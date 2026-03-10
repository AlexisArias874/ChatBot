const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- MATRIZ DE PRECIOS DINÁMICA ---
const PRECIOS = {
    "Mochila": { "Pequeña": "$600", "Mediana": "$850", "Grande": "$1,100" },
    "Maleta": { "Pequeña": "$1,200", "Mediana": "$1,500", "Grande": "$2,000" },
    "Bolso": { "Pequeña": "$400", "Mediana": "$600", "Grande": "$850" }
};

// Función para obtener el precio dinámico
function calcularPrecio(producto, tamano) {
    // Normalizamos los nombres para que coincidan con la matriz (Primera letra mayúscula)
    const p = producto.charAt(0).toUpperCase() + producto.slice(1).toLowerCase();
    const t = tamano.charAt(0).toUpperCase() + tamano.slice(1).toLowerCase();

    if (PRECIOS[p] && PRECIOS[p][t]) {
        return `${PRECIOS[p][t]} MXN`;
    }
    return "$1,500 MXN"; // Precio base por si falla la detección
}

// --- CONFIGURACIÓN DE GOOGLE SHEETS ---
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
            Fecha: new Date().toLocaleString(),
            Sesion: datos.session,
            Producto: datos.producto,
            "Tamaño": datos.tamano, // Usamos la Ñ para que coincida con tu encabezado de Excel
            Color: datos.color,
            Precio: datos.precio,
            Estado: "Pendiente",
            Usuario: datos.usuario || "Cliente Messenger"
        });
        console.log("✅ Pedido en Sheets");
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

async function generarRespuestaCreativa(userQuery, intentName) {
    const modelos = ["mistral", "openai"]; 
    const systemPrompt = `Vendedor experto de 'Venta de Equipaje'. Solo vendes: Mochila, Maleta, Bolso. Tamaños: Pequeña, Mediana, Grande. Colores: Negra, Blanca, Gris. Sé creativo, breve y cierra ventas siempre con una pregunta.`;

    for (let modelo of modelos) {
        try {
            const response = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(userQuery)}`, {
                params: { system: systemPrompt, model: modelo, seed: Math.floor(Math.random() * 1000) },
                timeout: 2200 
            });
            if (response.data) return response.data;
        } catch (error) {
            console.log(`Salto de modelo ${modelo}.`);
            continue; 
        }
    }
    return "¡Excelente elección! 🧳 ¿Te gustaría que confirmáramos el pedido de una vez?";
}

app.post("/webhook", async (req, res) => {
    const queryResult = req.body.queryResult;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Default";
    const sessionID = req.body.session;
    const params = queryResult.parameters;
    const userQuery = queryResult.queryText;

    try {
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            // Lógica de reinicio si fuera necesaria
        }

        if (intentName === "6.1 PasoFinalSi" || intentName === "7.1 PasoEncuestaSi") {
            console.log("✅ Paso Final detectado. Calculando y registrando...");

            // Calculamos el precio según la elección del usuario
            const productoFinal = params.producto || "Maleta";
            const tamanoFinal = params.tamano || "Mediana";
            const precioCalculado = calcularPrecio(productoFinal, tamanoFinal);

            await registrarEnSheets({
                session: sessionID,
                producto: productoFinal,
                tamano: tamanoFinal,
                color: params.color || "Gris",
                precio: precioCalculado,
                usuario: params.person ? params.person.name : "Cliente"
            });

            return res.json({ 
                fulfillmentText: `¡Pedido confirmado con éxito! 🥳 Tu ${productoFinal} ${tamanoFinal} color ${params.color || 'Gris'} ya está en proceso. El total es de ${precioCalculado}. ¿Te gustaría ayudarnos con una breve encuesta?` 
            });
        }

        const respuestaIA = await generarRespuestaCreativa(userQuery, intentName);
        return res.json({ fulfillmentText: respuestaIA });

    } catch (err) {
        console.error("Error en el flujo:", err.message);
        res.json({ fulfillmentText: "¡Recibido! Tu pedido ya está en bodega. 🧳" });
    }
});

app.get("/", (req, res) => res.send("Servidor Venta de Equipaje Activo"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));
