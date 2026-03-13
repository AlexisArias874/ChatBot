async function generarRespuestaIA(query, modo, info = {}) {

    let systemPrompt = ""

    if (modo === "despedida") {
        systemPrompt =
        `Vendedor amable. El cliente ${info.nombre} terminó. Agradece, cuenta un chiste corto de maletas y dile que escriba Hola para volver.`
    } else {
        systemPrompt =
        `Vendedor experto. Axel preguntó: "${query}". Responde breve con humor, cuenta un chiste y regrésalo a ${info.paso} pidiendo su ${info.siguienteDato}.`
    }

    // =====================
    // 1️⃣ POLLINATIONS
    // =====================

    const modelos = ["mistral", "llama", "openai"]

    for (let modelo of modelos) {

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

                const texto = r?.data?.text

                if (texto) {

                    console.log("✅ Pollinations respondió")

                    return texto
                }

            } catch (e) {
                console.log("⚠️ Pollinations fallo")
            }

        }

    }

    // =====================
    // 2️⃣ OPENROUTER FALLBACK
    // =====================

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

        if (texto) {

            console.log("✅ OpenRouter respondió")

            return texto
        }

    } catch (e) {

        console.log("❌ OpenRouter fallo")

    }

    // =====================
    // 3️⃣ RESPUESTA LOCAL
    // =====================

    console.log("🤖 fallback local")

    const chistes = [
        "¿Sabías que las maletas nunca discuten? Porque siempre llevan la carga.",
        "Las maletas nunca se pierden… solo toman rutas alternativas.",
        "Dicen que viajar abre la mente… pero primero hay que cerrar la maleta."
    ]

    const chiste = chistes[Math.floor(Math.random() * chistes.length)]

    return `¡${info.nombre}! 😂

${chiste}

Pero volvamos a lo importante.

Estábamos en ${info.paso}.

¿Qué ${info.siguienteDato} prefieres?`
}
