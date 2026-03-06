const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json({ limit: "2mb" }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const chatSessions = new Map();
let MODELOS_DISPONIBLES = [];

// pausa para evitar rate limit
function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}

//////////////////////////////////////////////////////
// OBTENER MODELOS DISPONIBLES
//////////////////////////////////////////////////////

async function cargarModelos(){

    try{

        const models = await genAI.listModels();

        MODELOS_DISPONIBLES = models
        .filter(m => m.supportedGenerationMethods.includes("generateContent"))
        .map(m => m.name.replace("models/",""));

        console.log("===== MODELOS DISPONIBLES =====");

        MODELOS_DISPONIBLES.forEach(m=>{
            console.log("✔", m);
        });

        console.log("===============================");

    }catch(error){

        console.error("Error obteniendo modelos:", error.message);

    }

}

//////////////////////////////////////////////////////
// GENERAR RESPUESTA CON FALLBACK
//////////////////////////////////////////////////////

async function generarRespuesta(userQuery, sessionID){

    if(MODELOS_DISPONIBLES.length === 0){
        throw new Error("No hay modelos disponibles");
    }

    for(let modelo of MODELOS_DISPONIBLES){

        try{

            console.log("Intentando modelo:", modelo);

            const model = genAI.getGenerativeModel({
                model: modelo,
                systemInstruction:
                "Eres el mejor vendedor de 'Venta de Equipaje'. Vendes mochilas, maletas y bolsos. Eres amable y ayudas al cliente a elegir.",
                generationConfig:{
                    maxOutputTokens:200,
                    temperature:0.7
                }
            });

            if(!chatSessions.has(sessionID)){
                chatSessions.set(sessionID, model.startChat({ history: [] }));
            }

            const chat = chatSessions.get(sessionID);

            const result = await chat.sendMessage(userQuery);

            return result.response.text();

        }catch(error){

            console.log(`Fallo en ${modelo}:`, error.message);

            if(error.message.includes("429")){
                console.log("Rate limit, esperando...");
                await sleep(8000);
                continue;
            }

            if(
                error.message.includes("503") ||
                error.message.includes("404")
            ){
                continue;
            }

            chatSessions.delete(sessionID);
        }

    }

    throw new Error("Ningún modelo respondió");

}

//////////////////////////////////////////////////////
// WEBHOOK PARA DIALOGFLOW
//////////////////////////////////////////////////////

app.post("/webhook", async (req,res)=>{

    const sessionID = req.body.session;

    const userQuery =
    req.body.queryResult.queryText;

    const intentName =
    req.body.queryResult.intent
    ? req.body.queryResult.intent.displayName
    : "Default";

    try{

        if(
            userQuery.toLowerCase() === "reiniciar" ||
            intentName === "NuevoPedido"
        ){
            chatSessions.delete(sessionID);
        }

        const respuesta =
        await generarRespuesta(userQuery, sessionID);

        res.json({
            fulfillmentText: respuesta
        });

    }catch(err){

        console.log("Fallback activado");

        const fallbacks = {

            "ElegirProducto":
            "¡Uy! Mis sistemas de maletas están algo lentos 🧳 ¿Buscas mochila, maleta o bolso?",

            "ElegirTamaño":
            "Se me perdió la cinta métrica un segundo 😂 ¿La quieres pequeña, mediana o grande?",

            "ElegirColor":
            "¡Tenemos varios colores! 🎨 ¿Negro, blanco o gris?"
        };

        const msg =
        fallbacks[intentName] ||
        "Perdón, hay mucha gente en la tienda 😅 ¿Puedes repetir tu pregunta?";

        res.json({
            fulfillmentText: msg
        });

    }

});

//////////////////////////////////////////////////////
// ENDPOINT PARA VER MODELOS
//////////////////////////////////////////////////////

app.get("/modelos",(req,res)=>{

    res.json({
        modelos: MODELOS_DISPONIBLES
    });

});

//////////////////////////////////////////////////////
// INICIAR SERVIDOR
//////////////////////////////////////////////////////

const PORT = process.env.PORT || 10000;

app.listen(PORT, async ()=>{

    console.log("🚀 Servidor iniciado");

    await cargarModelos();

});
