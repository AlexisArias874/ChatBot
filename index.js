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
        await doc.sheetsByIndex[0].addRow({
            "ID_Pedido": d.id,
            "Fecha": new Date().toLocaleString(),
            "Usuario": d.usuario,
            "Producto": d.producto,
            "Tamaño": d.tamano, // Usando la Ñ para coincidir con el Excel
            "Color": d.color,
            "Precio": d.precio,
            "Estado": "Pendiente"
        });
        console.log("✅ Pedido guardado en Sheets:", d.id);
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 4. LÓGICA DE IA CREATIVA (POLLINATIONS) ---
async function generarRespuestaIA(query) {
    const systemPrompt = "Vendedor experto de 'Venta de Equipaje'. Vendes Mochila, Maleta, Bolso. Colores: Negra, Blanca, Gris. Tamaños: Pequeña, Mediana, Grande. Sé breve y cierra con pregunta.";
    try {
        const resp = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, {
            params: { system: systemPrompt, model: "mistral", seed: Math.floor(Math.random() * 1000) },
            timeout: 2300 
        });
        return resp.data;
    } catch (e) { return "¡Excelente elección! 🧳 ¿Te gustaría confirmar el pedido?"; }
}

// --- 5. WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult, session } = req.body;
    const intentName = queryResult.intent?.displayName;
    const userQuery = queryResult.queryText;

    // --- FUNCIÓN PARA EXTRAER PARÁMETROS DE LA MEMORIA (CONTEXTOS) ---
    const getDato = (nombre) => {
        let v = queryResult.parameters[nombre];
        if (!v && queryResult.outputContexts) {
            for (const ctx of queryResult.outputContexts) {
                if (ctx.parameters && ctx.parameters[nombre]) {
                    v = ctx.parameters[nombre]; break;
                }
            }
        }
        if (v && typeof v === 'object' && v.name) v = v.name; // Para sys.person
        return v || null;
    };

    try {
        // --- REINICIAR CONTEXTOS (INTENT 9) ---
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const contextos = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta"];
            return res.json({
                fulfillmentText: "🧹 He borrado tu selección. ¡Empecemos de nuevo! ¿Qué buscas hoy: mochila, maleta o bolso?",
                outputContexts: contextos.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // Obtener datos reales de la conversación
        const usuario = getDato("usuario") || "Cliente";
        const producto = getDato("producto");
        const tamano = getDato("tamano");
        const color = getDato("color");

        // --- PRE-CONFIRMACIÓN CON PRECIO (INTENT 5) ---
        if (intentName === "5 SeleccionColor") {
            const precio = calcularPrecio(producto, tamano);
            return res.json({ 
                fulfillmentText: `Perfecto ${usuario}, has seleccionado ${producto || 'un producto'} tamaño ${tamano || 'mediano'} de color ${color || 'gris'}. El costo total será de ${precio}. ¿Quieres confirmar tu pedido?` 
            });
        }

        // --- REGISTRO FINAL (INTENT 6.1 O 7.1) ---
        if (intentName === "6.1 PasoFinalSi" || intentName === "7.1 PasoEncuestaSi") {
            const id = generarID();
            const precio = calcularPrecio(producto, tamano);
            await registrarEnSheets({ id, usuario, producto, tamano, color, precio });

            return res.json({ 
                fulfillmentText: `¡Listo, ${usuario}! 🎉 Tu pedido ha sido registrado con el ID: ${id}. Tu ${producto} llegará pronto. ¿Te gustaría responder una breve encuesta?` 
            });
        }

        // --- IA PARA OTROS INTENTS ---
        const respuesta = await generarRespuestaIA(userQuery);
        res.json({ fulfillmentText: respuesta });

    } catch (err) {
        console.error("Error Webhook:", err.message);
        res.json({ fulfillmentText: "¡Qué buena elección! 🧳 ¿Confirmamos tu pedido de equipaje?" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));
