const express = require("express");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library"); // Cambiado para mayor estabilidad

const app = express();
app.use(express.json());

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "TU_ID_DE_SHEETS_AQUI";
// Parseo robusto de credenciales
let GOOGLE_CREDS = {};
try {
  GOOGLE_CREDS = JSON.parse(process.env.GOOGLE_CREDS || "{}");
} catch (e) {
  console.error("❌ Error: Formato JSON inválido en GOOGLE_CREDS");
}

// ... (Resto del catálogo y contexto igual) ...

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function calcularPrecio(producto, tamano) {
  const precio = CATALOGO.precios[producto]?.[tamano];
  return precio ? `$${precio} MXN` : "$900 MXN";
}

function generarID() {
  // Ajustado para parecerse al de tu imagen
  return "VE-" + Math.floor(100000 + Math.random() * 900000) + "-" + Math.floor(1000 + Math.random() * 9000);
}

function catalogoComoTexto() {
  return CATALOGO.productos.map(p => {
    const precios = CATALOGO.tamanos
      .map(t => `${t}: $${CATALOGO.precios[p][t]} MXN`)
      .join(", ");
    return `• ${p} (${CATALOGO.descripciones[p]}) — ${precios}`;
  }).join("\n");
}

// ─── GOOGLE SHEETS (CORREGIDO) ────────────────────────────────────────────────
async function registrarEnSheets(datos) {
  // Validación de credenciales antes de intentar conectar
  if (!GOOGLE_CREDS.client_email || !GOOGLE_CREDS.private_key) {
    console.error("❌ Error: Faltan credenciales (client_email o private_key). Revisa tus variables de entorno.");
    return;
  }

  try {
    // Usamos JWT directamente para evitar el error de client_email
    const serviceAccountAuth = new JWT({
      email: GOOGLE_CREDS.client_email,
      key: GOOGLE_CREDS.private_key.replace(/\\n/g, '\n'), // Corrige saltos de línea en env vars
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];

    // IMPORTANTE: Los nombres de las llaves deben coincidir EXACTO con la fila 1 de tu Excel
    await sheet.addRow({
      "ID_Pedido": datos.id,
      "Fecha":     new Date().toLocaleString("es-MX"),
      "Usuario":   datos.usuario,
      "Producto":  datos.producto,
      "Tamaño":    datos.tamano,
      "Color":     datos.color,
      "Precio":    datos.precio,
      "Estado":    "Pendiente"
    });
    
    console.log("✅ Pedido registrado exitosamente en Sheets:", datos.id);
  } catch (err) {
    console.error("❌ Error en Sheets:", err.message);
  }
}

// ... (Resto del código del Webhook e IA permanece igual) ...

// ─── WEBHOOK PRINCIPAL (Sin cambios en lógica, solo llamadas actualizadas) ─────
app.post("/webhook", async (req, res) => {
    // ... (Tu código de webhook aquí, usará la nueva función registrarEnSheets automáticamente)
    // Asegúrate de copiar el resto de tu código original debajo de estas correcciones.
    // La lógica de "6.1 PasoFinalSi" ya enviaba los campos necesarios.
});

// ... (Puerto y listener) ...
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Traxi v2 corriendo en puerto ${PORT}`));
