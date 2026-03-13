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
        console.log("✅ Pedido registrado con éxito.");
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 3. LÓGICA DE IA (OPENROUTER) ---
async function generarRespuestaIA(query, modo, info = {}) {
    let systemPrompt = modo === "despedida" 
        ? `Eres un vendedor de maletas carismático. El cliente ${info.nombre} terminó. Agradece, cuenta un chiste corto de viajes y dile que escriba 'Hola' para volver.`
        : `Vendedor experto. El usuario preguntó: "${query}". Responde con humor breve, un chiste de maletas y regrésalo a ${info.paso} pidiendo su ${info.siguienteDato}.`;

    try {
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "google/gemini-2.0-flash-lite-preview-09-2025:free",
            messages: [{ "role": "system", "content": systemPrompt }, { "role": "user", "content": query }]
        }, {
            headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
            timeout: 4200
        });
        return response.data.choices[0].message.content;
    } catch (e) {
        return `¡Vaya ${info.nombre || 'viajero'}! Me distraje un segundo. 😂 ¿Sabías que las maletas no van a la escuela? ¡Porque ya están llenas! Pero dime, estábamos en ${info.paso}, ¿qué ${info.siguienteDato} prefieres?`;
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
        const usuario = getDato("usuario") || "Jaime";
        const califs = ["buena", "mala", "excelente", "deficiente", "regular", "pésima"];
        const esCalificacion = califs.some(c => userQuery.toLowerCase().includes(c));
        const enEncuesta = queryResult.outputContexts?.some(c => c.name.toLowerCase().includes("pasoencuesta"));

        // A) REINICIO TOTAL
        if (intentName.includes("9") || userQuery.toLowerCase() === "reiniciar") {
            const borrarTodo = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion", "PasoFinal", "InicioCompra", "PasoTamano", "PasoDosCompra"];
            return res.json({ fulfillmentText: "Escribe 'Hola' para empezar.", outputContexts: borrarTodo.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // B) PASO 6.1: REGISTRO FINAL (LA CLAVE ESTÁ AQUÍ)
        if (intentName.includes("6.1")) {
            const id = generarID();
            const prod = getDato("producto") || "Maleta"; const tam = getDato("tamano") || "Mediana";
            const precio = calcularPrecio(prod, tam);
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: getDato("color") || "Gris", precio });

            const resumen = `¡Listo, ${usuario}! 🎉 Pedido ID: ${id}\n🎒: ${prod}\n📏: ${tam}\n💰: ${precio}\n\n¿Deseas responder una encuesta?`;

            // MATAMOS TODOS LOS CONTEXTOS DE COMPRA (MAYÚSCULAS Y MINÚSCULAS)
            const contextosABorrar = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "PasoFinal", "InicioCompra", "PasoTamano", "PasoDosCompra"];
            const outCtxs = contextosABorrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            
            // Activamos SOLO el de encuesta
            outCtxs.push({ name: `${session}/contexts/pasoencuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentMessages: [{ "text": { "text": [resumen] } }, { "payload": { "facebook": { "attachment": { "type": "template", "payload": { "template_type": "button", "text": "Selecciona:", "buttons": [{ "type": "postback", "title": "Sí", "payload": "Si" }, { "type": "postback", "title": "No", "payload": "No" }] } } } } }],
                outputContexts: outCtxs
            });
        }

        // C) PASO 7.1: PREGUNTA ENCUESTA
        if (intentName.includes("7.1") || (enEncuesta && userQuery.toLowerCase().includes("si"))) {
            return res.json({ 
                fulfillmentText: `¡Genial, ${usuario}! ⭐ ¿Cómo calificarías tu experiencia? (Mala, Regular, Buena, Excelente)`,
                outputContexts: [{ name: `${session}/contexts/pasoencuesta`, lifespanCount: 0 }, { name: `${session}/contexts/esperandocalificacion`, lifespanCount: 1 }]
            });
        }

        // D) PASO 8: DESPEDIDA (IA CON CHISTE)
        if (intentName.includes("8") || intentName.includes("7.2") || esCalificacion) {
            const resp = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            const todos = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion", "PasoFinal", "InicioCompra", "PasoTamano", "PasoDosCompra"];
            return res.json({ fulfillmentText: resp, outputContexts: todos.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // E) IA INTERRUPCIONES
        let p = "el inicio", s = "producto";
        if (getDato("producto")) { p = "el tamaño"; s = "tamaño"; }
        if (getDato("tamano")) { p = "el color"; s = "color"; }
        
        const respIA = await generarRespuestaIA(userQuery, "interrupcion", { paso: p, siguienteDato: s, nombre: usuario });
        return res.json({ fulfillmentText: respIA });

    } catch (err) { return res.json({ fulfillmentText: "¡Excelente! ¿Confirmamos el pedido? 🧳" }); }
});

app.listen(process.env.PORT || 10000);

