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
    const prod = p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "Maleta";
    const tam = t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "Mediana";
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
        console.log("✅ [Sheets] Pedido registrado correctamente.");
    } catch (e) { console.error("❌ [Sheets] Error de registro:", e.message); }
}

// --- 3. LÓGICA DE IA (POLLINATIONS) CON LOGS ---
async function generarRespuestaIA(query, modo, info = {}) {
    let systemPrompt = "";
    if (modo === "despedida") {
        systemPrompt = `Vendedor amable. El cliente ${info.nombre} terminó. Agradece, cuenta un chiste corto de maletas y dile que escriba 'Hola' para volver.`;
    } else {
        systemPrompt = `Vendedor experto. Axel preguntó: "${query}". Responde breve con humor, cuenta un chiste de maletas y regrésalo a ${info.paso} pidiendo su ${info.siguienteDato}.`;
    }

    console.log(`⏳ [IA] Conectando con Pollinations AI (Modelo: OpenAI)...`);

    try {
        const response = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, {
            params: { 
                system: systemPrompt, 
                model: "openai", 
                seed: Math.floor(Math.random() * 1000) 
            },
            timeout: 0 // TIEMPO INDEFINIDO
        });

        console.log("✅ [IA] Respuesta de Pollinations recibida con éxito.");
        return response.data;

    } catch (e) {
        console.error("❌ [IA] Fallo en el servicio Pollinations:", e.message);
        return `¡Vaya ${info.nombre}! Me distraje un segundo con las maletas. 😂 ¿Sabías que las maletas no van a la escuela? ¡Porque ya están llenas! Pero bueno, estábamos en ${info.paso}, ¿qué ${info.siguienteDato} prefieres?`;
    }
}

// --- 4. WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult, session } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Fallback";
    const userQuery = queryResult.queryText;

    const getDato = (nombre) => {
        let v = queryResult.parameters[nombre];
        if (!v && queryResult.outputContexts) {
            for (const ctx of queryResult.outputContexts) {
                if (ctx.parameters && ctx.parameters[nombre]) { v = ctx.parameters[nombre]; break; }
            }
        }
        return (v && typeof v === 'object' && v.name) ? v.name : (v || null);
    };

    try {
        const usuario = getDato("usuario") || getDato("person") || "Cliente";
        const enEncuesta = queryResult.outputContexts?.some(c => c.name.toLowerCase().includes("pasoencuesta"));
        const enCalificacion = queryResult.outputContexts?.some(c => c.name.toLowerCase().includes("esperandocalificacion"));

        let p = "inicio", s = "producto";
        if (getDato("producto")) { p = "tamaño"; s = "tamaño"; }
        if (getDato("tamano")) { p = "color"; s = "color"; }

        // A) REINICIO
        if (intentName.includes("9") || userQuery.toLowerCase() === "reiniciar") {
            const borrar = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({ fulfillmentText: "🧹 ¡Borrón y cuenta nueva! Escribe 'Hola' para empezar.", outputContexts: borrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // B) REGISTRO 6.1
        if (intentName.includes("6.1")) {
            const id = generarID();
            const prod = getDato("producto"); const tam = getDato("tamano");
            const precio = calcularPrecio(prod, tam);
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: getDato("color"), precio });

            const resumen = `¡Listo, ${usuario}! 🎉 Pedido ID: ${id}\n🎒: ${prod}\n📏: ${tam}\n💰: ${precio}\n\n¿Deseas responder una encuesta?`;
            const out = ["iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal"].map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            out.push({ name: `${session}/contexts/pasoencuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentMessages: [{ "text": { "text": [resumen] } }, { "payload": { "facebook": { "attachment": { "type": "template", "payload": { "template_type": "button", "text": "Selecciona:", "buttons": [{ "type": "postback", "title": "Sí", "payload": "Si" }, { "type": "postback", "title": "No", "payload": "No" }] } } } } }],
                outputContexts: out
            });
        }

        // C) ENCUESTA 7.1
        if (intentName.includes("7.1") || (enEncuesta && userQuery.toLowerCase().includes("si"))) {
            return res.json({ 
                fulfillmentText: `¡Genial, ${usuario}! ⭐ ¿Cómo calificarías tu experiencia?`,
                outputContexts: [{ name: `${session}/contexts/pasoencuesta`, lifespanCount: 0 }, { name: `${session}/contexts/esperandocalificacion`, lifespanCount: 1 }]
            });
        }

        // D) DESPEDIDA
        if (intentName.includes("8") || intentName.includes("7.2") || enCalificacion) {
            const resp = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            const todos = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({ fulfillmentText: resp, outputContexts: todos.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // E) IA GENERAL
        const respIA = await generarRespuestaIA(userQuery, "interrupcion", { paso: p, siguienteDato: s, nombre: usuario });
        return res.json({ fulfillmentText: respIA });

    } catch (err) { return res.json({ fulfillmentText: "¡Excelente! ¿Confirmamos el pedido? 🧳" }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor con Pollinations AI activo en puerto ${PORT}`));
