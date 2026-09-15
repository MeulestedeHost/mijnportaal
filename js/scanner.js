// scanner.js — 📷 Scan stickers: één foto van een stapel nieuwe stickers,
// herkend, gecontroleerd en ingeboekt.
//
// DE GEBRUIKER BEVESTIGT ALTIJD. OCR leest fouten; er wordt niets gewijzigd voor
// er een controlevenster geweest is waarin elke code aan- of afgevinkt,
// verbeterd of verwijderd kan worden. Wat "zeker", "onzeker" en "onbekend"
// betekenen, staat in js/herkenning.js.
//
// Drie lagen, elk vervangbaar: js/ocr-lokaal.js leest woorden uit de foto,
// js/herkenning.js maakt er codes van, en js/inboeken.js boekt ze in met exact
// dezelfde regel als ⚡ Snelruilen. Dit bestand is enkel het venster.
//
// LATER (bewust nog niet): meerdere foto's samenvoegen, volledige pakjes,
// glansstickers, gebruik aan de ruiltafel. De tijdelijke lijst is daar al een
// eerste stap naartoe: scan verder, beslis later.
import { loadKinderen } from "./kinderen.js";
import { ontleedCode, haalCatalogus, haalLijst, wachtOpSchrijven, boekIn, GEWIJZIGD_EVENT } from "./inboeken.js";
import { herkenCodes, voegPogingenSamen } from "./herkenning.js";

// Per verzamelaar in localStorage: een tijdelijke lijst moet een refresh en een
// gesloten tabblad overleven — het is net bedoeld om later verder te doen.
const TIJDELIJK_PREFIX = "scanlijst:";

const VOORTGANG = {
  "loading tesseract core": "Herkenning laden (enkel de eerste keer)…",
  "initializing tesseract": "Herkenning laden (enkel de eerste keer)…",
  "loading language traineddata": "Taalmodel laden (enkel de eerste keer)…",
  "initializing api": "Herkenning starten…",
  "recognizing text": "Stickercodes zoeken…",
};

let venster = null;
let staat = null; // { kindId, naam, laden, catalogus, lijst, rijen, foto, volgendeId }

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-scanner]").forEach((knop) => {
    knop.addEventListener("click", () => {
      const kindId = new URLSearchParams(location.search).get("id");
      if (kindId) void openScanner({ kindId });
    });
  });
});

export async function openScanner({ kindId }) {
  if (!venster) venster = bouwVenster();
  const nieuw = { kindId, naam: "", laden: null, catalogus: null, lijst: null, rijen: [], foto: null, volgendeId: 1 };
  staat = nieuw;
  venster.voor.textContent = "";
  toonMelding("");
  toonStap("start");
  tekenTijdelijk();
  if (!venster.dialoog.open) venster.dialoog.showModal();

  // Catalogus en lijst al laden terwijl de gebruiker een foto neemt. De lijst
  // pas ná openstaande schrijfopdrachten (bv. uit Snelruilen), anders rekent
  // inboeken op een verouderde stand.
  nieuw.laden = (async () => {
    const [kinderen, catalogus, lijst] = await Promise.all([
      loadKinderen(),
      haalCatalogus(),
      wachtOpSchrijven().then(() => haalLijst(kindId)),
    ]);
    const kind = kinderen.find((k) => k.id === kindId);
    nieuw.naam = kind ? kind.voornaam : "";
    nieuw.catalogus = catalogus;
    nieuw.lijst = lijst;
  })();
  try {
    await nieuw.laden;
    if (staat !== nieuw) return;
    venster.voor.textContent = nieuw.naam ? `Voor ${nieuw.naam}` : "";
    tekenWaarschuwing();
  } catch (err) {
    if (staat === nieuw) toonMelding("De catalogus of je lijst kon niet geladen worden. Controleer je verbinding en probeer opnieuw.", "fout");
  }
}

// ---------- venster ----------

function maak(tag, klasse, tekst) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (tekst !== undefined) el.textContent = tekst;
  return el;
}

function knop(tekst, klasse, opKlik) {
  const k = maak("button", "btn " + klasse, tekst);
  k.type = "button";
  k.addEventListener("click", opKlik);
  return k;
}

// Een <label> rond een verborgen <input type="file">: de knop zelf opent de
// camera of de fotokiezer, zonder script dat een klik moet nabootsen — dat
// weigert iOS. capture="environment" vraagt op een gsm meteen de camera
// achteraan; een desktop negeert het en toont gewoon een bestandskiezer.
function fotoKnop(tekst, klasse, camera) {
  const label = maak("label", "btn scanner__knop " + klasse);
  const invoer = maak("input", "scanner__bestand");
  invoer.type = "file";
  invoer.accept = "image/*";
  if (camera) invoer.setAttribute("capture", "environment");
  invoer.addEventListener("change", () => {
    const bestand = invoer.files && invoer.files[0];
    invoer.value = ""; // dezelfde foto nog eens kiezen moet opnieuw iets doen
    if (bestand) void verwerkFoto(bestand);
  });
  label.append(tekst, invoer);
  return { label, invoer };
}

function bouwVenster() {
  const dialoog = maak("dialog", "scanner");
  dialoog.setAttribute("aria-labelledby", "scanner-titel");

  const kop = maak("div", "scanner__kop");
  const titel = maak("h2", "scanner__titel", "📷 Scan stickers");
  titel.id = "scanner-titel";
  kop.append(titel, knop("Sluiten", "btn--outline btn--sm", () => dialoog.close()));
  const voor = maak("p", "form-meta scanner__voor");
  const waarschuwing = maak("div", "message message--error scanner__waarschuwing");
  const melding = maak("div", "message scanner__melding");
  melding.setAttribute("role", "status");
  melding.setAttribute("aria-live", "polite");

  // --- start: foto nemen of kiezen ---
  const start = maak("section", "scanner__stap");
  const uitleg = maak(
    "p",
    "form-meta",
    "Leg de stickers plat met hun code zichtbaar — naast elkaar, onder elkaar of een beetje over elkaar — en fotografeer recht van boven bij goed licht. Er wordt niets ingeboekt voor jij de gevonden codes nakeek."
  );
  const knoppen = maak("div", "scanner__knoppen");
  const camera = fotoKnop("📷 Camera gebruiken", "btn--primary", true);
  const kiezen = fotoKnop("📁 Foto kiezen", "btn--outline", false);
  knoppen.append(camera.label, kiezen.label);
  const tijdelijk = maak("section", "scanner__tijdelijk hidden");
  start.append(uitleg, knoppen, tijdelijk);

  // --- bezig: herkennen ---
  const bezig = maak("section", "scanner__stap hidden");
  const bezigFoto = maak("canvas", "scanner__foto");
  const voortgang = maak("progress", "scanner__voortgang");
  voortgang.max = 1;
  const voortgangTekst = maak("p", "scanner__status", "Foto klaarmaken…");
  voortgangTekst.setAttribute("aria-live", "polite");
  bezig.append(voortgangTekst, voortgang, bezigFoto);

  // --- controle: nakijken ---
  const controle = maak("section", "scanner__stap hidden");
  const controleKop = maak("h3", "scanner__controlekop");
  const controleNota = maak("p", "form-meta");
  const lijst = maak("ul", "scanner__lijst");
  const toevoegen = knop("+ Code toevoegen", "btn--outline btn--sm", () => {
    staat.rijen.push(nieuweRij({ code: "", status: "onbekend" }));
    tekenRijen();
    const laatste = venster.lijst.lastElementChild;
    if (laatste) laatste.querySelector(".scanner__code").focus();
  });
  const controleActies = maak("div", "scanner__acties");
  const inboekKnop = knop("Inboeken", "btn--primary", () => void inboekenUitControle());
  const tijdelijkKnop = knop("Toevoegen aan tijdelijke lijst", "btn--outline", zetOpTijdelijkeLijst);
  const annuleer = knop("Annuleren", "btn--outline", () => {
    staat.rijen = [];
    toonStap("start");
  });
  controleActies.append(inboekKnop, tijdelijkKnop, annuleer);
  const controleFoto = maak("canvas", "scanner__foto");
  controle.append(controleKop, controleNota, lijst, toevoegen, controleActies, controleFoto);

  // --- klaar: samenvatting ---
  const klaar = maak("section", "scanner__stap hidden");
  const klaarKop = maak("h3", "scanner__controlekop");
  const samenvatting = maak("ul", "scanner__samenvatting");
  const details = maak("ul", "scanner__details");
  const klaarActies = maak("div", "scanner__acties");
  klaarActies.append(
    knop("📷 Nog een foto", "btn--primary", () => toonStap("start")),
    knop("Sluiten", "btn--outline", () => dialoog.close())
  );
  klaar.append(klaarKop, samenvatting, details, klaarActies);

  dialoog.append(kop, voor, waarschuwing, melding, start, bezig, controle, klaar);
  dialoog.addEventListener("click", (e) => {
    if (e.target === dialoog) dialoog.close();
  });
  // Een herkenning die nog loopt als het venster sluit, mag niets meer tonen.
  dialoog.addEventListener("close", () => {
    staat = null;
  });
  document.body.appendChild(dialoog);

  return {
    dialoog, voor, waarschuwing, melding, stappen: { start, bezig, controle, klaar },
    tijdelijk, bezigFoto, voortgang, voortgangTekst,
    controleKop, controleNota, lijst, inboekKnop, tijdelijkKnop, controleFoto,
    klaarKop, samenvatting, details,
  };
}

function toonStap(naam) {
  Object.entries(venster.stappen).forEach(([stap, el]) => el.classList.toggle("hidden", stap !== naam));
  if (naam === "start") tekenTijdelijk();
}

function toonMelding(tekst, soort = "info") {
  venster.melding.textContent = tekst;
  venster.melding.className = "message scanner__melding" + (tekst ? " message--show" : "") + (soort === "fout" ? " message--error" : "");
}

// Dezelfde waarschuwing als Snelruilen in Inboeken: zonder ingevulde Zoek ik
// wordt elke sticker een (valse) dubbel.
function tekenWaarschuwing() {
  const leeg = Boolean(staat && staat.lijst) && ![...staat.lijst.values()].some((r) => r.status === "ZOEKT");
  venster.waarschuwing.textContent = leeg
    ? "Je Zoek ik-lijst is leeg — alles wat je inboekt, wordt een dubbel. Vul eerst in wat je nog zoekt."
    : "";
  venster.waarschuwing.classList.toggle("message--show", leeg);
}

// ---------- herkennen ----------

async function verwerkFoto(bestand) {
  const mijn = staat;
  if (!mijn) return;
  toonMelding("");
  toonStap("bezig");
  zetVoortgang("Foto klaarmaken…", null);
  try {
    await mijn.laden;
    const { bereidFotoVoor, leesWoordenPogingen } = await import("./ocr-lokaal.js");
    const foto = await bereidFotoVoor(bestand);
    if (staat !== mijn) return;
    mijn.foto = foto;
    tekenFoto(venster.bezigFoto, foto, []);
    const pogingen = await leesWoordenPogingen(foto, {
      opVoortgang: (m) => {
        if (staat !== mijn) return;
        const lezen = m.status === "recognizing text";
        const stap = lezen && m.pogingen > 1 ? ` (stap ${m.poging} van ${m.pogingen})` : "";
        zetVoortgang((VOORTGANG[m.status] || "Bezig…").replace("…", stap + "…"), lezen ? m.progress : null);
      },
    });
    if (staat !== mijn) return;
    const kandidaten = voegPogingenSamen(pogingen.map((woorden) => herkenCodes(woorden, mijn.catalogus)));
    mijn.rijen = kandidaten.map((k) => nieuweRij(k));
    toonControle();
  } catch (err) {
    if (staat !== mijn) return;
    toonStap("start");
    toonMelding(`Herkennen lukte niet (${err.message}). Probeer opnieuw, of typ de codes in Snelruilen.`, "fout");
  }
}

function zetVoortgang(tekst, fractie) {
  venster.voortgangTekst.textContent = tekst + (typeof fractie === "number" ? ` ${Math.round(fractie * 100)}%` : "");
  if (typeof fractie === "number") venster.voortgang.value = fractie;
  else venster.voortgang.removeAttribute("value"); // onbepaald: de balk beweegt
}

// Een regel in het controlevenster. `invoer` is wat er in het veld staat,
// `code` de geldige, genormaliseerde code (of null).
function nieuweRij({ code, aantal = 1, status, kaders = [], gelezen = [] }) {
  return {
    id: staat.volgendeId++,
    invoer: code,
    code: status === "onbekend" ? null : code,
    aantal,
    status,
    gekozen: status === "zeker",
    kaders,
    gelezen,
  };
}

function toonControle() {
  toonStap("controle");
  tekenWaarschuwing();
  tekenFoto(venster.controleFoto, staat.foto, staat.rijen);
  tekenRijen();
}

// De foto met een kader rond elke gevonden code: zo zie je meteen wat het
// toestel las — en vooral wat het miste.
function tekenFoto(canvas, foto, rijen) {
  if (!foto) return;
  canvas.width = foto.width;
  canvas.height = foto.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(foto, 0, 0);
  ctx.lineWidth = Math.max(3, Math.round(foto.width / 400));
  const kleur = { zeker: "#1e7a3c", onzeker: "#d99400", onbekend: "#b4232a" };
  rijen.forEach((rij) => {
    ctx.strokeStyle = kleur[rij.status];
    rij.kaders.forEach((k) => ctx.strokeRect(k.x - 4, k.y - 4, k.b + 8, k.h + 8));
  });
}

// ---------- controlevenster ----------

function tekenRijen() {
  const rijen = staat.rijen;
  venster.lijst.textContent = "";
  rijen.forEach((rij) => venster.lijst.appendChild(rijElement(rij)));
  venster.controleKop.textContent = rijen.length
    ? "Ik heb volgende stickers gevonden:"
    : "Ik vond geen stickercodes op deze foto.";
  tekenNota();
  tekenActies();
}

function tekenNota() {
  const onzeker = staat.rijen.filter((r) => r.status === "onzeker").length;
  const onbekend = staat.rijen.filter((r) => r.status === "onbekend").length;
  const delen = [];
  if (onzeker) delen.push(`${onzeker} onzeker — vink ze aan als ze kloppen`);
  if (onbekend) delen.push(`${onbekend} onbekend — verbeter of verwijder ze`);
  venster.controleNota.textContent = staat.rijen.length
    ? delen.join(" · ") || "Kijk na of alles klopt, en voeg toe wat ik miste."
    : "Leg de stickers plat en fotografeer recht van boven bij goed licht — of voeg de codes hieronder zelf toe.";
}

function rijElement(rij) {
  const li = maak("li", "scanner__rij");

  const vink = maak("input", "scanner__vink");
  vink.type = "checkbox";
  vink.addEventListener("change", () => {
    rij.gekozen = vink.checked;
    werkRijBij(li, rij);
    tekenActies();
  });

  const veld = maak("input", "form-input scanner__code");
  veld.type = "text";
  veld.value = rij.invoer;
  veld.autocomplete = "off";
  veld.spellcheck = false;
  veld.setAttribute("autocapitalize", "characters");
  veld.setAttribute("aria-label", "Stickercode");
  veld.addEventListener("input", () => {
    beoordeelInvoer(rij, veld.value);
    werkRijBij(li, rij);
    tekenNota();
    tekenActies();
    tekenFoto(venster.controleFoto, staat.foto, staat.rijen);
  });

  const info = maak("div", "scanner__info");
  info.append(maak("span", "scanner__statustekst"), maak("span", "scanner__uitleg"));

  const aantal = maak("div", "scanner__aantal");
  const min = knop("−", "scanner__stap-knop", () => {
    rij.aantal = Math.max(1, rij.aantal - 1);
    werkRijBij(li, rij);
    tekenActies();
  });
  const getal = maak("span", "scanner__getal");
  const plus = knop("+", "scanner__stap-knop", () => {
    rij.aantal += 1;
    werkRijBij(li, rij);
    tekenActies();
  });
  aantal.append(min, getal, plus);

  const weg = knop("✕", "scanner__weg", () => {
    staat.rijen = staat.rijen.filter((r) => r !== rij);
    li.remove();
    tekenNota();
    tekenActies();
    tekenFoto(venster.controleFoto, staat.foto, staat.rijen);
  });

  li.append(vink, veld, info, aantal, weg);
  werkRijBij(li, rij);
  return li;
}

// Een verbeterde code is een beslissing van de gebruiker, geen gok van de OCR:
// klopt ze met de catalogus, dan staat ze meteen aangevinkt.
function beoordeelInvoer(rij, waarde) {
  rij.invoer = waarde;
  const ontleed = ontleedCode(waarde);
  if (ontleed && staat.catalogus.has(ontleed.code)) {
    rij.code = ontleed.code;
    rij.status = "zeker";
    rij.gekozen = true;
  } else {
    rij.code = null;
    rij.status = "onbekend";
    rij.gekozen = false;
  }
}

function werkRijBij(li, rij) {
  const [vink, , info, aantal, weg] = li.children;
  const [statusTekst, uitleg] = info.children;
  li.className = `scanner__rij scanner__rij--${rij.status}`;
  const geldig = Boolean(rij.code);
  vink.disabled = !geldig;
  vink.checked = geldig && rij.gekozen;
  vink.setAttribute("aria-label", geldig ? `${rij.code} meenemen` : "Onbekende code");

  const sticker = geldig ? staat.catalogus.get(rij.code) : null;
  if (rij.status === "zeker") statusTekst.textContent = "✓ Herkend";
  else if (rij.status === "onzeker") statusTekst.textContent = "⚠ Onzeker — klopt dit?";
  else statusTekst.textContent = rij.invoer.trim() ? "❌ Onbekende code" : "Typ een code";

  const gelezen = rij.gelezen.find((g) => g.toUpperCase().replace(/[^A-Z0-9]/g, "") !== rij.code);
  const naam = sticker ? [sticker.naam, sticker.land_naam].filter(Boolean).join(" · ") : "";
  uitleg.textContent =
    rij.status === "onbekend"
      ? "Verbeter de code of verwijder ze."
      : gelezen && rij.status === "onzeker"
      ? `${naam} — gelezen als "${gelezen}"`
      : naam;

  const [min, getal] = aantal.children;
  getal.textContent = `×${rij.aantal}`;
  min.disabled = rij.aantal <= 1;
  min.setAttribute("aria-label", `Eén ${rij.code || "exemplaar"} minder`);
  aantal.lastElementChild.setAttribute("aria-label", `Eén ${rij.code || "exemplaar"} meer`);
  weg.setAttribute("aria-label", `${rij.invoer || "Regel"} verwijderen`);
}

// Elke aangevinkte, geldige code zoveel keer als haar aantal.
function gekozenCodes() {
  return staat.rijen.filter((r) => r.gekozen && r.code).flatMap((r) => Array(r.aantal).fill(r.code));
}

function tekenActies() {
  const aantal = gekozenCodes().length;
  venster.inboekKnop.textContent = `Inboeken (${aantal})`;
  venster.inboekKnop.disabled = aantal === 0;
  venster.tijdelijkKnop.disabled = aantal === 0;
}

// ---------- inboeken ----------

async function inboekenUitControle() {
  const codes = gekozenCodes();
  if (!codes.length) return;
  await voerInboekingUit(codes, { uitTijdelijk: false });
}

async function voerInboekingUit(codes, { uitTijdelijk }) {
  const mijn = staat;
  venster.inboekKnop.disabled = true;
  try {
    await mijn.laden;
  } catch (err) {
    toonMelding("Je lijst is niet geladen; er werd niets ingeboekt. Sluit het venster en probeer opnieuw.", "fout");
    return;
  }
  const uitkomst = await boekIn(mijn.kindId, codes, mijn.lijst);
  // Zoals Snelruilen bij sluiten: kind.html (js/stickers.js) ververst zijn
  // lijsten, en een open Snelruilen haalt zijn lijst opnieuw op.
  document.dispatchEvent(new CustomEvent(GEWIJZIGD_EVENT, { detail: { kindId: mijn.kindId, bron: "scanner" } }));
  if (uitTijdelijk) {
    // Wat niet bewaard kon worden, blijft op de tijdelijke lijst staan.
    const rest = {};
    uitkomst.fouten.forEach((code) => {
      rest[code] = (rest[code] || 0) + 1;
    });
    schrijfTijdelijk(mijn.kindId, rest);
  }
  if (staat !== mijn) return;
  mijn.rijen = [];
  toonKlaar(codes.length, uitkomst);
}

function toonKlaar(aantal, { regels, uitZoek, dubbel, fouten }) {
  toonStap("klaar");
  tekenWaarschuwing();
  venster.klaarKop.textContent = `${aantal} ${aantal === 1 ? "sticker" : "stickers"} verwerkt`;
  venster.samenvatting.textContent = "";
  if (uitZoek) venster.samenvatting.appendChild(maak("li", "", `✅ ${uitZoek} verwijderd uit Zoek ik`));
  if (dubbel) venster.samenvatting.appendChild(maak("li", "", `✅ ${dubbel} ${dubbel === 1 ? "dubbel" : "dubbels"} toegevoegd`));
  if (fouten.length) {
    venster.samenvatting.appendChild(
      maak("li", "scanner__fout", `❌ ${fouten.length} niet bewaard: ${fouten.join(", ")} — controleer je verbinding en probeer die opnieuw`)
    );
  }
  venster.details.textContent = "";
  regels.forEach((r) => {
    const tekst = !r.gelukt
      ? `${r.code} — niet bewaard`
      : r.soort === "uitZoek"
      ? `${r.code} — uit Zoek ik`
      : `${r.code} — dubbel ${r.van} → ${r.naar}${r.van === 0 ? " (stond niet in Zoek ik, dus je had hem al)" : ""}`;
    venster.details.appendChild(maak("li", "", tekst));
  });
}

// ---------- tijdelijke lijst ----------

function leesTijdelijk(kindId) {
  try {
    const opgeslagen = JSON.parse(localStorage.getItem(TIJDELIJK_PREFIX + kindId));
    return opgeslagen && opgeslagen.codes ? opgeslagen.codes : {};
  } catch (err) {
    return {};
  }
}

function schrijfTijdelijk(kindId, codes) {
  try {
    if (Object.keys(codes).length) localStorage.setItem(TIJDELIJK_PREFIX + kindId, JSON.stringify({ codes, bewaard: Date.now() }));
    else localStorage.removeItem(TIJDELIJK_PREFIX + kindId);
  } catch (err) {
    /* privémodus zonder opslag: dan leeft de lijst niet langer dan dit venster */
  }
}

function zetOpTijdelijkeLijst() {
  const codes = gekozenCodes();
  if (!codes.length) return;
  const lijst = leesTijdelijk(staat.kindId);
  codes.forEach((code) => {
    lijst[code] = (lijst[code] || 0) + 1;
  });
  schrijfTijdelijk(staat.kindId, lijst);
  staat.rijen = [];
  toonStap("start");
  toonMelding(`${codes.length} ${codes.length === 1 ? "sticker" : "stickers"} op de tijdelijke lijst gezet — er is nog niets ingeboekt. Scan gerust verder.`);
}

function tekenTijdelijk() {
  const vak = venster.tijdelijk;
  vak.textContent = "";
  if (!staat) return;
  const lijst = leesTijdelijk(staat.kindId);
  const codes = Object.entries(lijst);
  const totaal = codes.reduce((som, [, n]) => som + n, 0);
  vak.classList.toggle("hidden", totaal === 0);
  if (!totaal) return;

  vak.append(
    maak("h3", "scanner__tijdelijkkop", `Tijdelijke lijst: ${totaal} ${totaal === 1 ? "sticker" : "stickers"}`),
    maak("p", "scanner__tijdelijkcodes", codes.map(([code, n]) => (n > 1 ? `${code} ×${n}` : code)).join(", ")),
    maak("p", "form-meta form-meta--plat", "Nog niets ingeboekt. Scan verder, en boek alles in zodra je klaar bent.")
  );
  const acties = maak("div", "scanner__acties");
  const inboeken = knop(`Alles inboeken (${totaal})`, "btn--primary", () => {
    const alle = codes.flatMap(([code, n]) => Array(n).fill(code));
    void voerInboekingUit(alle, { uitTijdelijk: true });
  });
  // Twee klikken om te wissen: een per ongeluk getikte knop mag geen stapel
  // gescande stickers kosten.
  const wis = knop("Wissen", "btn--outline", () => {
    if (wis.dataset.zeker !== "ja") {
      wis.dataset.zeker = "ja";
      wis.textContent = "Nog eens tikken om te wissen";
      return;
    }
    schrijfTijdelijk(staat.kindId, {});
    tekenTijdelijk();
    toonMelding("De tijdelijke lijst is gewist.");
  });
  acties.append(inboeken, wis);
  vak.appendChild(acties);
}
