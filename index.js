const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/webhook', async (req, res) => {
    if (!req.body.queryResult) return res.json({ fulfillmentText: "Error de datos." });
    const userQuery = req.body.queryResult.queryText;

    try {
        // USAMOS ESTE NOMBRE EXACTO DE TU LISTA
        // Es el modelo profesional, más estable frente a saturaciones (503)
        const model = genAI.getGenerativeModel({ model: "gemini-pro-latest" });

        const result = await model.generateContent(
            `Actúa como vendedor de maletas. Responde brevemente: ${userQuery}`
        );
        
        const responseText = result.response.text();

        return res.json({
            fulfillmentText: responseText
        });

    } catch (error) {
        console.error("Error detallado:", error.message);
        
        // Si el Pro también falla, intentamos el Flash como última opción
        try {
            const fallbackModel = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
            const resultFB = await fallbackModel.generateContent(userQuery);
            return res.json({ fulfillmentText: resultFB.response.text() });
        } catch (err2) {
            return res.json({ 
                fulfillmentText: "Mis sistemas están muy ocupados. ¿Podrías intentar preguntarme de nuevo?" 
            });
        }
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor usando Gemini Pro Latest`));
