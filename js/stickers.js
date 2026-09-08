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
// twintig keer hetzelfde rondje. Sinds deze versie kies je één land, vink je
// alle gezochte stickers tegelijk aan en zet je bij de dubbels meteen het
// juiste aantal, en bewaart één klik op "Bewaar wijzigingen" de hele lijst in
// twee databankaanroepen (één upsert, één delete) in plaats van N aparte
// inserts/updates. Gezocht en dubbel sluiten elkaar nog steeds uit per
// sticker — dat is geen UI-beperking maar de databank: één rij per
// (kind, sticker), met precies één status.
import { supabase, requireAuth } from "./supabase.js";
import { getKind } from "./kinderen.js";
import { landLabel, accentVoor, vergelijkLanden } from "./landen-data.js";

const TABEL = "stickers";
const STATUS_TEKST = { ZOEKT: "zoek ik", RUILT: "heb ik dubbel" };
const PAGINA = 1000; // PostgREST levert maximaal 1000 rijen per aanvraag

let kindId;
let catalogus = [];
let catalogusPerCode = new Map();
let landen = []; // één rij per land: code, namen, paginanummer
let sorteerwijze = "code";
let huidigeStickers = [];
let statusPerCode = new Map(); // code -> status van DIT kind
let aantalPerCode = new Map(); // code -> aantal dubbels van DIT kind

// De checklist van het momenteel gekozen land. checklistState is de live,
// bewerkbare stand (wat de gebruiker nu aanvinkt/optelt); origineelState is
// de bevroren momentopname waarmee bewaarChecklist() vergelijkt om te weten
// wat er precies gewijzigd is. Allebei Map<code, {gezocht, dubbel}>.
let huidigLand = "";
let checklistState = new Map();
let origineelState = new Map();

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

  try {
    const toonGlans = await glansstickersAan();
    catalogus = await laadCatalogus();
    // catalogusPerCode bevat wél alles: een kind dat vroeger BEL2s invoerde,
    // moet die regel in zijn lijst nog steeds met naam zien staan.
    catalogusPerCode = new Map(catalogus.map((s) => [s.code, s]));
    if (!toonGlans) catalogus = catalogus.filter((s) => !s.glans);
    verzamelLanden();
    vulLandKeuzelijst();
  } catch (err) {
    toonMelding("Stickerlijst kon niet geladen worden: " + err.message, "error");
  }

  document.getElementById("sticker-land").addEventListener("change", kiesLand);
  document.getElementById("sticker-sortering").addEventListener("change", wisselSortering);
  document.getElementById("sticker-zoek").addEventListener("input", tekenChecklist);
  document.getElementById("sticker-bewaar-btn").addEventListener("click", bewaarChecklist);
  document.getElementById("sticker-annuleer-btn").addEventListener("click", annuleerChecklist);

  await ververs();
});

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

// De keuzelijst toont overal dezelfde notatie: BEL - BELGIUM - België. De
// waarde van een optie is de landcode, niet de naam — dat is de sleutel die
// ook in de catalogus en in de stickercodes zit.
function vulLandKeuzelijst() {
  const select = document.getElementById("sticker-land");
  const gekozen = select.value;
  select.innerHTML = "";

  const leeg = document.createElement("option");
  leeg.value = "";
  leeg.textContent = "Kies een land…";
  select.appendChild(leeg);

  landen
    .slice()
    .sort((a, b) => vergelijkLanden(a, b, sorteerwijze))
    .forEach((land) => {
      const optie = document.createElement("option");
      optie.value = land.land_code;
      optie.textContent = landLabel(land);
      select.appendChild(optie);
    });

  // Van sortering wisselen mag de gekozen verzamelaar zijn land niet
  // afnemen: de lijst wordt herbouwd, de keuze blijft.
  select.value = gekozen;
}

function wisselSortering() {
  sorteerwijze = document.getElementById("sticker-sortering").value;
  vulLandKeuzelijst();
}

function omschrijving(sticker) {
  const glans = sticker.glans ? " ✨" : "";
  return sticker.naam ? `${sticker.code}${glans} — ${sticker.naam}` : sticker.code + glans;
}

// ---------- checklist per land ----------

// Bouwt checklistState/origineelState opnieuw op vanaf de huidige databankstand
// (statusPerCode/aantalPerCode) zodra een ander land gekozen wordt. Wissel je
// van land zonder te bewaren, dan gaan onbewaarde vinkjes voor het vorige land
// dus verloren — dezelfde afweging als een formulier verlaten zonder opslaan.
function kiesLand() {
  huidigLand = document.getElementById("sticker-land").value;
  document.getElementById("sticker-filter-vak").classList.toggle("hidden", !huidigLand);
  document.getElementById("sticker-zoek").value = "";

  // De accentkleur van het land staat op de kaart die zowel de landkop als de
  // checklist bevat; alles erin erft ze via var(--land-accent). Zo hoeft de
  // kleur niet per knop gezet te worden, en verandert ze in één keer mee bij
  // een ander land. (Op de checklist alleen zou de landkop ernaast ze niet
  // erven — custom properties erven naar beneden, niet zijwaarts.)
  document
    .getElementById("sticker-kaart")
    .style.setProperty("--land-accent", accentVoor(huidigLand));

  const kop = document.getElementById("sticker-landkop");
  const land = landen.find((l) => l.land_code === huidigLand);
  kop.textContent = land ? landLabel(land) : "";
  kop.classList.toggle("hidden", !land);

  checklistState = new Map();
  origineelState = new Map();
  if (huidigLand) {
    catalogus
      .filter((s) => s.land_code === huidigLand)
      .forEach((s) => {
        const status = statusPerCode.get(s.code);
        const staat = {
          gezocht: status === "ZOEKT",
          dubbel: status === "RUILT" ? aantalPerCode.get(s.code) || 1 : 0,
        };
        checklistState.set(s.code, { ...staat });
        origineelState.set(s.code, { ...staat });
      });
  }
  tekenChecklist();
}

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

  const term = document.getElementById("sticker-zoek").value.trim().toLowerCase();
  const stickersVanLand = catalogus.filter((s) => s.land_code === huidigLand);
  const zichtbaar = term
    ? stickersVanLand.filter(
        (s) =>
          String(s.nummer) === term ||
          s.code.toLowerCase().includes(term) ||
          (s.naam || "").toLowerCase().includes(term)
      )
    : stickersVanLand;

  teller.textContent = term
    ? `${zichtbaar.length} van ${stickersVanLand.length} stickers getoond`
    : `${stickersVanLand.length} sticker${stickersVanLand.length === 1 ? "" : "s"}`;

  zichtbaar.forEach((sticker) => ul.appendChild(bouwChip(sticker)));
  bijwerkenBewaarbalk();
}

// Eén chip = één sticker, met een vinkje (gezocht) en een stappenteller
// (dubbel). Wijzigingen passen enkel checklistState aan en werken hun eigen
// DOM-stukje bij — geen volledige herbouw van de lijst per klik, dat zou de
// focus van de gebruiker telkens kwijtraken.
function bouwChip(sticker) {
  const staat = checklistState.get(sticker.code);
  const li = document.createElement("li");
  li.className = "sticker-chip";

  const naam = document.createElement("span");
  naam.className = "sticker-chip__naam";
  naam.title = omschrijving(sticker);
  naam.textContent = omschrijving(sticker);
  li.appendChild(naam);

  const vinkLabel = document.createElement("label");
  vinkLabel.className = "sticker-chip__vink";
  const vink = document.createElement("input");
  vink.type = "checkbox";
  vink.checked = staat.gezocht;
  vinkLabel.appendChild(vink);
  vinkLabel.appendChild(document.createTextNode("Gezocht"));
  li.appendChild(vinkLabel);

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
    staat.gezocht = vink.checked;
    // Aanvinken als gezocht en tegelijk een dubbel-aantal >0 laten staan zou
    // "ik zoek 'm én ik heb 'm dubbel" betekenen — dat kan de databank niet
    // vastleggen (één status per rij), dus resetten we het aantal.
    if (staat.gezocht) staat.dubbel = 0;
    verversChip();
  });
  min.addEventListener("click", () => {
    if (staat.dubbel <= 0) return;
    staat.dubbel -= 1;
    verversChip();
  });
  plus.addEventListener("click", () => {
    staat.dubbel += 1;
    // Omgekeerde reset: een dubbel-aantal instellen terwijl "gezocht" nog
    // aanstond, zou dezelfde tegenstrijdigheid geven.
    if (staat.gezocht) staat.gezocht = false;
    verversChip();
  });

  // Beginstand: dezelfde opmaak als na een klik, zonder de bewaarbalk te
  // laten herrekenen voor elke chip die getekend wordt.
  min.disabled = staat.dubbel <= 0;
  li.classList.toggle("sticker-chip--gezocht", staat.gezocht);
  li.classList.toggle("sticker-chip--dubbel", staat.dubbel > 0);

  stepper.appendChild(min);
  stepper.appendChild(getal);
  stepper.appendChild(plus);
  li.appendChild(stepper);

  return li;
}

// Vergelijkt checklistState met origineelState en levert twee lijsten op: wat
// er in één upsert bij moet (nieuw gezocht, nieuw of gewijzigd aantal dubbel)
// en welke codes helemaal terug naar "heb ik" gaan (dus verwijderd worden).
function berekenWijzigingen() {
  const upsert = [];
  const verwijder = [];
  for (const [code, nu] of checklistState) {
    const was = origineelState.get(code);
    if (was.gezocht === nu.gezocht && was.dubbel === nu.dubbel) continue;

    if (nu.gezocht || nu.dubbel > 0) {
      upsert.push({
        kind_id: kindId,
        nummer: code,
        status: nu.gezocht ? "ZOEKT" : "RUILT",
        aantal: nu.gezocht ? 1 : nu.dubbel,
      });
    } else {
      verwijder.push(code);
    }
  }
  return { upsert, verwijder };
}

function bijwerkenBewaarbalk() {
  const balk = document.getElementById("sticker-bewaarbalk");
  const tekst = document.getElementById("sticker-wijzigingen-tekst");
  const { upsert, verwijder } = berekenWijzigingen();
  const totaal = upsert.length + verwijder.length;

  if (totaal === 0) {
    balk.classList.add("hidden");
    return;
  }
  balk.classList.remove("hidden");
  tekst.textContent = `${totaal} wijziging${totaal === 1 ? "" : "en"} nog niet bewaard`;
}

function annuleerChecklist() {
  for (const [code, was] of origineelState) {
    checklistState.set(code, { ...was });
  }
  tekenChecklist();
}

// Twee aanroepen in totaal, ongeacht hoeveel stickers er gewijzigd zijn: één
// upsert voor alles wat gezocht of dubbel wordt, één delete voor alles wat
// terug naar "heb ik" gaat. onConflict laat de bestaande unieke index
// (kind_id, nummer) het werk doen: bestaat de rij al, dan wordt ze bijgewerkt
// in plaats van een dubbele rij te proberen invoegen.
async function bewaarChecklist() {
  const { upsert, verwijder } = berekenWijzigingen();
  if (upsert.length === 0 && verwijder.length === 0) return;

  const knop = document.getElementById("sticker-bewaar-btn");
  knop.disabled = true;
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
    const totaal = upsert.length + verwijder.length;
    toonMelding(`${totaal} wijziging${totaal === 1 ? "" : "en"} bewaard.`, "success");
    await ververs();
    // ververs() slaat het herbouwen van de checklist over zolang er nog
    // onbewaarde wijzigingen lijken te staan — maar die wijzigingen zijn hier
    // net bewaard, dus checklistState en de nieuwe databankstand horen
    // voortaan gelijk te zijn. Zonder deze regel zou de bewaarbalk na het
    // bewaren dus ten onrechte "nog niet bewaard" blijven tonen.
    if (huidigLand) kiesLand();
  } catch (err) {
    toonMelding("Fout bij opslaan: " + err.message, "error");
  } finally {
    knop.disabled = false;
  }
}

// ---------- lijsten ----------

async function ververs() {
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

  // Enkel automatisch herbouwen als er niets onbewaards openstaat: anders zou
  // een Verwijder-klik op de dubbel-lijst tijdens het invullen van hetzelfde
  // land onbewaarde vinkjes stilletjes wegvegen.
  const { upsert, verwijder } = berekenWijzigingen();
  if (huidigLand && upsert.length === 0 && verwijder.length === 0) kiesLand();

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
