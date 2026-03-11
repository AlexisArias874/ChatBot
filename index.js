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
        await doc.sheetsByIndex[0].addRow({
            "ID_Pedido": d.id, "Fecha": new Date().toLocaleString(), "Usuario": d.usuario,
            "Producto": d.producto, "Tamaño": d.tamano, "Color": d.color, "Precio": d.precio, "Estado": "Pendiente"
        });
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 3. LÓGICA DE IA CON PERSONALIDAD ---
async function generarRespuestaIA(query, modo, nombre = "Cliente") {
    let systemPrompt = "";
    
    if (modo === "despedida") {
        systemPrompt = `Eres un vendedor de maletas carismático. El cliente ${nombre} ha terminado su interacción. 
        INSTRUCCIONES: 
        1. Despídete amablemente. 
        2. Dile claramente que para un nuevo pedido debe escribir 'Hola' para reiniciar. 
        3. ¡OBLIGATORIO! Cuenta un chiste corto y original relacionado con maletas, viajes o aeropuertos. 
        4. Sé creativo y usa emojis.`;
    } else {
        systemPrompt = "Eres un vendedor experto de maletas. Sé breve, amable y ayuda al cliente.";
    }

    try {
        const resp = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, {
            params: { system: systemPrompt, model: "mistral", seed: Math.floor(Math.random() * 1000) },
            timeout: 3000 
        });
        return resp.data;
    } catch (e) { 
        return `¡Gracias por todo, ${nombre}! Si quieres comprar otra cosa, solo escribe 'Hola' y ahí estaré. 🧳`; 
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

        // REINICIO MANUAL
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const ctxs = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta"];
            return res.json({
                fulfillmentText: "🧹 ¡Cero kilómetros! ¿Qué buscas hoy: mochila, maleta o bolso?",
                outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // REGISTRO DE PEDIDO (Paso 6.1)
        if (intentName === "6.1 PasoFinalSi") {
            const id = generarID();
            const prod = getDato("producto");
            const tam = getDato("tamano");
            const precio = calcularPrecio(prod, tam);
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: getDato("color"), precio });

            const resumen = `¡Listo, ${usuario}! 🎉 Pedido registrado.\n\n🆔 ID: ${id}\n🎒 Objeto: ${prod}\n📏 Tamaño: ${tam}\n💰 Precio: ${precio}\n\n¿Te gustaría responder una breve encuesta de satisfacción?`;
            
            const ctxsBorrar = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal"];
            const outCtxs = ctxsBorrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            outCtxs.push({ name: `${session}/contexts/PasoEncuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentMessages: [
                    { "text": { "text": [resumen] } },
                    { "payload": { "facebook": { "attachment": { "type": "template", "payload": { "template_type": "button", "text": "Selecciona:", "buttons": [{ "type": "postback", "title": "Sí", "payload": "Si" }, { "type": "postback", "title": "No", "payload": "No" }] } } } } }
                ],
                outputContexts: outCtxs
            });
        }

        // PREGUNTA DE ENCUESTA (Paso 7.1)
        if (intentName === "7.1 PasoEncuestaSi") {
            return res.json({ fulfillmentText: `¡Genial, ${usuario}! ⭐ ¿Cómo calificarías tu experiencia con nuestro chat? (Mala, Regular, Buena, Excelente)` });
        }

        // CIERRE CON IA Y CHISTE (Paso 7.2 o 8)
        if (intentName === "7.2 PasoEncuestaNo" || intentName === "8 PasoDespedida") {
            const despedidaIA = await generarRespuestaIA("Haz una despedida con chiste de maletas", "despedida", usuario);
            const ctxsFinales = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "PasoEncuesta"];
            
            return res.json({
                fulfillmentText: despedidaIA,
                outputContexts: ctxsFinales.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // IA PARA PRECIO Y OTROS
        const respuesta = await generarRespuestaIA(userQuery, "normal", usuario);
        return res.json({ fulfillmentText: respuesta });

    } catch (err) {
        return res.json({ fulfillmentText: "¡Excelente elección! ¿Confirmamos el pedido? 🧳" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));
