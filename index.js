const express = require("express");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { GoogleAuth } = require("google-auth-library");

const app = express();
app.use(express.json());

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "TU_ID_DE_SHEETS_AQUI";
const GOOGLE_CREDS   = JSON.parse(process.env.GOOGLE_CREDS || "{}");

// ─── PRECIOS ──────────────────────────────────────────────────────────────────
const PRECIOS = {
  Maleta:   { Pequeña: 800, Mediana: 1200, Grande: 1600 },
  Mochila:  { Pequeña: 400, Mediana: 600,  Grande: 900  },
  Maletín:  { Pequeña: 500, Mediana: 750,  Grande: 1000 },
};

function calcularPrecio(producto, tamano) {
  return PRECIOS[producto]?.[tamano]
    ? `$${PRECIOS[producto][tamano]} MXN`
    : "$1,200 MXN";
}

function generarID() {
  return "TXM-" + Date.now().toString().slice(-6);
}

// ─── GOOGLE SHEETS ────────────────────────────────────────────────────────────
async function registrarEnSheets(datos) {
  try {
    const auth = new GoogleAuth({
      credentials: GOOGLE_CREDS,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.addRow({
      ID:       datos.id,
      Usuario:  datos.usuario,
      Producto: datos.producto,
      Tamaño:   datos.tamano,
      Color:    datos.color,
      Precio:   datos.precio,
      Fecha:    new Date().toLocaleString("es-MX"),
    });
    console.log("✅ Pedido registrado en Sheets:", datos.id);
  } catch (err) {
    console.error("❌ Error en Sheets:", err.message);
  }
}

// ─── IA CON POLLINATIONS (sin API key, gratis) ────────────────────────────────
async function generarRespuestaIA(userQuery, tipo, contexto = {}) {
  const prompts = {
    interrupcion: `Eres un asistente de ventas amable de Transmex, una tienda de equipaje.
El cliente está en el paso de elegir ${contexto.paso}.
El cliente escribió algo fuera del tema: "${userQuery}"
Responde brevemente (máx 2 oraciones), con amabilidad, y redirige la conversación
pidiéndole que elija su ${contexto.siguienteDato}.
No uses markdown. Responde en español.`,

    despedida: `Eres un asistente de ventas amable de Transmex.
El cliente se llama ${contexto.nombre}.
${userQuery ? `El cliente escribió: "${userQuery}"` : ""}
Genera una despedida cálida y breve (máx 2 oraciones). 
No uses markdown. Responde en español.`,

    fallback: `Eres un asistente de ventas de Transmex.
El cliente escribió: "${userQuery}"
No entendiste su mensaje. Pide amablemente que se explique mejor (máx 1 oración).
No uses markdown. Responde en español.`,
  };

  const systemPrompt = prompts[tipo] || prompts.fallback;

  try {
    // Opción 1: Pollinations AI (gratis, sin key)
    const response = await axios.post(
      "https://text.pollinations.ai/openai",
      {
        model: "openai",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userQuery || "hola" },
        ],
        max_tokens: 120,
        temperature: 0.7,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 8000,
      }
    );

    const texto = response.data?.choices?.[0]?.message?.content?.trim();
    if (texto) return texto;
    throw new Error("Respuesta vacía de Pollinations");

  } catch (err) {
    console.error("⚠️ Error IA:", err.message);
    // Fallbacks por tipo si la IA falla
    const fallbacks = {
      interrupcion: `Entiendo, ${contexto.nombre || ""}. 😊 Sigamos con tu pedido, ¿me dices tu ${contexto.siguienteDato || "elección"}?`,
      despedida:    `¡Gracias por preferirnos, ${contexto.nombre || ""}! Fue un placer atenderte. 👋`,
      fallback:     "No entendí bien, ¿podrías repetirlo de otra forma? 😊",
    };
    return fallbacks[tipo] || fallbacks.fallback;
  }
}

// ─── WEBHOOK PRINCIPAL ────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const body        = req.body;
  const queryResult = body.queryResult || {};
  const intentName  = queryResult.intent?.displayName || "";
  const userQuery   = queryResult.queryText || "";
  const session     = body.session || "projects/default/agent/sessions/default";

  console.log(`📩 Intent: "${intentName}" | Query: "${userQuery}"`);

  // Helper para extraer parámetros de Dialogflow (contextos incluidos)
  const getDato = (nombre) => {
    let v = queryResult.parameters?.[nombre];
    if (!v && queryResult.outputContexts) {
      for (const ctx of queryResult.outputContexts) {
        if (ctx.parameters?.[nombre]) { v = ctx.parameters[nombre]; break; }
      }
    }
    if (v && typeof v === "object" && v.name) v = v.name;
    return v || null;
  };

  try {
    const usuario       = getDato("usuario") || "Cliente";
    const estaEnEncuesta = queryResult.outputContexts?.some(c =>
      c.name.includes("esperandocalificacion")
    );

    // ── REINICIO TOTAL ────────────────────────────────────────────────────────
    if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
      const borrar = ["bienvenida","iniciocompra","pasodoscompra","pasotamano",
                      "pasocolor","pasofinal","pasoencuesta","esperandocalificacion"];
      return res.json({
        fulfillmentText: "🧹 Memoria limpia. Escribe 'Hola' para empezar de nuevo.",
        outputContexts: borrar.map(c => ({
          name: `${session}/contexts/${c}`, lifespanCount: 0,
        })),
      });
    }

    // ── PASO 6.1: CONFIRMAR PEDIDO Y REGISTRAR ────────────────────────────────
    if (intentName === "6.1 PasoFinalSi") {
      const id     = generarID();
      const prod   = getDato("producto") || "Maleta";
      const tam    = getDato("tamano")   || "Mediana";
      const color  = getDato("color")    || "Negro";
      const precio = calcularPrecio(prod, tam);

      await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color, precio });

      const resumen = `¡Listo, ${usuario}! 🎉 Pedido registrado.\n🆔 ID: ${id}\n🎒 ${prod} – ${tam} – ${color}\n💰 ${precio}\n\n¿Te gustaría responder una encuesta de satisfacción?`;

      const limpiarCompra = ["iniciocompra","pasodoscompra","pasotamano","pasocolor","pasofinal"];
      const outCtxs = limpiarCompra.map(c => ({
        name: `${session}/contexts/${c}`, lifespanCount: 0,
      }));
      outCtxs.push({ name: `${session}/contexts/pasoencuesta`, lifespanCount: 1 });

      return res.json({
        fulfillmentMessages: [
          { text: { text: [resumen] } },
          {
            payload: {
              facebook: {
                attachment: {
                  type: "template",
                  payload: {
                    template_type: "button",
                    text: "Selecciona:",
                    buttons: [
                      { type: "postback", title: "Sí", payload: "Si" },
                      { type: "postback", title: "No", payload: "No" },
                    ],
                  },
                },
              },
            },
          },
        ],
        outputContexts: outCtxs,
      });
    }

    // ── PASO 7.1: INICIAR ENCUESTA ────────────────────────────────────────────
    if (intentName === "7.1 PasoEncuestaSi") {
      return res.json({
        fulfillmentText: `¡Genial, ${usuario}! ⭐ ¿Cómo calificarías tu experiencia? (Mala / Regular / Buena / Excelente)`,
        outputContexts: [
          { name: `${session}/contexts/pasoencuesta`,          lifespanCount: 0 },
          { name: `${session}/contexts/esperandocalificacion`, lifespanCount: 1 },
        ],
      });
    }

    // ── PASO 8 / 7.2: DESPEDIDA ───────────────────────────────────────────────
    if (
      intentName === "8 PasoDespedida" ||
      intentName === "7.2 PasoEncuestaNo" ||
      (intentName.includes("Fallback") && estaEnEncuesta)
    ) {
      const despedida = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario });
      const borrarTodo = ["bienvenida","iniciocompra","pasodoscompra","pasotamano",
                          "pasocolor","pasofinal","pasoencuesta","esperandocalificacion"];
      return res.json({
        fulfillmentText: despedida,
        outputContexts: borrarTodo.map(c => ({
          name: `${session}/contexts/${c}`, lifespanCount: 0,
        })),
      });
    }

    // ── IA PARA INTERRUPCIONES (cualquier otro intent / fallback) ─────────────
    let pActual = "el producto", sDato = "producto";
    if (getDato("producto")) { pActual = "el tamaño";  sDato = "tamaño"; }
    if (getDato("tamano"))   { pActual = "el color";   sDato = "color";  }
    if (getDato("color"))    { pActual = "la confirmación"; sDato = "confirmación"; }

    const respuestaIA = await generarRespuestaIA(userQuery, "interrupcion", {
      paso: pActual, siguienteDato: sDato, nombre: usuario,
    });

    return res.json({ fulfillmentText: respuestaIA });

  } catch (err) {
    console.error("❌ Error general:", err.message);
    return res.json({ fulfillmentText: "Ups, algo salió mal. ¿Podrías repetir eso? 😊" });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.send("🤖 Bot Transmex activo"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
