const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const chatSessions = new Map();

// --- FUNCIÓN DE RESPUESTA CON MODELOS 2.0 ---
async function generarRespuesta2_0(userQuery, sessionID) {
    // Usaremos los modelos 2.0 de tu lista exacta
    const modelos2_0 = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.0-flash-001"];
    
    for (let nombreModelo of modelos2_0) {
        try {
            console.log(`Intentando con modelo 2.0: ${nombreModelo}`);
            const model = genAI.getGenerativeModel({ 
                model: nombreModelo,
                // Instrucción de sistema para mantener el contexto de la tienda
                systemInstruction: "Eres el mejor vendedor de 'Venta de Equipaje'. Vendes mochilas, maletas y bolsos. Eres amable y cierras ventas."
            });

            if (!chatSessions.has(sessionID)) {
                chatSessions.set(sessionID, model.startChat({ history: [] }));
            }

            const chat = chatSessions.get(sessionID);
            const result = await chat.sendMessage(userQuery);
            return result.response.text();

        } catch (error) {
            console.error(`Fallo en ${nombreModelo}:`, error.message);
            
            // Si el error es 429 (Límite 0) o 503 (Saturación), probamos el siguiente 2.0
            if (error.message.includes("429") || error.message.includes("503") || error.message.includes("404")) {
                chatSessions.delete(sessionID);
                continue; 
            }
            throw error;
        }
    }
    throw new Error("Ningún modelo 2.0 respondió.");
}

app.post('/webhook', async (req, res) => {
    const sessionID = req.body.session;
    const userQuery = req.body.queryResult.queryText;
    const intentName = req.body.queryResult.intent ? req.body.queryResult.intent.displayName : "Default";

    try {
        // Reinicio manual
        if (userQuery.toLowerCase() === "reiniciar" || intentName === "NuevoPedido") {
            chatSessions.delete(sessionID);
        }

        const botReply = await generarRespuesta2_0(userQuery, sessionID);
        return res.json({ fulfillmentText: botReply });

    } catch (err) {
        // Si todo lo anterior falla, damos la respuesta humanizada de "respaldo"
        const fallbacks = {
            "ElegirProducto": "¡Uy! Mis sistemas de maletas están algo lentos. 🧳 Pero cuéntame, ¿buscabas mochila, maleta o bolso?",
            "ElegirTamaño": "Se me perdió la cinta métrica un segundo. 😂 ¿Qué tamaño prefieres: pequeña, mediana o grande?",
            "ElegirColor": "¡Qué colores tan padres! ¿Lo quieres en negro, blanco o gris? 🎨"
        };
        const msg = fallbacks[intentName] || "Lo siento, hay mucha gente en la tienda. ¿Me repites tu duda? 😅";
        return res.json({ fulfillmentText: msg });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor forzado a modelos 2.0 activo`));
