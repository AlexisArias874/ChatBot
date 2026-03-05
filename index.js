app.post('/webhook', async (req, res) => {
    const sessionID = req.body.session;
    const userQuery = req.body.queryResult.queryText;
    const intentName = req.body.queryResult.intent.displayName; // <--- LEEMOS EL NOMBRE DEL INTENT

    try {
        // SI EL INTENT ES "NuevoPedido", BORRAMOS LA MEMORIA DE ESTE USUARIO
        if (intentName === "9 PasoNuevoPedido") {
            chatSessions.delete(sessionID); 
            console.log(`Sesión ${sessionID} reiniciada para nuevo pedido.`);
            // No retornamos aquí, dejamos que el código de abajo cree una sesión limpia
        }

        if (!chatSessions.has(sessionID)) {
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.0-flash-lite",
                systemInstruction: `
                    Eres el vendedor estrella de 'Venta de Equipaje'.
                    TU OBJETIVO: Cerrar ventas de 🎒Mochilas, 🧳Maletas y 👜Bolsos.
                    
                    FLUJO DE VENTA:
                    1. Ayuda al cliente a elegir Producto, Tamaño y Color.
                    2. Al tener los 3 datos, da el PRECIO TOTAL e inventa un número de pedido.
                    3. LUEGO DE DAR EL PRECIO, pregunta siempre: "¿Te gustaría agregar otra pieza a tu pedido o prefieres que procedamos con el pago de esta?".
                    
                    REGLAS DE MEMORIA:
                    - Si el usuario dice "Quiero otra", felicítalo por su elección y pregúntale cuál de nuestros otros productos (mochila, maleta o bolso) quiere ahora.
                    - Si el usuario se confunde, recuérdale las opciones disponibles.
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
        console.error("Error:", error);
        return res.json({ fulfillmentText: "Hubo un pequeño error, pero cuéntame, ¿qué otra maleta estás buscando?" });
    }
});
