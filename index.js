const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "2mb" }));

/**
 * Función que conecta con la API gratuita de Pollinations.ai
 * Se eliminó el timeout para permitir que la API termine de generar.
 */
async function generarRespuestaCreativa(userQuery, intentName) {
    // Prompt optimizado para ser lo más rápido posible
    const systemPrompt = "Eres un vendedor amable de maletas y mochilas. Responde de forma creativa y breve.";
    
    let instruccionExtra = "";
    if (intentName.includes("Fallback") || intentName === "Default") {
        instruccionExtra = " El usuario dijo algo confuso, responde con ingenio sobre viajes.";
    }

    // Usamos el modelo 'openai' que suele ser el más estable en Pollinations
    const url = `https://text.pollinations.ai/${encodeURIComponent(userQuery)}?system=${encodeURIComponent(systemPrompt + instruccionExtra)}&model=openai`;

    try {
        // Realizamos la petición sin el parámetro de timeout
        const response = await axios.get(url);
        
        // Verificamos que la respuesta sea válida
        if (response.data) {
            return response.data;
        } else {
            throw new Error("Respuesta vacía");
        }
    } catch (error) {
        console.error("Error en API externa:", error.message);
        return "¡Uy! Mi sistema de equipaje está un poco lento hoy. 🧳 ¿Me podrías repetir la pregunta?";
    }
}

//////////////////////////////////////////////////////
// WEBHOOK PARA DIALOGFLOW
//////////////////////////////////////////////////////

app.post("/webhook", async (req, res) => {
    const userQuery = req.body.queryResult.queryText;
    const intentName = req.body.queryResult.intent 
        ? req.body.queryResult.intent.displayName 
        : "Default";

    try {
        // Esperamos a que la API responda sin importar cuánto tarde
        const respuesta = await generarRespuestaCreativa(userQuery, intentName);

        res.json({
            fulfillmentText: respuesta
        });

    } catch (err) {
        console.error("Error en Webhook:", err);
        res.json({
            fulfillmentText: "Hubo un pequeño error en la tienda, pero sigo aquí para ayudarte. ¿Qué buscabas?"
        });
    }
});

app.get("/", (req, res) => res.send("Webhook de Equipaje corriendo sin límites de tiempo 🚀"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
});
