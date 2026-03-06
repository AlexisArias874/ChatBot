const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "2mb" }));

async function generarRespuestaCreativa(userQuery, intentName) {
    // Prompt más corto = Respuesta más rápida
    const systemPrompt = "Eres un vendedor de maletas amable y breve. Responde en menos de 20 palabras.";
    
    // Si es fallback, pedimos algo ingenioso pero MUY corto
    const instruccion = (intentName.includes("Fallback") || intentName === "Default")
        ? " El usuario no fue claro. Sé creativo y breve."
        : "";

    // Construimos la URL. Agregamos 'seed' aleatorio para evitar que la API cachee respuestas viejas
    const seed = Math.floor(Math.random() * 1000);
    const url = `https://text.pollinations.ai/${encodeURIComponent(userQuery)}?system=${encodeURIComponent(systemPrompt + instruccion)}&model=openai&seed=${seed}`;

    try {
        // Configuramos un TIMEOUT de 4000ms (4 segundos)
        // Si la API no responde en 4 segundos, axios lanzará un error
        const response = await axios.get(url, { timeout: 4000 });
        return response.data;
    } catch (error) {
        console.error("Error o Tiempo excedido:", error.message);
        // Si tarda mucho, enviamos esta respuesta rápida para que Dialogflow no falle
        return "¡Uy! Mi catálogo de maletas es tan grande que me perdí buscándola. 😂 ¿Me repites eso?";
    }
}

app.post("/webhook", async (req, res) => {
    const userQuery = req.body.queryResult.queryText;
    const intentName = req.body.queryResult.intent ? req.body.queryResult.intent.displayName : "Default";

    try {
        // Intentamos obtener la respuesta de la API
        const respuesta = await generarRespuestaCreativa(userQuery, intentName);

        res.json({
            fulfillmentText: respuesta
        });

    } catch (err) {
        res.json({
            fulfillmentText: "Estamos recibiendo muchos clientes, ¡vuelve a preguntarme!"
        });
    }
});

app.get("/", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));
