// genereer-landkaarten-pdf.mjs — bouwt Panini_Landkaarten_2026.pdf uit
// landkaarten.html met Playwright (niet via "Afdrukken → Opslaan als PDF" in
// een browser, zoals bij ruilblad.html): de kaarten moeten tot tegen de
// paginarand lopen, en een browser voegt bij handmatig afdrukken standaard
// eigen marges en kop-/voetregels toe. page.pdf() drukt de pagina exact af op
// het CSS-formaat (@page { size: A4; margin: 0 }) zonder dat extra's.
//
// Gebruik (vanuit de map print/):
//   node genereer-landkaarten-pdf.mjs
//
// Vereist Playwright (al aanwezig als devafhankelijkheid van dit project se
// test-opstelling; zoniet: npm install -D playwright).
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const BRON = path.join(HIER, "landkaarten.html");
const DOEL = path.join(HIER, "Panini_Landkaarten_2026.pdf");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file:///" + BRON.replace(/\\/g, "/"));
// De 48 vlag-<img>'s moeten volledig geladen zijn vóór het afdrukken, anders
// staan er lege kaders in de PDF.
await page.evaluate(async () => {
  const imgs = [...document.querySelectorAll("img")];
  await Promise.all(
    imgs.map((img) => (img.complete ? null : new Promise((klaar) => (img.onload = img.onerror = klaar))))
  );
});

await page.pdf({
  path: DOEL,
  format: "A4",
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});

await browser.close();
console.log("Klaar:", DOEL);
