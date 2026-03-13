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
        systemPrompt = `Vendedor amable. El cliente ${info.nombre} terminó. Agradece, cuenta un chiste corto de maletas y dile que escriba 'Hola' para volver.`;
    } else if (modo === "interrupcion") {
        systemPrompt = `Eres un vendedor de maletas experto y carismático. El usuario ${info.nombre} te preguntó: "${query}". 
        INSTRUCCIONES:
        1. Responde PRIMERO su duda de forma inteligente y amable.
        2. ¡OBLIGATORIO! Cuenta un chiste de viajes corto.
        3. Regrésalo suavemente a la venta. Recuérdale que se quedó en: ${info.paso}.
        4. Pregúntale qué ${info.siguienteDato} prefiere para continuar.`;
    } else {
        systemPrompt = `Vendedor experto de 'Venta de Equipaje'. Ayuda a ${info.nombre} a elegir su equipo. Sé breve y amable.`;
    }

    try {
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "google/gemini-2.0-flash-lite-preview-09-2025:free",
            messages: [{ "role": "system", "content": systemPrompt }, { "role": "user", "content": query }]
        }, {
            headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
            timeout: 4500
        });
        return response.data.choices[0].message.content;
    } catch (e) {
        // RESPUESTA DE EMERGENCIA SI FALLA LA API
        return `¡Vaya ${info.nombre || 'viajero'}! Me distraje un segundo con el inventario. 😂 Pero bueno, estábamos en ${info.paso || 'el inicio'}, ¿qué ${info.siguienteDato || 'producto'} prefieres?`;
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
        const usuario = getDato("usuario") || getDato("person") || "Jaime";
        const enCalificacion = queryResult.outputContexts?.some(c => c.name.toLowerCase().includes("esperandocalificacion"));

        // DETECCIÓN DE PASO ACTUAL
        let p = "el inicio del catálogo", s = "producto";
        if (getDato("producto")) { p = "la elección del tamaño"; s = "tamaño"; }
        if (getDato("tamano")) { p = "la elección del color"; s = "color"; }
        if (getDato("color")) { p = "la confirmación final"; s = "confirmación (Sí o No)"; }

        // A) REINICIO
        if (intentName.includes("9") || userQuery.toLowerCase() === "reiniciar") {
            const borrar = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({ fulfillmentText: "🧹 ¡Todo listo! Escribe 'Hola' para empezar de nuevo.", outputContexts: borrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // B) REGISTRO 6.1
        if (intentName.includes("6.1")) {
            const id = generarID();
            const prod = getDato("producto") || "Maleta"; const tam = getDato("tamano") || "Mediana";
            const precio = calcularPrecio(prod, tam);
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: getDato("color") || "Gris", precio });

            const resumen = `¡Listo, ${usuario}! 🎉 Pedido registrado ID: ${id}\n🎒: ${prod}\n📏: ${tam}\n💰: ${precio}\n\n¿Deseas responder una encuesta?`;
            const borrar = ["iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal"];
            const out = borrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            out.push({ name: `${session}/contexts/pasoencuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentMessages: [{ "text": { "text": [resumen] } }, { "payload": { "facebook": { "attachment": { "type": "template", "payload": { "template_type": "button", "text": "Selecciona:", "buttons": [{ "type": "postback", "title": "Sí", "payload": "Si" }, { "type": "postback", "title": "No", "payload": "No" }] } } } } }],
                outputContexts: out
            });
        }

        // C) DESPEDIDA / CIERRE
        if (intentName.includes("8") || intentName.includes("7.2") || enCalificacion) {
            const resp = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            const todos = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({ fulfillmentText: resp, outputContexts: todos.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // D) IA PARA INTERRUPCIONES (PIZZA, PREGUNTAS GENERALES)
        const intentsVenta = ["3.1", "4", "5"];
        const esVenta = intentsVenta.some(i => intentName.includes(i));
        const modo = (!esVenta || intentName.includes("Fallback")) ? "interrupcion" : "normal";

        const respIA = await generarRespuestaIA(userQuery, modo, { paso: p, siguienteDato: s, nombre: usuario });
        return res.json({ fulfillmentText: respIA });

    } catch (err) { return res.json({ fulfillmentText: "¡Excelente punto! 🧳 Pero cuéntame, ¿confirmamos tu pedido?" }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));
