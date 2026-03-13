const express = require("express");
const axios = require("axios");
const { JWT } = require("google-auth-library");
const { GoogleSpreadsheet } = require("google-spreadsheet");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ==============================
// CONFIGURACIÓN Y PRECIOS
// ==============================

const PRECIOS = {
    Mochila: { Pequeña: "$600", Mediana: "$850", Grande: "$1100" },
    Maleta: { Pequeña: "$1200", Mediana: "$1500", Grande: "$2000" },
    Bolso: { Pequeña: "$400", Mediana: "$600", Grande: "$850" }
};

const normalizar = (t) => t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "";

function calcularPrecio(prod, tam) {
    const p = normalizar(prod);
    const t = normalizar(tam);
    return PRECIOS[p]?.[t] ? `${PRECIOS[p][t]} MXN` : "$1500 MXN";
}

function generarID() {
    return `VE-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// ==============================
// GOOGLE SHEETS
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
        await sheetCache.addRow({
            ID_Pedido: data.id,
            Fecha: new Date().toLocaleString(),
            Usuario: data.usuario,
            Producto: data.producto,
            Tamaño: data.tamano,
            Color: data.color,
            Precio: data.precio,
            Estado: "Pendiente"
        });
    } catch (e) {
        console.error("❌ Sheets error:", e.message);
    }
}

// ==============================
// IA POLLINATIONS (SISTEMA CENTRAL)
// ==============================

async function generarRespuestaIA(query, modo, info = {}) {
    const { nombre = "Cliente", paso = "inicio", siguiente = "producto" } = info;
    
    // Prompts dinámicos según el contexto del flujo
    const prompts = {
        reinicio: `El cliente ${nombre} quiere empezar de cero. Confirma que has borrado los datos anteriores y pregúntale qué busca (mochila, maleta o bolso) de forma creativa.`,
        despedida: `El cliente ${nombre} terminó su compra o no quiere encuesta. Despídete con mucha amabilidad y humor, invitándolo a volver pronto.`,
        error: `El cliente dijo algo que no entendimos: "${query}". Como vendedor experto, responde a lo que dijo brevemente pero redirígelo a que estamos en el paso de ${paso} y necesitamos saber el ${siguiente}.`,
        encuesta: `El pedido se registró con éxito. Pídele al cliente ${nombre} de forma muy entusiasta que califique su experiencia del 1 al 5.`
    };

    const systemPrompt = prompts[modo] || `Eres un vendedor experto de equipaje. El cliente está en el paso de ${paso}. Responde brevemente a: "${query}" y empújalo a decidir el ${siguiente}.`;

    try {
        // Usamos la API de texto de Pollinations (vía GET para máxima compatibilidad)
        const url = `https://text.pollinations.ai/${encodeURIComponent(systemPrompt + " Usuario dice: " + query)}?model=mistral`;
        const r = await axios.get(url);
        return r.data;
    } catch (error) {
        // Fallback de seguridad en caso de caída extrema de red, pero intentando IA de nuevo
        return "¡Ups! Me emocioné de más. ¿Seguimos con tu pedido? ¿Qué te parece el " + siguiente + "?";
    }
}

// ==============================
// WEBHOOK PRINCIPAL
// ==============================

app.post("/webhook", async (req, res) => {
    try {
        const { queryResult } = req.body;
        const intentName = queryResult?.intent?.displayName || "Fallback";
        const userQuery = queryResult?.queryText || "";
        
        // Extraer parámetros
        const getParam = (p) => queryResult.parameters?.[p] || null;
        const usuario = getParam("usuario") || "Cliente";
        const producto = getParam("producto");
        const tamano = getParam("tamano");
        const color = getParam("color");

        // Definir estado actual para la IA
        let paso = "inicio";
        let siguiente = "producto";
        if (producto) { paso = "tamaño"; siguiente = "tamaño"; }
        if (tamano) { paso = "color"; siguiente = "color"; }
        if (color) { paso = "confirmación"; siguiente = "confirmación"; }

        // 1. LÓGICA DE REINICIO
        if (intentName.includes("reinicio") || userQuery.toLowerCase() === "reinicio") {
            const r = await generarRespuestaIA(userQuery, "reinicio", { nombre: usuario });
            return res.json({ fulfillmentText: r, outputContexts: [] }); // Limpiamos contextos para evitar bucles
        }

        // 2. REGISTRO DE PEDIDO (Elimina el bucle de la imagen)
        if (intentName.includes("PasoFinalSi")) {
            const id = generarID();
            const prod = producto || "Mochila";
            const tam = tamano || "Mediana";
            const precio = calcularPrecio(prod, tam);

            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: color || "N/A", precio });

            const mensajeIA = await generarRespuestaIA(userQuery, "encuesta", { nombre: usuario });
            
            return res.json({
                fulfillmentText: `✅ *Pedido Registrado*\nID: ${id}\nProducto: ${prod}\nPrecio: ${precio}\n\n${mensajeIA}`
            });
        }

        // 3. DESPEDIDAS O FIN DE ENCUESTA
        if (intentName.includes("Despedida") || intentName.includes("EncuestaNo")) {
            const r = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            return res.json({ fulfillmentText: r });
        }

        // 4. MANEJO DE ERRORES / FALLBACKS / IA GENERAL
        // Esto captura cualquier cosa que no sea un intent reconocido
        const respuestaIA = await generarRespuestaIA(userQuery, "error", {
            nombre: usuario,
            paso: paso,
            siguiente: siguiente
        });

        res.json({ fulfillmentText: respuestaIA });

    } catch (e) {
        console.error("❌ Error General:", e.message);
        res.json({ fulfillmentText: "Dime, ¿buscas una mochila o una maleta? Estoy listo para ayudarte." });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot IA activo en puerto ${PORT}`));
