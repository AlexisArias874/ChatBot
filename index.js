const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- 1. MATRIZ DE PRECIOS ---
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
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 3. LÓGICA DE IA (OPENROUTER) ---
async function generarRespuestaIA(query, modo, info = {}) {
    let systemPrompt = "";
    if (modo === "despedida") {
        systemPrompt = `Vendedor amable. El cliente ${info.nombre} terminó. Agradece, cuenta un chiste corto de viajes y dile que escriba 'Hola' para volver.`;
    } else {
        systemPrompt = `Vendedor experto de maletas. El cliente ${info.nombre} preguntó: "${query}". Responde brevemente con humor, cuenta un chiste y regrésalo a ${info.paso} pidiendo su ${info.siguienteDato}.`;
    }

    try {
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "google/gemini-2.0-flash-lite-preview-09-2025:free",
            messages: [{ "role": "system", "content": systemPrompt }, { "role": "user", "content": query }]
        }, {
            headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
            timeout: 3800 // Tiempo justo para evitar reintentos de Facebook
        });
        return response.data.choices[0].message.content;
    } catch (e) {
        // RESPUESTA MANUAL DE EMERGENCIA (Si la IA falla o tarda)
        if (info.paso.includes("catálogo") || info.paso.includes("inicio")) {
            return `¡Excelente elección, ${info.nombre}! El Bolso es de lo más pedido. 👜 ¿Qué tamaño prefieres: Pequeña, Mediana o Grande?`;
        }
        return `¡Vaya ${info.nombre}! Me distraje un segundo. 😂 Pero bueno, estábamos en ${info.paso}, ¿qué ${info.siguienteDato} prefieres?`;
    }
}

// --- 4. WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult, session } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Default";
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
        const usuario = getDato("usuario") || getDato("person") || "Cliente";
        const enEncuesta = queryResult.outputContexts?.some(c => c.name.toLowerCase().includes("pasoencuesta"));
        const enCalificacion = queryResult.outputContexts?.some(c => c.name.toLowerCase().includes("esperandocalificacion"));

        // DETECCIÓN DE PASO ACTUAL
        let p = "el inicio del catálogo", s = "producto";
        const prodAct = getDato("producto");
        const tamAct = getDato("tamano");
        const colAct = getDato("color");

        if (prodAct) { p = "el tamaño"; s = "tamaño"; }
        if (tamAct) { p = "el color"; s = "color"; }
        if (colAct) { p = "la confirmación"; s = "confirmación"; }

        // A) REINICIO
        if (intentName.includes("9") || userQuery.toLowerCase() === "reiniciar") {
            const borrar = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({ fulfillmentText: "🧹 ¡Borrón y cuenta nueva! Escribe 'Hola' para ver nuestras maletas.", outputContexts: borrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // B) REGISTRO 6.1
        if (intentName.includes("6.1")) {
            const id = generarID();
            const precio = calcularPrecio(prodAct, tamAct);
            await registrarEnSheets({ id, usuario, producto: prodAct, tamano: tamAct, color: colAct, precio });

            const resumen = `¡Listo, ${usuario}! 🎉 Pedido ID: ${id}\n🎒: ${prodAct}\n📏: ${tamAct}\n💰: ${precio}\n\n¿Deseas responder una encuesta?`;
            const borrar = ["iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal"];
            const out = borrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            out.push({ name: `${session}/contexts/pasoencuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentMessages: [{ "text": { "text": [resumen] } }, { "payload": { "facebook": { "attachment": { "type": "template", "payload": { "template_type": "button", "text": "Selecciona:", "buttons": [{ "type": "postback", "title": "Sí", "payload": "Si" }, { "type": "postback", "title": "No", "payload": "No" }] } } } } }],
                outputContexts: out
            });
        }

        // C) ENCUESTA 7.1
        if (intentName.includes("7.1") || (enEncuesta && userQuery.toLowerCase().includes("si"))) {
            return res.json({ 
                fulfillmentText: `¡Genial, ${usuario}! ⭐ ¿Cómo calificarías tu experiencia? (Mala, Regular, Buena, Excelente)`,
                outputContexts: [{ name: `${session}/contexts/pasoencuesta`, lifespanCount: 0 }, { name: `${session}/contexts/esperandocalificacion`, lifespanCount: 1 }]
            });
        }

        // D) DESPEDIDA 8 / 7.2
        if (intentName.includes("8") || intentName.includes("7.2") || enCalificacion) {
            const respIA = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            const todos = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({ fulfillmentText: respIA, outputContexts: todos.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // E) IA PARA INTERRUPCIONES Y FLUJO NORMAL
        const respIA = await generarRespuestaIA(userQuery, "normal", { paso: p, siguienteDato: s, nombre: usuario });
        return res.json({ fulfillmentText: respIA });

    } catch (err) {
        return res.json({ fulfillmentText: "¡Qué buen punto! 🧳 Pero cuéntame, ¿qué producto prefieres?" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));
