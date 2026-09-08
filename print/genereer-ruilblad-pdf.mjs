// genereer-ruilblad-pdf.mjs — bouwt Ruilblad_Panini_FIFA_2026_Nieuw.pdf uit
// ruilblad.html.
//
// Dat PDF-bestand hangt aan de downloadknop op de startpagina en gaat als
// bijlage mee in de nieuwsbrief. Het met de hand afdrukken naar PDF kan ook
// (Ctrl+P → "Opslaan als PDF"), maar dan zet elke browser er zijn eigen marges
// en kop-/voetregels bij, en verschilt het resultaat per computer. page.pdf()
// drukt exact af op het CSS-formaat uit @page.
//
// Draai altijd eerst genereer-ruilblad.mjs — dat maakt ruilblad.html uit de
// SQL-seed. Dit script zet die HTML enkel om naar PDF:
//
//   cd print
//   node genereer-ruilblad.mjs
//   node genereer-ruilblad-pdf.mjs
//
// Vereist Playwright (npm install -D playwright, of een globale installatie).
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const BRON = path.join(HIER, "ruilblad.html");
const DOEL = path.join(HIER, "Ruilblad_Panini_FIFA_2026_Nieuw.pdf");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file:///" + BRON.replace(/\\/g, "/"));

// De marges staan al in @page van ruilblad.html; hier op 0 zetten zou ze
// dubbel toepassen. printBackground blijft aan voor de grijze vlakken die het
// blad structuur geven.
await page.pdf({ path: DOEL, format: "A4", printBackground: true });

await browser.close();
console.log("Klaar:", DOEL);
