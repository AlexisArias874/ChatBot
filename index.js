const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "2mb" }));

async function generarRespuestaCreativa(userQuery, intentName) {
    // Usamos solo los 2 modelos más rápidos de Pollinations
    const modelos = ["mistral", "openai"]; 
    
    // Prompt ultra-corto para que la IA procese más rápido
    const systemPrompt = "Vendedor de maletas. Breve y creativo.";
    const esFallback = intentName.includes("Fallback") || intentName === "Default";
    const promptFinal = esFallback ? `Responde con ingenio a: ${userQuery}` : userQuery;

    for (let modelo of modelos) {
        try {
            // Ponemos un timeout de solo 2 segundos por modelo. 
            // Si no responde rápido, pasamos al siguiente para no agotar los 5s de Dialogflow.
            const response = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(promptFinal)}`, {
                params: {
                    system: systemPrompt,
                    model: modelo,
                    seed: Math.floor(Math.random() * 1000)
                },
                timeout: 2200 
            });

            if (response.data) return response.data;
        } catch (error) {
            console.log(`Salto de modelo ${modelo} por lentitud o error.`);
            continue; 
        }
    }
    return "¡Hola! Estoy ordenando el inventario. 🧳 ¿En qué puedo ayudarte?";
}

app.post("/webhook", async (req, res) => {
    // Respuesta inmediata: Si el servidor acaba de despertar, esto ayuda a mantener la conexión
    const userQuery = req.body.queryResult.queryText;
    const intentName = req.body.queryResult.intent ? req.body.queryResult.intent.displayName : "Default";

    try {
        const respuesta = await generarRespuestaCreativa(userQuery, intentName);
        res.json({ fulfillmentText: respuesta });
    } catch (err) {
        res.json({ fulfillmentText: "¡Qué buena pregunta! Dame un segundo para revisarlo." });
    }
});

app.get("/", (req, res) => res.send("Servidor Activo"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));
