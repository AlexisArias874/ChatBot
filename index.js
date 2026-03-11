const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- 1. MATRIZ DE PRECIOS DINÁMICA ---
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
        console.log("✅ Registro en Sheets exitoso");
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 3. LÓGICA DE IA CREATIVA (POLLINATIONS) ---
async function generarRespuestaIA(query, modo, infoVenta = {}) {
    let systemPrompt = "";
    
    if (modo === "despedida") {
        systemPrompt = `Vendedor carismático. El cliente ${infoVenta.nombre} terminó. Despídete, cuenta un chiste corto de maletas y dile que escriba 'Hola' para volver.`;
    } else if (modo === "interrupcion") {
        systemPrompt = `Vendedor experto. El usuario preguntó algo raro: "${query}". 
        1. Responde con humor breve. 
        2. ¡OBLIGATORIO! Cuenta un chiste de viajes corto. 
        3. Recuérdale que se quedó en: ${infoVenta.paso} y pregúntale por su ${infoVenta.siguienteDato}.`;
    } else {
        systemPrompt = "Vendedor experto de 'Venta de Equipaje'. Sé breve, amable y cierra con pregunta de venta.";
    }

    try {
        // Usamos modelo 'openai' para máxima velocidad (evita el timeout de 5s)
        const resp = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, {
            params: { system: systemPrompt, model: "openai", seed: Math.floor(Math.random() * 1000) },
            timeout: 3200 
        });
        return resp.data;
    } catch (e) { 
        return `¡Vaya, me distraje! 😅 Pero volviendo a lo importante, estábamos en ${infoVenta.paso}. ¿Qué ${infoVenta.siguienteDato} prefieres?`; 
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
                if (ctx.parameters && ctx.parameters[nombre]) {
                    v = ctx.parameters[nombre]; break;
                }
            }
        }
        if (v && typeof v === 'object' && v.name) v = v.name; 
        return v || null;
    };

    try {
        const usuario = getDato("usuario") || "Cliente";

        // Determinar en qué paso de la venta estamos para la IA
        let paso = "el inicio";
        let siguiente = "producto (mochila, maleta o bolso)";
        if (getDato("producto")) { paso = "la elección de tamaño"; siguiente = "tamaño (pequeña, mediana o grande)"; }
        if (getDato("tamano")) { paso = "la elección de color"; siguiente = "color (negra, blanca o gris)"; }
        if (getDato("color")) { paso = "la confirmación"; siguiente = "confirmación (Sí o No)"; }

        // REINICIO (INTENT 9)
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const ctxs = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "EsperandoCalificacion"];
            return res.json({
                fulfillmentText: "🧹 ¡Borrón y cuenta nueva! ¿Qué buscas hoy: mochila, maleta o bolso?",
                outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // REGISTRO FINAL (6.1)
        if (intentName === "6.1 PasoFinalSi") {
            const id = generarID();
            const prod = getDato("producto") || "Maleta";
            const tam = getDato("tamano") || "Mediana";
            const col = getDato("color") || "Gris";
            const precio = calcularPrecio(prod, tam);
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: col, precio });

            const resumen = `¡Listo, ${usuario}! 🎉 Tu pedido ha sido registrado.\n\n🆔 ID: ${id}\n🎒 Objeto: ${prod}\n📏 Tamaño: ${tam}\n💰 Precio: ${precio}\n\n¿Te gustaría responder una encuesta de satisfacción?`;
            
            return res.json({
                fulfillmentMessages: [{ "text": { "text": [resumen] } }, { "payload": { "facebook": { "attachment": { "type": "template", "payload": { "template_type": "button", "text": "Selecciona:", "buttons": [{ "type": "postback", "title": "Sí", "payload": "Si" }, { "type": "postback", "title": "No", "payload": "No" }] } } } } }],
                outputContexts: [{ name: `${session}/contexts/PasoEncuesta`, lifespanCount: 1 }]
            });
        }

        // ENCUESTA (7.1)
        if (intentName === "7.1 PasoEncuestaSi") {
            return res.json({ 
                fulfillmentText: `¡Genial, ${usuario}! ⭐ ¿Cómo calificarías tu experiencia? (Mala, Regular, Buena, Excelente)`,
                outputContexts: [{ name: `${session}/contexts/PasoEncuesta`, lifespanCount: 0 }, { name: `${session}/contexts/EsperandoCalificacion`, lifespanCount: 1 }]
            });
        }

        // DESPEDIDA (8 O 7.2)
        if (intentName === "8 PasoDespedida" || intentName === "7.2 PasoEncuestaNo") {
            const despedidaIA = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            const ctxs = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "EsperandoCalificacion"];
            return res.json({ fulfillmentText: despedidaIA, outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // IA CREATIVA (Para interrupciones o Fallback)
        const intentsVenta = ["3.1 CompraProducto", "4 SeleccionTamano", "5 SeleccionColor"];
        const modoIA = (intentName.includes("Fallback") || !intentsVenta.includes(intentName)) ? "interrupcion" : "normal";
        
        const respuestaIA = await generarRespuestaIA(userQuery, modoIA, { paso, siguienteDato: siguiente, nombre: usuario });
        return res.json({ fulfillmentText: respuestaIA });

    } catch (err) {
        return res.json({ fulfillmentText: "¡Qué buen punto! 🧳 Pero cuéntame, ¿confirmamos tu pedido?" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot Venta de Equipaje en puerto ${PORT}`));
