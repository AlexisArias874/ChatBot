const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

// CONFIGURACIÓN: Pega aquí tu API Key de Gemini
const genAI = new GoogleGenerativeAI("AIzaSyDsyO8g_sDtHqpaBywoXdeRQTugmpGmgGE");

app.post('/webhook', async (req, res) => {
    // Verificamos si Dialogflow envió el texto correctamente
    if (!req.body.queryResult || !req.body.queryResult.queryText) {
        return res.json({ fulfillmentText: "Error: No recibí texto de Dialogflow." });
    }

    const userQuery = req.body.queryResult.queryText;
    console.log("Usuario dijo:", userQuery);

    try {
        // Usamos gemini-1.5-flash que es el más estable y gratuito
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash" 
        });

        // Prompt de instrucciones para la IA
        const prompt = `Eres un vendedor de maletas de la tienda 'Venta de Equipaje'. 
        Responde a lo siguiente de forma breve y amable: ${userQuery}`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        return res.json({
            fulfillmentText: responseText
        });

    } catch (error) {
        console.error("Error detallado de Gemini:", error);
        return res.json({
            fulfillmentText: "La IA de Google tuvo un problema. Intenta de nuevo en un momento."
        });
    }
});

const PORT = process.env.PORT || 10000; // Render usa el puerto 10000 por defecto
app.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`));
