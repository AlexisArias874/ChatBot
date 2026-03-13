const express = require("express")
const axios = require("axios")
const { JWT } = require("google-auth-library")
const { GoogleSpreadsheet } = require("google-spreadsheet")

const app = express()
app.use(express.json({ limit: "2mb" }))

// ==============================
// CONFIG AXIOS GLOBAL
// ==============================

axios.defaults.timeout = 6000

// ==============================
// MATRIZ DE PRECIOS
// ==============================

const PRECIOS = {
    Mochila: { Pequeña: "$600", Mediana: "$850", Grande: "$1100" },
    Maleta: { Pequeña: "$1200", Mediana: "$1500", Grande: "$2000" },
    Bolso: { Pequeña: "$400", Mediana: "$600", Grande: "$850" }
}

const normalizar = (t) =>
    t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : ""

function calcularPrecio(prod, tam) {

    const p = normalizar(prod)
    const t = normalizar(tam)

    return PRECIOS[p]?.[t]
        ? `${PRECIOS[p][t]} MXN`
        : "$1500 MXN"
}

function generarID() {
    return `VE-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`
}

// ==============================
// GOOGLE SHEETS (CACHE)
// ==============================

const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
})

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth)

let sheetCache = null

async function getSheet() {

    if (sheetCache) return sheetCache

    await doc.loadInfo()
    sheetCache = doc.sheetsByIndex[0]

    return sheetCache
}

async function registrarEnSheets(data) {

    try {

        const sheet = await getSheet()

        await sheet.addRow({
            ID_Pedido: data.id,
            Fecha: new Date().toLocaleString(),
            Usuario: data.usuario,
            Producto: data.producto,
            Tamaño: data.tamano,
            Color: data.color,
            Precio: data.precio,
            Estado: "Pendiente"
        })

        console.log("✅ Pedido guardado")

    } catch (e) {

        console.error("❌ Sheets error:", e.message)

    }
}

// ==============================
// IA POLLINATIONS
// ==============================

async function generarRespuestaIA(query, modo, info = {}) {

    const nombre = info.nombre || "Cliente"
    const paso = info.paso || "el inicio"
    const siguiente = info.siguienteDato || "producto"

    let systemPrompt = ""

    if (modo === "despedida") {

        systemPrompt =
        `Vendedor amable. El cliente ${nombre} terminó. Despídete con humor y dile que escriba Hola para volver.`

    } else if (modo === "interrupcion") {

        systemPrompt =
        `Vendedor experto. Responde breve con humor y regresa al flujo de venta en ${paso} preguntando por ${siguiente}.`

    } else {

        systemPrompt =
        "Vendedor experto de equipaje. Sé breve y vende."

    }

    try {

        const r = await axios.post(
            "https://text.pollinations.ai/generate",
            {
                model: "mistral",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: query }
                ]
            }
        )

        return r?.data?.text || "¿Qué producto buscas: mochila, maleta o bolso?"

    } catch {

        return `😅 Me distraje un segundo. Volvamos a ${paso}. ¿Qué ${siguiente} prefieres?`

    }
}

// ==============================
// UTILIDAD PARAMETROS
// ==============================

function getDato(queryResult, nombre) {

    let v = queryResult.parameters?.[nombre]

    if (!v && queryResult.outputContexts) {

        for (const ctx of queryResult.outputContexts) {

            if (ctx.parameters?.[nombre]) {
                v = ctx.parameters[nombre]
                break
            }

        }

    }

    if (v && typeof v === "object" && v.name) v = v.name

    return v || null
}

// ==============================
// WEBHOOK
// ==============================

app.post("/webhook", async (req, res) => {

    try {

        const { queryResult, session } = req.body

        const intentName =
            queryResult?.intent?.displayName || "Fallback"

        const userQuery = queryResult?.queryText || ""

        const usuario = getDato(queryResult, "usuario") || "Cliente"

        const producto = getDato(queryResult, "producto")
        const tamano = getDato(queryResult, "tamano")
        const color = getDato(queryResult, "color")

        let paso = "inicio"
        let siguiente = "producto"

        if (producto) {
            paso = "elección de tamaño"
            siguiente = "tamaño"
        }

        if (tamano) {
            paso = "elección de color"
            siguiente = "color"
        }

        if (color) {
            paso = "confirmación"
            siguiente = "confirmación"
        }

        // =====================
        // REINICIO
        // =====================

        if (intentName.includes("NuevoPedido") || userQuery === "reiniciar") {

            return res.json({
                fulfillmentText:
                "🧹 Empezamos de nuevo. ¿Buscas mochila, maleta o bolso?"
            })

        }

        // =====================
        // REGISTRO PEDIDO
        // =====================

        if (intentName.includes("PasoFinalSi")) {

            const id = generarID()

            const prod = producto || "Maleta"
            const tam = tamano || "Mediana"
            const col = color || "Gris"

            const precio = calcularPrecio(prod, tam)

            await registrarEnSheets({
                id,
                usuario,
                producto: prod,
                tamano: tam,
                color: col,
                precio
            })

            return res.json({
                fulfillmentText:
                `🎉 Pedido registrado

ID: ${id}
Producto: ${prod}
Tamaño: ${tam}
Precio: ${precio}

¿Deseas responder una encuesta?`
            })

        }

        // =====================
        // ENCUESTA
        // =====================

        if (intentName.includes("EncuestaSi")) {

            return res.json({
                fulfillmentText:
                `⭐ ${usuario}, ¿cómo calificarías tu experiencia?`
            })

        }

        // =====================
        // DESPEDIDA
        // =====================

        if (intentName.includes("Despedida") || intentName.includes("EncuestaNo")) {

            const r = await generarRespuestaIA(userQuery, "despedida", { nombre: usuario })

            return res.json({ fulfillmentText: r })

        }

        // =====================
        // IA GENERAL
        // =====================

        const r = await generarRespuestaIA(userQuery, "interrupcion", {
            nombre: usuario,
            paso,
            siguienteDato: siguiente
        })

        res.json({ fulfillmentText: r })

    } catch (e) {

        console.log("❌ webhook error", e.message)

        res.json({
            fulfillmentText:
            "🧳 Perfecto. ¿Confirmamos tu pedido?"
        })

    }

})

// ==============================
// SERVER
// ==============================

const PORT = process.env.PORT || 10000

app.listen(PORT, () =>
    console.log(`🚀 Bot activo en puerto ${PORT}`)
)
