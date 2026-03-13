const express = require("express");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { GoogleAuth } = require("google-auth-library");

const app = express();
app.use(express.json());

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "TU_ID_DE_SHEETS_AQUI";
const GOOGLE_CREDS   = JSON.parse(process.env.GOOGLE_CREDS || "{}");

// ─── CATÁLOGO COMPLETO DE TRANSMEX ───────────────────────────────────────────
// Centralizado aquí: si cambias algo, se refleja en toda la IA automáticamente.
const CATALOGO = {
  productos: ["Maleta", "Mochila", "Bolso"],
  tamanos:   ["Pequeño", "Mediano", "Grande"],
  colores:   ["Negro", "Azul", "Rojo", "Gris", "Café", "Verde"],
  precios: {
    Maleta:  { Pequeño: 800,  Mediano: 1200, Grande: 1600 },
    Mochila: { Pequeño: 400,  Mediano: 600,  Grande: 900  },
    Bolso:   { Pequeño: 350,  Mediano: 550,  Grande: 750  },
  },
  descripciones: {
    Maleta:  "ideal para viajes largos, con ruedas y candado incluido",
    Mochila: "perfecta para el día a día, con compartimentos organizadores",
    Bolso:   "elegante y práctico, ideal para uso urbano y viajes cortos",
  },
};

// ─── CONTEXTO DE CADA INTENT → qué debe hacer la IA en cada paso ─────────────
const CONTEXTO_POR_INTENT = {
  "0 Bienvenida": {
    paso: "bienvenida",
    descripcion: "El cliente acaba de saludar o iniciar el chat.",
    instruccion: "Dale la bienvenida calurosamente y pregúntale su nombre.",
    opciones: null,
  },
  "1 IdentificarUsuario": {
    paso: "identificación",
    descripcion: "El bot acaba de obtener el nombre del cliente.",
    instruccion: "Salúdalo por su nombre y pregúntale qué tipo de equipaje le interesa.",
    opciones: ["Maleta", "Mochila", "Bolso"],
  },
  "2.1 CompraEquipaje": {
    paso: "selección de producto",
    descripcion: "El cliente quiere comprar equipaje.",
    instruccion: "Preséntale los 3 productos disponibles con una descripción breve y rango de precios de cada uno.",
    opciones: ["Maleta", "Mochila", "Bolso"],
  },
  "2.2 AyudaEquipaje": {
    paso: "asesoría de producto",
    descripcion: "El cliente necesita ayuda para elegir qué comprar.",
    instruccion: "Hazle una pregunta para entender su necesidad y recomiéndale el producto más adecuado del catálogo.",
    opciones: ["Maleta", "Mochila", "Bolso"],
  },
  "3.1 CompraProducto": {
    paso: "confirmación de producto",
    descripcion: "El cliente ya eligió un producto.",
    instruccion: "Confirma su elección con entusiasmo, menciona algo positivo de ese producto y pregúntale el tamaño.",
    opciones: ["Pequeño", "Mediano", "Grande"],
  },
  "3.2 InformacionAyuda": {
    paso: "información de producto",
    descripcion: "El cliente pide más información sobre un producto específico.",
    instruccion: "Dile la descripción, tamaños y precios de ese producto, luego pregunta si desea comprarlo.",
    opciones: ["Maleta", "Mochila", "Bolso"],
  },
  "4 SeleccionTamano": {
    paso: "selección de tamaño",
    descripcion: "El cliente está eligiendo el tamaño de su producto.",
    instruccion: "Muéstrale los 3 tamaños con precio según el producto ya elegido. Luego pregunta cuál prefiere.",
    opciones: ["Pequeño", "Mediano", "Grande"],
  },
  "5 SeleccionColor": {
    paso: "selección de color",
    descripcion: "El cliente está eligiendo el color.",
    instruccion: "Lista los colores disponibles de forma atractiva y pregunta cuál prefiere.",
    opciones: ["Negro", "Azul", "Rojo", "Gris", "Café", "Verde"],
  },
  "Default Fallback Intent": {
    paso: "sin contexto claro",
    descripcion: "El bot no entendió al cliente.",
    instruccion: "Pide disculpas brevemente, menciona que solo vendes Maletas, Mochilas y Bolsos, y guíalo al paso correcto.",
    opciones: null,
  },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function calcularPrecio(producto, tamano) {
  const precio = CATALOGO.precios[producto]?.[tamano];
  return precio ? `$${precio} MXN` : "$900 MXN";
}

function generarID() {
  return "TXM-" + Date.now().toString().slice(-6);
}

function catalogoComoTexto() {
  return CATALOGO.productos.map(p => {
    const precios = CATALOGO.tamanos
      .map(t => `${t}: $${CATALOGO.precios[p][t]} MXN`)
      .join(", ");
    return `• ${p} (${CATALOGO.descripciones[p]}) — ${precios}`;
  }).join("\n");
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
    console.log("✅ Pedido registrado:", datos.id);
  } catch (err) {
    console.error("❌ Error Sheets:", err.message);
  }
}

// ─── IA CON CONCIENCIA DEL INTENT Y CATÁLOGO COMPLETO ────────────────────────
async function generarRespuestaIA(userQuery, intentName, datosCliente = {}) {
  const ctx = CONTEXTO_POR_INTENT[intentName]
    || CONTEXTO_POR_INTENT["Default Fallback Intent"];

  const opcionesTexto = ctx.opciones
    ? `Las opciones válidas para este paso son EXACTAMENTE estas: ${ctx.opciones.join(", ")}. No ofrezcas ninguna otra.`
    : "";

  const carritoTexto = [
    datosCliente.producto && `producto elegido: ${datosCliente.producto}`,
    datosCliente.tamano   && `tamaño elegido: ${datosCliente.tamano}`,
    datosCliente.color    && `color elegido: ${datosCliente.color}`,
  ].filter(Boolean).join(", ");

  const systemPrompt = `Eres "Traxi", asistente virtual de Transmex, tienda de equipaje de viaje.
Personalidad: amable, entusiasta, concisa. Sin markdown ni asteriscos. Solo español. Máx 3 oraciones.

CATÁLOGO COMPLETO (lo único que vendes):
${catalogoComoTexto()}
Colores disponibles para todos los productos: ${CATALOGO.colores.join(", ")}.

SITUACIÓN DEL CLIENTE AHORA MISMO:
- Nombre: ${datosCliente.usuario || "Cliente"}
- Paso actual: ${ctx.paso}
- Contexto: ${ctx.descripcion}
- Carrito actual: ${carritoTexto || "vacío, aún no ha elegido nada"}

LO QUE DEBES HACER EN ESTE MENSAJE:
${ctx.instruccion}
${opcionesTexto}

REGLAS OBLIGATORIAS:
1. NUNCA inventes productos, tamaños, colores ni precios fuera del catálogo.
2. Si piden algo que no está en el catálogo, diles que no está disponible y redirige a las opciones reales.
3. Si el cliente se desvía del tema, respóndele en máx 1 oración y regresa al paso actual.
4. Siempre menciona opciones concretas del catálogo cuando el paso lo requiera.
5. Si ya tiene algo en el carrito, úsalo para personalizar la respuesta.`;

  try {
    const response = await axios.post(
      "https://text.pollinations.ai/openai",
      {
        model: "openai",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userQuery || "hola" },
        ],
        max_tokens: 160,
        temperature: 0.65,
      },
      { headers: { "Content-Type": "application/json" }, timeout: 9000 }
    );

    const texto = response.data?.choices?.[0]?.message?.content?.trim();
    if (texto) {
      console.log(`🤖 [${ctx.paso}] → ${texto}`);
      return texto;
    }
    throw new Error("Respuesta vacía");

  } catch (err) {
    console.error("⚠️ IA falló:", err.message);
    // Fallbacks inteligentes por paso
    const fb = {
      "bienvenida":              `¡Bienvenido a Transmex! Soy Traxi. ¿Me dices tu nombre para atenderte mejor?`,
      "identificación":          `¡Hola, ${datosCliente.usuario}! Tenemos Maletas, Mochilas y Bolsos. ¿Qué te interesa?`,
      "selección de producto":   `Contamos con: Maleta ($800-$1600), Mochila ($400-$900) y Bolso ($350-$750). ¿Cuál prefieres?`,
      "asesoría de producto":    `Tenemos Maletas para viaje, Mochilas para diario y Bolsos urbanos. ¿Para qué lo usarías?`,
      "confirmación de producto":`¡Excelente elección! Los tamaños son: Pequeño, Mediano y Grande. ¿Cuál prefieres?`,
      "selección de tamaño":     `Tamaños disponibles: Pequeño, Mediano y Grande. ¿Cuál te va mejor?`,
      "selección de color":      `Colores disponibles: Negro, Azul, Rojo, Gris, Café y Verde. ¿Cuál eliges?`,
    };
    return fb[ctx.paso] || `No entendí bien. ¿Puedes repetirlo? Estamos eligiendo tu ${ctx.paso}.`;
  }
}

// ─── WEBHOOK PRINCIPAL ────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const body        = req.body;
  const queryResult = body.queryResult || {};
  const intentName  = queryResult.intent?.displayName || "";
  const userQuery   = queryResult.queryText || "";
  const session     = body.session || "projects/default/agent/sessions/default";

  console.log(`\n📩 Intent: "${intentName}" | Query: "${userQuery}"`);

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
    const usuario        = getDato("usuario") || "Cliente";
    const producto       = getDato("producto");
    const tamano         = getDato("tamano");
    const color          = getDato("color");
    const estaEnEncuesta = queryResult.outputContexts?.some(c =>
      c.name.includes("esperandocalificacion")
    );
    const datosCliente   = { usuario, producto, tamano, color };

    // ── REINICIO ──────────────────────────────────────────────────────────────
    if (intentName === "9 PasoNuevoPedido" || userQuery.toLowerCase() === "reiniciar") {
      const ctxs = ["bienvenida","iniciocompra","pasodoscompra","pasotamano",
                    "pasocolor","pasofinal","pasoencuesta","esperandocalificacion"];
      return res.json({
        fulfillmentText: "🧹 ¡Empecemos de cero! Escribe 'Hola' cuando quieras. 😊",
        outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })),
      });
    }

    // ── INTENTS QUE USAN IA CON CONTEXTO ─────────────────────────────────────
    const intentsCon_IA = [
      "0 Bienvenida", "1 IdentificarUsuario",
      "2.1 CompraEquipaje", "2.2 AyudaEquipaje",
      "3.1 CompraProducto", "3.2 InformacionAyuda",
      "4 SeleccionTamano", "5 SeleccionColor",
      "Default Fallback Intent",
    ];

    if (intentsCon_IA.includes(intentName)) {
      const respuesta = await generarRespuestaIA(userQuery, intentName, datosCliente);
      return res.json({ fulfillmentText: respuesta });
    }

    // ── 6.1: REGISTRAR PEDIDO ─────────────────────────────────────────────────
    if (intentName === "6.1 PasoFinalSi") {
      const id     = generarID();
      const prod   = producto || "Maleta";
      const tam    = tamano   || "Mediano";
      const col    = color    || "Negro";
      const precio = calcularPrecio(prod, tam);

      await registrarEnSheets({ id, usuario, producto: prod, tamano: tam, color: col, precio });

      const resumen = `¡Perfecto, ${usuario}! 🎉 Tu pedido está confirmado.\n\n🆔 ID: ${id}\n🎒 ${prod} ${tam} – ${col}\n💰 ${precio}\n\n¿Te gustaría responder una encuesta de satisfacción?`;

      const limpiar = ["iniciocompra","pasodoscompra","pasotamano","pasocolor","pasofinal"];
      const outCtxs = limpiar.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 }));
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
                    text: "¿Quieres responder la encuesta?",
                    buttons: [
                      { type: "postback", title: "Sí", payload: "Si" },
                      { type: "postback", title: "No, gracias", payload: "No" },
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

    // ── 7.1: ENCUESTA ─────────────────────────────────────────────────────────
    if (intentName === "7.1 PasoEncuestaSi") {
      return res.json({
        fulfillmentText: `¡Gracias, ${usuario}! ⭐ ¿Cómo calificarías tu experiencia?\n(Mala / Regular / Buena / Excelente)`,
        outputContexts: [
          { name: `${session}/contexts/pasoencuesta`,          lifespanCount: 0 },
          { name: `${session}/contexts/esperandocalificacion`, lifespanCount: 1 },
        ],
      });
    }

    // ── 8 / 7.2: DESPEDIDA ────────────────────────────────────────────────────
    if (
      intentName === "8 PasoDespedida" ||
      intentName === "7.2 PasoEncuestaNo" ||
      (intentName.includes("Fallback") && estaEnEncuesta)
    ) {
      const ctxs = ["bienvenida","iniciocompra","pasodoscompra","pasotamano",
                    "pasocolor","pasofinal","pasoencuesta","esperandocalificacion"];
      return res.json({
        fulfillmentText: `¡Gracias por elegirnos, ${usuario}! 👋 Fue un placer atenderte. ¡Hasta pronto!`,
        outputContexts: ctxs.map(c => ({ name: `${session}/contexts/${c}`, lifespanCount: 0 })),
      });
    }

    // ── FALLBACK GENÉRICO ─────────────────────────────────────────────────────
    const fb = await generarRespuestaIA(userQuery, "Default Fallback Intent", datosCliente);
    return res.json({ fulfillmentText: fb });

  } catch (err) {
    console.error("❌ Error general:", err.message);
    return res.json({
      fulfillmentText: `Ups, algo falló. 😅 Recuerda que tenemos ${CATALOGO.productos.join(", ")}. ¿Te interesa alguno?`,
    });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.send("🤖 Traxi v2 – Bot Transmex activo"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Traxi v2 corriendo en puerto ${PORT}`));
