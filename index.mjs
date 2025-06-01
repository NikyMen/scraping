import { chromium } from "playwright"
import { writeFile } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const savePath = path.join(__dirname, "data")

const browser = await chromium.launch({ headless: false })
const page = await browser.newPage()

// 1. Ir al sitio
await page.goto("https://www.intercap.com.ar/TiendaVirtual/home", {
  waitUntil: "domcontentloaded"
})

// 2. Login
await page.click("a[title='Ver formulario de login']")
await page.waitForSelector('#j_idt276\\:txtUsuarioDLG', { state: 'visible' })
await page.fill('#j_idt276\\:txtUsuarioDLG', 'SALASZMA')
await page.fill('#j_idt276\\:txtPasswordDLG', 'mica18')
await page.press('#j_idt276\\:txtPasswordDLG', 'Enter')
await page.waitForSelector(".menu-general", { timeout: 10000 })

// 3. Ir al catálogo
await page.goto("https://www.intercap.com.ar/TiendaVirtual/catalogo", {
  waitUntil: "domcontentloaded"
})

// 4. Activar filtro 'Stock disponible'
try {
  const stockCheckbox = page.locator('#j_idt247\\:j_idt260 .ui-chkbox-box')
  const alreadyChecked = await stockCheckbox.evaluate(el =>
    el.classList.contains("ui-state-active")
  )

  if (!alreadyChecked) {
    await stockCheckbox.scrollIntoViewIfNeeded()
    await stockCheckbox.click()
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)
  }
} catch (e) {
  console.log("⚠️ No se pudo activar el filtro de stock:", e.message)
}

// 5. Función de scraping por página
const extraerProductosEnPagina = async (page) => {
  await page.waitForSelector(".productoDetalle", { timeout: 15000 })

  return await page.$$eval(".productoDetalle", cards =>
    cards.map(card => {
      const imagen = card.querySelector("img")?.src || ""
      const nombre = card.querySelector(".descripcion span")?.textContent?.trim() || ""
      const precioTexto = card.querySelector(".precio-lista span")?.textContent || ""
      const precio = parseFloat(precioTexto.replace("$", "").replace(/\./g, "").replace(",", ".").trim())

      // 👉 Buscar div que contiene "Código: ..."
      const codigoEl = Array.from(card.querySelectorAll("div"))
        .find(div => div.textContent?.includes("Código:"))

      const codigo = codigoEl?.textContent?.split("Código:")[1]?.trim() || ""

      return {
        codigo,
        nombre,
        precio: isNaN(precio) ? 0 : precio,
        descripcion: "Repuestos Mendez",
        imagen
      }
    }).filter(p => p.codigo && p.nombre && p.precio > 0)
  )
}
// 6. Recorrer páginas
let productos = []
let paginaActual = 1

while (true) {
  console.log(`🔎 Scrapeando página ${paginaActual}...`)
  const nuevos = await extraerProductosEnPagina(page)
  productos.push(...nuevos)

  // Buscar botón "siguiente"
  const botones = await page.$$('a[aria-label="Ir a la página siguiente"]')
  let siguiente = null

  for (const boton of botones) {
    if (await boton.isVisible()) {
      siguiente = boton
      break
    }
  }

  if (!siguiente) break

  // Reintentar hasta 25 veces si falla el click
  let intentos = 0
  let exito = false

  while (intentos < 25) {
    try {
      await siguiente.scrollIntoViewIfNeeded()
      await Promise.all([
        page.waitForLoadState("domcontentloaded"),
        siguiente.click()
      ])
      await page.waitForTimeout(1500)
      exito = true
      break
    } catch (err) {
      console.warn(`🔁 Reintentando avanzar de página (${intentos + 1}/5)...`)
      intentos++
      await page.waitForTimeout(1000)
    }
  }

  if (!exito) {
    console.log("⚠️ No se pudo avanzar de página después de varios intentos.")
    break
  }

  paginaActual++
}

await browser.close()

// 7. Guardar productos
await writeFile(`${savePath}/productos.json`, JSON.stringify(productos, null, 2), "utf-8")
console.log(`✅ ${productos.length} productos guardados en data/productos.json`)
