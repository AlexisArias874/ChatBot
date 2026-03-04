const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// CONFIGURACIÓN: Reemplaza con tu API Key de OpenAI
const OPENAI_API_KEY = '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';

app.post('/webhook', async (req, res) => {
    // 1. Extraer el mensaje que el usuario escribió en Facebook/Dialogflow
    const userQuery = req.body.queryResult.queryText;
    console.log("Usuario dijo:", userQuery);

    try {
        // 2. Llamar a la IA (OpenAI GPT-4o-mini es el más barato y rápido)
        const aiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini", 
            messages: [
                { role: "system", content: "Eres un asistente de ventas para una tienda de equipaje. Sé amable y directo." },
                { role: "user", content: userQuery }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
        });

        const botReply = aiResponse.data.choices[0].message.content;

        // 3. Responder a Dialogflow con el formato que él entiende
        return res.json({
            fulfillmentText: botReply
        });

    } catch (error) {
        console.error("Error con la IA:", error.message);
        return res.json({
            fulfillmentText: "Lo siento, tuve un problema al procesar tu respuesta."
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));