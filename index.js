const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Función para esperar (evitar el error 429)
const delay = ms => new Promise(res => setTimeout(res, ms));

async function getAIResponse(query) {
    // Los modelos 2.5 y 3.1 te dan "Limit 0". Usa el 1.5 que es el estable.
    const modelName = "gemini-1.5-flash"; 
    
    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(query);
        return result.response.text();
    } catch (error) {
        if (error.message.includes("429")) {
            console.log("Cuota excedida, esperando 2 segundos...");
            await delay(2000);
            // Reintento único con el alias estable
            const modelRetry = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
            const resultRetry = await modelRetry.generateContent(query);
            return resultRetry.response.text();
        }
        throw error;
    }
}

app.post('/webhook', async (req, res) => {
    if (!req.body.queryResult) return res.json({ fulfillmentText: "Error de datos." });
    const userQuery = req.body.queryResult.queryText;

    try {
        const botReply = await getAIResponse(userQuery);
        return res.json({ fulfillmentText: botReply });
    } catch (err) {
        console.error("Error final:", err.message);
        return res.json({ fulfillmentText: "Lo siento, estoy recibiendo muchas consultas. Intenta de nuevo en un momento." });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Bot conectado con Gemini 1.5 Flash` ));
