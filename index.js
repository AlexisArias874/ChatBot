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

// --- 2. GENERADOR DE ID ÚNICO ---
const generarID = () => `VE-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

// --- 3. CONFIGURACIÓN GOOGLE SHEETS ---
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
            "ID_Pedido": d.id,
            "Fecha": new Date().toLocaleString(),
            "Usuario": d.usuario,
            "Producto": d.producto,
            "Tamaño": d.tamano, 
            "Color": d.color,
            "Precio": d.precio,
            "Estado": "Pendiente"
        });
        console.log("✅ Registro exitoso en Sheets ID:", d.id);
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 4. LÓGICA DE IA (POLLINATIONS) ---
async function generarRespuestaIA(query) {
    const systemPrompt = "Vendedor experto de 'Venta de Equipaje'. Solo Mochila, Maleta, Bolso. Sé breve, amable y cierra con pregunta.";
    try {
        const resp = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, {
            params: { system: systemPrompt, model: "mistral", seed: Math.floor(Math.random() * 1000) },
            timeout: 2400 
        });
        return resp.data;
    } catch (e) { return "¡Excelente elección! 🧳 ¿Te gustaría confirmar el pedido?"; }
}

// --- 5. WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult, session } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Default";
    const userQuery = queryResult.queryText;

    // Función para extraer datos de la memoria (Contextos)
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
        // --- REINICIAR PROCESO (INTENT 9) ---
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const ctxs = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta"];
            return res.json({
                fulfillmentText: "🧹 Memoria limpia. ¿Qué buscas ahora: mochila, maleta o bolso?",
                outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        const usuario = getDato("usuario") || "Cliente";
        const producto = getDato("producto");
        const tamano = getDato("tamano");
        const color = getDato("color");

        // --- PRE-CONFIRMACIÓN (MUESTRA PRECIO - INTENT 5) ---
        if (intentName === "5 SeleccionColor") {
            const precio = calcularPrecio(producto, tamano);
            return res.json({ 
                fulfillmentText: `Perfecto ${usuario}, has seleccionado ${producto || 'un producto'} tamaño ${tamano || 'mediano'} de color ${color || 'gris'}. El costo total será de ${precio}. ¿Quieres confirmar tu pedido?` 
            });
        }

        // --- REGISTRO ÚNICO Y LIMPIEZA DE CONTEXTOS (INTENT 6.1) ---
        if (intentName === "6.1 PasoFinalSi") {
            const id = generarID();
            const precio = calcularPrecio(producto, tamano);
            
            await registrarEnSheets({ id, usuario, producto, tamano, color, precio });

            const resumen = `¡Listo, ${usuario}! 🎉 Tu pedido ha sido registrado.\n\n` +
                            `🆔 ID: ${id}\n🎒 Objeto: ${producto}\n📏 Tamaño: ${tamano}\n💰 Precio: ${precio}\n\n` +
                            `¿Te gustaría responder una breve encuesta de satisfacción?`;

            // Borramos contextos de compra y activamos encuesta
            const ctxsBorrar = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal"];
            const outCtxs = ctxsBorrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            outCtxs.push({ name: `${session}/contexts/PasoEncuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentMessages: [
                    { "text": { "text": [resumen] } },
                    {
                        "payload": {
                            "facebook": {
                                "attachment": {
                                    "type": "template",
                                    "payload": {
                                        "template_type": "button",
                                        "text": "Selecciona una opción:",
                                        "buttons": [
                                            { "type": "postback", "title": "Sí", "payload": "Si" },
                                            { "type": "postback", "title": "No", "payload": "No" }
                                        ]
                                    }
                                }
                            }
                        }
                    }
                ],
                outputContexts: outCtxs
            });
        }

        // --- RESPUESTA DE ENCUESTA (INTENT 7.1) ---
        if (intentName === "7.1 PasoEncuestaSi") {
            return res.json({ 
                fulfillmentText: "¡Genial! ⭐ Cuéntanos, ¿cómo calificarías tu experiencia con nuestro chat automatizado?" 
            });
        }

        // --- DESPEDIDA FINAL Y CIERRE TOTAL (INTENT 8 O 7.2) ---
        // Este bloque es el que detiene el bucle de "Muy malo"
        if (intentName === "8 PasoDespedida" || intentName === "7.2 PasoEncuestaNo") {
            console.log("✅ Cerrando sesión final.");
            const ctxsFinales = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "PasoEncuesta"];
            return res.json({
                fulfillmentText: `¡Muchas gracias por tus comentarios, ${usuario}! 🙏 Nos ayudan a mejorar cada día. Que tengas un excelente viaje. ✈️ (Si necesitas algo más, solo escribe 'Hola'). ¡Hasta pronto!`,
                outputContexts: ctxsFinales.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // --- IA PARA EL RESTO DE CONSULTAS ---
        const respuestaIA = await generarRespuestaIA(userQuery);
        return res.json({ fulfillmentText: respuestaIA });

    } catch (err) {
        console.error("Error Webhook:", err.message);
        res.json({ fulfillmentText: "¡Excelente! ¿Confirmamos el pedido? 🧳" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor Venta de Equipaje Activo`));
