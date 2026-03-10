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
    const intentName = req.body.queryResult.intent ? req.body.queryResult.intent.displayName : "Default";
    const sessionID = req.body.session;
    const params = req.body.queryResult.parameters;

    try {
        // LÓGICA DE REGISTRO: Si el intent es de confirmación

console.log("Intent detectado:", intentName); // Esto te dirá en los logs si entró al intent correcto

        if (intentName === "6.1 PasoFinalSi") {
    console.log("Intent ConfirmarPedido detectado, iniciando registro en Sheets...");
    console.log("Parámetros recibidos:", params); // Esto te dirá si viajan los datos
    
    await registrarEnSheets({
        session: sessionID,
        producto: params.producto || "Indefinido",
        tamano: params.tamano || "Indefinido",
        color: params.color || "Indefinido",
        precio: "$1,500 MXN"
    });
}

        const respuesta = await generarRespuestaCreativa(userQuery, intentName);
        res.json({ fulfillmentText: respuesta });

    } catch (err) {
        // MAPA DE ERRORES DINÁMICOS (UX mejorada)
        const errores = {
            "ElegirProducto": "¡Uy! Se me trabó la maleta. 🧳 ¿Buscabas mochila, maleta o bolso?",
            "ElegirTamano": "Se me perdió la cinta métrica. 📏 ¿Qué tamano prefieres: pequeña, mediana o grande?",
            "ElegirColor": "¡Qué colores tan padres! 🎨 ¿Lo quieres en negro, blanco o gris?",
            "ConfirmarPedido": "¡Casi listo! 🛒 Hubo un error al procesar, ¿confirmamos tu pedido de nuevo?"
        };
        const fallback = errores[intentName] || "¡Qué buena pregunta! Dame un segundo para revisarlo en bodega. 😅";
        res.json({ fulfillmentText: fallback });
    }
});

app.get("/", (req, res) => res.send("Servidor Venta de Equipaje Activo"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));

