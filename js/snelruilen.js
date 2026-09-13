// snelruilen.js — ⚡ Snelruilen: aan de ruiltafel in een paar tellen weten of
// een verzamelaar een sticker zoekt of dubbel heeft.
//
// Voor wie aan de tafel staat met een stapel stickers in de hand en geen tijd
// heeft om een land te openen. Eén invoerveld, en één code beantwoordt allebei
// de vragen tegelijk ("zoek ik?" en "heb ik dubbel?"). Bewust geen twee
// velden: een sticker heeft in de databank precies één status, dus één opzoeking
// geeft beide antwoorden. Een tweede veld zou op een gsm onder het toetsenbord
// verdwijnen, en je kan niet meer in het verkeerde veld typen.
//
// Werkt op elke pagina met een knop [data-snelruilen]. Het venster wordt pas
// bij de eerste klik gebouwd, zodat pagina's die het nooit openen er niets van
// merken.
//
// LATER: plakken, bulkcontrole, meerdere codes tegelijk. Daarom staat het
// ontleden (ontleedCode) en het opzoeken (bekijkSticker) los van de DOM: een
// lijst codes controleren is dan codes.map(ontleedCode) en bekijkSticker per
// treffer, zonder aan het venster te komen.
import { supabase } from "./supabase.js";
import { loadKinderen } from "./kinderen.js";

const PAGINA = 1000; // PostgREST levert maximaal 1000 rijen per aanvraag
const HISTORIEK_MAX = 20;

// Een voorkeur van dit toestel, geen gegeven van het gezin — zelfde afweging
// als de verzamelaarskeuze van de wereldreis (js/wereldreis.js).
const KEUZE_SLEUTEL = "snelruilen.kind";

let catalogusPerCode = null; // Map code -> catalogusrij; één keer per pagina
let kinderen = null;
let actiefKindId = null;
let lijst = new Map(); // code -> { status, aantal } van de actieve verzamelaar
let laden = null; // de lopende of afgeronde laadronde (Promise)
let historiek = [];
let venster = null; // de <dialog> en zijn onderdelen, na de eerste opening

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-snelruilen]").forEach((knop) => {
    knop.addEventListener("click", open);
  });
});

// ---------- ontleden ----------

// "bel 3", "BEL-03" en "Bel3" worden allemaal BEL3: aan een tafel typt niemand
// netjes, en een spatie of koppelteken verandert niets aan welke sticker bedoeld
// is. Glansstickers (BEL2s) vallen hier bewust buiten: BEL12 zou al gecontroleerd
// zijn vóór de "s" getypt is.
export function ontleedCode(invoer) {
  const schoon = String(invoer || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (schoon === "00") return { code: "00", cijfers: 2 };
  const m = /^([A-Z]{3})(\d{1,2})$/.exec(schoon);
  if (!m) return null;
  // De catalogus schrijft zonder voorloopnul (BEL3), net als de rest van het
  // portaal. BEL03 wordt dus BEL3, niet omgekeerd.
  return { code: m[1] + Number(m[2]), land: m[1], cijfers: m[2].length, eersteCijfer: m[2][0] };
}

// Mag deze invoer meteen gecontroleerd worden, zonder Enter?
// Zodra er geen langere code meer kan bedoeld zijn. BEL12 kan nooit nog
// uitgroeien, BEL3 ook niet (er is geen BEL30) — maar BEL1 kan nog BEL12
// worden en BEL2 nog BEL20. Dat leest de catalogus, niet een vast getal: een
// album met meer dan twintig stickers per land werkt dan vanzelf.
//
// Een onbekend land wacht wél op Enter. Anders zou "BLE1" (tikfout) meteen
// "bestaat niet" geven terwijl je nog aan het typen bent.
function meteenControleren(ontleed) {
  if (!ontleed) return false;
  if (ontleed.cijfers === 2) return true;
  if (ontleed.eersteCijfer === "0") return false; // BEL0 → BEL01…BEL09
  if (!catalogusPerCode) return false;
  if (!catalogusPerCode.has(ontleed.code)) return false;
  for (let i = 0; i <= 9; i++) {
    if (catalogusPerCode.has(ontleed.land + ontleed.eersteCijfer + i)) return false;
  }
  return true;
}

// Het antwoord op beide vragen voor één code, uit wat al in het geheugen staat.
export function bekijkSticker(code) {
  const sticker = catalogusPerCode ? catalogusPerCode.get(code) || null : null;
  const rij = lijst.get(code);
  return {
    code,
    sticker,
    zoekt: Boolean(rij && rij.status === "ZOEKT"),
    dubbel: rij && rij.status === "RUILT" ? Math.max(Number(rij.aantal) || 1, 1) : 0,
  };
}

// ---------- gegevens ----------

// De catalogus verandert niet terwijl je op een pagina staat en haalt hij dus
// maar één keer op. De lijst van de verzamelaar wel opnieuw bij elke opening:
// wie net op de stickerpagina iets aanvinkte, moet dat hier meteen terugzien.
function laadGegevens() {
  const ronde = (async () => {
    if (!kinderen) kinderen = await loadKinderen();
    if (!kinderen.length) return;
    if (!actiefKindId) actiefKindId = kiesStartKind();
    const [catalogus, stickers] = await Promise.all([
      catalogusPerCode ? null : haalCatalogus(),
      haalLijst(actiefKindId),
    ]);
    if (catalogus) catalogusPerCode = new Map(catalogus.map((s) => [s.code, s]));
    lijst = stickers;
  })();
  laden = ronde;
  // Mislukt het (geen bereik in de zaal), dan mag de volgende controle het
  // gewoon opnieuw proberen in plaats van altijd dezelfde fout terug te geven.
  // Enkel wissen als er intussen geen nieuwere ronde (ander kind) gestart is.
  ronde.catch(() => {
    if (laden === ronde) laden = null;
  });
  return ronde;
}

async function haalCatalogus() {
  const alles = [];
  for (let van = 0; ; van += PAGINA) {
    const { data, error } = await supabase
      .from("sticker_catalogus")
      .select("code,naam,land_naam")
      .order("code", { ascending: true })
      .range(van, van + PAGINA - 1);
    if (error) throw error;
    alles.push(...data);
    if (data.length < PAGINA) return alles;
  }
}

async function haalLijst(kindId) {
  const { data, error } = await supabase
    .from("stickers")
    .select("nummer,status,aantal")
    .eq("kind_id", kindId);
  if (error) throw error;
  return new Map((data || []).map((s) => [s.nummer, s]));
}

// Op de stickerpagina van een kind is dat kind de vanzelfsprekende keuze; elders
// wie hier de vorige keer gekozen was, en anders de eerste.
function kiesStartKind() {
  const bestaat = (id) => id && kinderen.some((k) => k.id === id);
  if (location.pathname.endsWith("/kind.html")) {
    const uitUrl = new URLSearchParams(location.search).get("id");
    if (bestaat(uitUrl)) return uitUrl;
  }
  let bewaard = null;
  try {
    bewaard = localStorage.getItem(KEUZE_SLEUTEL);
  } catch (err) {
    /* privémodus: dan gewoon de eerste */
  }
  return bestaat(bewaard) ? bewaard : kinderen[0].id;
}

// ---------- venster ----------

async function open() {
  if (!venster) venster = bouwVenster();
  venster.dialoog.showModal();
  venster.invoer.focus();
  toonHint("");

  try {
    await laadGegevens();
  } catch (err) {
    toonFout("Je lijst kon niet geladen worden. Controleer je verbinding — de volgende controle probeert opnieuw.");
    return;
  }
  if (!kinderen.length) {
    toonFout("Je hebt nog geen verzamelaars. Voeg er eerst een toe op het dashboard.");
    venster.invoer.disabled = true;
    return;
  }
  vulKindKeuze();
  // Typte iemand al een korte code terwijl de catalogus nog laadde, dan kon
  // meteenControleren() dat nog niet beslissen. Nu wel.
  verwerkInvoer();
}

function bouwVenster() {
  const dialoog = maak("dialog", "snelruil");
  dialoog.setAttribute("aria-labelledby", "snelruil-titel");

  const kop = maak("div", "snelruil__kop");
  const titel = maak("h2", "snelruil__titel", "⚡ Snelruilen");
  titel.id = "snelruil-titel";
  const sluit = maak("button", "btn btn--outline btn--sm", "Sluiten");
  sluit.type = "button";
  sluit.addEventListener("click", () => dialoog.close());
  kop.append(titel, sluit);

  const kindVak = maak("div", "snelruil__kind hidden");
  const kindLabel = maak("label", "form-label", "Verzamelaar");
  kindLabel.htmlFor = "snelruil-kind";
  const kindKeuze = maak("select", "form-input");
  kindKeuze.id = "snelruil-kind";
  kindKeuze.addEventListener("change", () => wisselKind(kindKeuze.value));
  kindVak.append(kindLabel, kindKeuze);

  const invoerLabel = maak("label", "form-label", "Stickercode");
  invoerLabel.htmlFor = "snelruil-invoer";
  const invoer = maak("input", "form-input snelruil__invoer");
  invoer.id = "snelruil-invoer";
  invoer.type = "text";
  invoer.placeholder = "BEL3";
  invoer.autocomplete = "off";
  invoer.spellcheck = false;
  invoer.setAttribute("autocapitalize", "characters");
  invoer.setAttribute("autocorrect", "off");
  invoer.setAttribute("enterkeyhint", "search");
  invoer.setAttribute("aria-describedby", "snelruil-hint");
  invoer.addEventListener("input", () => {
    toonHint("");
    verwerkInvoer();
  });
  invoer.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    verwerkInvoer({ enter: true });
  });

  const hint = maak("p", "form-meta snelruil__hint");
  hint.id = "snelruil-hint";

  // aria-live: een schermlezer leest het antwoord voor zonder dat de focus het
  // invoerveld hoeft te verlaten — precies wat hier ook voor ziende gebruikers
  // de bedoeling is.
  const resultaat = maak("div", "snelruil__resultaat");
  resultaat.setAttribute("aria-live", "polite");

  const historiekKop = maak("h3", "snelruil__historiek-kop hidden", "Recente controles");
  const historiekLijst = maak("ul", "snelruil__historiek");

  dialoog.append(kop, kindVak, invoerLabel, invoer, hint, resultaat, historiekKop, historiekLijst);

  // Klik op de donkere achtergrond sluit ook: de dialoog zelf vult enkel het
  // kader, dus een klik die op het element zelf landt, viel erbuiten.
  dialoog.addEventListener("click", (e) => {
    if (e.target === dialoog) dialoog.close();
  });

  document.body.appendChild(dialoog);
  return { dialoog, kindVak, kindKeuze, invoer, hint, resultaat, historiekKop, historiekLijst };
}

function vulKindKeuze() {
  const { kindVak, kindKeuze } = venster;
  kindKeuze.textContent = "";
  kinderen.forEach((kind) => {
    const optie = document.createElement("option");
    optie.value = kind.id;
    optie.textContent = `${kind.voornaam} ${kind.familienaam}`;
    kindKeuze.appendChild(optie);
  });
  kindKeuze.value = actiefKindId;
  // Met één verzamelaar valt er niets te kiezen.
  kindVak.classList.toggle("hidden", kinderen.length < 2);
}

async function wisselKind(kindId) {
  actiefKindId = kindId;
  try {
    localStorage.setItem(KEUZE_SLEUTEL, kindId);
  } catch (err) {
    /* niet erg: dan kiest de volgende opening opnieuw de eerste */
  }
  // De historiek ging over de vorige verzamelaar; blijft ze staan, dan lees je
  // straks "✓ zoek ik" bij een sticker die dit kind helemaal niet zoekt.
  historiek = [];
  tekenHistoriek();
  venster.resultaat.textContent = "";
  venster.invoer.focus();
  try {
    await laadGegevens();
  } catch (err) {
    toonFout("De lijst van deze verzamelaar kon niet geladen worden.");
  }
}

// ---------- invoer ----------

function verwerkInvoer({ enter = false } = {}) {
  const { invoer } = venster;
  const tekst = invoer.value;
  if (!tekst.trim()) return;
  const ontleed = ontleedCode(tekst);
  if (!ontleed) {
    if (enter) toonHint("Typ een code zoals BEL3 of BEL03.");
    return;
  }
  if (!enter && !meteenControleren(ontleed)) return;
  // Meteen leegmaken, nog vóór er iets geladen is: wie al aan de volgende code
  // begint, mag die niet kwijtraken wanneer het antwoord binnenkomt.
  invoer.value = "";
  void controleer(ontleed.code, tekst);
}

async function controleer(code, oorspronkelijk) {
  try {
    await (laden || laadGegevens());
  } catch (err) {
    zetTerug(oorspronkelijk);
    toonFout("Je lijst kon niet geladen worden. Controleer je verbinding en druk opnieuw Enter.");
    return;
  }

  const antwoord = bekijkSticker(code);
  if (!antwoord.sticker) {
    // Niet "zoek ik niet": een tikfout (BLE3) zou dan "nee" antwoorden terwijl
    // je BEL3 misschien wél zoekt. En niet in de historiek, want er is niets
    // gecontroleerd. De tekst blijft geselecteerd staan om te overschrijven.
    zetTerug(oorspronkelijk);
    tekenOnbekend(code);
    return;
  }
  tekenResultaat(antwoord);
  historiek.unshift(antwoord);
  historiek.length = Math.min(historiek.length, HISTORIEK_MAX);
  tekenHistoriek();
}

// Enkel terugzetten als het veld nog leeg is — anders typte iemand intussen
// al verder.
function zetTerug(tekst) {
  const { invoer } = venster;
  if (invoer.value) return;
  invoer.value = tekst;
  invoer.select();
}

// ---------- tekenen ----------

// Groen en rood, maar nooit enkel kleur: ✓ en ✗ hebben een andere vorm, en de
// tekst zegt het nog eens. Een op twaalf jongens ziet rood en groen niet uit
// elkaar, en 🟢/🔴 zijn allebei gewoon een bolletje.
function tekenResultaat({ code, sticker, zoekt, dubbel }) {
  const { resultaat } = venster;
  resultaat.textContent = "";
  toonHint("");

  const naam = maak("p", "snelruil__naam");
  naam.append(maak("strong", "snelruil__code", code));
  if (sticker.naam) naam.append(" — " + sticker.naam);
  const land = maak("p", "snelruil__land", sticker.land_naam || "");

  const antwoorden = maak("div", "snelruil__antwoorden");
  antwoorden.append(
    antwoordVak("Zoek ik?", zoekt, zoekt ? "Zoek ik" : "Zoek ik niet"),
    antwoordVak("Heb ik dubbel?", dubbel > 0, dubbelTekst(dubbel))
  );
  resultaat.append(naam, land, antwoorden);
}

function antwoordVak(vraag, ja, tekst) {
  const vak = maak("div", "snelruil__antwoord " + (ja ? "snelruil--ja" : "snelruil--nee"));
  vak.append(maak("span", "snelruil__vraag", vraag));
  vak.append(maak("span", "snelruil__uitkomst", (ja ? "✓ " : "✗ ") + tekst));
  return vak;
}

function tekenOnbekend(code) {
  const { resultaat } = venster;
  resultaat.textContent = "";
  toonHint("");
  const vak = maak("div", "snelruil__antwoord snelruil--nee");
  vak.append(maak("span", "snelruil__uitkomst", `✗ ${code} bestaat niet`));
  resultaat.append(vak);
}

function tekenHistoriek() {
  const { historiekKop, historiekLijst } = venster;
  historiekLijst.textContent = "";
  historiekKop.classList.toggle("hidden", historiek.length === 0);
  historiek.forEach(({ code, zoekt, dubbel }) => {
    const ja = zoekt || dubbel > 0;
    const li = maak("li", "snelruil__regel " + (ja ? "snelruil--ja" : "snelruil--nee"));
    const tekst = zoekt ? "zoek ik" : dubbel > 0 ? dubbelTekst(dubbel).toLowerCase() : "zoek ik niet, geen dubbel";
    li.append(maak("strong", "snelruil__code", code), maak("span", "", (ja ? "✓ " : "✗ ") + tekst));
    historiekLijst.append(li);
  });
}

function dubbelTekst(dubbel) {
  if (dubbel === 0) return "Geen dubbel";
  return `${new Intl.NumberFormat("nl-BE").format(dubbel)} ${dubbel === 1 ? "dubbel" : "dubbels"}`;
}

function toonHint(tekst) {
  venster.hint.textContent = tekst;
}

function toonFout(tekst) {
  const { resultaat } = venster;
  resultaat.textContent = "";
  resultaat.append(maak("div", "message message--show message--error", tekst));
}

function maak(tag, klasse, tekst) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (tekst !== undefined) el.textContent = tekst;
  return el;
}
