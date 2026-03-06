const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const chatSessions = new Map();

// función para esperar
function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- FUNCIÓN DE RESPUESTA CON FALLBACK ---
async function generarRespuesta(userQuery, sessionID) {

    // lista de modelos en orden de prioridad
    const modelos = [
        "gemini-1.5-flash",
        "gemini-1.5-flash-latest",
        "gemini-1.5-pro",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite"
    ];

    for (let nombreModelo of modelos) {

        try {

            console.log(`Intentando modelo: ${nombreModelo}`);

            const model = genAI.getGenerativeModel({
                model: nombreModelo,
                systemInstruction:
                "Eres el mejor vendedor de 'Venta de Equipaje'. Vendes mochilas, maletas y bolsos. Eres amable y cierras ventas.",
                generationConfig: {
                    maxOutputTokens: 200,
                    temperature: 0.7
                }
            });

            if (!chatSessions.has(sessionID)) {
                chatSessions.set(sessionID, model.startChat({ history: [] }));
            }

            const chat = chatSessions.get(sessionID);

            const result = await chat.sendMessage(userQuery);

            return result.response.text();

        } catch (error) {

            console.error(`Fallo en ${nombreModelo}:`, error.message);

            // límite de requests
            if (error.message.includes("429")) {
                console.log("Rate limit alcanzado, esperando 10s...");
                await sleep(10000);
                continue;
            }

            // modelo saturado
            if (error.message.includes("503")) {
                console.log("Modelo saturado, probando otro...");
                continue;
            }

            // modelo no encontrado
            if (error.message.includes("404")) {
                console.log("Modelo no disponible...");
                continue;
            }

            chatSessions.delete(sessionID);
        }
    }

    throw new Error("Ningún modelo respondió.");
}

app.post('/webhook', async (req, res) => {

    const sessionID = req.body.session;
    const userQuery = req.body.queryResult.queryText;

    const intentName =
        req.body.queryResult.intent
        ? req.body.queryResult.intent.displayName
        : "Default";

    try {

        // reiniciar sesión manual
        if (userQuery.toLowerCase() === "reiniciar" || intentName === "NuevoPedido") {
            chatSessions.delete(sessionID);
        }

        const botReply = await generarRespuesta(userQuery, sessionID);

        return res.json({
            fulfillmentText: botReply
        });

    } catch (err) {

        console.error("Error total:", err.message);

        // fallback humanizado
        const fallbacks = {

            "ElegirProducto":
                "¡Uy! Mis sistemas de maletas están algo lentos. 🧳 Pero cuéntame, ¿buscabas mochila, maleta o bolso?",

            "ElegirTamaño":
                "Se me perdió la cinta métrica un segundo. 😂 ¿Qué tamaño prefieres: pequeña, mediana o grande?",

            "ElegirColor":
                "¡Qué colores tan padres! ¿Lo quieres en negro, blanco o gris? 🎨"
        };

        const msg =
            fallbacks[intentName] ||
            "Lo siento, hay mucha gente en la tienda. ¿Me repites tu duda? 😅";

        return res.json({
            fulfillmentText: msg
        });
    }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () =>
    console.log(`🚀 Servidor con fallback inteligente activo`)
);
