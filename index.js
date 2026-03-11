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
        console.log("✅ Registro exitoso ID:", d.id);
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 4. LÓGICA DE IA (POLLINATIONS) ---
async function generarRespuestaIA(query) {
    const systemPrompt = "Vendedor de maletas experto. Sé breve y amable.";
    try {
        const resp = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, {
            params: { system: systemPrompt, model: "mistral", seed: Math.floor(Math.random() * 1000) },
            timeout: 2400 
        });
        return resp.data;
    } catch (e) { return "¡Excelente elección! ¿Confirmamos el pedido? 🧳"; }
}

// --- 5. WEBHOOK PRINCIPAL ---
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
        // --- REINICIAR (INTENT 9) ---
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const ctxs = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "pasoencuestasi"];
            return res.json({
                fulfillmentText: "Memoria limpia. Escribe "Hola"",
                outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        const usuario = getDato("usuario") || "Cliente";

        // --- 5 SELECCIÓN COLOR / PRECIO ---
        if (intentName === "5 SeleccionColor") {
            const prod = getDato("producto");
            const tam = getDato("tamano");
            const col = getDato("color");
            const precio = calcularPrecio(prod, tam);
            return res.json({ 
                fulfillmentText: `Perfecto ${usuario}, has seleccionado ${prod} tamaño ${tam} de color ${col}. El costo total será de ${precio}. ¿Quieres confirmar tu pedido?` 
            });
        }

        // --- 6.1 REGISTRO DE PEDIDO ---
        if (intentName === "6.1 PasoFinalSi") {
            const id = generarID();
            const prod = getDato("producto");
            const tam = getDato("tamano");
            const col = getDato("color");
            const precio = calcularPrecio(prod, tam);
            
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: col, precio });

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

        // --- 7.1 RESPUESTA SI A ENCUESTA ---
        if (intentName === "7.1 PasoEncuestaSi") {
            return res.json({ fulfillmentText: "¡Genial! ⭐ ¿Cómo calificarías tu experiencia con nuestro chat?" });
        }

        // --- DESPEDIDA FINAL (7.2 O 8) ---
        // Este bloque ahora maneja el "No" a la encuesta usando el nombre dinámico
        if (intentName === "7.2 PasoEncuestaNo" || intentName === "8 PasoDespedida") {
            const ctxsFinales = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "pasoencuestasi"];
            return res.json({
                fulfillmentText: `¡Muchas gracias por tu tiempo, ${usuario}! 🙏 Esperamos verte de regreso pronto. ¡Que tengas un excelente viaje! ✈️ (Si necesitas algo más, solo escribe 'Hola')`,
                outputContexts: ctxsFinales.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // IA para otros mensajes
        const respuesta = await generarRespuestaIA(userQuery);
        return res.json({ fulfillmentText: respuesta });

    } catch (err) {
        return res.json({ fulfillmentText: "¡Excelente! ¿Confirmamos el pedido? 🧳" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor Venta de Equipaje Activo`));

