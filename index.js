const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Función para llamar a la IA con reintentos
async function getAIResponse(query) {
    // Intentaremos con estos 3 modelos en orden de prioridad
    const modelsToTry = ["gemini-2.5-pro", "gemini-2.0-flash-lite", "gemini-3-pro-preview"];
    
    for (let modelName of modelsToTry) {
        try {
            console.log(`Intentando con el modelo: ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const prompt = `Actúa como vendedor experto de 'Venta de Equipaje'. Responde brevemente: ${query}`;
            
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            console.error(`Error con ${modelName}:`, error.message);
            // Si el error es 503 o 429, el bucle pasará al siguiente modelo
            continue; 
        }
    }
    throw new Error("Todos los modelos de Google están saturados.");
}

app.post('/webhook', async (req, res) => {
    if (!req.body.queryResult) return res.json({ fulfillmentText: "Error de datos." });

    const userQuery = req.body.queryResult.queryText;
    console.log("Usuario dijo:", userQuery);

    try {
        const botReply = await getAIResponse(userQuery);
        return res.json({ fulfillmentText: botReply });
    } catch (finalError) {
        return res.json({ 
            fulfillmentText: "Lo siento, mis sistemas están muy ocupados en este momento. ¿Puedes preguntarme de nuevo en un minuto?" 
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Bot multimodelo listo en puerto ${PORT}`));
