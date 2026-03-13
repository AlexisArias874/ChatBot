const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- 1. CONFIGURACIÓN DE NEGOCIO ---
const PRECIOS = {
    "Mochila": { "Pequeña": "$600", "Mediana": "$850", "Grande": "$1,100" },
    "Maleta": { "Pequeña": "$1,200", "Mediana": "$1,500", "Grande": "$2,000" },
    "Bolso": { "Pequeña": "$400", "Mediana": "$600", "Grande": "$850" }
};

const calcularPrecio = (p, t) => {
    const prod = p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
    const tam = t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "";
    return (PRECIOS[prod] && PRECIOS[prod][tam]) ? `${PRECIOS[prod][tam]} MXN` : "$1,500 MXN";
};

const generarID = () => `VE-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

// --- 2. CONFIGURACIÓN GOOGLE SHEETS ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

async function registrarEnSheets(d) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        await sheet.addRow({
            "ID_Pedido": d.id, "Fecha": new Date().toLocaleString(), "Usuario": d.usuario,
            "Producto": d.producto, "Tamaño": d.tamano, "Color": d.color, "Precio": d.precio, "Estado": "Pendiente"
        });
        console.log("✅ Fila escrita en Sheets");
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 3. LÓGICA DE IA (OPENROUTER) ---
async function generarRespuestaIA(query, modo, info = {}) {
    let systemPrompt = "";
    if (modo === "despedida") {
        systemPrompt = `Eres un vendedor amable. El cliente ${info.nombre} terminó. Agradece, cuenta un chiste corto de maletas y dile que escriba 'Hola' para volver.`;
    } else {
        systemPrompt = `Eres el vendedor estrella de 'Venta de Equipaje'. El usuario Axel se distrajo y preguntó: "${query}". 
        RESPONDE: 1. Breve con humor. 2. Cuenta un chiste de maletas. 3. Regrésalo al paso de ${info.paso} pidiendo su ${info.siguienteDato}.`;
    }

    try {
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "google/gemini-2.0-flash-lite-preview-09-2025:free",
            messages: [{ "role": "system", "content": systemPrompt }, { "role": "user", "content": query }]
        }, {
            headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
            timeout: 4500 // Tiempo máximo de espera
        });
        return response.data.choices[0].message.content;
    } catch (e) {
        console.error("❌ Falló la IA de OpenRouter:", e.message);
        // Si la IA falla, damos una respuesta manual CREATIVA de respaldo
        return `¡Vaya Axel! Me quedé pensando en esa pregunta de "${query}", pero me distraje acomodando las correas. 😂 Por cierto, un chiste: ¿Qué le dijo una maleta a la otra? "¡Qué pesado eres!". Pero bueno, volviendo a lo nuestro, estábamos en ${info.paso}, ¿qué ${info.siguienteDato} prefieres?`;
    }
}

// --- 4. WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult, session } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Default Fallback Intent";
    const userQuery = queryResult.queryText;

    const getDato = (nombre) => {
        let v = queryResult.parameters[nombre];
        if (!v && queryResult.outputContexts) {
            for (const ctx of queryResult.outputContexts) {
                if (ctx.parameters && ctx.parameters[nombre]) { v = ctx.parameters[nombre]; break; }
            }
        }
        if (v && typeof v === 'object' && v.name) v = v.name; 
        return v || null;
    };

    try {
        const usuario = getDato("usuario") || "Axel";
        const enCalificacion = queryResult.outputContexts?.some(c => c.name.toLowerCase().includes("esperandocalificacion"));

        // --- DETECTAR PASO ACTUAL ---
        let paso = "el inicio del catálogo", siguiente = "producto";
        if (getDato("producto")) { paso = "la elección del tamaño"; siguiente = "tamaño"; }
        if (getDato("tamano")) { paso = "la elección del color"; siguiente = "color"; }
        if (getDato("color")) { paso = "la confirmación final"; siguiente = "confirmación (Sí o No)"; }

        // REINICIO
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const borrar = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({
                fulfillmentText: "🧹 ¡Memoria limpia! Escribe 'Hola' para ver nuestras maletas de nuevo.",
                outputContexts: borrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // REGISTRO FINAL (6.1)
        if (intentName === "6.1 PasoFinalSi") {
            const id = generarID();
            const prod = getDato("producto"); const tam = getDato("tamano"); const col = getDato("color");
            const precio = calcularPrecio(prod, tam);
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: col, precio });
            
            const resumen = `¡Listo, ${usuario}! 🎉 Pedido ID: ${id}\n🎒: ${prod}\n📏: ${tam}\n💰: ${precio}\n\n¿Deseas responder una encuesta?`;
            const out = ["iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal"].map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            out.push({ name: `${session}/contexts/pasoencuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentMessages: [{ "text": { "text": [resumen] } }, { "payload": { "facebook": { "attachment": { "type": "template", "payload": { "template_type": "button", "text": "Selecciona:", "buttons": [{ "type": "postback", "title": "Sí", "payload": "Si" }, { "type": "postback", "title": "No", "payload": "No" }] } } } } }],
                outputContexts: out
            });
        }

        // DESPEDIDA (8 O 7.2 O FALLBACK EN CALIFICACIÓN)
        if (intentName === "8 PasoDespedida" || intentName === "7.2 PasoEncuestaNo" || (intentName.includes("Fallback") && enCalificacion)) {
            const respIA = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            const todos = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({ fulfillmentText: respIA, outputContexts: todos.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // --- IA PARA INTERRUPCIONES (PIZZA, PERROS, ETC) ---
        const esVenta = ["3.1 CompraProducto", "4 SeleccionTamano", "5 SeleccionColor"].includes(intentName);
        const modoIA = (intentName.includes("Fallback") || !esVenta) ? "interrupcion" : "normal";
        
        const respuestaIA = await generarRespuestaIA(userQuery, modoIA, { paso, siguienteDato: siguiente, nombre: usuario });
        return res.json({ fulfillmentText: respuestaIA });

    } catch (err) {
        return res.json({ fulfillmentText: "¡Excelente punto! 🧳 Pero volviendo a lo nuestro, ¿confirmamos tu pedido?" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot Maestro en puerto ${PORT}`));
