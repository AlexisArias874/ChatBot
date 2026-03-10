const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- CONFIGURACIÓN DE GOOGLE SHEETS ---
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// Función para registrar en la hoja
async function registrarEnSheets(datos) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        await sheet.addRow({
            Fecha: new Date().toLocaleString(),
            Sesion: datos.session,
            Producto: datos.producto,
            Tamano: datos.tamano, // Usando tamano sin ñ
            Color: datos.color,
            Precio: datos.precio,
            Estado: "Pendiente"
            Usuario: "Cliente Messenger"
        });
        console.log("✅ Pedido en Sheets");
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

async function generarRespuestaCreativa(userQuery, intentName) {
    const modelos = ["mistral", "openai"]; 
    
    // Contexto de negocio inyectado en el prompt de sistema
    const systemPrompt = `Vendedor experto de 'Venta de Equipaje'. 
    Solo vendes: Mochila, Maleta, Bolso. 
    Tamaños: Pequeña, Mediana, Grande. 
    Colores: Negra, Blanca, Gris. 
    Sé creativo, breve y cierra ventas siempre con una pregunta.`;

    for (let modelo of modelos) {
        try {
            const response = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(userQuery)}`, {
                params: {
                    system: systemPrompt,
                    model: modelo,
                    seed: Math.floor(Math.random() * 1000)
                },
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
        // --- 1. DETECTAR INTENT DE REINICIO ---
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            // Aquí puedes limpiar variables si es necesario
        }

        // --- 2. DETECTAR INTENT DE CONFIRMACIÓN FINAL (6.1 o 7.1) ---
        if (intentName === "6.1 PasoFinalSi" || intentName === "7.1 PasoEncuestaSi") {
            console.log("✅ Paso Final detectado. Registrando pedido...");

            // Registramos en Google Sheets
            await registrarEnSheets({
                session: sessionID,
                producto: params.producto || "Maleta",
                tamano: params.tamano || "Grande",
                color: params.color || "Gris",
                precio: "$1,500 MXN"
            });

            // RESPUESTA FIJA DE ÉXITO (Para no confundir al usuario)
            return res.json({ 
                fulfillmentText: `¡Pedido confirmado con éxito, Rosa! 🥳 Tu ${params.producto} ${params.tamano} color ${params.color} ya está en proceso de envío. ¿Te gustaría ayudarnos con una breve encuesta de satisfacción?` 
            });
        }

        // --- 3. PARA EL RESTO DE INTENTS, USAMOS LA IA ---
        const respuestaIA = await generarRespuestaCreativa(userQuery, intentName);
        return res.json({ fulfillmentText: respuestaIA });

    } catch (err) {
        console.error("Error en el flujo:", err.message);
        // Respuesta de respaldo si todo falla
        res.json({ fulfillmentText: "¡Recibido! Tu pedido está siendo procesado por nuestro equipo de bodega. 🧳" });
    }
});

app.get("/", (req, res) => res.send("Servidor Venta de Equipaje Activo"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));




