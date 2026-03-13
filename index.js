const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- 1. MATRIZ DE PRECIOS ---
const PRECIOS = {
    "Mochila": { "Pequeña": "$600", "Mediana": "$850", "Grande": "$1,100" },
    "Maleta": { "Pequeña": "$1,200", "Mediana": "$1,500", "Grande": "$2,000" },
    "Bolso": { "Pequeña": "$400", "Mediana": "$600", "Grande": "$850" }
};

const calcularPrecio = (p, t) => {
    const prod = p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
    const tam = t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "";
    return (PRECIOS[prod] && PRECIOS[prod][tam]) ? `${PRECIOS[prod][tam]} MXN` : "$1,500 MXN";
};

// --- CORRECCIÓN ID: VE-644029-1481 ---
const generarID = () => {
    const parte1 = Date.now().toString().slice(-6); // 6 dígitos basados en tiempo
    const parte2 = Math.floor(1000 + Math.random() * 9000); // 4 dígitos aleatorios
    return `VE-${parte1}-${parte2}`;
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
        const sheet = doc.sheetsByIndex[0];
        // Asegúrate de que las llaves coincidan exactamente con las cabeceras de tu Excel
        await sheet.addRow({
            "ID_Pedido": d.ID_Pedido, 
            "Fecha": new Date().toLocaleString("es-MX", {timeZone: "America/Mexico_City"}), 
            "Usuario": d.usuario,
            "Producto": d.producto, 
            "Tamaño": d.tamano, 
            "Color": d.color, 
            "Precio": d.precio, 
            "Estado": "Pendiente"
        });
        console.log("✅ Pedido guardado correctamente:", d.ID_Pedido);
    } catch (e) { 
        console.error("❌ Error Sheets:", e.message); 
    }
}

// --- 3. LÓGICA DE IA (POLLINATIONS) - TIMEOUT 20s ---
async function generarRespuestaIA(query, modo, info = {}) {
    let systemPrompt = "";
    if (modo === "despedida") {
        systemPrompt = `Eres un vendedor amable. El cliente ${info.nombre} terminó su compra. 
        INSTRUCCIONES: Agradece brevemente, cuenta un chiste corto de viajes y despídete con emojis.`;
    } else if (modo === "interrupcion") {
        systemPrompt = `Vendedor experto. El usuario preguntó algo fuera de lugar: "${query}". Responde breve con humor y regrésalo al paso de ${info.paso} pidiendo su ${info.siguienteDato}.`;
    } else {
        systemPrompt = "Vendedor experto de maletas. Sé breve y amable.";
    }

    try {
        const resp = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, {
            params: { system: systemPrompt, model: "openai", seed: Math.floor(Math.random() * 1000) },
            timeout: 20000 // SUBIDO A 20 SEGUNDOS
        });
        return resp.data;
    } catch (e) { 
        console.error("⚠️ Timeout IA, usando respuesta fallback.");
        return `¡Gracias por tu preferencia, ${info.nombre}! 🙌 ¿Deseas algo más? Escribe 'Hola' para un nuevo pedido.`; 
    }
}

// --- 4. WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult, session } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Default Fallback Intent";
    const userQuery = queryResult.queryText;

    const getDato = (nombre) => {
        let v = queryResult.parameters[nombre];
        if (!v && queryResult.outputContexts) {
            for (const ctx of queryResult.outputContexts) {
                if (ctx.parameters && ctx.parameters[nombre]) { v = ctx.parameters[nombre]; break; }
            }
        }
        if (v && typeof v === 'object' && v.name) v = v.name; 
        return v || null;
    };

    try {
        const usuario = getDato("usuario") || "Cliente";
        const estaEnEncuesta = queryResult.outputContexts?.some(c => c.name.includes("esperandocalificacion"));

        // --- REINICIO TOTAL ---
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const borrar = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({
                fulfillmentText: "🧹 Memoria limpia. Escribe 'Hola' para empezar de nuevo.",
                outputContexts: borrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // --- PASO 6.1: REGISTRO Y LIMPIEZA ---
        if (intentName === "6.1 PasoFinalSi") {
            const nuevoId = generarID();
            const prod = getDato("producto") || "Maleta";
            const tam = getDato("tamano") || "Mediana";
            const col = getDato("color") || "Gris";
            const precio = calcularPrecio(prod, tam);

            // Se envía explícitamente el ID generado
            await registrarEnSheets({ 
                ID_Pedido: nuevoId, 
                usuario, 
                producto: prod, 
                tamano: tam, 
                color: col, 
                precio 
            });

            const resumen = `¡Listo, ${usuario}! 🎉 Pedido registrado con éxito.\n\n🆔 ID: ${nuevoId}\n🎒 Objeto: ${prod}\n📏 Tamaño: ${tam}\n💰 Precio: ${precio}\n\n¿Te gustaría responder una encuesta de satisfacción?`;
            
            const limpiarCompra = ["iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal"];
            const outCtxs = limpiarCompra.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            outCtxs.push({ name: `${session}/contexts/pasoencuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentText: resumen,
                outputContexts: outCtxs
            });
        }

        // --- PASO 7.1 / 7.2 / 8 Lógica de encuesta (Se mantiene igual) ---
        if (intentName === "7.1 PasoEncuestaSi") {
            return res.json({ 
                fulfillmentText: `¡Genial, ${usuario}! ⭐ ¿Cómo calificarías tu experiencia hoy? (Mala, Regular, Buena, Excelente)`,
                outputContexts: [{ name: `${session}/contexts/esperandocalificacion`, lifespanCount: 1 }]
            });
        }

        if (intentName === "8 PasoDespedida" || intentName === "7.2 PasoEncuestaNo" || (intentName.includes("Fallback") && estaEnEncuesta)) {
            const despedida = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            return res.json({ fulfillmentText: despedida });
        }

        // --- IA PARA INTERRUPCIONES ---
        let pActual = "el inicio", sDato = "producto";
        if (getDato("producto")) { pActual = "el tamaño"; sDato = "tamaño"; }
        if (getDato("tamano")) { pActual = "el color"; sDato = "color"; }

        const respuestaIA = await generarRespuestaIA(userQuery, "interrupcion", { paso: pActual, siguienteDato: sDato, nombre: usuario });
        return res.json({ fulfillmentText: respuestaIA });

    } catch (err) {
        return res.json({ fulfillmentText: "¡Excelente! ¿Confirmamos tu pedido? 🧳" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Puerto: ${PORT}`));
