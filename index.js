const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
app.use(express.json());

// CONFIGURACIÓN: Tu API Key
const genAI = new GoogleGenerativeAI("AIzaSyDsyO8g_sDtHqpaBywoXdeRQTugmpGmgGE");

// FUNCIÓN PARA LISTAR MODELOS (Aparecerá en los logs de Render)
async function listModels() {
    try {
        console.log("--- LISTA DE MODELOS DISPONIBLES ---");
        // Nota: En algunas versiones de la SDK, listModels() puede variar.
        // Intentaremos listar los modelos para ver cuáles tienes activos.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${genAI.apiKey}`);
        const data = await response.json();
        
        if (data.models) {
            data.models.forEach(m => console.log("- " + m.name));
        } else {
            console.log("No se pudieron listar los modelos:", data);
        }
        console.log("------------------------------------");
    } catch (err) {
        console.error("Error al listar modelos:", err);
    }
}

// Ejecutar la lista al iniciar
listModels();

app.post('/webhook', async (req, res) => {
    const userQuery = req.body.queryResult.queryText;
    console.log("Usuario dijo:", userQuery);

    try {
        // PRUEBA ESTO: Cambiamos a 'gemini-pro' que es el más compatible universalmente
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        const result = await model.generateContent(userQuery);
        const responseAI = await result.response;
        const botReply = responseAI.text();

        return res.json({ fulfillmentText: botReply });

    } catch (error) {
        console.error("Error detallado de Gemini:", error);
        return res.json({ fulfillmentText: "Error de conexión con la IA." });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
