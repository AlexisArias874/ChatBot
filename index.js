const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- 1. MATRIZ DE PRECIOS DINÁMICA ---
const PRECIOS = {
    "Mochila": { "Pequeña": "$600", "Mediana": "$850", "Grande": "$1,100" },
    "Maleta": { "Pequeña": "$1,200", "Mediana": "$1,500", "Grande": "$2,000" },
    "Bolso": { "Pequeña": "$400", "Mediana": "$600", "Grande": "$850" }
};

function calcularPrecio(producto, tamano) {
    const p = producto.charAt(0).toUpperCase() + producto.slice(1).toLowerCase();
    const t = tamano.charAt(0).toUpperCase() + tamano.slice(1).toLowerCase();
    if (PRECIOS[p] && PRECIOS[p][t]) return `${PRECIOS[p][t]} MXN`;
    return "$1,500 MXN";
}

// --- 2. GENERADOR DE ID ÚNICO ---
function generarIDPedido() {
    const fecha = new Date();
    const formatoFecha = fecha.getFullYear().toString().slice(-2) + 
                       (fecha.getMonth() + 1).toString().padStart(2, '0') + 
                       fecha.getDate().toString().padStart(2, '0');
    const random = Math.floor(1000 + Math.random() * 9000);
    return `VE-${formatoFecha}-${random}`; // Ejemplo: VE-240310-4512
}

// --- 3. CONFIGURACIÓN DE GOOGLE SHEETS ---
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

async function registrarEnSheets(datos) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
 await sheet.addRow({
            "ID_Pedido": datos.id,
            "Fecha": new Date(),
            "Usuario": datos.usuario,
            "Producto": datos.producto,
            "Tamaño": datos.tamano,
            "Color": datos.color,
            "Precio": datos.precio,
            "Estado": "Pendiente"
        });
        console.log("✅ Pedido guardado en Sheets ID:", datos.id);
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 4. LÓGICA DE IA (POLLINATIONS) ---
async function generarRespuestaCreativa(userQuery, intentName) {
    const modelos = ["mistral", "openai"]; 
    const systemPrompt = "Vendedor experto de 'Venta de Equipaje'. Solo vendes: Mochila, Maleta, Bolso. Tamaños: Pequeña, Mediana, Grande. Colores: Negra, Blanca, Gris. Sé creativo, breve y cierra con pregunta.";

    for (let modelo of modelos) {
        try {
            const response = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(userQuery)}`, {
                params: { system: systemPrompt, model: modelo, seed: Math.floor(Math.random() * 1000) },
                timeout: 2300 
            });
            if (response.data) return response.data;
        } catch (error) { continue; }
    }
    return "¡Excelente elección! 🧳 ¿Confirmamos el pedido para enviarlo a bodega?";
}

// --- 5. WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const queryResult = req.body.queryResult;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Default";
    const sessionID = req.body.session;
    const params = queryResult.parameters;

    // Función para rescatar el nombre del cliente de los contextos
    const obtenerNombreUsuario = () => {
        if (params.person && params.person.name) return params.person.name;
        if (queryResult.outputContexts) {
            for (let ctx of queryResult.outputContexts) {
                if (ctx.parameters && ctx.parameters.person) {
                    const p = ctx.parameters.person;
                    return typeof p === 'object' ? p.name : p;
                }
            }
        }
        return "Cliente";
    };

    try {
        // DETECTAR PASO FINAL (6.1 o 7.1)
        if (intentName === "6.1 PasoFinalSi" || intentName === "7.1 PasoEncuestaSi") {
            const id = generarIDPedido();
            const nombre = obtenerNombreUsuario();
            const prod = params.producto || "Maleta";
            const tam = params.tamano || "Mediana";
            const precio = calcularPrecio(prod, tam);

            await registrarEnSheets({
                id: id,
                session: sessionID,
                usuario: nombre,
                producto: prod,
                tamano: tam,
                color: params.color || "Gris",
                precio: precio
            });

            return res.json({ 
                fulfillmentText: `¡Listo, ${nombre}! 🥳 Tu pedido ha sido registrado con el ID: ${id}. Tu ${prod} ${tam} de color ${params.color || 'Gris'} está en proceso. El total es ${precio}. ¿Te gustaría responder una breve encuesta?` 
            });
        }

        // RESPUESTA DE IA PARA EL RESTO DE INTENTS
        const respuesta = await generarRespuestaCreativa(queryResult.queryText, intentName);
        res.json({ fulfillmentText: respuesta });

    } catch (err) {
        console.error("Error Webhook:", err.message);
        const errores = {
            "3.1 CompraProducto": "¡Uy! ¿Buscabas maleta, mochila o bolso? 🧳",
            "4 SeleccionTamano": "No encuentro la cinta métrica. 📏 ¿Qué tamano prefieres: pequeña, mediana o grande?",
            "5 SeleccionColor": "¡Qué colores tan padres! 🎨 ¿Lo quieres en negro, blanco o gris?"
        };
        res.json({ fulfillmentText: errores[intentName] || "¡Recibido! Tu pedido está en proceso. 🧳" });
    }
});

app.get("/", (req, res) => res.send("Servidor Venta de Equipaje ONLINE"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Corriendo en puerto: ${PORT}`));


