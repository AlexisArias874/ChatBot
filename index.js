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
    const userQuery = req.body.queryResult.queryText;
    const sessionID = req.body.session;
    const params = req.body.queryResult.parameters;

    // --- LEER EL NOMBRE EXACTO DEL INTENT DESDE DIALOGFLOW ---
    const intentName = req.body.queryResult.intent ? req.body.queryResult.intent.displayName : "Default";

    try {
        // REINICIAR: Tu intent se llama "9 PasoNuevoPedido"
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            // Aquí puedes añadir lógica para limpiar la sesión si usas memoria
            console.log("Reiniciando pedido...");
        }

        // REGISTRAR EN SHEETS: Tu intent se llama "6.1 PasoFinalSi"
        if (intentName === "6.1 PasoFinalSi") {
            console.log("Detectado Paso Final. Registrando en Sheets...");
            
            await registrarEnSheets({
                session: sessionID,
                producto: params.producto || "No detectado",
                tamano: params.tamano || "No detectado", // Asegúrate que en Dialogflow se llame 'tamano'
                color: params.color || "No detectado",
                precio: "$1,500 MXN"
            });
        }

        const respuesta = await generarRespuestaCreativa(userQuery, intentName);
        res.json({ fulfillmentText: respuesta });

    } catch (err) {
        // Mapa de errores ajustado a tus nombres de Intent
        const errores = {
            "3.1 CompraProducto": "¡Uy! ¿Buscabas maleta, mochila o bolso? 🧳",
            "4 SeleccionTamano": "Se me perdió la cinta métrica. 📏 ¿Qué tamano prefieres: pequeña, mediana o grande?",
            "5 SeleccionColor": "¡Qué colores tan padres! 🎨 ¿Lo quieres en negro, blanco o gris?",
            "6.1 PasoFinalSi": "¡Casi listo! 🛒 ¿Confirmamos tu pedido para enviarlo a bodega?"
        };
        const fallback = errores[intentName] || "¡Qué buena pregunta! Dame un segundo para revisarlo. 😅";
        res.json({ fulfillmentText: fallback });
    }
});

app.get("/", (req, res) => res.send("Servidor Venta de Equipaje Activo"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));


