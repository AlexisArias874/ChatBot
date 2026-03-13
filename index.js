const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// ─── 1. CONFIGURACIÓN Y PRECIOS ──────────────────────────────────────────────
const PRECIOS = {
  "Maleta":  { "Pequeña": 800, "Mediana": 1200, "Grande": 1600 },
  "Mochila": { "Pequeña": 400, "Mediana": 600,  "Grande": 900  },
  "Maletín": { "Pequeña": 500, "Mediana": 750,  "Grande": 1000 },
};

function calcularPrecio(producto, tamano) {
  const p = producto ? producto.charAt(0).toUpperCase() + producto.slice(1).toLowerCase() : "";
  const t = tamano ? tamano.charAt(0).toUpperCase() + tamano.slice(1).toLowerCase() : "";
  return PRECIOS[p]?.[t] ? `$${PRECIOS[p][t]} MXN` : "$1,200 MXN";
}

function generarID() {
  return "TXM-" + Date.now().toString().slice(-6);
}

// ─── 2. CONFIGURACIÓN GOOGLE SHEETS ──────────────────────────────────────────
// Se usan variables individuales para evitar el error de "client_email"
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

async function registrarEnSheets(datos) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        // Estos son los nombres de las columnas en tu Excel/Sheet
        await sheet.addRow({
            "ID":       datos.id,
            "Usuario":  datos.usuario,
            "Producto": datos.producto,
            "Tamaño":   datos.tamano,
            "Color":    datos.color,
            "Precio":   datos.precio,
            "Fecha":    new Date().toLocaleString("es-MX"),
            "Estado":   "Pendiente"
        });
        console.log("✅ Pedido registrado:", datos.id);
    } catch (e) { 
        console.error("❌ Error Sheets:", e.message); 
    }
}

// ─── 3. LÓGICA DE IA (POLLINATIONS) ──────────────────────────────────────────
async function generarRespuestaIA(userQuery, tipo, contexto = {}) {
    const prompts = {
        interrupcion: `Eres un asistente de ventas de Transmex. El cliente está en el paso de elegir ${contexto.paso}. Escribió: "${userQuery}". Responde brevemente y redirige a elegir su ${contexto.siguienteDato}.`,
        despedida: `Eres un asistente de ventas. El cliente ${contexto.nombre} terminó. Genera una despedida cálida y breve.`,
        fallback: `Pide amablemente al cliente que se explique mejor sobre su pedido de maletas.`
    };
    const systemPrompt = prompts[tipo] || prompts.fallback;

    try {
        const resp = await axios.post("https://text.pollinations.ai/openai", {
            model: "openai",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userQuery || "hola" }
            ]
        }, { timeout: 5000 });
        return resp.data?.choices?.[0]?.message?.content?.trim() || "¡Gracias por tu compra!";
    } catch (e) {
        return `¡Gracias por preferirnos, ${contexto.nombre || "cliente"}! 👋`;
    }
}

// ─── 4. WEBHOOK PRINCIPAL ────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
    const { queryResult, session } = req.body;
    const intentName = queryResult.intent?.displayName || "";
    const userQuery = queryResult.queryText || "";

    const getDato = (nombre) => {
        let v = queryResult.parameters?.[nombre];
        if (!v && queryResult.outputContexts) {
            for (const ctx of queryResult.outputContexts) {
                if (ctx.parameters?.[nombre]) { v = ctx.parameters[nombre]; break; }
            }
        }
        return (v && typeof v === 'object' && v.name) ? v.name : (v || null);
    };

    try {
        const usuario = getDato("usuario") || "Alex";
        const estaEnEncuesta = queryResult.outputContexts?.some(c => c.name.includes("esperandocalificacion"));

        // REINICIO
        if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
            const borrar = ["bienvenida", "iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal", "pasoencuesta", "esperandocalificacion"];
            return res.json({
                fulfillmentText: "🧹 Memoria limpia. Escribe 'Hola' para empezar de nuevo.",
                outputContexts: borrar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // PASO 6.1: CONFIRMACIÓN Y REGISTRO (Aquí es donde se guarda en el Sheet)
        if (intentName === "6.1 PasoFinalSi") {
            const id = generarID();
            const prod = getDato("producto") || "Mochila";
            const tam = getDato("tamano") || "Pequeña";
            const col = getDato("color") || "Gris";
            const precio = calcularPrecio(prod, tam);

            // Llamada compatible con los campos del Sheet
            await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: col, precio });

            // Mensaje de confirmación (Mantenido exactamente igual a tu imagen)
            const resumen = `¡Listo, ${usuario}! 🎉 Pedido registrado.\n🆔 ID: ${id}\n🎒 ${prod} – ${tam} – ${col}\n💰 ${precio}\n\n¿Te gustaría responder una encuesta de satisfacción?`;
            
            const limpiarCompra = ["iniciocompra", "pasodoscompra", "pasotamano", "pasocolor", "pasofinal"];
            const outCtxs = limpiarCompra.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
            outCtxs.push({ name: `${session}/contexts/pasoencuesta`, lifespanCount: 1 });

            return res.json({
                fulfillmentMessages: [
                    { text: { text: [resumen] } },
                    { payload: { facebook: { attachment: { type: "template", payload: { template_type: "button", text: "Selecciona:", buttons: [{ type: "postback", title: "Sí", payload: "Si" }, { type: "postback", title: "No", payload: "No" }] } } } } }
                ],
                outputContexts: outCtxs
            });
        }

        // PASO 7.1: ENCUESTA
        if (intentName === "7.1 PasoEncuestaSi") {
            return res.json({ 
                fulfillmentText: `¡Genial, ${usuario}! ⭐ ¿Cómo calificarías tu experiencia? (Mala / Regular / Buena / Excelente)`,
                outputContexts: [{ name: `${session}/contexts/esperandocalificacion`, lifespanCount: 1 }]
            });
        }

        // DESPEDIDA
        if (intentName === "8 PasoDespedida" || intentName === "7.2 PasoEncuestaNo" || (intentName.includes("Fallback") && estaEnEncuesta)) {
            const despedida = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
            return res.json({
                fulfillmentText: despedida,
                outputContexts: ["bienvenida", "iniciocompra", "pasoencuesta", "esperandocalificacion"].map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }))
            });
        }

        // INTERRUPCIONES IA
        let pActual = "el producto", sDato = "producto";
        if (getDato("producto")) { pActual = "el tamaño"; sDato = "tamaño"; }
        if (getDato("tamano")) { pActual = "el color"; sDato = "color"; }
        
        const respuestaIA = await generarRespuestaIA(userQuery, "interrupcion", { paso: pActual, siguienteDato: sDato, nombre: usuario });
        return res.json({ fulfillmentText: respuestaIA });

    } catch (err) {
        console.error("Error General:", err);
        return res.json({ fulfillmentText: "Lo siento, hubo un error procesando tu pedido. ¿Podemos intentar de nuevo? 😊" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
