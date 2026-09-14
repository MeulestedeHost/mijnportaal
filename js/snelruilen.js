// snelruilen.js — ⚡ Snelruilen: in een paar tellen weten of een verzamelaar
// een sticker zoekt of dubbel heeft (CONTROLEREN), of een stapel nieuwe
// stickers verwerken (INBOEKEN).
//
// Eén invoerveld, en één code beantwoordt allebei de vragen tegelijk ("zoek
// ik?" en "heb ik dubbel?"). Bewust geen twee velden: een sticker heeft in de
// databank precies één status, dus één opzoeking geeft beide antwoorden. Een
// tweede veld zou op een gsm onder het toetsenbord verdwijnen, en je kan niet
// meer in het verkeerde veld typen.
//
// TWEE MODI IN ÉÉN VENSTER, NIET TWEE KNOPPEN. Het invoerveld, de regel wanneer
// een code "klaar" is, de verzamelaarskeuze en de historiek zijn identiek. Het
// gevaar is de verkeerde modus: wie op de beurs "zoek jij FRA05?" typt terwijl
// het venster nog op Inboeken staat, haalt FRA05 uit zijn Zoek ik. Daarom wordt
// Inboeken NIET per toestel onthouden, enkel zolang je op dezelfde pagina blijft
// — een nieuwe pagina begint altijd bij Controleren.
//
// Werkt op elke pagina met een knop [data-snelruilen]. Het venster wordt pas
// bij de eerste klik gebouwd, zodat pagina's die het nooit openen er niets van
// merken.
//
// LATER: plakken, bulk, volledige pakjes, scannen. Daarom staan het ontleden
// (ontleedCode), het opzoeken (bekijkSticker) en het rekenen (bepaalInboeking)
// los van de DOM: een pakje verwerken is dan per code bepaalInboeking op de
// lokale lijst, zonder aan het venster te komen.
import { supabase } from "./supabase.js";
import { loadKinderen } from "./kinderen.js";
import { kiesRuiler as kiesRuilerVenster, haalRuilkansen, openRuilBevestiging } from "./ruilregistratie.js";
import {
  BUNDEL_EVENT,
  huidigeBundel,
  bundelKindId,
  kiesRuiler as kiesBundelRuiler,
  vergeetRuiler,
  voegToe,
  zetKant,
  verwijderRuil,
  leegRuilen,
  ruilNummer,
  volledigeParen,
  ruilerLabel,
  teHerstellen,
  herstelMelding,
} from "./ruilbundel.js";

const PAGINA = 1000; // PostgREST levert maximaal 1000 rijen per aanvraag
const HISTORIEK_MAX = 20;

// Een voorkeur van dit toestel, geen gegeven van het gezin — zelfde afweging
// als de verzamelaarskeuze van de wereldreis (js/wereldreis.js).
const KEUZE_SLEUTEL = "snelruilen.kind";

// Andere pagina's (js/stickers.js) luisteren hierop om hun lijst te verversen.
export const GEWIJZIGD_EVENT = "snelruilen:gewijzigd";

const UITLEG = {
  controleren: "Controleer snel of je een sticker zoekt of als dubbel hebt. Je verzameling wordt niet gewijzigd.",
  inboeken:
    "Gebruik deze modus wanneer je nieuwe stickers hebt gekregen of uit een pakje hebt gehaald. Je verzameling wordt automatisch bijgewerkt.",
};

let catalogusPerCode = null; // Map code -> catalogusrij; één keer per pagina
let kinderen = null;
let actiefKindId = null;
let lijst = new Map(); // code -> { status, aantal } van de actieve verzamelaar
let lijstGeladen = false; // hoort `lijst` al bij actiefKindId?
let laden = null; // de lopende of afgeronde laadronde (Promise)
let historiek = [];
let venster = null; // de <dialog> en zijn onderdelen, na de eerste opening

// Met wie je aan tafel ruilt en wat er in de ruil zit, staat niet hier maar in
// js/ruilbundel.js: de ruilpagina moet dezelfde bundel zien. Enkel voor de
// keuzelijst bij een halve ruil: welke codes van deze ruiler er passen.
let kandidaten = { sleutel: null, ik: [], ander: [] };

let modus = "controleren"; // bewust niet bewaard: zie bovenaan
// Elke inboeking legt haar vorige stand op de stapel; ongedaan maken pakt er
// telkens één af. Een stapel en niet enkel "de laatste": bij een stapel stickers
// merk je een tikfout vaak pas twee stickers later.
let ongedaanStapel = [];
// Schrijfopdrachten gaan één voor één en in volgorde: wie twee keer snel ARG10
// typt, moet 1 en dan 2 wegschrijven — niet twee keer 1 in willekeurige
// volgorde. Elke opdracht schrijft de volledige gewenste stand, geen "+1".
let schrijfrij = Promise.resolve();
let gewijzigd = false; // iets weggeschreven sinds het venster openging?

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-snelruilen]").forEach((knop) => {
    knop.addEventListener("click", open);
  });
});

// Kiest de ruilpagina een sticker of een andere ruiler, dan moet een open
// venster dat meteen tonen (js/ruilen.js luistert omgekeerd op hetzelfde).
document.addEventListener(BUNDEL_EVENT, () => {
  if (!venster) return;
  tekenRuilerVak();
  tekenBundel();
  tekenHistoriek();
});

// Vanuit een ruilerkaart: meteen voor de verzamelaar van die kaart, niet voor
// wie Snelruilen de vorige keer koos.
export async function openSnelruilen({ kindId } = {}) {
  if (kindId && kindId !== actiefKindId) {
    const hadAl = Boolean(actiefKindId);
    actiefKindId = kindId;
    lijstGeladen = false;
    if (hadAl) {
      historiek = [];
      ongedaanStapel = [];
      if (venster) {
        tekenHistoriek();
        tekenOngedaanKnop();
        venster.resultaat.textContent = "";
      }
    }
  }
  await open();
}

// ---------- ontleden en rekenen (los van de DOM) ----------

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

// Mag deze invoer meteen verwerkt worden, zonder Enter?
// Zodra er geen langere code meer kan bedoeld zijn. BEL12 kan nooit nog
// uitgroeien, BEL3 ook niet (er is geen BEL30) — maar BEL1 kan nog BEL12
// worden en BEL2 nog BEL20. Dat leest de catalogus, niet een vast getal: een
// album met meer dan twintig stickers per land werkt dan vanzelf.
//
// Een onbekend land wacht wél op Enter. Anders zou "BLE1" (tikfout) meteen
// "bestaat niet" geven terwijl je nog aan het typen bent.
function meteenVerwerken(ontleed) {
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

// Wat er met de lijst gebeurt als je deze sticker krijgt. `voor` en `na` zijn
// een rij ({ status, aantal }) of null (geen rij: "heb ik, niet dubbel").
//
// De databank kent geen "heb ik" — alles wat niet gezocht is, geldt als al in
// het album (zie README, "Geplakt is een afleiding"). Een sticker die niet in
// Zoek ik staat, is dus per definitie een dubbel. Dat klopt enkel voor wie zijn
// Zoek ik-lijst invulde; daarom de waarschuwing bij een lege lijst.
export function bepaalInboeking(voor) {
  if (voor && voor.status === "ZOEKT") return { na: null, soort: "uitZoek" };
  const van = voor && voor.status === "RUILT" ? Math.max(Number(voor.aantal) || 1, 1) : 0;
  return { na: { status: "RUILT", aantal: van + 1 }, soort: "dubbel", van, naar: van + 1 };
}

// ---------- gegevens ----------

// De catalogus verandert niet terwijl je op een pagina staat en haalt hij dus
// maar één keer op. De lijst van de verzamelaar wel opnieuw bij elke opening:
// wie net op de stickerpagina iets aanvinkte, moet dat hier meteen terugzien.
// Pas ná de openstaande schrijfopdrachten, anders komt er een lijst terug waar
// de laatste inboekingen nog niet in staan.
function laadGegevens() {
  const ronde = (async () => {
    if (!kinderen) kinderen = await loadKinderen();
    if (!kinderen.length) return;
    if (!actiefKindId) actiefKindId = kiesStartKind();
    const kindId = actiefKindId;
    const [catalogus, stickers] = await Promise.all([
      catalogusPerCode ? null : haalCatalogus(),
      schrijfrij.then(() => haalLijst(kindId)),
    ]);
    if (catalogus) catalogusPerCode = new Map(catalogus.map((s) => [s.code, s]));
    if (kindId !== actiefKindId) return; // intussen van verzamelaar gewisseld
    lijst = stickers;
    lijstGeladen = true;
  })();
  laden = ronde;
  // Mislukt het (geen bereik in de zaal), dan mag de volgende poging het
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

// Eén aanvraag per wijziging, met de volledige stand: een rij wordt upsert op
// (kind_id, nummer) — dezelfde unieke index als js/stickers.js gebruikt — en
// "geen rij" wordt een delete.
function schrijf(kindId, code, rij) {
  const opdracht = schrijfrij.then(async () => {
    const { error } = rij
      ? await supabase
          .from("stickers")
          .upsert({ kind_id: kindId, nummer: code, status: rij.status, aantal: rij.aantal }, { onConflict: "kind_id,nummer" })
      : await supabase.from("stickers").delete().eq("kind_id", kindId).eq("nummer", code);
    if (error) throw error;
    gewijzigd = true;
  });
  // De rij zelf mag nooit afgewezen blijven, anders stopt alles erna.
  schrijfrij = opdracht.catch(() => {});
  return opdracht;
}

function zetLokaal(code, rij) {
  if (rij) lijst.set(code, { nummer: code, status: rij.status, aantal: rij.aantal });
  else lijst.delete(code);
}

// Op de stickerpagina van een kind is dat kind de vanzelfsprekende keuze; elders
// wie hier de vorige keer gekozen was, en anders de eerste.
function kiesStartKind() {
  const bestaat = (id) => id && kinderen.some((k) => k.id === id);
  if (location.pathname.endsWith("/kind.html")) {
    const uitUrl = new URLSearchParams(location.search).get("id");
    if (bestaat(uitUrl)) return uitUrl;
  }
  // Staat er aan tafel een bundel open, dan hoort Snelruilen bij die verzamelaar.
  if (bestaat(bundelKindId())) return bundelKindId();
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
  gewijzigd = false;
  venster.dialoog.showModal();
  tekenModus();
  venster.invoer.focus();
  toonHint("");

  try {
    await laadGegevens();
  } catch (err) {
    toonFout("Je lijst kon niet geladen worden. Controleer je verbinding — de volgende poging probeert opnieuw.");
    return;
  }
  if (!kinderen.length) {
    toonFout("Je hebt nog geen verzamelaars. Voeg er eerst een toe op het dashboard.");
    venster.invoer.disabled = true;
    return;
  }
  vulKindKeuze();
  tekenRuilerVak();
  tekenBundel();
  tekenWaarschuwing();
  // Typte iemand al een korte code terwijl de catalogus nog laadde, dan kon
  // meteenVerwerken() dat nog niet beslissen. Nu wel.
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

  // aria-pressed op gewone knoppen in plaats van radioknoppen: twee grote
  // tikvlakken, en Tab + Enter/Spatie werkt zonder extra code.
  const modi = maak("div", "snelruil__modi");
  modi.setAttribute("role", "group");
  modi.setAttribute("aria-label", "Modus");
  const modusKnoppen = [
    ["controleren", "🔎 Controleren"],
    ["inboeken", "➕ Inboeken"],
  ].map(([waarde, tekst]) => {
    const knop = maak("button", "snelruil__modus", tekst);
    knop.type = "button";
    knop.dataset.modus = waarde;
    knop.addEventListener("click", () => wisselModus(waarde));
    modi.append(knop);
    return knop;
  });

  const uitleg = maak("p", "form-meta snelruil__uitleg");
  const waarschuwing = maak("div", "message message--error snelruil__waarschuwing");
  waarschuwing.setAttribute("role", "status");

  const kindVak = maak("div", "snelruil__kind hidden");
  const kindLabel = maak("label", "form-label", "Verzamelaar");
  kindLabel.htmlFor = "snelruil-kind";
  const kindKeuze = maak("select", "form-input");
  kindKeuze.id = "snelruil-kind";
  kindKeuze.addEventListener("change", () => wisselKind(kindKeuze.value));
  kindVak.append(kindLabel, kindKeuze);

  // "Ruil met: Sol" bovenaan. Nooit een verplichte keuze: Snelruilen dient ook
  // gewoon om je eigen lijst na te kijken, zonder vaste tegenpartij.
  const ruilerVak = maak("div", "form-meta snelruil__ruiler");
  const ruilerTekst = maak("span", "snelruil__ruiler-tekst");
  const ruilerKies = maak("button", "snelruil__ruiler-wijzig", "kies ruiler");
  ruilerKies.type = "button";
  ruilerKies.addEventListener("click", () => void kiesEenRuiler());
  const ruilerStop = maak("button", "snelruil__ruiler-wijzig hidden", "stoppen");
  ruilerStop.type = "button";
  ruilerStop.title = "Niet meer met deze ruiler bezig — de gekozen ruilen worden gewist";
  ruilerStop.addEventListener("click", () => {
    vergeetRuiler();
    venster.invoer.focus();
  });
  ruilerVak.append(ruilerTekst, ruilerKies, ruilerStop);

  const invoerLabel = maak("label", "form-label", "Stickercode");
  invoerLabel.htmlFor = "snelruil-invoer";
  const invoer = maak("input", "form-input snelruil__invoer");
  invoer.id = "snelruil-invoer";
  invoer.type = "text";
  invoer.autocomplete = "off";
  invoer.spellcheck = false;
  invoer.setAttribute("autocapitalize", "characters");
  invoer.setAttribute("autocorrect", "off");
  invoer.setAttribute("aria-describedby", "snelruil-hint");
  invoer.addEventListener("input", () => {
    toonHint("");
    verwerkInvoer();
  });
  invoer.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      verwerkInvoer({ enter: true });
      return;
    }
    // Ctrl+Z in een leeg veld: ongedaan maken zonder de handen van het
    // toetsenbord. Staat er tekst, dan blijft Ctrl+Z gewoon tekst herstellen.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !invoer.value && modus === "inboeken") {
      e.preventDefault();
      maakOngedaan();
    }
  });

  const onder = maak("div", "snelruil__onder");
  const hint = maak("p", "form-meta snelruil__hint");
  hint.id = "snelruil-hint";
  const ongedaanKnop = maak("button", "btn btn--outline btn--sm snelruil__ongedaan hidden");
  ongedaanKnop.type = "button";
  ongedaanKnop.addEventListener("click", maakOngedaan);
  onder.append(hint, ongedaanKnop);

  // aria-live: een schermlezer leest het antwoord voor zonder dat de focus het
  // invoerveld hoeft te verlaten — precies wat hier ook voor ziende gebruikers
  // de bedoeling is.
  const resultaat = maak("div", "snelruil__resultaat");
  resultaat.setAttribute("aria-live", "polite");

  // De ruilen die aan tafel samengesteld worden (js/ruilbundel.js).
  const bundelVak = maak("section", "snelruil__bundel hidden");
  bundelVak.setAttribute("aria-label", "Voorgestelde ruilen");

  const historiekKop = maak("h3", "snelruil__historiek-kop hidden", "Recent");
  const historiekLijst = maak("ul", "snelruil__historiek");

  dialoog.append(kop, ruilerVak, modi, uitleg, waarschuwing, kindVak, invoerLabel, invoer, onder, resultaat, bundelVak, historiekKop, historiekLijst);

  // Klik op de donkere achtergrond sluit ook: de dialoog zelf vult enkel het
  // kader, dus een klik die op het element zelf landt, viel erbuiten.
  dialoog.addEventListener("click", (e) => {
    if (e.target === dialoog) dialoog.close();
  });
  // De pagina eronder (kind.html) toont anders nog de stand van vóór het
  // inboeken. Wachten tot alles weggeschreven is, anders ververst ze te vroeg.
  dialoog.addEventListener("close", () => {
    void schrijfrij.then(() => {
      if (!gewijzigd) return;
      gewijzigd = false;
      document.dispatchEvent(new CustomEvent(GEWIJZIGD_EVENT, { detail: { kindId: actiefKindId } }));
    });
  });

  document.body.appendChild(dialoog);
  return {
    dialoog, modusKnoppen, uitleg, waarschuwing, kindVak, kindKeuze, ruilerVak, ruilerTekst, ruilerKies, ruilerStop,
    bundelVak, invoerLabel, invoer,
    hint, ongedaanKnop, resultaat, historiekKop, historiekLijst,
  };
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
  lijstGeladen = false;
  try {
    localStorage.setItem(KEUZE_SLEUTEL, kindId);
  } catch (err) {
    /* niet erg: dan kiest de volgende opening opnieuw de eerste */
  }
  // De historiek en de ongedaan-stapel gingen over de vorige verzamelaar;
  // blijven ze staan, dan lees je "✓ zoek ik" bij een sticker die dit kind
  // helemaal niet zoekt, of maak je een inboeking van een ander kind ongedaan.
  historiek = [];
  ongedaanStapel = [];
  tekenHistoriek();
  tekenOngedaanKnop();
  tekenRuilerVak();
  tekenBundel();
  tekenWaarschuwing();
  venster.resultaat.textContent = "";
  venster.invoer.focus();
  try {
    await laadGegevens();
    tekenWaarschuwing();
  } catch (err) {
    toonFout("De lijst van deze verzamelaar kon niet geladen worden.");
  }
}

function wisselModus(nieuw) {
  if (modus === nieuw) return;
  modus = nieuw;
  venster.resultaat.textContent = "";
  toonHint("");
  tekenModus();
  venster.invoer.focus();
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
  if (!enter && !meteenVerwerken(ontleed)) return;
  // Meteen leegmaken, nog vóór er iets geladen is: wie al aan de volgende code
  // begint, mag die niet kwijtraken wanneer het antwoord binnenkomt.
  invoer.value = "";
  // De modus van het moment van typen, niet die van wanneer het laden klaar is.
  void verwerk(ontleed.code, tekst, modus);
}

async function verwerk(code, oorspronkelijk, gekozenModus) {
  try {
    await (laden || laadGegevens());
  } catch (err) {
    zetTerug(oorspronkelijk);
    toonFout("Je lijst kon niet geladen worden. Controleer je verbinding en druk opnieuw Enter.");
    return;
  }
  if (!kinderen || !kinderen.length) return;

  if (!bekijkSticker(code).sticker) {
    // Niet "zoek ik niet": een tikfout (BLE3) zou dan "nee" antwoorden terwijl
    // je BEL3 misschien wél zoekt — of, bij inboeken, een onbestaande sticker
    // wegschrijven. En niet in de historiek, want er is niets gebeurd. De
    // tekst blijft geselecteerd staan om te overschrijven.
    zetTerug(oorspronkelijk);
    tekenOnbekend(code);
    return;
  }
  if (gekozenModus === "inboeken") inboek(code);
  else controleer(code);
}

function controleer(code) {
  const antwoord = bekijkSticker(code);
  tekenResultaat(antwoord);
  voegToeAanHistoriek({ soort: "controle", ...antwoord });
  void koppelAanBundel(antwoord);
}

// Lokaal meteen bijwerken en tekenen, daarna op de achtergrond wegschrijven.
// Zo voelt een stapel stickers even snel als controleren; mislukt het
// schrijven, dan zegt de regel dat en halen we de echte stand opnieuw op.
function inboek(code) {
  const kindId = actiefKindId;
  const rij = lijst.get(code);
  const voor = rij ? { status: rij.status, aantal: Number(rij.aantal) || 1 } : null;
  const plan = bepaalInboeking(voor);
  zetLokaal(code, plan.na);

  const regel = { soort: "inboek", code, sticker: catalogusPerCode.get(code), ...plan, toestand: "bewaard" };
  const stap = { kindId, code, voor, na: plan.na, regel };
  ongedaanStapel.push(stap);
  // Niet verder terug dan wat de historiek nog toont: ongedaan maken wat je
  // niet meer ziet staan, zou een raadsel zijn.
  if (ongedaanStapel.length > HISTORIEK_MAX) ongedaanStapel.shift();

  voegToeAanHistoriek(regel);
  tekenInboeking(regel);
  tekenOngedaanKnop();
  tekenWaarschuwing();

  schrijf(kindId, code, plan.na).catch(() => {
    regel.toestand = "fout";
    ongedaanStapel = ongedaanStapel.filter((s) => s !== stap);
    tekenHistoriek();
    tekenOngedaanKnop();
    toonFout(`${code} kon niet bewaard worden. Controleer je verbinding en boek hem opnieuw in.`);
    herlaadNaFout(kindId);
  });
}

function maakOngedaan() {
  const stap = ongedaanStapel.pop();
  if (!stap) return;
  zetLokaal(stap.code, stap.voor);
  stap.regel.toestand = "ongedaan";
  tekenHistoriek();
  tekenOngedaanKnop();
  tekenWaarschuwing();
  tekenOngedaan(stap.regel);
  venster.invoer.focus();

  schrijf(stap.kindId, stap.code, stap.voor).catch(() => {
    toonFout(`Ongedaan maken van ${stap.code} lukte niet. Controleer je verbinding; je lijst wordt opnieuw geladen.`);
    herlaadNaFout(stap.kindId);
  });
}

// Na een mislukte schrijfopdracht klopt de lokale lijst niet meer met de
// databank. Niet afwachten binnen de schrijfrij zelf: laadGegevens() wacht op
// die rij en zou dan op zichzelf blijven wachten.
function herlaadNaFout(kindId) {
  setTimeout(() => {
    if (kindId !== actiefKindId) return;
    laadGegevens().then(tekenWaarschuwing, () => {});
  }, 0);
}

// Enkel terugzetten als het veld nog leeg is — anders typte iemand intussen
// al verder.
function zetTerug(tekst) {
  const { invoer } = venster;
  if (invoer.value) return;
  invoer.value = tekst;
  invoer.select();
}

function voegToeAanHistoriek(regel) {
  historiek.unshift(regel);
  historiek.length = Math.min(historiek.length, HISTORIEK_MAX);
  tekenHistoriek();
}

// ---------- tekenen ----------

// Inboeken moet er onmiskenbaar anders uitzien: een gekleurde rand, een ander
// label en een andere tekst op de Enter-toets. Wie in de verkeerde modus zit,
// moet dat zien vóór hij typt.
function tekenModus() {
  const { dialoog, modusKnoppen, uitleg, invoerLabel, invoer } = venster;
  const inboeken = modus === "inboeken";
  modusKnoppen.forEach((knop) => knop.setAttribute("aria-pressed", String(knop.dataset.modus === modus)));
  dialoog.classList.toggle("snelruil--modus-inboeken", inboeken);
  uitleg.textContent = UITLEG[modus];
  invoerLabel.textContent = inboeken ? "Sticker inboeken" : "Stickercode";
  invoer.placeholder = inboeken ? "BEL3 → toevoegen" : "BEL3";
  invoer.setAttribute("enterkeyhint", inboeken ? "done" : "search");
  tekenOngedaanKnop();
  tekenRuilerVak();
  tekenBundel();
  tekenWaarschuwing();
}

function tekenWaarschuwing() {
  if (!venster) return;
  const leeg = modus === "inboeken" && lijstGeladen && ![...lijst.values()].some((r) => r.status === "ZOEKT");
  venster.waarschuwing.textContent = leeg
    ? "Je Zoek ik-lijst is leeg — alles wat je inboekt, wordt een dubbel. Vul eerst in wat je nog zoekt."
    : "";
  venster.waarschuwing.classList.toggle("message--show", leeg);
}

function tekenOngedaanKnop() {
  const { ongedaanKnop } = venster;
  const laatste = ongedaanStapel[ongedaanStapel.length - 1];
  ongedaanKnop.classList.toggle("hidden", modus !== "inboeken" || !laatste);
  if (laatste) ongedaanKnop.textContent = `↩ Ongedaan maken (${laatste.code})`;
}

// Enkel in Controleren: in Inboeken ruil je niet, je verwerkt pakjes.
function tekenRuilerVak() {
  if (!venster) return;
  const { ruilerVak, ruilerTekst, ruilerKies, ruilerStop } = venster;
  const bundel = huidigeBundel(actiefKindId);
  const ruiler = bundel && bundel.ruiler;
  ruilerVak.classList.toggle("hidden", modus !== "controleren");
  ruilerTekst.textContent = "Ruil met: ";
  if (ruiler) {
    ruilerTekst.append(maak("strong", "", ruilerLabel(ruiler) + (ruiler.tijdelijk ? " (zonder account)" : "")));
  }
  ruilerKies.textContent = ruiler ? "wijzig" : "kies ruiler";
  ruilerStop.classList.toggle("hidden", !ruiler);
}

function kopVoor(sticker, code) {
  const naam = maak("p", "snelruil__naam");
  naam.append(maak("strong", "snelruil__code", code));
  if (sticker && sticker.naam) naam.append(" — " + sticker.naam);
  const land = maak("p", "snelruil__land", (sticker && sticker.land_naam) || "");
  return [naam, land];
}

// ---------- ruilen aan tafel ----------

// Enkel op een "zoek ik"-rij zonder gekozen ruiler: dat is de sticker die je
// wil krijgen, en dus het moment om te vragen met wie je ruilt.
function ruilKnop(code) {
  const knop = maak("button", "btn btn--outline btn--sm snelruil__ruil-knop", "Ruil voor sticker?");
  knop.type = "button";
  knop.addEventListener("click", (e) => {
    e.stopPropagation();
    void startRuilFlow(code);
  });
  return knop;
}

async function kiesEenRuiler() {
  let ruiler = null;
  try {
    ruiler = await kiesRuilerVenster({ eigenKindId: actiefKindId });
  } catch (err) {
    toonFout(err.message);
  }
  if (!ruiler) return null;
  kiesBundelRuiler(actiefKindId, ruiler);
  venster.invoer.focus();
  return ruiler;
}

async function startRuilFlow(code) {
  const bundel = huidigeBundel(actiefKindId);
  if (!(bundel && bundel.ruiler) && !(await kiesEenRuiler())) return;
  await koppelAanBundel(bekijkSticker(code), { handmatig: true });
}

// Past een gecontroleerde code bij de gekozen ruiler, dan komt ze in de
// bundel: zoek ik en hij heeft ze dubbel → jij krijgt ze; jouw dubbel en hij
// zoekt ze → hij krijgt ze. Twee keer dezelfde code typen haalt niets weg
// (voegToe, niet wisselSticker): controleren moet onschuldig blijven.
//
// Bij een ruiler zonder account weet het portaal niet wat hij heeft. Daar telt
// een controle dus niet vanzelf mee; een knop laat je zelf beslissen.
async function koppelAanBundel({ code, zoekt, dubbel }, { handmatig = false } = {}) {
  const bundel = huidigeBundel(actiefKindId);
  if (!bundel || !bundel.ruiler || modus !== "controleren") return;
  if (!zoekt && !(dubbel > 0)) return;
  const kant = zoekt ? "ik" : "ander";
  const naam = bundel.ruiler.naam;
  const inRuil = () => `→ Ruil ${ruilNummer(huidigeBundel(actiefKindId), kant, code)} met ${naam}`;

  if (bundel.ruiler.tijdelijk) {
    if (handmatig) {
      voegToe(actiefKindId, kant, code);
      bundelRegel(code, inRuil());
      return;
    }
    const knop = maak(
      "button",
      "btn btn--outline btn--sm",
      zoekt ? `+ In de ruil (je krijgt ${code})` : `+ In de ruil (je geeft ${code})`
    );
    knop.type = "button";
    knop.addEventListener("click", () => void koppelAanBundel({ code, zoekt, dubbel }, { handmatig: true }));
    bundelRegel(code, knop);
    return;
  }

  let rijen;
  try {
    rijen = await haalRuilkansen(actiefKindId);
  } catch (err) {
    return;
  }
  const richting = zoekt ? "jij_zoekt" : "jij_hebt_dubbel";
  const past = rijen.some((r) => r.ander_kind_id === bundel.ruiler.id && r.richting === richting && r.code === code);
  if (!past) {
    bundelRegel(code, zoekt ? `${naam} heeft ${code} niet dubbel — niet in de ruil.` : `${naam} zoekt ${code} niet — niet in de ruil.`);
    return;
  }
  voegToe(actiefKindId, kant, code);
  bundelRegel(code, inRuil());
}

// Onder het antwoord, maar enkel als dat antwoord nog over deze code gaat —
// wie intussen verder typte, zou anders een regel bij de verkeerde sticker
// zien. Dan komt een tekst in de hint.
function bundelRegel(code, inhoud) {
  const { resultaat } = venster;
  if (resultaat.dataset.code !== code || !resultaat.querySelector(".snelruil__antwoorden")) {
    if (typeof inhoud === "string") toonHint(inhoud);
    return;
  }
  resultaat.querySelector(".snelruil__bundelregel")?.remove();
  const regel = maak("p", "snelruil__bundelregel");
  regel.append(inhoud);
  resultaat.append(regel);
}

function tekenBundel() {
  if (!venster) return;
  const { bundelVak } = venster;
  bundelVak.textContent = "";
  const bundel = huidigeBundel(actiefKindId);
  const herstel = modus === "controleren" ? teHerstellen() : null;
  const toon = Boolean(bundel && bundel.ruiler && bundel.ruilen.length && modus === "controleren");
  bundelVak.classList.toggle("hidden", !toon && !herstel);
  if (herstel) {
    bundelVak.append(
      herstelMelding(herstel, {
        naHerstel: (b) => {
          if (b.eigenKindId !== actiefKindId && kinderen && kinderen.some((k) => k.id === b.eigenKindId)) {
            venster.kindKeuze.value = b.eigenKindId;
            void wisselKind(b.eigenKindId);
          }
        },
      })
    );
  }
  if (!toon) return;

  laadKandidaten(bundel);
  bundelVak.append(maak("h3", "snelruil__bundel-kop", "Voorgestelde ruilen"));
  bundelVak.append(maak("p", "form-meta form-meta--plat", `Links wat jij krijgt, rechts wat ${bundel.ruiler.naam} krijgt.`));

  const lijstEl = maak("ol", "snelruil__bundel-lijst");
  bundel.ruilen.forEach((ruil, index) => {
    const li = maak("li", "snelruil__bundel-ruil");
    const paar = maak("span", "snelruil__bundel-paar");
    paar.append(kantVeld(bundel, index, "ik"), " ⇄ ", kantVeld(bundel, index, "ander"));
    const weg = maak("button", "snelruil__bundel-weg", "✕");
    weg.type = "button";
    weg.setAttribute("aria-label", `Ruil ${index + 1} verwijderen`);
    weg.addEventListener("click", () => verwijderRuil(actiefKindId, index));
    li.append(maak("span", "ruilbadge", `Ruil ${index + 1}`), paar, weg);
    lijstEl.append(li);
  });
  bundelVak.append(lijstEl);

  const paren = volledigeParen(bundel);
  const knop = maak("button", "btn btn--primary btn--sm", paren.length > 1 ? `${paren.length} ruilen registreren` : "Ruil registreren");
  knop.type = "button";
  knop.disabled = paren.length === 0;
  knop.addEventListener("click", registreerBundel);
  bundelVak.append(knop);
}

// Een ingevulde kant is gewoon de code; een open kant een keuzelijst met wat
// er bij deze ruiler nog past — sneller dan de code opzoeken en typen.
function kantVeld(bundel, index, kant) {
  const code = bundel.ruilen[index][kant];
  if (code) return maak("strong", "", code);
  const gebruikt = new Set(bundel.ruilen.map((r) => r[kant]).filter(Boolean));
  const opties = kandidaten.sleutel === kandidatenSleutel(bundel) ? kandidaten[kant].filter((c) => !gebruikt.has(c)) : [];
  // Bij iemand zonder account kent het portaal zijn lijst niet: dan is typen
  // de enige weg, en dat mag er staan.
  if (!opties.length) {
    return maak("span", "snelruil__bundel-open", bundel.ruiler.tijdelijk ? (kant === "ik" ? "typ wat je krijgt" : "typ wat je geeft") : "…");
  }
  const keuze = maak("select", "form-input snelruil__bundel-keuze");
  keuze.setAttribute(
    "aria-label",
    kant === "ik" ? `Welke sticker krijg je in ruil ${index + 1}?` : `Welke dubbel geef je in ruil ${index + 1}?`
  );
  keuze.append(new Option("kies…", ""));
  opties.forEach((c) => keuze.append(new Option(c, c)));
  keuze.addEventListener("change", () => zetKant(actiefKindId, index, kant, keuze.value));
  return keuze;
}

function kandidatenSleutel(bundel) {
  return `${actiefKindId}|${bundel.ruiler.id}`;
}

function laadKandidaten(bundel) {
  if (bundel.ruiler.tijdelijk) return;
  const sleutel = kandidatenSleutel(bundel);
  if (kandidaten.sleutel === sleutel) return;
  kandidaten = { sleutel, ik: [], ander: [] };
  haalRuilkansen(actiefKindId).then(
    (rijen) => {
      if (kandidaten.sleutel !== sleutel) return;
      rijen
        .filter((r) => r.ander_kind_id === bundel.ruiler.id)
        .forEach((r) => (r.richting === "jij_zoekt" ? kandidaten.ik : kandidaten.ander).push(r.code));
      tekenBundel();
    },
    () => {
      if (kandidaten.sleutel === sleutel) kandidaten.sleutel = null;
    }
  );
}

function registreerBundel() {
  const bundel = huidigeBundel(actiefKindId);
  if (!bundel || !bundel.ruiler) return;
  const paren = volledigeParen(bundel);
  const ruiler = bundel.ruiler;
  const eigenKind = kinderen.find((k) => k.id === actiefKindId);
  openRuilBevestiging({
    eigenKind: { id: eigenKind.id, naam: eigenKind.voornaam },
    ruiler,
    paren,
    onGeregistreerd: () => {
      leegRuilen(actiefKindId);
      const { resultaat } = venster;
      resultaat.textContent = "";
      delete resultaat.dataset.code;
      const aantal = paren.length === 1 ? "1 ruil" : `${paren.length} ruilen`;
      resultaat.append(
        maak(
          "div",
          "message message--show",
          ruiler.tijdelijk
            ? `✓ ${aantal} met ${ruiler.naam} vastgelegd.`
            : `✓ ${aantal} met ${ruiler.naam} geregistreerd. ${ruiler.naam} moet nog bevestigen.`
        )
      );
      venster.invoer.focus();
    },
  });
}

// Groen en rood, maar nooit enkel kleur: ✓ en ✗ hebben een andere vorm, en de
// tekst zegt het nog eens. Een op twaalf jongens ziet rood en groen niet uit
// elkaar, en 🟢/🔴 zijn allebei gewoon een bolletje.
function tekenResultaat({ code, sticker, zoekt, dubbel }) {
  const { resultaat } = venster;
  resultaat.textContent = "";
  toonHint("");
  const antwoorden = maak("div", "snelruil__antwoorden");
  antwoorden.append(
    antwoordVak("Zoek ik?", zoekt, zoekt ? "Zoek ik" : "Zoek ik niet"),
    antwoordVak("Heb ik dubbel?", dubbel > 0 ? "dub" : false, dubbelTekst(dubbel))
  );
  resultaat.dataset.code = code;
  resultaat.append(...kopVoor(sticker, code), antwoorden);
  const bundel = huidigeBundel(actiefKindId);
  if (zoekt && !(bundel && bundel.ruiler)) resultaat.append(ruilKnop(code));
}

function tekenInboeking(regel) {
  const { resultaat } = venster;
  resultaat.textContent = "";
  toonHint("");
  const vak = antwoordVak("Ingeboekt", true, "Toegevoegd");
  vak.append(maak("span", "snelruil__detail", inboekDetail(regel)));
  // 0 → 1 is het geval waar de afleiding "niet gezocht = al in het album" kan
  // mislopen. Dat zeggen, in plaats van het stil aan te nemen.
  if (regel.soort === "dubbel" && regel.van === 0) {
    vak.append(maak("span", "snelruil__detail", "Stond niet in Zoek ik, dus je had hem al."));
  }
  resultaat.append(...kopVoor(regel.sticker, regel.code), vak);
}

function tekenOngedaan(regel) {
  const { resultaat } = venster;
  resultaat.textContent = "";
  toonHint("");
  const terug =
    regel.soort === "uitZoek"
      ? "Terug in Zoek ik"
      : regel.van === 0
      ? "Weer geen dubbel"
      : `Dubbels terug naar ${regel.van}`;
  const vak = antwoordVak("Ongedaan gemaakt", true, `↩ ${regel.code}`, { teken: "" });
  vak.append(maak("span", "snelruil__detail", terug));
  resultaat.append(vak);
}

function inboekDetail(regel) {
  return regel.soort === "uitZoek" ? "Verwijderd uit Zoek ik" : `Aantal dubbels verhoogd: ${regel.van} → ${regel.naar}`;
}

// `stand` is true (groen, "ja"), false (rood, "nee") of "dub" (geel, dubbel).
function standKlasse(stand) {
  return stand === "dub" ? "snelruil--dub" : stand ? "snelruil--ja" : "snelruil--nee";
}

function antwoordVak(vraag, stand, tekst, { teken = stand ? "✓ " : "✗ " } = {}) {
  const vak = maak("div", "snelruil__antwoord " + standKlasse(stand));
  vak.append(maak("span", "snelruil__vraag", vraag));
  vak.append(maak("span", "snelruil__uitkomst", teken + tekst));
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
  const bundel = huidigeBundel(actiefKindId);
  historiek.forEach((regel) => {
    const { stand, tekst, klasse } = historiekRegel(regel);
    const li = maak("li", `snelruil__regel ${standKlasse(stand)} ${klasse}`);
    li.append(maak("strong", "snelruil__code", regel.code), maak("span", "", tekst));
    if (regel.soort === "controle") {
      const kant = regel.zoekt ? "ik" : regel.dubbel > 0 ? "ander" : null;
      const nummer = kant ? ruilNummer(bundel, kant, regel.code) : 0;
      if (nummer) li.append(maak("span", "ruilbadge snelruil__regel-badge", `Ruil ${nummer}`));
      else if (regel.zoekt && !(bundel && bundel.ruiler)) li.append(ruilKnop(regel.code));
    }
    historiekLijst.append(li);
  });
}

function historiekRegel(regel) {
  if (regel.soort === "controle") {
    const { zoekt, dubbel } = regel;
    const stand = zoekt ? true : dubbel > 0 ? "dub" : false;
    const tekst = zoekt ? "zoek ik" : dubbel > 0 ? dubbelTekst(dubbel).toLowerCase() : "zoek ik niet, geen dubbel";
    return { stand, tekst: (stand ? "✓ " : "✗ ") + tekst, klasse: "" };
  }
  const kort = regel.soort === "uitZoek" ? "verwijderd uit Zoek ik" : `dubbel verhoogd naar ${regel.naar}`;
  if (regel.toestand === "fout") return { stand: false, tekst: "✗ niet bewaard", klasse: "" };
  if (regel.toestand === "ongedaan") return { stand: true, tekst: "↩ ongedaan: " + kort, klasse: "snelruil__regel--ongedaan" };
  return { stand: true, tekst: "✓ " + kort, klasse: "" };
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
