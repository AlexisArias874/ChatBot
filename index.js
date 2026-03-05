const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const chatSessions = new Map();

// --- FUNCIÓN DE RESPALDO PARA CUOTAS (PLAN A, B y C) ---
async function generarRespuestaConRespaldo(userQuery, sessionID) {
    // Lista de modelos ordenados por estabilidad en la versión gratuita
    const modelosSoportados = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"];
    
    for (let nombreModelo of modelosSoportados) {
        try {
            console.log(`Intentando con el modelo estable: ${nombreModelo}`);
            const model = genAI.getGenerativeModel({ 
                model: nombreModelo,
                systemInstruction: "Eres el vendedor estrella de 'Venta de Equipaje'. Ayuda al cliente a elegir mochila, maleta o bolso."
            });

            // Si no hay sesión, la creamos para este modelo
            if (!chatSessions.has(sessionID)) {
                chatSessions.set(sessionID, model.startChat({ history: [] }));
            }

            const chat = chatSessions.get(sessionID);
            const result = await chat.sendMessage(userQuery);
            return result.response.text();

        } catch (error) {
            console.error(`Error con ${nombreModelo}:`, error.message);
            // Si es error de cuota (429), borramos la sesión fallida e intentamos el siguiente modelo
            chatSessions.delete(sessionID);
            if (error.message.includes("429") || error.message.includes("404")) continue;
            throw error;
        }
    }
    throw new Error("Ningún modelo de Google está disponible ahora.");
}

app.post('/webhook', async (req, res) => {
    const sessionID = req.body.session;
    const userQuery = req.body.queryResult.queryText;
    const intentName = req.body.queryResult.intent ? req.body.queryResult.intent.displayName : "Default";

    try {
        if (intentName === "NuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            chatSessions.delete(sessionID);
        }

        const botReply = await generarRespuestaConRespaldo(userQuery, sessionID);
        return res.json({ fulfillmentText: botReply });

    } catch (finalError) {
        // RESPUESTA DE EMERGENCIA SI GOOGLE SE CAE POR COMPLETO
        const respuestasFallback = {
            "ElegirProducto": "¡Uy! Mis sistemas están saturados. Pero cuéntame, ¿buscabas maleta, mochila o bolso? 🧳",
            "ElegirTamaño": "Se me perdió la cinta métrica por un segundo. 😂 ¿Qué tamaño prefieres: pequeña, mediana o grande?",
            "ElegirColor": "¡Qué colores tan bonitos! ¿Cuál de los tres prefieres: negra, blanca o gris? 🎨"
        };
        const msg = respuestasFallback[intentName] || "Lo siento, hay mucha gente en la tienda ahora mismo. ¿Podrías repetirme tu pregunta? 😅";
        return res.json({ fulfillmentText: msg });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Vendedor listo con modelos serie 1.5`));
