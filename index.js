async function generarRespuestaIA(query, modo, info = {}) {

    const nombre = info.nombre || "Cliente"
    const paso = info.paso || "la elección del producto"
    const siguiente = info.siguienteDato || "opción"

    let systemPrompt = ""

    if (modo === "despedida") {
        systemPrompt =
        `Vendedor amable. El cliente ${nombre} terminó. Agradece, cuenta un chiste corto de maletas y dile que escriba Hola para volver.`
    } else {
        systemPrompt =
        `Vendedor experto. El cliente preguntó: "${query}". Responde breve con humor, cuenta un chiste y regresa al flujo de compra en ${paso} pidiendo su ${siguiente}.`
    }

    // =====================
    // 1️⃣ POLLINATIONS
    // =====================

    const modelos = ["mistral", "llama", "openai"]

    for (const modelo of modelos) {

        for (let intento = 1; intento <= 2; intento++) {

            try {

                console.log(`🧠 Pollinations intento ${intento} modelo ${modelo}`)

                const r = await axios.post(
                    "https://text.pollinations.ai/generate",
                    {
                        model: modelo,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: query }
                        ]
                    },
                    { timeout: 12000 }
                )

                const texto = r?.data?.text || r?.data?.response

                if (texto && texto.length > 5) {

                    console.log(`✅ Pollinations respondió con ${modelo}`)

                    return texto.trim()
                }

            } catch (e) {

                console.log(`⚠️ Pollinations fallo (${modelo})`, e.message)

            }

        }

    }

    // =====================
    // 2️⃣ OPENROUTER FALLBACK
    // =====================

    if (process.env.OPENROUTER_API_KEY) {

        try {

            console.log("🔁 Activando fallback OpenRouter")

            const r = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    model: "meta-llama/llama-3.1-8b-instruct:free",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: query }
                    ]
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 15000
                }
            )

            const texto = r?.data?.choices?.[0]?.message?.content

            if (texto && texto.length > 5) {

                console.log("✅ OpenRouter respondió")

                return texto.trim()
            }

        } catch (e) {

            console.log("❌ OpenRouter fallo:", e.message)

        }

    }

    // =====================
    // 3️⃣ RESPUESTA LOCAL
    // =====================

    console.log("🤖 fallback local activado")

    const chistes = [
        "¿Sabías que las maletas nunca discuten? Porque siempre llevan la carga.",
        "Las maletas nunca se pierden… solo toman rutas alternativas.",
        "Dicen que viajar abre la mente… pero primero hay que cerrar la maleta."
    ]

    const chiste = chistes[Math.floor(Math.random() * chistes.length)]

    return `¡${nombre}! 😂

${chiste}

Pero volvamos a lo importante.

Estábamos en ${paso}.

¿Qué ${siguiente} prefieres?`
}
