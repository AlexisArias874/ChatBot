const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- 1. MATRIZ DE PRECIOS OPTIMIZADA ---
const PRECIOS = {
    "Mochila": { "Pequeña": "$600", "Mediana": "$850", "Grande": "$1,100" },
    "Maleta": { "Pequeña": "$1,200", "Mediana": "$1,500", "Grande": "$2,000" },
    "Bolso": { "Pequeña": "$400", "Mediana": "$600", "Grande": "$850" }
};

const calcularPrecio = (p, t) => {
    // Normalizamos para asegurar que coincida con la matriz
    const prod = p?.charAt(0).toUpperCase() + p?.slice(1).toLowerCase();
    const tam = t?.charAt(0).toUpperCase() + t?.slice(1).toLowerCase();
    return (PRECIOS[prod] && PRECIOS[prod][tam]) ? `${PRECIOS[prod][tam]} MXN` : "$1,500 MXN";
};

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
            "ID_Pedido": `VE-${Date.now().toString().slice(-6)}`, // ID único basado en tiempo
            "Fecha": new Date().toLocaleString(),
            "Usuario": d.usuario,
            "Producto": d.producto,
            "Tamaño": d.tamano,
            "Color": d.color,
            "Precio": d.precio,
            "Estado": "Pendiente"
        });
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 3. WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult, session } = req.body;
    const intentName = queryResult.intent?.displayName;
    const params = queryResult.parameters; // Aquí vienen tus datos de la imagen
    
    // Extraemos según los nombres exactos de tu imagen
    const producto = params.producto || "Maleta";
    const tamano = params.tamano || "Mediana";
    const color = params.color || "Gris";
    // Si 'usuario' viene como objeto (sys.person), extraemos el nombre, si no, el string
    const usuario = params.usuario?.name || params.usuario || "Cliente";

    try {
        // PASO 5: PRE-CONFIRMACIÓN (Muestra el precio)
        if (intentName === "5 SeleccionColor") {
            const precio = calcularPrecio(producto, tamano);
            return res.json({ 
                fulfillmentText: `Perfecto ${usuario}, has seleccionado ${producto} tamaño ${tamano} de color ${color}. El costo total será de ${precio}. ¿Quieres confirmar tu pedido?` 
            });
        }

        // PASO 6.1: REGISTRO FINAL
        if (intentName === "6.1 PasoFinalSi" || intentName === "7.1 PasoEncuestaSi") {
            const precio = calcularPrecio(producto, tamano);
            await registrarEnSheets({ usuario, producto, tamano, color, precio, session });
            
            return res.json({ 
                fulfillmentText: `¡Excelente, ${usuario}! Tu pedido de ${producto} ${tamano} ha sido registrado. ¡Gracias por tu compra! 🚀` 
            });
        }

        // --- IA PARA OTROS INTENTS ---
        const aiResp = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(queryResult.queryText)}`, {
            params: { system: "Vendedor de maletas breve.", model: "mistral" },
            timeout: 2500
        });
        res.json({ fulfillmentText: aiResp.data });

    } catch (err) {
        res.json({ fulfillmentText: "¡Excelente elección! ¿Confirmamos el pedido? 🧳" });
    }
});

app.listen(process.env.PORT || 10000);
