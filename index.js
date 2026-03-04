const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

// 1. CONFIGURACIÓN: Pega aquí tu API Key de Gemini
const genAI = new GoogleGenerativeAI("AIzaSyDsyO8g_sDtHqpaBywoXdeRQTugmpGmgGE");

app.post('/webhook', async (req, res) => {
    // Extraer el mensaje del usuario desde Dialogflow
    const userQuery = req.body.queryResult.queryText;
    console.log("Usuario dijo:", userQuery);

    try {
        // 2. Configurar el modelo (gemini-1.5-flash es el más rápido y gratis)
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: "Eres un experto vendedor de la tienda 'Venta de Equipaje'. Responde de forma amable, profesional y breve. Ayuda al cliente a elegir la mejor maleta.",
        });

        // 3. Generar la respuesta
        const result = await model.generateContent(userQuery);
        const responseAI = await result.response;
        const botReply = responseAI.text();

        // 4. Enviar la respuesta de vuelta a Dialogflow -> Facebook
        return res.json({
            fulfillmentText: botReply
        });

    } catch (error) {
        console.error("Error con Gemini:", error);
        return res.json({
            fulfillmentText: "Lo siento, tuve un problema al procesar tu solicitud con Gemini."
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor con Gemini en puerto ${PORT}`));
