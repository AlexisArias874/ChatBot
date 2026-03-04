const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

// CONFIGURACIÓN: Lee la clave de las variables de entorno de Render
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/webhook', async (req, res) => {
    // Validar que Dialogflow envió datos
    if (!req.body.queryResult || !req.body.queryResult.queryText) {
        return res.json({ fulfillmentText: "No recibí texto." });
    }

    const userQuery = req.body.queryResult.queryText;
    console.log("Usuario dijo:", userQuery);

    try {
        // Seleccionamos el modelo gemini-1.5-flash (el más recomendado)
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            // INSTRUCCIONES DE SISTEMA: Aquí defines la "personalidad" de tu IA
            systemInstruction: `Eres un asistente experto de la tienda 'Venta de Equipaje'. 
            Tu objetivo es ayudar a los clientes a encontrar maletas y equipaje. 
            Responde de forma amable, profesional y concisa. 
            Si te preguntan algo que no sea de maletas, intenta redirigir la conversación al negocio.`
        });

        const result = await model.generateContent(userQuery);
        const responseAI = await result.response;
        const botReply = responseAI.text();

        // Enviamos la respuesta de vuelta a Facebook
        return res.json({
            fulfillmentText: botReply
        });

    } catch (error) {
        console.error("Error con Gemini:", error);
        return res.json({
            fulfillmentText: "Lo siento, tuve un problema técnico. ¿Puedes repetir tu pregunta?"
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Bot de Equipaje vivo en puerto ${PORT}`));
