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

function calcularPrecio(producto, tamano) {
    const p = producto.charAt(0).toUpperCase() + producto.slice(1).toLowerCase();
    const t = tamano.charAt(0).toUpperCase() + tamano.slice(1).toLowerCase();
    if (PRECIOS[p] && PRECIOS[p][t]) return `${PRECIOS[p][t]} MXN`;
    return "$1,500 MXN";
}

// --- 2. GENERADOR DE ID ÚNICO ---
function generarIDPedido() {
    const fecha = new Date();
    const formatoFecha = fecha.getFullYear().toString().slice(-2) + 
                       (fecha.getMonth() + 1).toString().padStart(2, '0') + 
                       fecha.getDate().toString().padStart(2, '0');
    const random = Math.floor(1000 + Math.random() * 9000);
    return `VE-${formatoFecha}-${random}`; // Ejemplo: VE-240310-4512
}

// --- 3. CONFIGURACIÓN DE GOOGLE SHEETS ---
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

async function registrarEnSheets(datos) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
 await sheet.addRow({
            "ID_Pedido": datos.id,
            "Fecha": new Date(),
            "Usuario": datos.usuario,
            "Producto": datos.producto,
            "Tamaño": datos.tamano,
            "Color": datos.color,
            "Precio": datos.precio,
            "Estado": "Pendiente"
        });
        console.log("✅ Pedido guardado en Sheets ID:", datos.id);
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 4. LÓGICA DE IA (POLLINATIONS) ---
async function generarRespuestaCreativa(userQuery, intentName) {
    const modelos = ["mistral", "openai"]; 
    const systemPrompt = "Vendedor experto de 'Venta de Equipaje'. Solo vendes: Mochila, Maleta, Bolso. Tamaños: Pequeña, Mediana, Grande. Colores: Negra, Blanca, Gris. Sé creativo, breve y cierra con pregunta.";

    for (let modelo of modelos) {
        try {
            const response = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(userQuery)}`, {
                params: { system: systemPrompt, model: modelo, seed: Math.floor(Math.random() * 1000) },
                timeout: 2300 
            });
            if (response.data) return response.data;
        } catch (error) { continue; }
    }
    return "¡Excelente elección! 🧳 ¿Confirmamos el pedido para enviarlo a bodega?";
}

// --- 5. WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const queryResult = req.body.queryResult;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Default";
    const sessionID = req.body.session;
    const userQuery = queryResult.queryText;

    // --- FUNCIÓN INTELIGENTE PARA BUSCAR PARÁMETROS EN CUALQUIER CONTEXTO ---
    const obtenerDatoDeMemoria = (nombreParametro) => {
        // 1. Intentamos en los parámetros directos del mensaje actual
        let valor = queryResult.parameters[nombreParametro];
        
        // 2. Si no está, lo buscamos en los Contextos (historial)
        if (!valor && queryResult.outputContexts) {
            for (let ctx of queryResult.outputContexts) {
                if (ctx.parameters && ctx.parameters[nombreParametro]) {
                    valor = ctx.parameters[nombreParametro];
                    break;
                }
            }
        }
        return valor; // Retorna el valor encontrado o undefined
    };

    // Función para obtener el nombre (usando la búsqueda inteligente)
    const nombre = obtenerDatoDeMemoria("person") || "Cliente";
    const nombreFinal = typeof nombre === 'object' ? nombre.name : nombre;

    try {
        // --- LÓGICA: PRE-CONFIRMACIÓN (INTENT 5 SELECCIONCOLOR) ---
        if (intentName === "5 SeleccionColor") {
            // Buscamos los datos reales en la memoria
            const prod = obtenerDatoDeMemoria("producto") || "Maleta";
            const tam = obtenerDatoDeMemoria("tamano") || "Mediana";
            const col = obtenerDatoDeMemoria("color") || "Gris";
            const precio = calcularPrecio(prod, tam);

            return res.json({ 
                fulfillmentText: `Perfecto ${nombreFinal}, has seleccionado ${prod} tamaño ${tam} de color ${col}. El costo total será de ${precio}. ¿Quieres confirmar tu pedido?` 
            });
        }

        // --- LÓGICA: REGISTRO FINAL (INTENT 6.1 O 7.1) ---
        if (intentName === "6.1 PasoFinalSi" || intentName === "7.1 PasoEncuestaSi") {
            const id = generarIDPedido();
            const prod = obtenerDatoDeMemoria("producto") || "Maleta";
            const tam = obtenerDatoDeMemoria("tamano") || "Mediana";
            const col = obtenerDatoDeMemoria("color") || "Gris";
            const precio = calcularPrecio(prod, tam);

            await registrarEnSheets({
                id: id,
                session: sessionID,
                usuario: nombreFinal,
                producto: prod,
                tamano: tam,
                color: col,
                precio: precio
            });

            return res.json({ 
                fulfillmentText: `¡Muchas gracias, ${nombreFinal}! Tu ID es ${id}. Tu ${prod} ${tam} ${col} ya está en camino. 🚀` 
            });
        }

        // ... (Resto del código IA Pollinations) ...
        const respuestaIA = await generarRespuestaCreativa(userQuery, intentName);
        res.json({ fulfillmentText: respuestaIA });

    } catch (err) {
        console.error("Error:", err.message);
        res.json({ fulfillmentText: "¡Excelente elección! ¿Confirmamos el pedido? 🧳" });
    }
});

app.get("/", (req, res) => res.send("Servidor Venta de Equipaje ONLINE"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Corriendo en puerto: ${PORT}`));




