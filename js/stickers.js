// stickers.js — Kinddetail-pagina: stickers beheren voor één verzamelaar.
//
// Twee statussen, meer niet: ZOEKT ("zoek ik") en RUILT ("heb ik dubbel", met
// een aantal). Wat een kind al in het album heeft plakken we niet bij: dat is
// werk zonder opbrengst, want ruilen draait enkel om zoeken en dubbels.
//
// De sticker wordt gekozen uit public.sticker_catalogus in plaats van vrij
// ingetypt, zodat er geen tikfouten of onbestaande nummers in de lijst
// belanden. De kolom stickers.nummer bewaart de catalogus-CODE (bv. "BEL7").
//
// CHECKLIST PER LAND, NIET ÉÉN STICKER TEGELIJK. Vroeger moest je per sticker
// zoeken, aanklikken, een status kiezen en opslaan — voor twintig stickers dus
// twintig keer hetzelfde rondje. Nu kies je één land en vink je alles in één
// doorloop aan. "Zoek ik" en dubbel sluiten elkaar uit per sticker — dat is
// geen UI-beperking maar de databank: één rij per (kind, sticker), met precies
// één status.
//
// AUTOSAVE. Er valt niets te verliezen: elke klik gaat meteen in
// pendingChanges en wordt een halve seconde later weggeschreven (debounce, dus
// vijf keer op + is één aanvraag). Van land wisselen schrijft eerst weg; een
// tabblad dat sluit vóór de ronde klaar is, laat zijn wachtrij in localStorage
// achter en die gaat er bij de volgende lading alsnog in. De knop "Bewaar
// wijzigingen" blijft bestaan om nú te schrijven in plaats van straks, en
// "Ongedaan maken" draait de laatste klik terug via een undo-stapel.
import { supabase, requireAuth } from "./supabase.js";
import { getKind } from "./kinderen.js";
import {
  accentVoor,
  vergelijkLanden,
  normaliseer,
  landMatcht,
} from "./landen-data.js";
import { maakLandcombo } from "./landcombo.js";

const TABEL = "stickers";
const STATUS_TEKST = { ZOEKT: "zoek ik", RUILT: "heb ik dubbel" };
const PAGINA = 1000; // PostgREST levert maximaal 1000 rijen per aanvraag

// Hoe lang we na de laatste klik wachten voor we schrijven. Wie vijf keer op +
// tikt, stuurt zo één aanvraag in plaats van vijf. Lang genoeg om reeksen
// klikken samen te nemen, kort genoeg om niet als "niet bewaard" te voelen.
const AUTOSAVE_MS = 500;

// Uitstel van het zoeken naar stickers en spelers. Kort, want er gaat geen
// aanvraag uit: de catalogus staat al in het geheugen en we filteren gewoon
// een lijst. Dezelfde 150 ms als het herschikken van de wereldkaart
// (js/wereldkaart.js) — genoeg om niet bij elke aanslag de hele lijst te
// hertekenen, te kort om als vertraging te voelen. De 500 ms hierboven is van
// een andere orde: die spaart netwerkaanvragen uit.
const ZOEK_UITSTEL_MS = 150;

// Hoeveel zoekresultaten er onder het veld passen voor het een lijst wordt
// waar je doorheen moet scrollen. Wat er niet bij staat, wordt geteld ("+ 34
// extra resultaten") — dat is het signaal om verder te typen.
const ZOEK_MAX = 20;

// Hoe lang een aangeklikte sticker opgelicht blijft staan. Lang genoeg om hem
// terug te vinden na het scrollen, kort genoeg om niet te blijven roepen.
const MARKEER_MS = 3000;

// Voorvoegsel van het DOM-id van een chip (zie chipId), ook gebruikt om van
// een chip-element terug naar zijn code te rekenen (pasZoekMarkeringToe).
const CHIP_ID_PREFIX = "sticker-chip-";

// Vangnet voor het geval het tabblad sluit vóór de laatste schrijfronde klaar
// is: wat nog openstaat gaat naar localStorage en wordt bij de volgende
// paginalading alsnog weggeschreven. Per kind, want je kan van kind wisselen.
const CACHE_PREFIX = "panini-stickers-openstaand";

let kindId;
let catalogus = [];
let catalogusPerCode = new Map();
let landen = []; // één rij per land: code, namen, paginanummer
let landcombo; // de landkeuze waarin je kan typen (js/landcombo.js)
let sorteerwijze = "pagina";
let huidigeStickers = [];
let statusPerCode = new Map(); // code -> status van DIT kind
let aantalPerCode = new Map(); // code -> aantal dubbels van DIT kind

// De checklist van het momenteel gekozen land. checklistState is de live,
// bewerkbare stand (wat de gebruiker nu aanvinkt/optelt); origineelState is
// de databankstand van datzelfde land, de lat waartegen "nog niet bewaard"
// gemeten wordt. Allebei Map<code, {gezocht, dubbel}>.
let huidigLand = "";
let checklistState = new Map();
let origineelState = new Map();

// AUTOSAVE. pendingChanges is de enige waarheid over "wat moet er nog naar de
// databank": code -> {gezocht, dubbel}, de gewenste eindtoestand. Ze loopt
// bewust over landen heen — mislukt een schrijfronde vlak voor je van land
// wisselt, dan blijft die wijziging gewoon in de rij staan tot ze lukt.
// origineelState blijft daarnaast de databankstand van het huidige land,
// waartegen de checklist zich meet.
let pendingChanges = new Map();
// Elke actie legt de VORIGE toestand van die ene sticker op de stapel; undo
// pakt er telkens één af. Per sticker, niet per lijst: dat is wat "laatste
// wijziging ongedaan maken" voor een gebruiker betekent.
let undoStack = [];
let autosaveTimer = null;
let autosaveBezig = false;

// Het zoeken naar stickers en spelers over alle landen heen, opgesplitst in
// twee groepen. zoekResultaten zijn de treffers bij een ANDER land dan het
// geopende: die staan in de lijst onder het veld (afgekapt op ZOEK_MAX) en
// vragen een klik of Enter om te wisselen van land. zoekBinnenLand zijn de
// treffers bij het land dat al open staat: die krijgen geen lijst, want ze
// zijn al zichtbaar — ze worden rechtstreeks gemarkeerd in de checklist
// (pasZoekMarkeringToe). zoekActief is de rij in zoekResultaten die met de
// pijltjes aangeduid is en die Enter kiest.
let zoekResultaten = [];
let zoekBinnenLand = [];
let zoekActief = -1;
let zoekTimer = null;
let markeerTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
  const zone = document.getElementById("sticker-checklist");
  if (!zone) return;

  const user = await requireAuth();
  if (!user) return;

  kindId = new URLSearchParams(window.location.search).get("id");
  if (!kindId) {
    window.location.href = "/dashboard.html";
    return;
  }

  // De exportknop staat al in de navigatiebalk, maar weet zonder deze regel
  // niet over wie het gaat. Pas hier ingevuld, want kindId komt uit de URL.
  const exportLink = document.getElementById("export-ruilfiche");
  if (exportLink) exportLink.href = `/print/ruilfiche.html?kind=${encodeURIComponent(kindId)}`;

  try {
    const kind = await getKind(kindId);
    document.getElementById("kind-naam").textContent = `${kind.voornaam} ${kind.familienaam}`;
    document.getElementById("kind-geboortejaar").textContent = kind.is_volwassen
      ? "Volwassen verzamelaar"
      : kind.geboortejaar
      ? "Geboortejaar: " + kind.geboortejaar
      : "";
  } catch (err) {
    document.getElementById("kind-naam").textContent = "Kind niet gevonden.";
    document.getElementById("sticker-kaart").classList.add("hidden");
    return;
  }

  // De sorteervolgorde komt uit de keuzelijst zelf, zodat de standaard maar op
  // één plek staat (kind.html) en de lijst hier nooit anders geordend raakt
  // dan wat er in het vakje "Volgorde" te lezen valt.
  const sorteerKiezer = document.getElementById("sticker-sortering");
  sorteerwijze = sorteerKiezer.value;
  landcombo = maakLandcombo({
    wortel: document.getElementById("sticker-landcombo"),
    opKies: () => void wisselLand(),
  });

  try {
    const toonGlans = await glansstickersAan();
    catalogus = await laadCatalogus();
    // catalogusPerCode bevat wél alles: een kind dat vroeger BEL2s invoerde,
    // moet die regel in zijn lijst nog steeds met naam zien staan.
    catalogusPerCode = new Map(catalogus.map((s) => [s.code, s]));
    if (!toonGlans) catalogus = catalogus.filter((s) => !s.glans);
    verzamelLanden();
    vulLandcombo();
  } catch (err) {
    toonMelding("Stickerlijst kon niet geladen worden: " + err.message, "error");
  }

  sorteerKiezer.addEventListener("change", wisselSortering);
  koppelZoekveld();
  document.getElementById("sticker-bewaar-btn").addEventListener("click", () => synchroniseer());
  document.getElementById("sticker-annuleer-btn").addEventListener("click", maakOngedaan);

  bewaakVerlaten();

  // Bleef er van een vorige keer iets openstaan (tabblad gesloten vóór de
  // laatste schrijfronde klaar was), dan gaat dat er nu alsnog in — vóór
  // ververs(), zodat de lijsten meteen de bijgewerkte stand tonen.
  herstelLokaleCache();
  if (pendingChanges.size) await synchroniseer();

  await ververs();
});

// Bij het sluiten van het tabblad is een gewone async-aanroep niet meer
// betrouwbaar. Daarom twee netten: visibilitychange vuurt op mobiel wél
// betrouwbaar bij het wegklikken, en wat dan nog openstaat is via
// localStorage bij de volgende lading terug op te halen.
function bewaakVerlaten() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && pendingChanges.size) void synchroniseer();
  });
  window.addEventListener("beforeunload", (e) => {
    if (!pendingChanges.size) return;
    void synchroniseer();
    e.preventDefault();
    e.returnValue = "";
  });
}

// ---------- catalogus ----------

// De Europese albums hebben geen glansvarianten (BEL2s naast BEL2). Of ze
// meetellen staat in public.instellingen en is te wijzigen op de
// instellingenpagina. Bestaat de kolom nog niet, dan houden we ze verborgen:
// dat is het geval waar deze schakelaar voor bedoeld is.
async function glansstickersAan() {
  const { data, error } = await supabase
    .from("instellingen")
    .select("toon_glans")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return false;
  return Boolean(data.toon_glans);
}

async function laadCatalogus() {
  const alles = [];
  for (let van = 0; ; van += PAGINA) {
    const { data, error } = await supabase
      .from("sticker_catalogus")
      .select("categorie,land_code,land_naam,land_naam_en,pagina,nummer,code,naam,glans")
      .order("land_code", { ascending: true })
      .order("nummer", { ascending: true })
      .order("glans", { ascending: true })
      .range(van, van + PAGINA - 1);
    if (error) throw error;
    alles.push(...data);
    if (data.length < PAGINA) return alles;
  }
}

// Eén rij per land uit de catalogus: code, beide namen en het paginanummer.
// Dat laatste komt uit sql/013 en bepaalt de albumvolgorde.
function verzamelLanden() {
  const perCode = new Map();
  catalogus.forEach((s) => {
    if (perCode.has(s.land_code)) return;
    perCode.set(s.land_code, {
      land_code: s.land_code,
      land_naam: s.land_naam,
      land_naam_en: s.land_naam_en,
      pagina: s.pagina,
    });
  });
  landen = [...perCode.values()];
}

// De landen gaan gesorteerd naar de keuzelijst; die filtert er tijdens het
// typen enkel nog rijen uit en laat de volgorde met rust. Zo blijft wat de
// gebruiker bij "Volgorde" instelde ook tijdens het zoeken gelden.
//
// De keuzelijst zet er zelf het paginanummer bij ("BEL - BELGIUM - België
// (p.56)"): bij een land hoort dat, want het wijst de weg in het fysieke
// album. Bij een sticker niet — zie omschrijving() hieronder.
function vulLandcombo() {
  landcombo.zetLanden(landen.slice().sort((a, b) => vergelijkLanden(a, b, sorteerwijze)));
}

function wisselSortering() {
  sorteerwijze = document.getElementById("sticker-sortering").value;
  vulLandcombo();
  // De zoekresultaten volgen dezelfde volgorde en moeten dus mee herschikken.
  zoek();
}

// "BEL3 — Kevin De Bruyne". Zonder paginanummer, ook al staat dat in de rij:
// de albumpagina hoort bij het land en niet bij de sticker. Ze bij elke
// stickerregel herhalen zou suggereren dat net die sticker daar staat, en dat
// klopt niet — een land beslaat meerdere bladzijden.
function omschrijving(sticker) {
  const glans = sticker.glans ? " ✨" : "";
  return sticker.naam ? `${sticker.code}${glans} — ${sticker.naam}` : sticker.code + glans;
}

// ---------- checklist per land ----------

// Van land wisselen schrijft eerst weg wat er nog openstaat. Lukt dat niet
// (netwerk weg), dan blijft het in pendingChanges staan en wordt het later
// alsnog verstuurd — de wissel gaat gewoon door, er gaat niets verloren.
async function wisselLand() {
  if (pendingChanges.size) await synchroniseer();
  kiesLand();
}

// Bouwt checklistState/origineelState opnieuw op vanaf de databankstand
// (statusPerCode/aantalPerCode), met daarbovenop alles wat nog in
// pendingChanges staat. Die laatste laag is er voor het geval een schrijfronde
// faalde: dan toont het scherm nog steeds wat de gebruiker bedoelde, niet de
// verouderde databankstand. origineelState blijft wél de kale databankstand —
// dat is de lat waartegen "nog niet bewaard" gemeten wordt.
function kiesLand() {
  huidigLand = landcombo.waarde();

  // De accentkleur van het land staat op de kaart die de checklist bevat;
  // alles erin erft ze via var(--land-accent). Zo hoeft de kleur niet per chip
  // gezet te worden en verandert ze in één keer mee bij een ander land.
  document
    .getElementById("sticker-kaart")
    .style.setProperty("--land-accent", accentVoor(huidigLand));

  checklistState = new Map();
  origineelState = new Map();
  if (huidigLand) {
    catalogus
      .filter((s) => s.land_code === huidigLand)
      .forEach((s) => {
        const status = statusPerCode.get(s.code);
        const uitDatabank = {
          gezocht: status === "ZOEKT",
          dubbel: status === "RUILT" ? aantalPerCode.get(s.code) || 1 : 0,
        };
        const openstaand = pendingChanges.get(s.code);
        checklistState.set(s.code, { ...(openstaand || uitDatabank) });
        origineelState.set(s.code, { ...uitDatabank });
      });
  }
  tekenChecklist();
}

// Toont altijd ALLE stickers van het gekozen land, ongefilterd — er is geen
// apart zoekveld meer dat hier rijen uit weghaalt. Het globale zoekveld
// hierboven markeert in plaats daarvan de treffers rechtstreeks in deze
// volledige lijst (pasZoekMarkeringToe hieronder), dus na elke herbouw wordt
// die markering opnieuw gezet: staat er nog een zoekterm, dan moet die na een
// nieuw land of een undo weer op de juiste chips staan.
function tekenChecklist() {
  const ul = document.getElementById("sticker-checklist");
  const teller = document.getElementById("sticker-teller");
  const leeg = document.getElementById("sticker-leeg");
  ul.innerHTML = "";

  if (!huidigLand) {
    teller.textContent = "";
    leeg.classList.remove("hidden");
    bijwerkenBewaarbalk();
    return;
  }
  leeg.classList.add("hidden");

  const stickersVanLand = catalogus.filter((s) => s.land_code === huidigLand);
  teller.textContent = `${stickersVanLand.length} sticker${stickersVanLand.length === 1 ? "" : "s"}`;
  stickersVanLand.forEach((sticker) => ul.appendChild(bouwChip(sticker)));

  pasZoekMarkeringToe();
  bijwerkenBewaarbalk();
}

// Eén chip = één sticker: de code vet bovenaan, de spelersnaam eronder op een
// eigen regel, en daaronder pas de bediening. Dat is drie regels in plaats van
// één, maar de naam past er wel volledig op — afgekapte namen als
// "CIV1 — Embl…" maakten de lijst onbruikbaar zonder er telkens over te hoveren.
//
// Wijzigingen passen enkel checklistState aan en werken hun eigen DOM-stukje
// bij — geen volledige herbouw van de lijst per klik, dat zou de focus van de
// gebruiker telkens kwijtraken.
function bouwChip(sticker) {
  const staat = checklistState.get(sticker.code);
  const li = document.createElement("li");
  li.className = "sticker-chip";
  // Een eigen id en tabindex=-1 maken de chip het doelwit van een
  // zoekresultaat: springen, oplichten en focus krijgen (toonSticker()). In de
  // tabvolgorde komt hij daarmee niet — daar staan de vinkjes en knopjes al.
  li.id = chipId(sticker.code);
  li.tabIndex = -1;

  const code = document.createElement("span");
  code.className = "sticker-chip__code";
  code.textContent = sticker.code + (sticker.glans ? " ✨" : "");
  li.appendChild(code);

  if (sticker.naam) {
    const naam = document.createElement("span");
    naam.className = "sticker-chip__naam";
    naam.textContent = sticker.naam;
    li.appendChild(naam);
  }

  const regel = document.createElement("div");
  regel.className = "sticker-chip__regel";

  const vinkLabel = document.createElement("label");
  vinkLabel.className = "sticker-chip__vink";
  const vink = document.createElement("input");
  vink.type = "checkbox";
  vink.checked = staat.gezocht;
  vinkLabel.appendChild(vink);
  vinkLabel.appendChild(document.createTextNode("Zoek ik"));
  regel.appendChild(vinkLabel);

  const stepper = document.createElement("div");
  stepper.className = "sticker-stepper";
  stepper.setAttribute("role", "group");
  stepper.setAttribute("aria-label", "Aantal dubbel van " + omschrijving(sticker));

  const min = document.createElement("button");
  min.type = "button";
  min.className = "sticker-stepper__knop";
  min.textContent = "−";
  min.setAttribute("aria-label", "Eén dubbel minder");

  const getal = document.createElement("span");
  getal.className = "sticker-stepper__aantal";
  getal.textContent = String(staat.dubbel);

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "sticker-stepper__knop";
  plus.textContent = "+";
  plus.setAttribute("aria-label", "Eén dubbel meer");

  // De status zit in de ACHTERGROND, de landkleur in de rand: zo blijft
  // zichtbaar bij welk land een sticker hoort terwijl zijn status verandert.
  function verversChip() {
    vink.checked = staat.gezocht;
    getal.textContent = String(staat.dubbel);
    min.disabled = staat.dubbel <= 0;
    li.classList.toggle("sticker-chip--gezocht", staat.gezocht);
    li.classList.toggle("sticker-chip--dubbel", staat.dubbel > 0);
    bijwerkenBewaarbalk();
  }

  vink.addEventListener("change", () => {
    const vorige = { ...staat };
    staat.gezocht = vink.checked;
    // Aanvinken als gezocht en tegelijk een dubbel-aantal >0 laten staan zou
    // "ik zoek 'm én ik heb 'm dubbel" betekenen — dat kan de databank niet
    // vastleggen (één status per rij), dus resetten we het aantal.
    if (staat.gezocht) staat.dubbel = 0;
    verversChip();
    registreerWijziging(sticker.code, vorige);
  });
  min.addEventListener("click", () => {
    if (staat.dubbel <= 0) return;
    const vorige = { ...staat };
    staat.dubbel -= 1;
    verversChip();
    registreerWijziging(sticker.code, vorige);
  });
  plus.addEventListener("click", () => {
    const vorige = { ...staat };
    staat.dubbel += 1;
    // Omgekeerde reset: een dubbel-aantal instellen terwijl "gezocht" nog
    // aanstond, zou dezelfde tegenstrijdigheid geven.
    if (staat.gezocht) staat.gezocht = false;
    verversChip();
    registreerWijziging(sticker.code, vorige);
  });

  // Beginstand: dezelfde opmaak als na een klik, zonder de bewaarbalk te
  // laten herrekenen voor elke chip die getekend wordt.
  min.disabled = staat.dubbel <= 0;
  li.classList.toggle("sticker-chip--gezocht", staat.gezocht);
  li.classList.toggle("sticker-chip--dubbel", staat.dubbel > 0);

  stepper.appendChild(min);
  stepper.appendChild(getal);
  stepper.appendChild(plus);
  regel.appendChild(stepper);
  li.appendChild(regel);

  return li;
}

// ---------- zoeken naar een sticker of speler ----------

// De tweede weg naar een sticker. De eerste blijft "kies een land en vink af";
// deze is voor wie al weet wélke sticker hij zoekt en niet eerst wil uitzoeken
// bij welk land Musiala hoort. Zoekt daarom over alle landen heen.
//
// Twee uitkomsten, geen tussenstap. Hoort de treffer bij het land dat al open
// staat, dan is hij al zichtbaar in de (ongefilterde) checklist eronder — die
// krijgt gewoon een blauwe rand terwijl je typt, zonder klik. Er is dus geen
// apart "zoeken binnen dit land"-veldje meer: dat deed precies hetzelfde,
// alleen via filteren (rijen verbergen) in plaats van markeren. Hoort de
// treffer bij een ANDER land, dan kán hij niet zomaar verschijnen — het land
// moet nog wisselen — en daarvoor blijft de resultatenlijst onder het veld
// staan: die aanklikken (of Enter) kiest het land en springt naar de sticker.
//
// Alles gebeurt in het geheugen: de catalogus staat er al, dus er gaat geen
// aanvraag uit en de lijst kan bij elke aanslag mee.
function koppelZoekveld() {
  const veld = document.getElementById("sticker-globaalzoek");
  const lijst = document.getElementById("sticker-globaalresultaten");

  veld.addEventListener("input", plangZoek);
  veld.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      veld.value = "";
      zoek();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (zoekResultaten.length > 0) {
        // Zonder pijltjes gebruikt: dan is de bovenste rij bedoeld. Dat is
        // ook het geval waar er maar één resultaat overblijft.
        void kiesZoekresultaat(zoekResultaten[Math.max(zoekActief, 0)]);
      } else if (zoekBinnenLand.length > 0) {
        // Niets om naar te wisselen — de treffer staat al in de checklist
        // hieronder en is al gemarkeerd. Enter geeft er dan gewoon focus aan,
        // zodat ook wie met het toetsenbord werkt er meteen bij kan.
        toonSticker(zoekBinnenLand[0].code);
      }
      return;
    }
    if (zoekResultaten.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        zetZoekActief(zoekActief + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        zetZoekActief(zoekActief - 1);
        break;
      // Home en End blijven met opzet van de tekst zelf: dit is een zoekveld
      // waar je in typt, en de cursor naar het begin van je zoekterm brengen
      // hoort daar te blijven werken.
      default:
        break;
    }
  });

  // Zelfde reden als bij de landkeuzelijst: de muisknop indrukken op een
  // <li> haalt anders de focus uit het zoekveld weg.
  lijst.addEventListener("mousedown", (e) => e.preventDefault());
  lijst.addEventListener("click", (e) => {
    const rij = e.target.closest(".zoekresultaat");
    if (rij) void kiesZoekresultaat(catalogusPerCode.get(rij.dataset.code));
  });
}

function plangZoek() {
  clearTimeout(zoekTimer);
  zoekTimer = setTimeout(zoek, ZOEK_UITSTEL_MS);
}

// Stickernummer, code, spelersnaam en het team waar hij voor speelt — dat
// laatste is bij dit album gewoon het land, dus daar mag "Germany",
// "Duitsland" en "GER" alle drie voor gebruikt worden.
function stickerMatcht(sticker, term) {
  return (
    normaliseer(sticker.code).includes(term) ||
    String(sticker.nummer) === term ||
    normaliseer(sticker.naam).includes(term) ||
    landMatcht(sticker, term)
  );
}

function zoek() {
  clearTimeout(zoekTimer);
  const term = normaliseer(document.getElementById("sticker-globaalzoek").value.trim());
  if (!term) {
    zoekResultaten = [];
    zoekBinnenLand = [];
    pasZoekMarkeringToe();
    tekenZoekresultaten(0, 0, "");
    return;
  }
  const treffers = catalogus.filter((s) => stickerMatcht(s, term));
  // Dezelfde volgorde als de landkeuzelijst: zoeken filtert/splitst, het
  // sorteert de gevonden landen niet anders dan ingesteld.
  zoekBinnenLand = huidigLand
    ? treffers.filter((s) => s.land_code === huidigLand).sort(vergelijkCatalogus)
    : [];
  const andereLanden = (huidigLand ? treffers.filter((s) => s.land_code !== huidigLand) : treffers).sort(
    vergelijkCatalogus
  );
  zoekResultaten = andereLanden.slice(0, ZOEK_MAX);
  pasZoekMarkeringToe();
  tekenZoekresultaten(andereLanden.length, treffers.length, term);
}

function vergelijkCatalogus(a, b) {
  return vergelijkLanden(a, b, sorteerwijze) || a.nummer - b.nummer;
}

// Zet de blauwe rand op elke chip van het geopende land die met de huidige
// zoekterm matcht, en haalt hem weg bij de rest. Draait na elke aanslag én na
// elke herbouw van de checklist (tekenChecklist) — die laatste is nodig omdat
// een nieuw land of een undo de chips vervangt door verse exemplaren zonder
// de klasse.
function pasZoekMarkeringToe() {
  const term = normaliseer(document.getElementById("sticker-globaalzoek").value.trim());
  const treffers =
    term && huidigLand
      ? new Set(
          catalogus.filter((s) => s.land_code === huidigLand && stickerMatcht(s, term)).map((s) => s.code)
        )
      : new Set();
  document.querySelectorAll("#sticker-checklist .sticker-chip").forEach((chip) => {
    const code = chip.id.slice(CHIP_ID_PREFIX.length);
    chip.classList.toggle("sticker-chip--zoektreffer", treffers.has(code));
  });
}

function tekenZoekresultaten(totaalAndereLanden, totaalTreffers, term) {
  const veld = document.getElementById("sticker-globaalzoek");
  const lijst = document.getElementById("sticker-globaalresultaten");
  const meer = document.getElementById("sticker-globaalmeer");

  lijst.innerHTML = "";
  zoekActief = -1;
  veld.removeAttribute("aria-activedescendant");
  veld.setAttribute("aria-expanded", String(zoekResultaten.length > 0));
  lijst.classList.toggle("hidden", zoekResultaten.length === 0);

  zoekResultaten.forEach((sticker, i) => {
    const rij = document.createElement("li");
    rij.className = "zoekresultaat";
    rij.id = "sticker-zoekresultaat-" + i;
    rij.setAttribute("role", "option");
    rij.setAttribute("aria-selected", "false");
    rij.dataset.code = sticker.code;
    rij.textContent = omschrijving(sticker);
    lijst.appendChild(rij);
  });

  // Onderregel: ofwel hoeveel er niet getoond worden, ofwel dat er nergens
  // een match is. Allebei nieuws waar je iets mee doet — verder typen — dus
  // staat het in een aria-live-gebied en niet enkel in beeld. Zit alles wat
  // gevonden werd al in het geopende land (totaalAndereLanden 0, maar
  // totaalTreffers > 0), dan blijft dit gebied leeg: de markering in de
  // checklist hieronder is dan het enige signaal, en dat volstaat.
  const extra = totaalAndereLanden - zoekResultaten.length;
  if (!term) meer.textContent = "";
  else if (totaalTreffers === 0) meer.textContent = "Geen stickers gevonden.";
  else if (extra > 0) meer.textContent = `+ ${extra} extra resultaten — typ verder om te verfijnen.`;
  else meer.textContent = "";
  meer.classList.toggle("hidden", meer.textContent === "");
}

function zetZoekActief(index) {
  if (zoekResultaten.length === 0) return;
  zoekActief = Math.min(Math.max(index, 0), zoekResultaten.length - 1);
  const lijst = document.getElementById("sticker-globaalresultaten");
  [...lijst.children].forEach((el, i) => {
    el.classList.toggle("zoekresultaat--actief", i === zoekActief);
    el.setAttribute("aria-selected", String(i === zoekActief));
  });
  const el = lijst.children[zoekActief];
  if (!el) return;
  document.getElementById("sticker-globaalzoek").setAttribute("aria-activedescendant", el.id);
  el.scrollIntoView({ block: "nearest" });
}

// Een resultaat aanklikken doet in één beweging alles wat je anders met de
// hand moest doen: het juiste land kiezen, de checklist laden en naar die ene
// sticker toe. zoekResultaten bevat per definitie enkel ANDERE landen dan het
// geopende (zoek() splitst dat al), dus hier hoeft nooit gecontroleerd te
// worden of het land al klopt. De zoekresultaten blijven na de sprong staan,
// zodat je meteen naar de volgende treffer kan springen.
async function kiesZoekresultaat(sticker) {
  if (!sticker) return;
  landcombo.zetWaarde(sticker.land_code);
  await wisselLand(); // schrijft eerst weg wat nog openstond
  toonSticker(sticker.code);
}

function chipId(code) {
  return CHIP_ID_PREFIX + code;
}

// Erheen scrollen alleen volstaat niet: in een raster van tweehonderd chips
// die op elkaar lijken, is "ergens in het midden" nog steeds zoeken. Daarom
// ook oplichten en de focus geven — dan weet ook wie met het toetsenbord
// werkt of een schermlezer gebruikt waar hij beland is.
function toonSticker(code) {
  const chip = document.getElementById(chipId(code));
  if (!chip) return;
  clearTimeout(markeerTimer);
  document
    .querySelectorAll(".sticker-chip--gevonden")
    .forEach((el) => el.classList.remove("sticker-chip--gevonden"));
  chip.classList.add("sticker-chip--gevonden");
  chip.scrollIntoView({ block: "center", behavior: "smooth" });
  // preventScroll, anders vecht de focus met het zachte scrollen hierboven.
  chip.focus({ preventScroll: true });
  markeerTimer = setTimeout(() => chip.classList.remove("sticker-chip--gevonden"), MARKEER_MS);
}

// ---------- autosave ----------

// Eén klik = één opdracht: leg de vorige toestand op de undo-stapel, zet de
// nieuwe in de wachtrij naar de databank, en plan een schrijfronde.
function registreerWijziging(code, vorige) {
  undoStack.push({ code, vorige });
  markeerOpenstaand(code);
  bewaarLokaleCache();
  bijwerkenBewaarbalk();
  plangAutosave();
}

// Staat de nieuwe waarde toevallig weer gelijk aan wat er in de databank
// staat (typisch na een undo), dan hoeft er niets geschreven te worden en
// gaat de code weer uit de wachtrij.
function markeerOpenstaand(code) {
  const nu = checklistState.get(code);
  const was = origineelState.get(code);
  if (was && was.gezocht === nu.gezocht && was.dubbel === nu.dubbel) pendingChanges.delete(code);
  else pendingChanges.set(code, { ...nu });
}

function plangAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => void synchroniseer(), AUTOSAVE_MS);
}

// Schrijft alles weg wat openstaat: één upsert voor wat gezocht of dubbel
// wordt, één delete voor wat terug naar "heb ik" gaat — ongeacht hoeveel
// stickers er gewijzigd zijn. onConflict laat de unieke index
// (kind_id, nummer) het werk doen: bestaat de rij al, dan wordt ze bijgewerkt.
async function synchroniseer() {
  clearTimeout(autosaveTimer);
  if (pendingChanges.size === 0) return;

  // Loopt er al een ronde, dan wachten we die af en plannen we opnieuw:
  // twee gelijktijdige schrijfrondes op dezelfde rijen zouden elkaar kunnen
  // overschrijven met een verouderde waarde.
  if (autosaveBezig) {
    plangAutosave();
    return;
  }
  autosaveBezig = true;

  // Momentopname: wat de gebruiker ná dit punt nog aanklikt, hoort bij de
  // volgende ronde en mag hier niet als "bewaard" afgevinkt worden.
  const batch = new Map(pendingChanges);
  const upsert = [];
  const verwijder = [];
  for (const [code, staat] of batch) {
    if (staat.gezocht || staat.dubbel > 0) {
      upsert.push({
        kind_id: kindId,
        nummer: code,
        status: staat.gezocht ? "ZOEKT" : "RUILT",
        aantal: staat.gezocht ? 1 : staat.dubbel,
      });
    } else {
      verwijder.push(code);
    }
  }

  bijwerkenBewaarbalk();
  try {
    if (upsert.length) {
      const { error } = await supabase.from(TABEL).upsert(upsert, { onConflict: "kind_id,nummer" });
      if (error) throw error;
    }
    if (verwijder.length) {
      const { error } = await supabase
        .from(TABEL)
        .delete()
        .eq("kind_id", kindId)
        .in("nummer", verwijder);
      if (error) throw error;
    }

    // Enkel afvinken wat sinds de momentopname niet opnieuw gewijzigd is.
    for (const [code, staat] of batch) {
      const huidig = pendingChanges.get(code);
      if (huidig && huidig.gezocht === staat.gezocht && huidig.dubbel === staat.dubbel) {
        pendingChanges.delete(code);
      }
      // De databank staat nu zo; origineelState is de lat waartegen de
      // bewaarbalk meet en moet dus mee opschuiven.
      if (origineelState.has(code)) origineelState.set(code, { ...staat });
      if (staat.gezocht) {
        statusPerCode.set(code, "ZOEKT");
        aantalPerCode.set(code, 1);
      } else if (staat.dubbel > 0) {
        statusPerCode.set(code, "RUILT");
        aantalPerCode.set(code, staat.dubbel);
      } else {
        statusPerCode.delete(code);
        aantalPerCode.delete(code);
      }
    }
    bewaarLokaleCache();

    const totaal = upsert.length + verwijder.length;
    toonMelding(
      `${totaal} wijziging${totaal === 1 ? "" : "en"} bewaard${landErbij(batch.keys())}.`,
      "success"
    );
    // Bewust zonder de checklist te herbouwen: die staat al goed, en opnieuw
    // tekenen midden in het aanvinken kost de gebruiker zijn plaats in de lijst.
    await ververs({ herbouwChecklist: false });
  } catch (err) {
    // Niets afvinken: alles blijft in pendingChanges (en in localStorage)
    // staan en gaat mee met de volgende poging.
    toonMelding("Nog niet bewaard — we proberen het straks opnieuw. (" + err.message + ")", "error");
  } finally {
    autosaveBezig = false;
    bijwerkenBewaarbalk();
  }
}

// " voor Ivoorkust (CIV)" — zodat een melding onderaan het scherm niet los
// staat van het land waar je net in aan het werken was. Gaat de ronde over
// meerdere landen (kan enkel na een mislukte poging), dan laten we het weg.
function landErbij(codes) {
  const landcodes = new Set();
  for (const code of codes) {
    const sticker = catalogusPerCode.get(code);
    if (sticker) landcodes.add(sticker.land_code);
  }
  if (landcodes.size !== 1) return "";
  const code = [...landcodes][0];
  const land = landen.find((l) => l.land_code === code);
  return land ? ` voor ${land.land_naam} (${code})` : ` voor ${code}`;
}

// ---------- lokale cache ----------

// Het vangnet voor een tabblad dat sluit vóór de laatste ronde klaar is.
// Mislukt localStorage (privémodus, volle opslag), dan werkt de rest gewoon
// door: het is een extra net, geen voorwaarde.
function cacheSleutel() {
  return `${CACHE_PREFIX}:${kindId}`;
}

function bewaarLokaleCache() {
  try {
    if (pendingChanges.size === 0) localStorage.removeItem(cacheSleutel());
    else localStorage.setItem(cacheSleutel(), JSON.stringify([...pendingChanges]));
  } catch (err) {
    /* geen vangnet beschikbaar; de gewone autosave blijft werken */
  }
}

function herstelLokaleCache() {
  let rauw = null;
  try {
    rauw = localStorage.getItem(cacheSleutel());
  } catch (err) {
    return;
  }
  if (!rauw) return;
  try {
    for (const [code, staat] of JSON.parse(rauw)) {
      if (catalogusPerCode.has(code)) pendingChanges.set(code, staat);
    }
  } catch (err) {
    // Onleesbare cache is erger dan geen cache: opruimen en verder.
    try {
      localStorage.removeItem(cacheSleutel());
    } catch (e) {
      /* niets meer aan te doen */
    }
  }
}

// ---------- bewaarbalk en undo ----------

function bijwerkenBewaarbalk() {
  const balk = document.getElementById("sticker-bewaarbalk");
  const tekst = document.getElementById("sticker-wijzigingen-tekst");
  const bewaarKnop = document.getElementById("sticker-bewaar-btn");
  const undoKnop = document.getElementById("sticker-annuleer-btn");
  const openstaand = pendingChanges.size;

  // De balk blijft ook staan als alles bewaard is: de undo-knop hoort
  // bereikbaar te blijven voor wat je net (automatisch) bewaarde.
  const zichtbaar = openstaand > 0 || undoStack.length > 0;
  balk.classList.toggle("hidden", !zichtbaar);
  if (!zichtbaar) return;

  if (autosaveBezig) tekst.textContent = "Bewaren…";
  else if (openstaand === 0) tekst.textContent = "Alles bewaard";
  else tekst.textContent = `${openstaand} wijziging${openstaand === 1 ? "" : "en"} nog niet bewaard`;

  bewaarKnop.disabled = openstaand === 0 || autosaveBezig;
  undoKnop.disabled = undoStack.length === 0;
}

// Eén stap terug: de sticker van de laatste actie krijgt zijn vorige waarde
// terug, en dat is op zijn beurt gewoon een wijziging die mee autosavet.
// Staat die sticker in een ander land dan het land dat nu open staat, dan
// wordt er van land gewisseld zodat je ziet wat er terugdraait.
function maakOngedaan() {
  const laatste = undoStack.pop();
  if (!laatste) return;

  const sticker = catalogusPerCode.get(laatste.code);
  if (sticker && sticker.land_code !== huidigLand) {
    landcombo.zetWaarde(sticker.land_code);
    kiesLand();
  }

  checklistState.set(laatste.code, { ...laatste.vorige });
  markeerOpenstaand(laatste.code);
  bewaarLokaleCache();
  tekenChecklist();
  plangAutosave();

  const naam = sticker && sticker.naam ? `${laatste.code} — ${sticker.naam}` : laatste.code;
  toonMelding(`Laatste wijziging ongedaan gemaakt (${naam}).`, "success");
}

// ---------- lijsten ----------

// herbouwChecklist staat standaard aan, maar de autosave zet ze uit: die
// draait terwijl de gebruiker nog aan het aanvinken is, en de lijst dan
// opnieuw tekenen kost hem zijn plaats in een lijst van twintig stickers.
async function ververs({ herbouwChecklist = true } = {}) {
  try {
    const { data, error } = await supabase.from(TABEL).select("*").eq("kind_id", kindId);
    if (error) throw error;
    huidigeStickers = data || [];
  } catch (err) {
    toonMelding("Fout bij laden: " + err.message, "error");
    return;
  }

  statusPerCode = new Map(huidigeStickers.map((s) => [s.nummer, s.status]));
  aantalPerCode = new Map(huidigeStickers.map((s) => [s.nummer, s.aantal]));
  huidigeStickers.sort(vergelijkStickers);
  toonLijst("zoekt-list", huidigeStickers.filter((s) => s.status === "ZOEKT"), false);
  toonLijst("ruilt-list", huidigeStickers.filter((s) => s.status === "RUILT"), true);

  // Herbouwen mag hier zonder risico: kiesLand() legt alles wat nog in
  // pendingChanges staat bovenop de databankstand, dus onbewaarde vinkjes
  // overleven het opnieuw tekenen.
  if (herbouwChecklist && huidigLand) kiesLand();

  await verversMatches();
}

// Dezelfde volgorde als de keuzelijst hierboven, zodat de samenvattingslijsten
// niet ineens een andere ordening aanhouden dan de checklist.
function vergelijkStickers(a, b) {
  const ca = catalogusPerCode.get(a.nummer);
  const cb = catalogusPerCode.get(b.nummer);
  if (ca && cb) {
    return vergelijkLanden(ca, cb, sorteerwijze) || ca.nummer - cb.nummer;
  }
  return String(a.nummer).localeCompare(String(b.nummer), "nl");
}

function toonLijst(lijstId, stickers, toonStepper) {
  const ul = document.getElementById(lijstId);
  ul.innerHTML = "";
  if (stickers.length === 0) {
    const leeg = document.createElement("li");
    leeg.className = "sticker-item sticker-item--empty";
    leeg.textContent = "Nog niets.";
    ul.appendChild(leeg);
    return;
  }

  stickers.forEach((sticker) => {
    const uitCatalogus = catalogusPerCode.get(sticker.nummer);
    const li = document.createElement("li");
    li.className = "sticker-item";

    const label = document.createElement("span");
    label.className = "sticker-item__nummer";
    label.textContent = uitCatalogus ? omschrijving(uitCatalogus) : sticker.nummer;
    li.appendChild(label);

    // Enkel de dubbel-lijst krijgt een stapper: "gezocht" is een aan/uit-ding
    // zonder aantal, dat regel je via de checklist hierboven.
    if (toonStepper) li.appendChild(inlineStepper(sticker));

    const acties = document.createElement("div");
    acties.className = "sticker-item__actions";

    const verwijder = document.createElement("button");
    verwijder.className = "btn btn--danger btn--sm";
    verwijder.textContent = "Verwijder";
    verwijder.addEventListener("click", () => verwijderSticker(sticker.id));
    acties.appendChild(verwijder);

    li.appendChild(acties);
    ul.appendChild(li);
  });
}

// De ±-knopjes naast een dubbele sticker in de samenvattingslijst: sneller dan
// terug naar de checklist van dat land te moeten gaan voor één cijfertje. Elke
// klik is meteen een eigen databankaanroep — geen aparte "bewaar"-stap nodig
// voor deze ene rij.
function inlineStepper(sticker) {
  const wrap = document.createElement("div");
  wrap.className = "sticker-item__stepper";

  const min = document.createElement("button");
  min.type = "button";
  min.className = "sticker-stepper__knop";
  min.textContent = "−";
  min.setAttribute("aria-label", "Eén dubbel minder");
  min.disabled = (sticker.aantal || 1) <= 1;
  min.addEventListener("click", () => pasAantalAan(sticker, -1));

  const getal = document.createElement("span");
  getal.className = "sticker-stepper__aantal";
  getal.textContent = "×" + (sticker.aantal || 1);

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "sticker-stepper__knop";
  plus.textContent = "+";
  plus.setAttribute("aria-label", "Eén dubbel meer");
  plus.addEventListener("click", () => pasAantalAan(sticker, 1));

  wrap.appendChild(min);
  wrap.appendChild(getal);
  wrap.appendChild(plus);
  return wrap;
}

async function pasAantalAan(sticker, delta) {
  const nieuw = Math.max(1, (sticker.aantal || 1) + delta);
  if (nieuw === sticker.aantal) return;
  try {
    const { error } = await supabase.from(TABEL).update({ aantal: nieuw }).eq("id", sticker.id);
    if (error) throw error;
    await ververs();
  } catch (err) {
    toonMelding("Fout bij bijwerken: " + err.message, "error");
  }
}

// ---------- matches ----------

// get_matches() draait als security definer in de database: enkel zo kan ze
// de stickers van andere gezinnen zien. De voornaam komt er sinds sql/015
// altijd bij — ook vóór de beurs, zodat buren elkaar meteen vinden. Enkel
// e-mail en WhatsApp blijven wachten tot de beurs voorbij is (sql/014).
async function verversMatches() {
  const ul = document.getElementById("match-list");
  const uitleg = document.getElementById("match-uitleg");
  ul.innerHTML = "";

  let rijen;
  try {
    const { data, error } = await supabase.rpc("get_matches", { p_kind_id: kindId });
    if (error) throw error;
    rijen = (data || []).filter((r) => r.richting === "jij_zoekt");
  } catch (err) {
    uitleg.textContent = "";
    const leeg = document.createElement("li");
    leeg.className = "sticker-item sticker-item--empty";
    leeg.textContent = "Ruilkansen konden niet geladen worden.";
    ul.appendChild(leeg);
    return;
  }

  uitleg.textContent = "Stickers die jij zoekt en die iemand anders dubbel heeft.";

  if (rijen.length === 0) {
    const leeg = document.createElement("li");
    leeg.className = "sticker-item sticker-item--empty";
    leeg.textContent = "Nog geen ruilkansen.";
    ul.appendChild(leeg);
    return;
  }

  rijen.forEach((rij) => {
    const li = document.createElement("li");
    li.className = "sticker-item";

    const label = document.createElement("span");
    label.className = "sticker-item__nummer";
    // ×N enkel tonen als het er meer dan één is: "×1" leert niemand iets bij.
    const suffix = rij.aantal > 1 ? ` ×${rij.aantal}` : "";
    label.textContent = (rij.sticker_naam ? `${rij.code} — ${rij.sticker_naam}` : rij.code) + suffix;

    const bij = document.createElement("span");
    bij.className = "sticker-item__bij";
    if (rij.eigen_gezin) {
      bij.textContent = `bij ${rij.ander_kind} — je eigen verzamelaar`;
      bij.classList.add("sticker-item__bij--eigen");
    } else {
      // Wijk erbij als dat gezin ze invulde: dan zie je meteen of het een buur
      // is met wie je nu al kan ruilen. Volledige contactgegevens staan op de
      // ruilpagina.
      bij.textContent = rij.ander_wijk
        ? `bij ${rij.ander_kind} (${rij.ander_wijk})`
        : `bij ${rij.ander_kind}`;
    }

    li.appendChild(label);
    li.appendChild(bij);
    ul.appendChild(li);
  });
}

// ---------- verwijderen ----------

async function verwijderSticker(id) {
  if (!confirm("Deze sticker verwijderen?")) return;
  try {
    const { error } = await supabase.from(TABEL).delete().eq("id", id);
    if (error) throw error;
    await ververs();
  } catch (err) {
    toonMelding("Fout bij verwijderen: " + err.message, "error");
  }
}

function toonMelding(tekst, type) {
  const el = document.getElementById("sticker-message");
  el.textContent = tekst;
  el.className = "message message--show message--" + type;
}
