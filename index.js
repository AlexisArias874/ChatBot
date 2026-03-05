const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/webhook', async (req, res) => {
    if (!req.body.queryResult) return res.json({ fulfillmentText: "Error de datos." });
    const userQuery = req.body.queryResult.queryText;

    try {
        // Probamos con el modelo más liviano y con mayor probabilidad de cuota libre
        // Si este falla, el "catch" intentará con el Pro estándar.
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        const result = await model.generateContent(
            `Instrucción: Eres un vendedor de la tienda 'Venta de Equipaje'. Responde de forma muy breve: ${userQuery}`
        );
        
        return res.json({ fulfillmentText: result.response.text() });

    } catch (error) {
        console.error("Error con Flash, intentando con 1.5-pro-latest...");
        
        try {
            // Plan B: El modelo Pro estándar (A veces tiene cuota cuando el Flash falla)
            const backupModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
            const resultBackup = await backupModel.generateContent(userQuery);
            return res.json({ fulfillmentText: resultBackup.response.text() });
        } catch (err2) {
            console.error("Ambos fallaron:", err2.message);
            return res.json({ 
                fulfillmentText: "Mis sistemas están saturados por ahora. Por favor, intenta de nuevo en unos segundos." 
            });
        }
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo con Gemini 1.5 Flash Latest`));
