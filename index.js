const express = require("express")
const axios = require("axios")
const { JWT } = require("google-auth-library")
const { GoogleSpreadsheet } = require("google-spreadsheet")

const app = express()
app.use(express.json({ limit: "2mb" }))

// =============================
// CONFIG NEGOCIO
// =============================

const PRECIOS = {
    Mochila: { Pequeña: "$600", Mediana: "$850", Grande: "$1100" },
    Maleta: { Pequeña: "$1200", Mediana: "$1500", Grande: "$2000" },
    Bolso: { Pequeña: "$400", Mediana: "$600", Grande: "$850" }
}

const calcularPrecio = (p, t) => {
    const prod = p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "Maleta"
    const tam = t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "Mediana"
    return PRECIOS[prod]?.[tam] ? `${PRECIOS[prod][tam]} MXN` : "$1500 MXN"
}

const generarID = () =>
    `VE-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`


// =============================
// GOOGLE SHEETS
// =============================

const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
})

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth)

async function registrarEnSheets(d) {

    try {

        await doc.loadInfo()
        const sheet = doc.sheetsByIndex[0]

        await sheet.addRow({
            ID_Pedido: d.id,
            Fecha: new Date().toLocaleString(),
            Usuario: d.usuario,
            Producto: d.producto,
            Tamaño: d.tamano,
            Color: d.color,
            Precio: d.precio,
            Estado: "Pendiente"
        })

        console.log("✅ Pedido guardado en Sheets")

    } catch (e) {

        console.error("❌ Error Sheets:", e.message)

    }

}


// =============================
// CACHE IA
// =============================

const cacheIA = new Map()

function cacheKey(prompt) {
    return prompt.slice(0, 80)
}


// =============================
// IA POLLINATIONS PRO
// =============================

async function generarRespuestaIA(query, modo, info = {}) {

    let systemPrompt = ""

    if (modo === "despedida") {

        systemPrompt =
            `Vendedor amable. El cliente ${info.nombre} terminó. Agradece, cuenta un chiste corto de maletas y dile que escriba Hola para volver.`

    } else {

        systemPrompt =
            `Vendedor experto. Axel preguntó: "${query}". Responde breve con humor, cuenta un chiste y regrésalo a ${info.paso} pidiendo su ${info.siguienteDato}.`

    }

    const promptCompleto = systemPrompt + query

    if (cacheIA.has(cacheKey(promptCompleto))) {

        console.log("⚡ respuesta desde cache")

        return cacheIA.get(cacheKey(promptCompleto))

    }

    const modelos = ["mistral", "llama", "openai"]

    for (let modelo of modelos) {

        for (let intento = 1; intento <= 2; intento++) {

            try {

                console.log(`⏳ IA intento ${intento} modelo ${modelo}`)

                const response = await axios.post(
                    "https://text.pollinations.ai/generate",
                    {
                        model: modelo,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: query }
                        ]
                    },
                    { timeout: 15000 }
                )

                const texto = response?.data?.text

                if (texto) {

                    cacheIA.set(cacheKey(promptCompleto), texto)

                    console.log(`✅ IA respondió (${modelo})`)

                    return texto

                }

            } catch (e) {

                console.log(`⚠️ fallo ${modelo}`)

            }

        }

    }

    console.log("❌ IA fallback")

    return `¡${info.nombre}! Me distraje acomodando las maletas 😂.  
¿En qué estábamos? ${info.paso}.  
¿Qué ${info.siguienteDato} prefieres?`

}



// =============================
// WEBHOOK DIALOGFLOW
// =============================

app.post("/webhook", async (req, res) => {

    const { queryResult, session } = req.body

    const intentName = queryResult?.intent?.displayName || "Fallback"
    const userQuery = queryResult?.queryText || ""

    const getDato = (nombre) => {

        let v = queryResult.parameters[nombre]

        if (!v && queryResult.outputContexts) {

            for (const ctx of queryResult.outputContexts) {

                if (ctx.parameters && ctx.parameters[nombre]) {

                    v = ctx.parameters[nombre]
                    break

                }

            }

        }

        return v || null

    }

    try {

        const usuario = getDato("usuario") || "Cliente"

        let paso = "el catálogo"
        let siguiente = "producto"

        if (getDato("producto")) {

            paso = "la elección de tamaño"
            siguiente = "tamaño"

        }

        if (getDato("tamano")) {

            paso = "la elección de color"
            siguiente = "color"

        }

        if (intentName.includes("6.1")) {

            const id = generarID()
            const prod = getDato("producto")
            const tam = getDato("tamano")

            const precio = calcularPrecio(prod, tam)

            await registrarEnSheets({
                id,
                usuario,
                producto: prod,
                tamano: tam,
                color: getDato("color"),
                precio
            })

            return res.json({
                fulfillmentText:
                    `🎉 Pedido registrado ${usuario}

ID: ${id}
Producto: ${prod}
Tamaño: ${tam}
Precio: ${precio}

¿Deseas responder una encuesta?`
            })

        }

        if (intentName.includes("8")) {

            const resp = await generarRespuestaIA(
                userQuery,
                "despedida",
                { nombre: usuario }
            )

            return res.json({ fulfillmentText: resp })

        }

        const respIA = await generarRespuestaIA(
            userQuery,
            "interrupcion",
            { paso, siguienteDato: siguiente, nombre: usuario }
        )

        res.json({ fulfillmentText: respIA })

    } catch (error) {

        console.log("❌ error webhook", error.message)

        res.json({
            fulfillmentText:
                "¡Perfecto! ¿Confirmamos el pedido?"
        })

    }

})


// =============================
// SERVER
// =============================

const PORT = process.env.PORT || 10000

app.listen(PORT, () =>
    console.log("🚀 servidor activo puerto", PORT)
)
