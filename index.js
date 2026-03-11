const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- 1. MATRIZ DE PRECIOS EXACTA ---
const PRECIOS = {
    "Mochila": { "Pequeña": "$600", "Mediana": "$850", "Grande": "$1,100" },
    "Maleta": { "Pequeña": "$1,200", "Mediana": "$1,500", "Grande": "$2,000" },
    "Bolso": { "Pequeña": "$400", "Mediana": "$600", "Grande": "$850" }
};

const calcularPrecio = (p, t) => {
    // Normalizamos para evitar errores de mayúsculas (p. ej: maleta -> Maleta)
    const prod = p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
    const tam = t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "";
    return (PRECIOS[prod] && PRECIOS[prod][tam]) ? `${PRECIOS[prod][tam]} MXN` : "$1,500 MXN";
};

// --- 2. CONFIGURACIÓN GOOGLE SHEETS ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

async function registrarEnSheets(d) {
    try {
        await doc.loadInfo();
        await doc.sheetsByIndex[0].addRow({
            "ID_Pedido": `VE-${Date.now().toString().slice(-6)}`,
            "Fecha": new Date().toLocaleString(),
            "Usuario": d.usuario,
            "Producto": d.producto,
            "Tamaño": d.tamano,
            "Color": d.color,
            "Precio": d.precio,
            "Estado": "Pendiente"
        });
        console.log("✅ Fila escrita con éxito");
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- 3. WEBHOOK OPTIMIZADO ---
app.post("/webhook", async (req, res) => {
    const { queryResult, session } = req.body;
    const intentName = queryResult.intent?.displayName;
    const params = queryResult.parameters;

    // --- CAZADOR DE ATRIBUTOS (Extrae lo que configuraste en tu imagen) ---
    // Buscamos en 'parameters' y si no está, escaneamos los 'outputContexts'
    const getAtributo = (nombre) => {
        let v = params[nombre];
        if (!v && queryResult.outputContexts) {
            for (const ctx of queryResult.outputContexts) {
                if (ctx.parameters && ctx.parameters[nombre]) {
                    v = ctx.parameters[nombre];
                    break;
                }
            }
        }
        // Si es un objeto de sistema (sys.person), sacamos el nombre
        if (v && typeof v === 'object' && v.name) v = v.name;
        return v || null;
    };

    // Obtenemos los valores REALES de tu tabla
    const usuarioFinal = getAtributo("usuario") || "Cliente";
    const productoFinal = getAtributo("producto");
    const tamanoFinal = getAtributo("tamano");
    const colorFinal = getAtributo("color");

    try {
        // PASO 5: CÁLCULO Y MUESTRA DE PRECIO (5 SeleccionColor)
        if (intentName === "5 SeleccionColor") {
            const precio = calcularPrecio(productoFinal, tamanoFinal);
            
            // Si falta algún dato, forzamos una respuesta de ayuda
            if (!productoFinal || !tamanoFinal) {
                return res.json({ fulfillmentText: "¡Qué buena elección! Pero se me olvidó qué modelo buscabas. ¿Me repites si querías maleta, mochila o bolso? 🧳" });
            }

            return res.json({ 
                fulfillmentText: `Perfecto ${usuarioFinal}, has seleccionado ${productoFinal} tamaño ${tamanoFinal} de color ${colorFinal}. El costo total será de ${precio}. ¿Quieres confirmar tu pedido?` 
            });
        }

        // PASO 6.1: REGISTRO FINAL
        if (intentName === "6.1 PasoFinalSi" || intentName === "7.1 PasoEncuestaSi") {
            const precio = calcularPrecio(productoFinal, tamanoFinal);
            
            await registrarEnSheets({
                usuario: usuarioFinal,
                producto: productoFinal || "Maleta",
                tamano: tamanoFinal || "Mediana",
                color: colorFinal || "Gris",
                precio: precio,
                session: session
            });

            return res.json({ 
                fulfillmentText: `¡Listo, ${usuarioFinal}! Tu pedido ha sido registrado. Tu ${productoFinal} ${tamanoFinal} color ${colorFinal} está en camino. El total fue ${precio}. 🚀
                
                ¿Quieres hacer una encuesta de satisfacción?` 
            });
        }

        // --- IA PARA OTROS INTENTS ---
        const aiResp = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(queryResult.queryText)}`, {
            params: { system: "Vendedor de maletas experto y breve.", model: "mistral" },
            timeout: 2500
        });
        res.json({ fulfillmentText: aiResp.data });

    } catch (err) {
        console.error("Error:", err.message);
        res.json({ fulfillmentText: "¡Excelente! ¿Confirmamos tu pedido de equipaje? 🧳" });
    }
});

app.listen(process.env.PORT || 10000);

