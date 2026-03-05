const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/webhook', async (req, res) => {
    if (!req.body.queryResult) return res.json({ fulfillmentText: "Error de datos." });

    const userQuery = req.body.queryResult.queryText;
    console.log("Usuario dijo:", userQuery);

    try {
        // Usamos la versión 2.0 que apareció en tu lista de modelos disponibles
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash" 
        });

        const chat = model.startChat({
            history: [],
            generationConfig: { maxOutputTokens: 500 },
        });

        const prompt = `Actúa como vendedor de 'Venta de Equipaje'. Responde brevemente a: ${userQuery}`;
        
        const result = await chat.sendMessage(prompt);
        const response = await result.response;
        const text = response.text();

        return res.json({ fulfillmentText: text });

    } catch (error) {
        console.error("Error detallado:", error);
        // Si el error es 404 de nuevo, el bot te lo dirá en el chat para avisarte
        return res.json({ 
            fulfillmentText: "Error 404: El modelo no fue encontrado. Intenta cambiar el nombre en el código." 
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor listo en puerto ${PORT}`));
