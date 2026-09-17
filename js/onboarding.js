// onboarding.js — de inschrijfwizard: vier stappen voor wie voor het eerst
// aanmeldt, in plaats van een dashboard met losse knoppen.
//
// WAAROM EEN WIZARD. Een nieuw gezin moest vroeger zelf uitzoeken waar het
// begon: een kaart die naar gezin.html sprong, een kaart die een formulier
// openklapte, en de aanwezigheid ergens onderaan in een uitlegblok. Nu is er
// per scherm één taak en één hoofdknop, en de aanwezigheid staat mee in de
// laatste stap — op het moment dat er verzamelaars zijn om aan te duiden.
//
// WANNEER. Zolang het gezin geen enkele verzamelaar heeft (dashboard.js kijkt
// dat na). Een tweede ouder die aan een bestaand gezin gekoppeld wordt, slaat
// de wizard dus over: die lijst is al gevuld.
//
// ELKE STAP BEWAART METEEN. "Volgende" in stap 2 schrijft je gegevens weg, en
// een verzamelaar staat in de databank zodra je hem toevoegt — anders kan stap
// 4 geen vinkje per verzamelaar tonen, en verlies je alles bij een wegvallende
// verbinding. "Vorige" is dus navigeren, geen ongedaan maken.
import { supabase } from "./supabase.js";
import { addKind, valideerKind, kindPayload } from "./kinderen.js";
import { HOE_GEVONDEN, ANDERE, opschrift } from "./hoe-gevonden.js";
import { haalKomendeEvents, datumVoluit, uur } from "./beurs.js";

const LAATSTE_STAP = 4;

let user = null;
let gezin = null; // rij uit public.gezinnen, of null zolang er geen gezin is
let ik = { voornaam: "", familienaam: "" }; // mijn rij in public.gezin_leden
let verzamelaars = []; // wat ik in stap 3 toevoegde, in de volgorde van toevoegen
let events = [];
let komtMee = new Map(); // "event_id|kind_id" -> true zolang het vinkje aan staat
let stap = 1;

export async function startWizard(ingelogde) {
  user = ingelogde;
  const wizard = document.getElementById("onboarding");
  if (!wizard) return;

  verbergDashboardDingen(true);
  wizard.classList.remove("hidden");

  zetTitel();
  koppelKnoppen();
  await laadGegevens();
  void zetBeursZin();
  naarStap(1);
}

// ---------- laden ----------

// De wizard begint altijd bij stap 1, ook als er al gegevens bewaard zijn:
// wie halverwege wegklikte en terugkomt, ziet dezelfde weg opnieuw, met zijn
// antwoorden al ingevuld. Een wizard die op een andere stap opent dan waar je
// hem verliet, vraagt meer uitleg dan hij oplevert.
async function laadGegevens() {
  const [gezinRes, ledenRes] = await Promise.all([
    supabase.from("gezinnen").select("*").limit(1),
    supabase.from("gezin_leden").select("*"),
  ]);
  gezin = ((gezinRes.data || [])[0]) || null;
  const mij = (ledenRes.data || []).find((l) => l.user_id === user.id);
  if (mij) ik = { voornaam: mij.voornaam || "", familienaam: mij.familienaam || "" };

  vulGegevensFormulier();
}

// De naam uit het Google-account als voorstel: negen op de tien keer is dat de
// juiste, en typen op een telefoon is het eerste waar iemand afhaakt. Wie met
// een magic link aanmeldt, heeft geen naam in zijn account en vult zelf in.
function googleNaam() {
  const meta = (user && user.user_metadata) || {};
  const heel = (meta.full_name || meta.name || "").trim();
  const voornaam = (meta.given_name || heel.split(/\s+/)[0] || "").trim();
  const familienaam = (meta.family_name || heel.split(/\s+/).slice(1).join(" ") || "").trim();
  return { voornaam, familienaam };
}

function zetTitel() {
  const { voornaam } = googleNaam();
  // Een e-mailadres als aanspreking voelt eerder als een foutmelding dan als
  // een welkom, dus zonder naam blijft het "Welkom!".
  if (voornaam) document.getElementById("welkom-titel").textContent = `Welkom, ${voornaam}`;
}

// De datum van de eerstvolgende beurs komt uit de kalender, niet uit de tekst:
// anders staat er volgend jaar een verkeerde datum in het welkomstscherm.
async function zetBeursZin() {
  events = await haalKomendeEvents();
  if (!events.length) return;
  const ev = events[0];
  document.getElementById("wizard-beurs").textContent =
    `Dit portaal dient ook als inschrijving voor ${ev.naam} op ${datumVoluit(ev.start)}.`;
}

function vulGegevensFormulier() {
  const voorstel = googleNaam();
  document.getElementById("wz-voornaam").value = ik.voornaam || voorstel.voornaam;
  document.getElementById("wz-familienaam").value = ik.familienaam || voorstel.familienaam;
  document.getElementById("wz-wijk").value = (gezin && gezin.wijk) || "";

  // De keuzelijst bestaat pas na migratie 026. Ontbreekt de kolom, dan blijft
  // de hele vraag weg in plaats van een veld te tonen dat niets bewaart.
  const kaart = document.getElementById("wz-gevonden-kaart");
  if (gezin && !("hoe_gevonden" in gezin)) {
    kaart.classList.add("hidden");
    return;
  }
  const keuze = document.getElementById("wz-gevonden");
  if (keuze.options.length <= 1) {
    HOE_GEVONDEN.forEach(([waarde, tekst]) => {
      const optie = document.createElement("option");
      optie.value = waarde;
      optie.textContent = tekst;
      keuze.appendChild(optie);
    });
  }
  keuze.value = (gezin && gezin.hoe_gevonden) || "";
  document.getElementById("wz-gevonden-ander").value = (gezin && gezin.hoe_gevonden_ander) || "";
  toonAnderVeld();
}

// ---------- stappen ----------

function koppelKnoppen() {
  document.querySelectorAll("[data-wizard-verder]").forEach((knop) => {
    knop.addEventListener("click", () => void verder(Number(knop.dataset.wizardVerder)));
  });
  document.querySelectorAll("[data-wizard-terug]").forEach((knop) => {
    knop.addEventListener("click", () => naarStap(Number(knop.dataset.wizardTerug)));
  });
  document.getElementById("wizard-gegevens-form").addEventListener("submit", bewaarGegevens);
  document.getElementById("wizard-verzamelaar-form").addEventListener("submit", voegVerzamelaarToe);
  document.getElementById("wz-gevonden").addEventListener("change", toonAnderVeld);
  document.getElementById("wz-opslaan-btn").addEventListener("click", bewaarAanwezigheid);

  // Het geboortejaar is voor een volwassene niet relevant; het veld verdwijnt
  // dan in plaats van een verplicht vak te blijven dat niemand wil invullen.
  const vinkje = document.getElementById("wz-kind-volwassen");
  vinkje.addEventListener("change", pasVolwassenToe);
  pasVolwassenToe();
}

function pasVolwassenToe() {
  const volwassen = document.getElementById("wz-kind-volwassen").checked;
  document.getElementById("wz-kind-geboortejaar-groep").classList.toggle("hidden", volwassen);
  if (volwassen) document.getElementById("wz-kind-geboortejaar").value = "";
}

// Alleen "Volgende" loopt langs hier: stap 2 moet eerst bewaren, stap 3 heeft
// minstens één verzamelaar nodig. "Vorige" mag altijd.
async function verder(doel) {
  if (stap === 3 && !verzamelaars.length) {
    melding("wizard-verzamelaar-message", "Voeg eerst één verzamelaar toe — zonder verzamelaar valt er niets te ruilen.", "error");
    document.getElementById("wz-kind-voornaam").focus();
    return;
  }
  if (doel === LAATSTE_STAP) tekenSamenvatting();
  naarStap(doel);
}

function naarStap(nummer) {
  stap = nummer;
  for (let n = 1; n <= LAATSTE_STAP; n++) {
    document.getElementById(`wizard-stap-${n}`).classList.toggle("hidden", n !== nummer);
  }
  document.getElementById("wizard-klaar").classList.add("hidden");
  document.getElementById("wizard-teller").textContent = `Stap ${nummer} van ${LAATSTE_STAP}`;
  tekenBalk(nummer);

  // Op een telefoon staat de voortgangsbalk boven het paneel; zonder dit blijf
  // je na "Volgende" midden in het vorige scherm hangen.
  document.getElementById("onboarding").scrollIntoView({ block: "start" });
  if (nummer === 3) document.getElementById("wz-kind-voornaam").focus({ preventScroll: true });
}

function tekenBalk(nummer) {
  [...document.getElementById("wizard-balk").children].forEach((bol, i) => {
    const eigen = i + 1;
    bol.classList.toggle("wizard__bol--nu", eigen === nummer);
    bol.classList.toggle("wizard__bol--gedaan", eigen < nummer);
    if (eigen === nummer) bol.setAttribute("aria-current", "step");
    else bol.removeAttribute("aria-current");
  });
}

function toonAnderVeld() {
  const anders = document.getElementById("wz-gevonden").value === ANDERE;
  document.getElementById("wz-gevonden-ander-groep").classList.toggle("hidden", !anders);
}

// ---------- stap 2: bewaren ----------

async function bewaarGegevens(e) {
  e.preventDefault();
  const voornaam = document.getElementById("wz-voornaam").value.trim();
  const familienaam = document.getElementById("wz-familienaam").value.trim();
  const wijk = document.getElementById("wz-wijk").value.trim() || null;
  const keuze = document.getElementById("wz-gevonden").value;
  const toelichting = document.getElementById("wz-gevonden-ander").value.trim();

  if (!voornaam || !familienaam) {
    melding("wizard-gegevens-message", "Vul je voornaam en naam in — daarmee herkennen andere gezinnen je bij een ruilkans.", "error");
    return;
  }

  const knop = document.getElementById("wz-gegevens-btn");
  knop.disabled = true;
  knop.textContent = "Opslaan…";
  try {
    const gezinId = await verzekerGezin();
    const { error: naamFout } = await supabase
      .from("gezin_leden")
      .update({ voornaam, familienaam })
      .eq("user_id", user.id);
    if (naamFout) throw naamFout;

    await bewaarGezinsrij(gezinId, {
      wijk,
      hoe_gevonden: keuze || null,
      // De toelichting hoort bij "Andere"; kiest iemand achteraf iets anders,
      // dan verdwijnt ze mee.
      hoe_gevonden_ander: keuze === ANDERE && toelichting ? toelichting : null,
    });

    ik = { voornaam, familienaam };
    // Het voorstel voor stap 3: kinderen dragen meestal de naam van de ouder.
    const kindNaam = document.getElementById("wz-kind-familienaam");
    if (!kindNaam.value) kindNaam.value = familienaam;

    melding("wizard-gegevens-message", "", "");
    naarStap(3);
  } catch (err) {
    melding("wizard-gegevens-message", "Kon dit niet bewaren: " + err.message, "error");
  }
  knop.disabled = false;
  knop.textContent = "Volgende";
}

// WAAROM DIT APART STAAT. Cloudflare Pages en Supabase worden door dezelfde
// merge gedeployd, dus er is een ogenblik waarop deze pagina al 'whatsapp' kan
// aanbieden terwijl migratie 027 nog niet gedraaid is. De check-constraint
// weigert dat antwoord dan (23514). De rest van het formulier mag daar niet
// mee sneuvelen: we bewaren opnieuw zonder het antwoord en zeggen het.
async function bewaarGezinsrij(gezinId, velden) {
  const { error } = await supabase.from("gezinnen").update(velden).eq("id", gezinId);
  if (!error) {
    gezin = { ...(gezin || { id: gezinId }), ...velden };
    return;
  }
  const constraint = error.code === "23514" || /hoe_gevonden/i.test(error.message || "");
  if (!constraint || velden.hoe_gevonden == null) throw error;

  const zonder = { ...velden, hoe_gevonden: null, hoe_gevonden_ander: null };
  const { error: tweede } = await supabase.from("gezinnen").update(zonder).eq("id", gezinId);
  if (tweede) throw tweede;
  gezin = { ...(gezin || { id: gezinId }), ...zonder };
  document.getElementById("wz-gevonden").value = "";
  toonAnderVeld();
  melding("wizard-gegevens-message", "Die keuze kan de databank nog niet bewaren; de rest is opgeslagen.", "error");
}

// Een gezin bestaat pas zodra iemand het nodig heeft. Deze RPC maakt het aan
// als het er nog niet is, en geeft anders het bestaande id terug.
async function verzekerGezin() {
  const { data, error } = await supabase.rpc("gezin_verzeker");
  if (error) throw error;
  return data;
}

// ---------- stap 3: verzamelaars ----------

async function voegVerzamelaarToe(e) {
  e.preventDefault();
  const voornaam = document.getElementById("wz-kind-voornaam").value.trim();
  const familienaam = document.getElementById("wz-kind-familienaam").value.trim();
  const geboortejaar = document.getElementById("wz-kind-geboortejaar").value.trim();
  const isVolwassen = document.getElementById("wz-kind-volwassen").checked;

  const fout = valideerKind(voornaam, familienaam, geboortejaar, isVolwassen);
  if (fout) {
    melding("wizard-verzamelaar-message", fout, "error");
    return;
  }

  const knop = document.getElementById("wz-kind-btn");
  knop.disabled = true;
  knop.textContent = "Toevoegen…";
  try {
    const rij = await addKind(user.id, kindPayload(voornaam, familienaam, geboortejaar, isVolwassen));
    verzamelaars.push(rij);
    tekenVerzamelaars();
    document.getElementById("wizard-verzamelaar-form").reset();
    // De familienaam blijft staan: het tweede kind heet meestal zoals het eerste.
    document.getElementById("wz-kind-familienaam").value = familienaam;
    pasVolwassenToe();
    melding("wizard-verzamelaar-message", `${voornaam} staat erbij. Nog een kind? Vul hieronder de volgende in.`, "success");
    document.getElementById("wz-kind-voornaam").focus();
  } catch (err) {
    melding("wizard-verzamelaar-message", "Fout bij opslaan: " + err.message, "error");
  }
  knop.disabled = false;
  knop.textContent = "＋ Verzamelaar toevoegen";
}

function tekenVerzamelaars() {
  const ul = document.getElementById("wz-verzamelaars");
  ul.textContent = "";
  verzamelaars.forEach((k) => {
    const li = document.createElement("li");
    li.className = "kind-item";

    const info = document.createElement("div");
    info.className = "kind-item__info";

    const naam = document.createElement("span");
    naam.className = "kind-item__name";
    naam.textContent = `✓ ${k.voornaam} ${k.familienaam}`;
    info.appendChild(naam);

    if (k.is_volwassen) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = "volwassene";
      info.appendChild(chip);
    }

    li.appendChild(info);
    ul.appendChild(li);
  });
}

// ---------- stap 4: controleren ----------

function tekenSamenvatting() {
  const regels = [`${ik.voornaam} ${ik.familienaam}`.trim()];
  if (gezin && gezin.wijk) regels.push(gezin.wijk);
  document.getElementById("wz-samen-inschrijver").textContent = regels.join(" — ");

  const sleutel = gezin && gezin.hoe_gevonden;
  const gevondenBlok = document.getElementById("wz-samen-gevonden-blok");
  gevondenBlok.classList.toggle("hidden", !sleutel);
  if (sleutel) {
    const extra = sleutel === ANDERE && gezin.hoe_gevonden_ander ? ` — ${gezin.hoe_gevonden_ander}` : "";
    document.getElementById("wz-samen-gevonden").textContent = opschrift(sleutel) + extra;
  }

  const ul = document.getElementById("wz-samen-verzamelaars");
  ul.textContent = "";
  verzamelaars.forEach((k) => {
    const li = document.createElement("li");
    li.textContent = `✓ ${k.voornaam} ${k.familienaam}`;
    ul.appendChild(li);
  });

  tekenAanwezigheid();
}

// Standaard staan de vinkjes AAN: dit portaal is ook de inschrijving voor de
// beurs, en wie hier belandt is net daarvoor komen aanmelden. Wie toch niet
// komt, haalt het vinkje uit — dat is één handeling minder voor de meerderheid.
// Er wordt pas iets naar de databank geschreven bij "Opslaan".
function tekenAanwezigheid() {
  const blok = document.getElementById("wz-aanwezig-blok");
  if (!events.length || !verzamelaars.length) {
    blok.classList.add("hidden");
    return;
  }

  const houder = document.getElementById("wz-aanwezig-events");
  houder.textContent = "";
  events.forEach((ev) => {
    const groep = document.createElement("div");
    groep.className = "wizard__event";

    const titel = document.createElement("h3");
    titel.className = "wizard__eventtitel";
    titel.textContent = `${ev.naam} — ${datumVoluit(ev.start)}, ${uur(ev.start)}–${uur(ev.einde)}`;
    groep.appendChild(titel);

    const lijst = document.createElement("ul");
    lijst.className = "aanwezig-lijst";
    verzamelaars.forEach((kind) => {
      const sleutel = `${ev.id}|${kind.id}`;
      if (!komtMee.has(sleutel)) komtMee.set(sleutel, true);

      const li = document.createElement("li");
      const label = document.createElement("label");
      label.className = "checkbox-rij";

      const vinkje = document.createElement("input");
      vinkje.type = "checkbox";
      vinkje.checked = komtMee.get(sleutel);
      vinkje.dataset.sleutel = sleutel;
      vinkje.addEventListener("change", () => komtMee.set(sleutel, vinkje.checked));

      const tekst = document.createElement("span");
      tekst.textContent = `${kind.voornaam} ${kind.familienaam} komt mee`;

      label.append(vinkje, tekst);
      li.appendChild(label);
      lijst.appendChild(li);
    });
    groep.appendChild(lijst);
    houder.appendChild(groep);
  });
  blok.classList.remove("hidden");
}

// Elke combinatie gaat naar de databank, ook de uitgevinkte: "komt niet" is
// een antwoord, en zo staat er na de wizard voor elke verzamelaar een rij.
// Mislukt er één, dan blijft de wizard staan met de melding erbij — de
// gegevens uit stap 2 en 3 zijn dan al bewaard, dus er gaat niets verloren.
async function bewaarAanwezigheid() {
  const knop = document.getElementById("wz-opslaan-btn");
  knop.disabled = true;
  knop.textContent = "Opslaan…";
  try {
    for (const ev of events) {
      for (const kind of verzamelaars) {
        const sleutel = `${ev.id}|${kind.id}`;
        const { error } = await supabase.rpc("aanwezigheid_zetten", {
          p_kind_id: kind.id,
          p_event_id: ev.id,
          p_komt: Boolean(komtMee.get(sleutel)),
        });
        if (error) throw error;
      }
    }
    toonKlaar();
  } catch (err) {
    melding("wizard-opslaan-message", "Kon de aanwezigheid niet bewaren: " + err.message, "error");
    knop.disabled = false;
    knop.textContent = "Opslaan";
  }
}

// De knop gaat rechtstreeks naar de verzameling van het EERSTE kind dat in
// stap 3 werd toegevoegd — de plek waar "zoek ik" en dubbels ingevuld worden,
// en dus de eigenlijke volgende stap na inschrijven. Bij meerdere kinderen
// staat de naam in de knoptekst, zodat duidelijk is welke van de twee opent;
// de rest vind je gewoon terug op het dashboard.
//
// Geen id te vinden (kan hier niet gebeuren: stap 3 laat "Volgende" pas toe
// vanaf één verzamelaar) dan blijft de terugval uit de HTML staan: naar het
// dashboard, nooit een kapotte link of een blanco scherm.
function toonKlaar() {
  for (let n = 1; n <= LAATSTE_STAP; n++) {
    document.getElementById(`wizard-stap-${n}`).classList.add("hidden");
  }
  document.getElementById("wizard-klaar").classList.remove("hidden");
  document.getElementById("wizard-teller").textContent = "Klaar";
  tekenBalk(LAATSTE_STAP + 1);

  const eersteKind = verzamelaars[0];
  if (eersteKind && eersteKind.id) {
    document.getElementById("wizard-klaar-tekst").textContent =
      "Klik hieronder om de verzameling van je eerste verzamelaar te openen: " +
      "daar duid je aan welke stickers je zoekt en welke je dubbel hebt.";
    const knop = document.getElementById("wizard-klaar-knop");
    knop.href = `/kind.html?id=${encodeURIComponent(eersteKind.id)}`;
    knop.textContent = `Naar de stickers van ${eersteKind.voornaam}`;
  }

  document.getElementById("onboarding").scrollIntoView({ block: "start" });
}

// ---------- klein ----------

// Tijdens de wizard hoort er één taak op het scherm te staan. Nieuws,
// statistieken, snelruilen en de openstaande acties zijn voor een gezin zonder
// verzamelaars trouwens ook leeg of zinloos.
function verbergDashboardDingen(verberg) {
  document.querySelectorAll("[data-naast-wizard]").forEach((el) => {
    el.classList.toggle("hidden", verberg);
  });
  const bel = document.querySelector(".acties-bel");
  if (bel) bel.classList.toggle("hidden", verberg);
}

function melding(id, tekst, soort) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = tekst;
  el.className = tekst ? "message message--show message--" + soort : "message";
}
