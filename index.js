const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/webhook', async (req, res) => {
    if (!req.body.queryResult) return res.json({ fulfillmentText: "Error de datos." });
    const userQuery = req.body.queryResult.queryText;

    try {
        // USANDO EL MODELO EXACTO DE TU LISTA: gemini-2.0-flash-lite
        // Este es el que tiene más probabilidad de tener cuota gratuita libre
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

        const result = await model.generateContent(
            `Eres un vendedor de maletas. Responde de forma muy breve: ${userQuery}`
        );
        
        return res.json({ fulfillmentText: result.response.text() });

    } catch (error) {
        console.error("Error con 2.0-flash-lite, intentando gemini-flash-lite-latest...");
        
        try {
            // PLAN B: Otro modelo Lite de tu lista que debería ser gratuito
            const backupModel = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });
            const resultBackup = await backupModel.generateContent(userQuery);
            return res.json({ fulfillmentText: resultBackup.response.text() });
        } catch (err2) {
            console.error("Ambos fallaron:", err2.message);
            return res.json({ 
                fulfillmentText: "Mis sistemas están saturados. Por favor, intenta de nuevo en unos segundos." 
            });
        }
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo usando modelos Lite de tu lista`));
