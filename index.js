const express = require("express");
const axios = require("axios");
const { JWT } = require("google-auth-library");
const { GoogleSpreadsheet } = require("google-spreadsheet");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ==============================
// CONFIGURACIÓN GLOBAL
// ==============================
axios.defaults.timeout = 30000; 

const PRECIOS = {
    Mochila: { Pequeña: "$600", Mediana: "$850", Grande: "$1100" },
    Maleta: { Pequeña: "$1200", Mediana: "$1500", Grande: "$2000" },
    Bolso: { Pequeña: "$400", Mediana: "$600", Grande: "$850" }
};

const normalizar = (t) => t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "";

function calcularPrecio(prod, tam) {
    const p = normalizar(prod);
    const t = normalizar(tam);
    return PRECIOS[p]?.[t] ? `${PRECIOS[p][t]} MXN` : "$1200 MXN";
}

function generarID() {
    return `VE-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// ==============================
// GOOGLE SHEETS (CONEXIÓN MEJORADA)
// ==============================
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
let sheetCache = null;

async function registrarEnSheets(data) {
    try {
        if (!sheetCache) {
            await doc.loadInfo();
            sheetCache = doc.sheetsByIndex[0];
        }
        // Aseguramos que los nombres de las columnas coincidan con tu Excel
        await sheetCache.addRow({
            ID_Pedido: data.id,
            Fecha: new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" }),
            Usuario: data.usuario,
            Producto: data.producto,
            Tamaño: data.tamano,
            Color: data.color || "No especificado",
            Precio: data.precio,
            Estado: "Pendiente"
        });
        console.log("✅ Registro exitoso en Sheets");
    } catch (e) {
        console.error("❌ Error crítico en Sheets:", e.message);
    }
}

// ==============================
// IA POLLINATIONS
// ==============================
async function generarRespuestaIA(query, modo, info = {}, intentos = 2) {
    const { nombre = "James", paso = "inicio", siguiente = "producto" } = info;

    const prompts = {
        reinicio: `El cliente ${nombre} ha reiniciado la conversación. Salúdalo brevemente y pregúntale qué accesorio de viaje busca hoy (mochila, maleta o bolso).`,
        despedida: `El cliente ${nombre} se va. Despídete con amabilidad y humor.`,
        error: `El cliente dijo "${query}". Como vendedor, responde con ingenio y vuelve a preguntar por el ${siguiente}.`,
        encuesta: `Venta terminada para ${nombre}. Invítalo con una frase corta y entusiasta a calificar el servicio.`,
        flujo: `Eres vendedor. El cliente dice "${query}". Ayúdalo y pregúntale por el ${siguiente}.`
    };

    const systemPrompt = prompts[modo] || prompts.flujo;

    for (let i = 0; i < intentos; i++) {
        try {
            const r = await axios.post("https://text.pollinations.ai/", {
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: query }
                ],
                model: "mistral",
                seed: Math.floor(Math.random() * 999)
            });
            const texto = typeof r.data === 'string' ? r.data : r.data.choices[0].message.content;
            return texto.trim();
        } catch (e) {
            if (i === intentos - 1) return "¿Te gustaría realizar un nuevo pedido?";
            await new Promise(res => setTimeout(res, 1000));
        }
    }
}

// ==============================
// WEBHOOK (LÓGICA MEJORADA)
// ==============================
app.post("/webhook", async (req, res) => {
    try {
        const { queryResult, session } = req.body;
        const intentName = queryResult?.intent?.displayName || "Fallback";
        const userQuery = queryResult?.queryText || "";

        const getP = (n) => queryResult.parameters?.[n] || null;
        const usuario = getP("usuario") || "Cliente";
        const producto = getP("producto");
        const tamano = getP("tamano");
        const color = getP("color");

        // 1. LÓGICA DE REINICIO (LIMPIEZA TOTAL DE CONTEXTOS)
        if (userQuery.toLowerCase().includes("reinicio") || intentName.includes("reinicio")) {
            const r = await generarRespuestaIA(userQuery, "reinicio", { nombre: usuario });
            
            // Para limpiar contextos, enviamos los existentes con lifespan 0
            const activeContexts = queryResult.outputContexts || [];
            const expiredContexts = activeContexts.map(ctx => ({
                name: ctx.name,
                lifespanCount: 0
            }));

            return res.json({
                fulfillmentText: r,
                fulfillmentMessages: [
                    { text: { text: [r] } },
                    {
                        quickReplies: {
                            title: "Elige una opción:",
                            quickReplies: ["Hacer otro pedido", "Ayuda"]
                        }
                    }
                ],
                outputContexts: expiredContexts
            });
        }

        // 2. REGISTRO FINAL
        if (intentName.includes("PasoFinalSi")) {
            const id = generarID();
            const prod = normalizar(producto || "Mochila");
            const tam = normalizar(tamano || "Mediana");
            const col = normalizar(color || "Gris");
            const precio = calcularPrecio(prod, tam);

            // Guardar con todos los datos capturados
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: col, precio });

            const mensajeIA = await generarRespuestaIA(userQuery, "encuesta", { nombre: usuario });

            return res.json({
                fulfillmentText: `🎉 Pedido registrado\n\nID: ${id}\nProducto: ${prod}\nTamaño: ${tam}\nPrecio: ${precio}\n\n${mensajeIA}`
            });
        }

        // 3. FALLBACKS O CONSULTAS RANDOM
        const paso = producto ? (tamano ? "color" : "tamaño") : "producto";
        const siguiente = producto ? (tamano ? "color" : "tamaño") : "producto";
        
        const modoIA = (intentName.includes("Fallback")) ? "error" : "flujo";
        const respuestaIA = await generarRespuestaIA(userQuery, modoIA, {
            nombre: usuario,
            paso,
            siguiente
        });

        res.json({ fulfillmentText: respuestaIA });

    } catch (e) {
        console.error("Error en Webhook:", e);
        res.json({ fulfillmentText: "Lo siento, ¿podemos retomar tu pedido de mochila o maleta?" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot activo en puerto ${PORT}`));
