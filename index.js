app.post('/webhook', async (req, res) => {
    const sessionID = req.body.session;
    const userQuery = req.body.queryResult.queryText;
    
    // 1. EXTRAEMOS EL NOMBRE DEL INTENT PARA EL MANEJO DINÁMICO
    const intentName = req.body.queryResult.intent ? req.body.queryResult.intent.displayName : "Desconocido";

    try {
        if (intentName === "NuevoPedido") {
            chatSessions.delete(sessionID);
        }

        if (!chatSessions.has(sessionID)) {
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.0-flash-lite",
                systemInstruction: `Eres un experto vendedor de 'Venta de Equipaje' (mochilas, maletas y bolsos). Tu meta es cerrar ventas ayudando al usuario a elegir producto, tamaño y color.`
            });
            chatSessions.set(sessionID, model.startChat({ history: [] }));
        }

        const chat = chatSessions.get(sessionID);
        const result = await chat.sendMessage(userQuery);
        const responseAI = await result.response;
        const botReply = responseAI.text();

        return res.json({ fulfillmentText: botReply });

    } catch (error) {
        console.error("Error detectado en Intent:", intentName, error);

        // 2. MAPA DE MENSAJES DE ERROR DINÁMICOS
        const mensajesDeError = {
            "Default Welcome Intent": "¡Hola! Perdona, se me trabó la cremallera del saludo. 🎒 ¿Estás buscando mochila, maleta o bolso hoy?",
            "ElegirProducto": "¡Vaya! Me distraje viendo los catálogos. ¿Me repetías si querías maleta, mochila o bolso? 🧳",
            "ElegirTamaño": "¡Ups! Se me perdió la cinta métrica por un segundo. 📏 ¿Qué tamaño te gustaría: pequeña, mediana o grande?",
            "ElegirColor": "¡Qué colores tan bonitos! Pero me confundí un poco, ¿cuál de los tres elegiste: negra, blanca o gris? 🎨",
            "ConfirmarPedido": "¡Casi terminamos! Hubo un pequeño error al procesar el total, ¿podrías confirmarme si estás listo para el pedido? 🛒",
            "NuevoPedido": "¡Claro! Empecemos de nuevo. ¿Qué pieza de equipaje quieres agregar ahora? 🎒🧳👜"
        };

        // 3. SELECCIONAR EL MENSAJE SEGÚN EL INTENT O UNO POR DEFECTO
        const respuestaFinal = mensajesDeError[intentName] || "¡Uy! Se me cayó una maleta y me confundí. ¿Podrías repetirme lo último? 😅";

        return res.json({ fulfillmentText: respuestaFinal });
    }
});
