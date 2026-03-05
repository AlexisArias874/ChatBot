const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// OBJETO PARA GUARDAR EL HISTORIAL DE CADA USUARIO
const chatSessions = new Map();

app.post('/webhook', async (req, res) => {
    const sessionID = req.body.session; // ID único de la charla en Messenger/Dialogflow
    const userQuery = req.body.queryResult.queryText;

    try {
        // 1. OBTENER O CREAR LA SESIÓN DE ESTE USUARIO
        if (!chatSessions.has(sessionID)) {
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.0-flash-lite", // El modelo Lite que te funcionó
                systemInstruction: `
                    Eres un experto vendedor de la tienda 'Venta de Equipaje'.
                    PRODUCTOS DISPONIBLES: 🎒 Mochila, 🧳 Maleta, 👜 Bolso.
                    TAMAÑOS: Pequeña, Mediana, Grande.
                    COLORES: Negra, Blanca, Gris.
                    
                    REGLAS DE COMPORTAMIENTO:
                    1. Sé amable, profesional y puedes hacer bromas sobre viajes o maletas.
                    2. Si el usuario intenta hablar de otra cosa, redirígelo amablemente a la compra.
                    3. Cuando el usuario confirme su pedido (tenga producto, tamaño y color), inventa un "Precio Total" (ej: $1,500 MXN).
                    4. Mantén las respuestas cortas para Messenger.
                `
            });
            // Iniciamos el chat para este usuario nuevo
            chatSessions.set(sessionID, model.startChat({ history: [] }));
        }

        const chat = chatSessions.get(sessionID);

        // 2. ENVIAR EL MENSAJE AL CHAT (Esto mantiene la memoria)
        const result = await chat.sendMessage(userQuery);
        const responseAI = await result.response;
        const botReply = responseAI.text();

        return res.json({ fulfillmentText: botReply });

    } catch (error) {
        console.error("Error en el chat:", error);
        return res.json({ fulfillmentText: "Lo siento, me distraje un poco. ¿Qué decíamos de tu maleta?" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Bot con memoria listo`));
