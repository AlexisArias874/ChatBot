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
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 3. LÓGICA DE IA (OPENROUTER) ---
async function generarRespuestaIA(query, modo, info = {}) {
    let systemPrompt = "";
    if (modo === "despedida") {
        systemPrompt = `Eres un vendedor de maletas carismático. El cliente ${info.nombre} acaba de calificar el servicio. 
        INSTRUCCIONES: 1. Agradece brevemente. 2. Cuenta un chiste corto de maletas o viajes. 3. Dile que escriba 'Hola' para un nuevo pedido. 4. Despídete con muchos emojis.`;
    } else {
        systemPrompt = `Vendedor experto. El usuario preguntó: "${query}". Responde brevemente con humor, cuenta un chiste de viajes y regrésalo al paso de ${info.paso} pidiendo su ${info.siguienteDato}.`;
    }

    try {
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "google/gemini-2.0-flash-lite-preview-09-2025:free",
            messages: [{ "role": "system", "content": systemPrompt }, { "role": "user", "content": query }]
        }, {
            headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
            timeout: 4000
        });
        return response.data.choices[0].message.content;
    } catch (e) {
        return `¡Gracias por visitarnos, ${info.nombre}! 🙌 Si quieres iniciar un nuevo pedido, solo escribe 'Hola'. ¡Buen viaje! ✈️`;
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
        const usuario = getDato("usuario") || "Cliente";
        const enCalificacion = queryResult.outputContexts?.some(c => c.name.toLowerCase().includes("esperandocalificacion"));

        // --- REINICIO ---
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const borrar = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({
                fulfillmentText: "🧹 Memoria limpia. Escribe 'Hola' para empezar de nuevo.",
                outputContexts: borrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // --- 6.1 REGISTRO FINAL ---
        if (intentName === "6.1 PasoFinalSi") {
            const id = generarID();
            const prod = getDato("producto") || "Maleta";
            const tam = getDato("tamano") || "Mediana";
            const col = getDato("color") || "Gris";
            const precio = calcularPrecio(prod, tam);
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: col, precio });

            const resumen = `¡Listo, ${usuario}! 🎉 Pedido registrado ID: ${id}\n🎒: ${prod}\n📏: ${tam}\n💰: ${precio}\n\n¿Deseas responder una encuesta?`;
            
            const borrarVenta = ["iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal"];
            const outCtxs = borrarVenta.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            outCtxs.push({ name: `${session}/contexts/pasoencuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentMessages: [{ "text": { "text": [resumen] } }, { "payload": { "facebook": { "attachment": { "type": "template", "payload": { "template_type": "button", "text": "Selecciona:", "buttons": [{ "type": "postback", "title": "Sí", "payload": "Si" }, { "type": "postback", "title": "No", "payload": "No" }] } } } } }],
                outputContexts: outCtxs
            });
        }

        // --- 7.1 PREGUNTA ENCUESTA ---
        if (intentName === "7.1 PasoEncuestaSi") {
            return res.json({ 
                fulfillmentText: `¡Genial, ${usuario}! ⭐ ¿Cómo calificarías tu experiencia? (Mala, Regular, Buena, Excelente)`,
                outputContexts: [{ name: `${session}/contexts/pasoencuesta`, lifespanCount: 0 }, { name: `${session}/contexts/esperandocalificacion`, lifespanCount: 1 }]
            });
        }

        // --- 8 / 7.2 DESPEDIDA (LA TRAMPA PARA EL BUCLE) ---
        // Si el intent es despedida O si estamos en la fase de calificación (aunque no entienda la palabra)
        if (intentName === "8 PasoDespedida" || intentName === "7.2 PasoEncuestaNo" || enCalificacion) {
            const despedida = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            const todos = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({
                fulfillmentText: despedida,
                outputContexts: todos.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // --- IA PARA INTERRUPCIONES ---
        let paso = "inicio", sig = "producto";
        if (getDato("producto")) { paso = "el tamaño"; sig = "tamaño"; }
        if (getDato("tamano")) { paso = "el color"; sig = "color"; }

        const respuestaIA = await generarRespuestaIA(userQuery, "interrupcion", { paso, siguienteDato: sig, nombre: usuario });
        return res.json({ fulfillmentText: respuestaIA });

    } catch (err) { return res.json({ fulfillmentText: "¡Excelente! ¿Confirmamos el pedido? 🧳" }); }
});

app.listen(process.env.PORT || 10000);
