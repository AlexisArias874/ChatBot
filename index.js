const express = require("express");
const axios = require("axios"); // Usaremos axios para la API gratuita

const app = express();
app.use(express.json({ limit: "2mb" }));

// Mapa para guardar un poco de contexto si lo deseas (opcional)
const chatSessions = new Map();

/**
 * Función que conecta con la API gratuita de Pollinations.ai
 */
async function generarRespuestaCreativa(userQuery, intentName) {
    // Definimos la personalidad del vendedor
    const systemPrompt = "Eres el mejor vendedor de 'Venta de Equipaje'. Vendes mochilas, maletas y bolsos. Eres amable e ingenioso.";
    
    // Si es un Fallback (Dialogflow no entendió), pedimos creatividad extra
    let instruccionExtra = "";
    if (intentName.includes("Fallback") || intentName === "Default") {
        instruccionExtra = " El usuario dijo algo que no entendiste. Responde de forma muy creativa o con un chiste sobre viajes, y trata de que vuelva a interesarse por una maleta.";
    }

    // Construimos la URL para la API (Pollinations no necesita API KEY)
    // Usamos el modelo 'openai' (que es gratuito a través de su gateway)
    const url = `https://text.pollinations.ai/${encodeURIComponent(userQuery)}?system=${encodeURIComponent(systemPrompt + instruccionExtra)}&model=openai`;

    try {
        const response = await axios.get(url);
        return response.data; // La API devuelve el texto directamente
    } catch (error) {
        console.error("Error en API externa:", error.message);
        return "¡Uy! Mi sistema de equipaje se quedó trabado en la aduana. 🧳 ¿Me repites la pregunta?";
    }
}

//////////////////////////////////////////////////////
// WEBHOOK PARA DIALOGFLOW
//////////////////////////////////////////////////////

app.post("/webhook", async (req, res) => {
    const sessionID = req.body.session;
    const userQuery = req.body.queryResult.queryText;
    const intentName = req.body.queryResult.intent 
        ? req.body.queryResult.intent.displayName 
        : "Default";

    try {
        // Si el usuario quiere reiniciar
        if (userQuery.toLowerCase() === "reiniciar") {
            chatSessions.delete(sessionID);
        }

        // Llamamos a la API creativa
        const respuesta = await generarRespuestaCreativa(userQuery, intentName);

        res.json({
            fulfillmentText: respuesta
        });

    } catch (err) {
        res.json({
            fulfillmentText: "Perdón, hubo un pequeño error en la tienda. 😅 ¿En qué puedo ayudarte?"
        });
    }
});

// Ruta base para que Render sepa que el sitio está vivo
app.get("/", (req, res) => res.send("Servidor de Equipaje Activo 🚀"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
});
