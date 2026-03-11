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

// --- 3. IA CREATIVA CON MEMORIA DE PASO ---
async function generarRespuestaIA(query, modo, infoVenta = {}) {
    let systemPrompt = "";
    
    if (modo === "despedida") {
        systemPrompt = `Eres un vendedor carismático. El cliente ${infoVenta.nombre} terminó. Despídete, cuenta un chiste de maletas y dile que escriba 'Hola' para volver.`;
    } else if (modo === "interrupcion") {
        systemPrompt = `Eres un vendedor de maletas experto. El usuario te preguntó algo fuera de contexto: "${query}". 
        INSTRUCCIONES:
        1. Responde su duda brevemente y con humor.
        2. ¡OBLIGATORIO! Cuenta un chiste corto de viajes o maletas.
        3. Recuérdale amablemente que se quedó en el paso de: ${infoVenta.paso}.
        4. Hazle una pregunta para que elija su ${infoVenta.siguienteDato} y continuar la compra.`;
    } else {
        systemPrompt = "Vendedor experto de maletas. Ayuda al cliente, sé breve y cierra con pregunta de venta.";
    }

    try {
        const resp = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, {
            params: { system: systemPrompt, model: "mistral", seed: Math.floor(Math.random() * 1000) },
            timeout: 3000 
        });
        return resp.data;
    } catch (e) { return "¡Excelente! ¿Seguimos con tu pedido? 🧳"; }
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

        // --- DETECCIÓN DE PASO ACTUAL (Para la IA) ---
        let pasoActual = "eligiendo su equipo";
        let siguienteDato = "producto (mochila, maleta o bolso)";
        if (getDato("producto")) { pasoActual = "elegir el tamaño"; siguienteDato = "tamaño (pequeña, mediana o grande)"; }
        if (getDato("tamano")) { pasoActual = "elegir el color"; siguienteDato = "color (negro, blanco o gris)"; }
        if (getDato("color")) { pasoActual = "confirmar el pedido"; siguienteDato = "confirmación (Sí o No)"; }

        // --- REINICIO (INTENT 9) ---
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const ctxs = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "EsperandoCalificacion"];
            return res.json({
                fulfillmentText: "🧹 ¡Todo listo para empezar de nuevo! ¿Qué buscas hoy: mochila, maleta o bolso?",
                outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // --- REGISTRO 6.1 ---
        if (intentName === "6.1 PasoFinalSi") {
            const id = generarID();
            const prod = getDato("producto");
            const tam = getDato("tamano");
            const col = getDato("color");
            const precio = calcularPrecio(prod, tam);
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: col, precio });
            
            const resumen = `¡Listo, ${usuario}! 🎉 Pedido registrado.\n\n🆔 ID: ${id}\n🎒 Objeto: ${prod}\n📏 Tamaño: ${tam}\n💰 Precio: ${precio}\n\n¿Te gustaría responder una encuesta?`;
            return res.json({
                fulfillmentMessages: [{ "text": { "text": [resumen] } }, { "payload": { "facebook": { "attachment": { "type": "template", "payload": { "template_type": "button", "text": "Selecciona:", "buttons": [{ "type": "postback", "title": "Sí", "payload": "Si" }, { "type": "postback", "title": "No", "payload": "No" }] } } } } }],
                outputContexts: [{ name: `${session}/contexts/PasoEncuesta`, lifespanCount: 1 }]
            });
        }

        // --- ENCUESTA 7.1 ---
        if (intentName === "7.1 PasoEncuestaSi") {
            return res.json({ 
                fulfillmentText: `¡Genial! ⭐ ¿Cómo calificarías tu experiencia?`,
                outputContexts: [{ name: `${session}/contexts/PasoEncuesta`, lifespanCount: 0 }, { name: `${session}/contexts/EsperandoCalificacion`, lifespanCount: 1 }]
            });
        }

        // --- DESPEDIDA 8 / 7.2 ---
        if (intentName === "8 PasoDespedida" || intentName === "7.2 PasoEncuestaNo") {
            const respIA = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            const ctxs = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "EsperandoCalificacion"];
            return res.json({ fulfillmentText: respIA, outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })) });
        }

        // --- IA PARA PREGUNTAS GENERALES O PASOS INTERMEDIOS ---
        // Si no es ninguno de los intents "críticos", la IA maneja la charla y regresa al flujo
        const esPasoVenta = ["3.1 CompraProducto", "4 SeleccionTamano", "5 SeleccionColor"].includes(intentName);
        const modoIA = esPasoVenta ? "normal" : "interrupcion";
        
        const respuesta = await generarRespuestaIA(userQuery, modoIA, { nombre: usuario, paso: pasoActual, siguienteDato: siguienteDato });
        return res.json({ fulfillmentText: respuesta });

    } catch (err) {
        return res.json({ fulfillmentText: "¡Excelente elección! ¿Confirmamos el pedido? 🧳" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot Inteligente en puerto ${PORT}`));
