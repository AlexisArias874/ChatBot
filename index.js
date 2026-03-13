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

// --- 3. LÓGICA DE IA (OPENROUTER) CON REDIRECCIÓN ---
async function generarRespuestaIA(query, modo, infoVenta = {}) {
    let systemPrompt = "";
    
    if (modo === "interrupcion") {
        // Instrucción especial para cuando el usuario se sale del tema
        systemPrompt = `Eres el vendedor estrella de 'Venta de Equipaje'. El usuario se distrajo preguntando: "${query}". 
        INSTRUCCIONES:
        1. Responde con ingenio y brevedad (relacionado con maletas si es posible).
        2. ¡OBLIGATORIO! Cuenta una broma corta de viajes o aeropuertos.
        3. Regresa al usuario al proceso de venta amablemente. 
        4. Recuérdale que se quedó en el paso de: ${infoVenta.paso}.
        5. Pregúntale por su ${infoVenta.siguienteDato} para continuar.`;
    } else if (modo === "despedida") {
        systemPrompt = `Vendedor amable. El cliente ${infoVenta.nombre} terminó. Despídete, cuenta un chiste de maletas y dile que escriba 'Hola' para volver.`;
    } else {
        systemPrompt = "Eres un vendedor experto de maletas. Sé breve, amable y cierra con pregunta de venta.";
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
        return `¡Vaya, me distraje! 😅 Pero volviendo a lo nuestro, estábamos en el paso de ${infoVenta.paso}, ¿qué ${infoVenta.siguienteDato} prefieres?`;
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

        // --- DETECTAR EL PASO ACTUAL PARA RE-DIRIGIR ---
        let pasoActual = "inicio del catálogo";
        let datoFaltante = "producto (mochila, maleta o bolso)";
        
        if (getDato("producto")) { pasoActual = "seleccionar el tamaño"; datoFaltante = "tamaño (pequeña, mediana o grande)"; }
        if (getDato("tamano")) { pasoActual = "elegir el color"; datoFaltante = "color (negro, blanco o gris)"; }
        if (getDato("color")) { pasoActual = "confirmar tu pedido"; datoFaltante = "confirmación (Sí o No)"; }

        // --- REINICIO TOTAL ---
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const ctxs = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({
                fulfillmentText: "🧹 ¡Borrón y cuenta nueva! Escribe 'Hola' para empezar de nuevo.",
                outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // --- REGISTRO FINAL (6.1) ---
        if (intentName === "6.1 PasoFinalSi") {
            const id = generarID();
            const prod = getDato("producto"); const tam = getDato("tamano"); const col = getDato("color");
            const precio = calcularPrecio(prod, tam);
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: col, precio });
            
            const resumen = `¡Listo, ${usuario}! 🎉 Pedido registrado ID: ${id}\n🎒: ${prod}\n📏: ${tam}\n💰: ${precio}\n\n¿Encuesta de satisfacción?`;
            const borrar = ["iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal"];
            const outCtxs = borrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            outCtxs.push({ name: `${session}/contexts/pasoencuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentMessages: [{ "text": { "text": [resumen] } }, { "payload": { "facebook": { "attachment": { "type": "template", "payload": { "template_type": "button", "text": "Selecciona:", "buttons": [{ "type": "postback", "title": "Sí", "payload": "Si" }, { "type": "postback", "title": "No", "payload": "No" }] } } } } }],
                outputContexts: outCtxs
            });
        }

        // --- DESPEDIDA (8 O 7.2) ---
        if (intentName === "8 PasoDespedida" || intentName === "7.2 PasoEncuestaNo" || (intentName.includes("Fallback") && queryResult.outputContexts?.some(c => c.name.includes("esperandocalificacion")))) {
            const respIA = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            const ctxs = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({ fulfillmentText: respIA, outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // --- LÓGICA DE CHARLA CREATIVA (FALLBACK O INTERRUPCIÓN) ---
        const intentsVenta = ["3.1 CompraProducto", "4 SeleccionTamano", "5 SeleccionColor"];
        const modoIA = (intentName.includes("Fallback") || !intentsVenta.includes(intentName)) ? "interrupcion" : "normal";
        
        const respuestaIA = await generarRespuestaIA(userQuery, modoIA, { paso: pasoActual, siguienteDato: datoFaltante, nombre: usuario });
        return res.json({ fulfillmentText: respuestaIA });

    } catch (err) {
        console.error("Error:", err.message);
        return res.json({ fulfillmentText: "¡Qué buen punto! 🧳 Pero volviendo a lo nuestro, ¿confirmamos tu pedido?" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot Maestro de Equipaje Activo`));
