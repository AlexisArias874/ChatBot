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
// GOOGLE SHEETS (CONEXIÓN)
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
        console.error("❌ Error en Sheets:", e.message);
    }
}

// ==============================
// IA POLLINATIONS (SISTEMA CENTRAL)
// ==============================
async function generarRespuestaIA(query, modo, info = {}, intentos = 2) {
    const { nombre = "James", paso = "inicio", siguiente = "producto" } = info;

    const prompts = {
        reinicio: `El cliente ${nombre} quiere reiniciar. Confirma amablemente y pregunta si busca mochila, maleta o bolso.`,
        despedida: `El cliente ${nombre} terminó. Despídete con humor y dile que escriba 'Hola' para volver.`,
        error: `El cliente dijo "${query}". Como vendedor experto, responde brevemente y redirígelo a elegir el ${siguiente}.`,
        encuesta: `El pedido de ${nombre} está listo. Invítalo con una sola frase muy entusiasta a responder una breve encuesta de satisfacción.`,
        flujo: `Eres vendedor de equipaje. El cliente dice "${query}". Ayúdalo y pregúntale por el ${siguiente}.`
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
            if (i === intentos - 1) return "¿Deseas responder una encuesta de satisfacción?";
            await new Promise(res => setTimeout(res, 1000));
        }
    }
}

// ==============================
// WEBHOOK (LÓGICA DE DIALOGFLOW)
// ==============================
app.post("/webhook", async (req, res) => {
    try {
        const { queryResult } = req.body;
        const intentName = queryResult?.intent?.displayName || "Fallback";
        const userQuery = queryResult?.queryText || "";

        const getP = (n) => queryResult.parameters?.[n] || null;
        const usuario = getP("usuario") || "James";
        const producto = getP("producto");
        const tamano = getP("tamano");
        const color = getP("color");

        let paso = "inicio";
        let siguiente = "producto";
        if (producto) { paso = "tamaño"; siguiente = "tamaño"; }
        if (tamano) { paso = "color"; siguiente = "color"; }
        if (color) { paso = "confirmación"; siguiente = "confirmación"; }

        // 1. REINICIO
        if (userQuery.toLowerCase().includes("reinicio") || intentName.includes("reinicio")) {
            const r = await generarRespuestaIA(userQuery, "reinicio", { nombre: usuario });
            return res.json({ fulfillmentText: r, outputContexts: [] });
        }

        // 2. REGISTRO FINAL (CON FORMATO DE PRECIO ANTERIOR)
        if (intentName.includes("PasoFinalSi")) {
            const id = generarID();
            const prod = normalizar(producto || "Mochila");
            const tam = normalizar(tamano || "Mediana");
            const precio = calcularPrecio(prod, tam);

            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: color || "Gris", precio });

            const mensajeIA = await generarRespuestaIA(userQuery, "encuesta", { nombre: usuario });

            // Formato exacto solicitado
            return res.json({
                fulfillmentText: `🎉 Pedido registrado\n\nID: ${id}\nProducto: ${prod}\nTamaño: ${tam}\nPrecio: ${precio}\n\n${mensajeIA}`
            });
        }

        // 3. DESPEDIDAS
        if (intentName.includes("Despedida") || intentName.includes("EncuestaNo")) {
            const r = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            return res.json({ fulfillmentText: r });
        }

        // 4. IA GENERAL / FALLBACK
        const modoIA = (intentName.includes("Fallback")) ? "error" : "flujo";
        const respuestaIA = await generarRespuestaIA(userQuery, modoIA, {
            nombre: usuario,
            paso: paso,
            siguiente: siguiente
        });

        res.json({ fulfillmentText: respuestaIA });

    } catch (e) {
        res.json({ fulfillmentText: "¡Excelente elección! ¿Confirmamos tu pedido?" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot activo en puerto ${PORT}`));
