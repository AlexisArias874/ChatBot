const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const chatSessions = new Map();

// --- CONFIGURACIÓN DE NEGOCIO ---
const DATOS_TIENDA = {
    productos: ["Mochila 🎒", "Maleta 🧳", "Bolso 👜"],
    tamanios: ["Pequeña", "Mediana", "Grande"],
    colores: ["Negra", "Blanca", "Gris"],
    precios_base: { "Mochila": 850, "Maleta": 1500, "Bolso": 600 }
};

app.post('/webhook', async (req, res) => {
    const sessionID = req.body.session;
    const userQuery = req.body.queryResult.queryText;
    const queryLower = userQuery.toLowerCase();
    const intentName = req.body.queryResult.intent ? req.body.queryResult.intent.displayName : "Default";

    // 1. FILTRO DE SEGURIDAD (Respuestas manuales para que NUNCA falle lo básico)
    if (queryLower.includes("tamaño") || queryLower.includes("medida") || queryLower.includes("grande") || queryLower.includes("pequeñ")) {
        return res.json({ 
            fulfillmentText: `📏 ¡Buena pregunta! En 'Venta de Equipaje' nos especializamos en los tres tamaños más prácticos: Pequeña, Mediana y Grande. Están diseñadas para aprovechar cada centímetro. ¿Cuál de estas tres medidas buscas para tu viaje?` 
        });
    }

    if (queryLower.includes("color") || queryLower.includes("colores") || queryLower.includes("azul") || queryLower.includes("rojo")) {
        return res.json({ 
            fulfillmentText: `🎨 Por el momento, manejamos nuestra línea exclusiva en colores clásicos: Negra, Blanca y Gris. Son los más elegantes y no se ensucian fácil en los aeropuertos. ¿Cuál te gustaría estrenar?` 
        });
    }

    try {
        // 2. GESTIÓN DE SESIÓN Y REINICIO
        if (intentName === "NuevoPedido") {
            chatSessions.delete(sessionID);
        }

        if (!chatSessions.has(sessionID)) {
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.0-flash-lite",
                systemInstruction: `
                    ERES: El vendedor estrella de 'Venta de Equipaje'.
                    MISIÓN: Guiar al cliente por el embudo: Producto -> Tamaño -> Color -> Precio.
                    
                    INVENTARIO:
                    - Productos: Mochila, Maleta, Bolso.
                    - Tamaños: Pequeña, Mediana, Grande.
                    - Colores: Negra, Blanca, Gris.

                    REGLAS DE ORO:
                    - Si preguntan por algo que NO tenemos, di: "Esa es una buena idea, pero por ahora nos enfocamos en perfeccionar nuestras opciones actuales: [Lista]".
                    - Siempre termina con una pregunta para avanzar la venta.
                    - Usa emojis y haz bromas sobre viajes (ej. exceso de equipaje, aeropuertos).
                    - Cuando tengan Producto, Tamaño y Color, dales un "Precio Total estimado" (Mochila $850, Maleta $1500, Bolso $600) y pregunta si confirmas.
                `
            });
            chatSessions.set(sessionID, model.startChat({ history: [] }));
        }

        const chat = chatSessions.get(sessionID);
        const result = await chat.sendMessage(userQuery);
        const responseAI = await result.response;
        const botReply = responseAI.text();

        return res.json({ fulfillmentText: botReply });

    } catch (error) {
        console.error("Error en el flujo:", error);

        // 3. RESPUESTA DINÁMICA DE RESPALDO (Si la IA falla o se satura)
        const respuestasFallback = {
            "Default Welcome Intent": "¡Hola! Bienvenido a 'Venta de Equipaje'. ✈️ ¿Listo para tu próximo viaje? ¿Buscas mochila, maleta o bolso?",
            "ElegirProducto": "¡Excelente elección! 🧳 Para ese modelo, ¿lo prefieres en tamaño pequeño, mediano o grande?",
            "ElegirTamaño": "¡Perfecto! 📏 Para terminar de apartarlo, ¿en qué color lo quieres: negro, blanco o gris?",
            "ElegirColor": "¡Se va a ver increíble! 😍 ¿Te gustaría que te diera el precio total para confirmar tu pedido?",
            "ConfirmarPedido": "¡Casi listo! 🛒 Por el momento mis sistemas están un poco lentos, pero el precio aproximado es de $1,500. ¿Confirmamos?"
        };

        const fallbackMessage = respuestasFallback[intentName] || "¡Uy! Me distraje acomodando el inventario. 😅 Pero cuéntame, ¿qué tamaño o color de equipaje estabas buscando?";

        return res.json({ fulfillmentText: fallbackMessage });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Vendedor de Equipaje listo en puerto ${PORT}`));
