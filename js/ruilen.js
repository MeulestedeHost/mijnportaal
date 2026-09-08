// ruilen.js — Ruilpagina: met wie kan je wat ruilen, en wat is er afgesproken.
//
// DRIE LAGEN OP ÉÉN PAGINA.
//   1. RUILKANSEN — wat er tussen jouw verzamelaar en de anderen ligt. Te
//      bekijken per ruiler (met wie kan ik iets doen?) of per land (wie heeft
//      of zoekt deze sticker?).
//   2. AFSPRAKEN  — wat er geregistreerd is, met een bevestiging per kant.
//   3. OPVOLGING  — hetzelfde, maar dan voor de hele beurs. Enkel voor de
//      organisatie; de databank beslist dat, niet deze pagina.
//
// HET SYSTEEM VERPLAATST GEEN STICKERS. Een geregistreerde of zelfs voltooide
// ruil laat "zoek ik" en "heb ik dubbel" ongemoeid. Elke verzamelaar houdt
// zijn eigen lijst bij, want alleen hij weet wat er echt in de map zit. Wat
// het portaal wél doet, is de afspraak onthouden en tonen wie ze al bevestigd
// heeft. Bevestig je zelf, dan kleuren enkel JOUW betrokken stickers lichtrood
// — bij de andere ruiler verandert er niets tot die zelf bevestigt.
//
// WAT JE VAN EEN ÁNDER GEZIN TE ZIEN KRIJGT, EN WANNEER — de databank bepaalt
// dat, niet dit bestand:
//   ALTIJD              — de voornaam, en de wijk of gemeente als dat gezin ze
//                         invulde (sql/015), zodat buren elkaar meteen vinden.
//   NA het beursvenster — daarbovenop het e-mailadres en het WhatsApp-nummer
//                         als dat gezin koos om het te delen (sql/014).
// get_matches geeft ander_email/ander_whatsapp buiten hun fase gewoon niet
// terug; wat hier gebeurt is dus presentatie, geen beveiliging.
//
// ZOEKEN WERKT ZOALS OP DE STICKERPAGINA. Live, zonder knop, ongevoelig voor
// hoofdletters en accenten — dezelfde normaliseer() en landMatcht() uit
// landen-data.js. Wie daar leert dat "IVOOR" en "cote" hetzelfde land vinden,
// verwacht dat hier ook.
import { supabase, requireAuth } from "./supabase.js";
import { loadKinderen } from "./kinderen.js";
import { whatsappKnop, toonOrganisatorKnop } from "./whatsapp.js";
import {
  landLabel,
  accentVoor,
  vergelijkLanden,
  normaliseer,
  landMatcht,
} from "./landen-data.js";

let kinderen = [];
let actiefKindId = "";
const matchesPerKind = new Map(); // kind_id -> rijen uit get_matches
let afspraken = []; // rijen uit mijn_ruilen()

let zoekterm = "";
let weergave = "ruiler";
let landsortering = "pagina";

// Welke sticker staat er links en welke rechts geselecteerd, per ruilerkaart.
// Sleutel: "<eigen kind>|<ander kind>". Blijft bewaard over een hertekening
// heen, zodat filteren of bevestigen je keuze niet wegneemt.
const keuzePerRuiler = new Map();

// Wat het bevestigingsvenster op dit moment wil registreren.
let openVoorstel = null;

// null = nog niet nagevraagd. Het antwoord verandert niet tijdens een sessie,
// dus het wordt één keer opgehaald; de lijst eronder wél elke keer opnieuw.
let isBeheerder = null;

document.addEventListener("DOMContentLoaded", async () => {
  const inhoud = document.getElementById("ruil-inhoud");
  if (!inhoud) return; // niet op ruilen.html

  const user = await requireAuth();
  if (!user) return;

  await toonVenster();
  toonOrganisatorKnop("organisator-knop", "💬 WhatsApp de organisator");

  const loading = document.getElementById("ruil-loading");
  try {
    kinderen = await loadKinderen();
  } catch (err) {
    loading.textContent = "Fout bij laden: " + err.message;
    return;
  }

  if (kinderen.length === 0) {
    loading.classList.add("hidden");
    inhoud.appendChild(
      melding("Je hebt nog geen verzamelaars. Voeg er eerst een toe op het dashboard.")
    );
    return;
  }

  actiefKindId = kinderen[0].id;
  vulKindKeuze();
  koppelFilters();
  koppelDialoog();

  try {
    await laadGegevens();
  } catch (err) {
    loading.textContent =
      "Ruilkansen konden niet geladen worden — draai sql/016_ruilen_registreren.sql in Supabase. (" +
      err.message +
      ")";
    return;
  }

  loading.classList.add("hidden");
  teken();
  void toonBeheer();
});

// ---------- gegevens ----------

async function laadGegevens() {
  await Promise.all([haalMatches(actiefKindId), haalAfspraken()]);
}

// Per verzamelaar één aanroep, en het resultaat blijft bewaard: van
// verzamelaar wisselen en weer terug hoeft de databank niet nog eens lastig
// te vallen. Na een registratie of bevestiging halen we gericht opnieuw op.
async function haalMatches(kindId) {
  if (matchesPerKind.has(kindId)) return matchesPerKind.get(kindId);
  const { data, error } = await supabase.rpc("get_matches", { p_kind_id: kindId });
  if (error) throw error;
  matchesPerKind.set(kindId, data || []);
  return data || [];
}

async function haalAfspraken() {
  const { data, error } = await supabase.rpc("mijn_ruilen");
  if (error) throw error;
  afspraken = data || [];
  return afspraken;
}

// Na een registratie of een bevestiging: de afspraken opnieuw ophalen, de
// pagina hertekenen en — voor wie het ziet — ook het opvolgingsoverzicht
// bijwerken. Anders zou dat overzicht de ruil tonen zoals hij bij het laden
// van de pagina was.
async function verversNaWijziging() {
  await haalAfspraken();
  teken();
  await toonBeheer();
}

function actieveMatches() {
  return matchesPerKind.get(actiefKindId) || [];
}

function actiefKind() {
  return kinderen.find((k) => k.id === actiefKindId) || kinderen[0];
}

// ---------- filters ----------

function vulKindKeuze() {
  const select = document.getElementById("ruil-kind");
  const vak = document.getElementById("ruil-kind-vak");
  select.innerHTML = "";
  kinderen.forEach((kind) => {
    const optie = document.createElement("option");
    optie.value = kind.id;
    optie.textContent = `${kind.voornaam} ${kind.familienaam}`;
    select.appendChild(optie);
  });
  select.value = actiefKindId;
  // Met één verzamelaar valt er niets te kiezen; een keuzelijst met één
  // mogelijkheid is dan enkel ruis.
  vak.classList.toggle("hidden", kinderen.length < 2);
}

function koppelFilters() {
  document.getElementById("ruil-kind").addEventListener("change", async (e) => {
    actiefKindId = e.target.value;
    const inhoud = document.getElementById("ruil-inhoud");
    inhoud.textContent = "";
    try {
      await haalMatches(actiefKindId);
    } catch (err) {
      inhoud.appendChild(melding("Ruilkansen konden niet geladen worden: " + err.message));
      return;
    }
    teken();
  });

  document.getElementById("ruil-zoek").addEventListener("input", (e) => {
    zoekterm = normaliseer(e.target.value.trim());
    teken();
  });

  document.getElementById("ruil-weergave").addEventListener("change", (e) => {
    weergave = e.target.value;
    teken();
  });

  document.getElementById("ruil-landsortering").addEventListener("change", (e) => {
    landsortering = e.target.value;
    teken();
  });
}

// Eén rij is relevant als de zoekterm voorkomt in de naam van de ruiler, in
// het land (code, Engelse of Nederlandse naam) of in de sticker zelf (code of
// spelersnaam). Zonder zoekterm valt er niets te filteren.
function rijMatcht(rij) {
  if (!zoekterm) return true;
  return (
    normaliseer(rij.ander_kind).includes(zoekterm) ||
    landMatcht(rij, zoekterm) ||
    normaliseer(rij.code).includes(zoekterm) ||
    normaliseer(rij.sticker_naam).includes(zoekterm)
  );
}

// ---------- beursvenster ----------

async function toonVenster() {
  const el = document.getElementById("ruil-venster");
  let start;
  let einde;
  try {
    const { data, error } = await supabase
      .from("instellingen")
      .select("beurs_start,beurs_einde")
      .eq("id", 1)
      .single();
    if (error) throw error;
    start = new Date(data.beurs_start);
    einde = new Date(data.beurs_einde);
  } catch (err) {
    el.textContent = "Het beursvenster kon niet opgehaald worden.";
    return;
  }

  const nu = new Date();
  const opmaak = new Intl.DateTimeFormat("nl-BE", { dateStyle: "full", timeStyle: "short" });
  const uur = new Intl.DateTimeFormat("nl-BE", { timeStyle: "short" });

  el.className = "ruil-venster ruil-venster--open";
  if (nu < start) {
    el.textContent = `De ruilbeurs begint op ${opmaak.format(start)} en sluit om ${uur.format(
      einde
    )}. Je ziet nu al de voornaam — en de wijk, als die is ingevuld — van wie elke sticker heeft: woon je in dezelfde buurt, dan kan je nu al onderling ruilen. E-mail en WhatsApp komen erbij zodra de beurs voorbij is.`;
  } else if (nu < einde) {
    el.textContent = `De ruilbeurs is bezig — nog tot ${uur.format(
      einde
    )}. Je ziet de voornaam en de wijk van wie elke sticker heeft; e-mail en WhatsApp komen erbij zodra de beurs voorbij is.`;
  } else {
    el.textContent = `De ruilbeurs van ${opmaak.format(
      start
    )} is voorbij, maar ruilen kan gewoon verder: je ziet nu ook het e-mailadres (en eventueel WhatsApp) van wie je nog kan ruilen.`;
  }
}

// ---------- tekenen ----------

function teken() {
  const inhoud = document.getElementById("ruil-inhoud");
  inhoud.textContent = "";

  const alles = actieveMatches();
  const rijen = alles.filter(rijMatcht);
  tekenTeller(alles.length, rijen.length);

  if (alles.length === 0) {
    inhoud.appendChild(
      melding(
        "Nog geen ruilkansen voor deze verzamelaar. Die verschijnen zodra iemand anders een sticker dubbel heeft die jij zoekt, of omgekeerd."
      )
    );
  } else if (rijen.length === 0) {
    inhoud.appendChild(melding("Geen ruilkansen die passen bij je zoekterm."));
  } else if (weergave === "land") {
    tekenPerLand(inhoud, rijen);
  } else {
    tekenPerRuiler(inhoud, rijen);
  }

  tekenAfspraken();
}

function tekenTeller(totaal, getoond) {
  const el = document.getElementById("ruil-teller");
  if (!totaal) {
    el.textContent = "";
    return;
  }
  el.textContent = zoekterm
    ? `${getoond} van ${totaal} ruilkansen`
    : `${totaal} ruilkans${totaal === 1 ? "" : "en"}`;
}

// ---------- weergave: per ruiler ----------

function tekenPerRuiler(doel, rijen) {
  const perRuiler = new Map();
  rijen.forEach((rij) => {
    if (!perRuiler.has(rij.ander_kind_id)) {
      perRuiler.set(rij.ander_kind_id, { info: rij, heeft: [], wil: [] });
    }
    const groep = perRuiler.get(rij.ander_kind_id);
    (rij.richting === "jij_zoekt" ? groep.heeft : groep.wil).push(rij);
  });

  // Ruilers waar het langs twee kanten klikt eerst: dat zijn de enige waar een
  // ruil in één beweging rond is. Daarna de grootste lijsten, en bij gelijke
  // stand op naam zodat de volgorde niet blijft verspringen.
  const gesorteerd = [...perRuiler.values()].sort((a, b) => {
    const tweeA = a.heeft.length && a.wil.length ? 1 : 0;
    const tweeB = b.heeft.length && b.wil.length ? 1 : 0;
    if (tweeA !== tweeB) return tweeB - tweeA;
    const somA = a.heeft.length + a.wil.length;
    const somB = b.heeft.length + b.wil.length;
    if (somA !== somB) return somB - somA;
    return String(a.info.ander_kind).localeCompare(String(b.info.ander_kind), "nl");
  });

  gesorteerd.forEach((groep) => doel.appendChild(ruilerKaart(groep)));
}

function ruilerKaart(groep) {
  const kind = actiefKind();
  const info = groep.info;
  const sectie = document.createElement("section");
  sectie.className = "card ruiler-kaart";

  // ----- kop: naam, wijk, contact -----
  const kop = document.createElement("header");
  kop.className = "ruiler-kaart__kop";

  const titel = document.createElement("h2");
  titel.textContent = info.ander_kind;
  kop.appendChild(titel);

  if (info.ander_wijk) {
    const wijk = document.createElement("span");
    wijk.className = "chip ruiler-kaart__wijk";
    wijk.textContent = info.ander_wijk;
    kop.appendChild(wijk);
  }
  if (info.eigen_gezin) {
    const eigen = document.createElement("span");
    eigen.className = "chip ruiler-kaart__eigen";
    eigen.textContent = "je eigen verzamelaar";
    kop.appendChild(eigen);
  }

  const contact = document.createElement("div");
  contact.className = "ruiler-kaart__contact";
  if (info.ander_email) {
    const mail = document.createElement("a");
    mail.className = "btn btn--outline btn--sm";
    mail.href = mailtoLink(info.ander_email, kind, info);
    mail.textContent = "✉️ E-mail";
    contact.appendChild(mail);
  }
  const wa = whatsappKnop(info.ander_whatsapp, ruilBericht(kind, info), "💬 WhatsApp");
  if (wa) contact.appendChild(wa);
  if (contact.childElementCount) kop.appendChild(contact);

  sectie.appendChild(kop);

  // ----- twee kolommen -----
  const sleutel = `${actiefKindId}|${info.ander_kind_id}`;
  const keuze = keuzePerRuiler.get(sleutel) || {};
  // Een selectie die door filteren of door een aangepaste lijst verdwenen is,
  // laten staan zou een ruil voorstellen die niet meer op het scherm staat.
  if (!groep.heeft.some((r) => r.code === keuze.ik)) keuze.ik = groep.heeft[0]?.code;
  if (!groep.wil.some((r) => r.code === keuze.ander)) keuze.ander = groep.wil[0]?.code;
  keuzePerRuiler.set(sleutel, keuze);

  const kolommen = document.createElement("div");
  kolommen.className = "ruiler-kaart__kolommen";
  kolommen.appendChild(
    ruilKolom("Deze ruiler heeft wat jij zoekt", groep.heeft, keuze.ik, (code) => {
      keuze.ik = code;
      teken();
    })
  );
  kolommen.appendChild(
    ruilKolom("Deze ruiler wil jouw dubbels", groep.wil, keuze.ander, (code) => {
      keuze.ander = code;
      teken();
    })
  );
  sectie.appendChild(kolommen);

  // ----- mogelijke ruil -----
  if (groep.heeft.length && groep.wil.length && keuze.ik && keuze.ander) {
    sectie.appendChild(ruilVoorstel(info, keuze.ik, keuze.ander));
  } else {
    const eenzijdig = document.createElement("p");
    eenzijdig.className = "form-meta form-meta--plat ruiler-kaart__eenzijdig";
    eenzijdig.textContent = groep.heeft.length
      ? "Deze ruiler heeft iets voor jou, maar jij hebt (nog) niets dat hij zoekt — spreek gerust af, een ruil registreren kan pas als het langs twee kanten klopt."
      : "Jij hebt iets dat deze ruiler zoekt, maar hij heeft (nog) niets dat jij zoekt.";
    sectie.appendChild(eenzijdig);
  }

  return sectie;
}

// Eén kolom met de stickers gegroepeerd per land, in de gekozen landvolgorde.
// Elke sticker is een knop: aanklikken kiest hem als jouw kant van de ruil.
function ruilKolom(kopTekst, rijen, gekozen, opKlik) {
  const kolom = document.createElement("section");
  kolom.className = "ruilkolom";

  const kop = document.createElement("h3");
  kop.className = "ruilkolom__kop";
  kop.textContent = kopTekst;
  kolom.appendChild(kop);

  if (rijen.length === 0) {
    const leeg = document.createElement("p");
    leeg.className = "ruilkolom__leeg";
    leeg.textContent = "Niets";
    kolom.appendChild(leeg);
    return kolom;
  }

  const gemarkeerd = doorMijBevestigd();

  groepeerPerLand(rijen).forEach((land) => {
    const blok = document.createElement("div");
    blok.className = "ruilkolom__land";

    const naam = document.createElement("h4");
    naam.className = "ruilkolom__landnaam";
    const streep = document.createElement("span");
    streep.className = "land-streep";
    streep.style.backgroundColor = accentVoor(land.land_code);
    naam.appendChild(streep);
    naam.appendChild(document.createTextNode(landLabel(land)));
    blok.appendChild(naam);

    const lijst = document.createElement("ul");
    lijst.className = "ruilkolom__stickers";
    land.rijen.forEach((rij) => {
      const li = document.createElement("li");
      const knop = document.createElement("button");
      knop.type = "button";
      knop.className = "ruilsticker";
      if (rij.code === gekozen) knop.classList.add("ruilsticker--gekozen");
      if (gemarkeerd.has(rij.code)) knop.classList.add("ruilsticker--geruild");
      knop.setAttribute("aria-pressed", String(rij.code === gekozen));
      knop.title = rij.sticker_naam || rij.code;

      const code = document.createElement("span");
      code.className = "ruilsticker__code";
      code.textContent = rij.code;
      knop.appendChild(code);

      if (rij.sticker_naam) {
        const spelernaam = document.createElement("span");
        spelernaam.className = "ruilsticker__naam";
        spelernaam.textContent = rij.sticker_naam;
        knop.appendChild(spelernaam);
      }
      if (rij.aantal > 1) {
        const aantal = document.createElement("span");
        aantal.className = "ruilsticker__aantal";
        aantal.textContent = `×${rij.aantal}`;
        knop.appendChild(aantal);
      }

      knop.addEventListener("click", () => opKlik(rij.code));
      li.appendChild(knop);
      lijst.appendChild(li);
    });
    blok.appendChild(lijst);
    kolom.appendChild(blok);
  });

  return kolom;
}

function ruilVoorstel(info, ikKrijg, anderKrijgt) {
  const vak = document.createElement("div");
  vak.className = "ruilvoorstel";

  const titel = document.createElement("p");
  titel.className = "ruilvoorstel__titel";
  titel.textContent = "Mogelijke ruil";
  vak.appendChild(titel);

  const paar = document.createElement("p");
  paar.className = "ruilvoorstel__paar";
  paar.textContent = `${ikKrijg} ⇄ ${anderKrijgt}`;
  vak.appendChild(paar);

  const knop = document.createElement("button");
  knop.type = "button";
  knop.className = "btn btn--primary btn--sm";

  const bestaande = zoekAfspraak(info.ander_kind_id, ikKrijg, anderKrijgt);
  if (bestaande) {
    knop.disabled = true;
    knop.textContent =
      bestaande.status === "VOLTOOID" ? "✔ Al geruild" : "✔ Al geregistreerd";
  } else {
    knop.textContent = "Ruil registreren";
    knop.addEventListener("click", () => openDialoog(info, ikKrijg, anderKrijgt));
  }
  vak.appendChild(knop);
  return vak;
}

// ---------- weergave: per land ----------

function tekenPerLand(doel, rijen) {
  groepeerPerLand(rijen).forEach((land) => {
    const sectie = document.createElement("section");
    sectie.className = "card landkaart";

    const titel = document.createElement("h2");
    titel.className = "landkaart__titel";
    const streep = document.createElement("span");
    streep.className = "land-streep";
    streep.style.backgroundColor = accentVoor(land.land_code);
    titel.appendChild(streep);
    titel.appendChild(document.createTextNode(landLabel(land)));
    sectie.appendChild(titel);

    // Per sticker: wie heeft ze dubbel, en wie zoekt ze. Dezelfde sticker kan
    // in beide kolommen staan — dan heeft de ene ruiler ze dubbel en zoekt een
    // andere ze bij jou.
    const perCode = new Map();
    land.rijen.forEach((rij) => {
      if (!perCode.has(rij.code)) perCode.set(rij.code, { rij, heeft: [], zoekt: [] });
      const groep = perCode.get(rij.code);
      (rij.richting === "jij_zoekt" ? groep.heeft : groep.zoekt).push(rij.ander_kind);
    });

    const gemarkeerd = doorMijBevestigd();
    const lijst = document.createElement("div");
    lijst.className = "landkaart__stickers";

    [...perCode.values()]
      .sort((a, b) => a.rij.nummer - b.rij.nummer)
      .forEach((groep) => {
        const blok = document.createElement("article");
        blok.className = "stickerblok";
        if (gemarkeerd.has(groep.rij.code)) blok.classList.add("stickerblok--geruild");

        const kop = document.createElement("h3");
        kop.className = "stickerblok__code";
        kop.textContent = groep.rij.code;
        if (groep.rij.sticker_naam) {
          const naam = document.createElement("span");
          naam.className = "stickerblok__naam";
          naam.textContent = groep.rij.sticker_naam;
          kop.appendChild(naam);
        }
        blok.appendChild(kop);

        blok.appendChild(namenLijst("Ruilers die deze sticker hebben", groep.heeft));
        blok.appendChild(namenLijst("Ruilers die deze sticker zoeken", groep.zoekt));
        lijst.appendChild(blok);
      });

    sectie.appendChild(lijst);
    doel.appendChild(sectie);
  });
}

function namenLijst(kopTekst, namen) {
  const vak = document.createElement("div");
  vak.className = "stickerblok__kolom";

  const kop = document.createElement("p");
  kop.className = "stickerblok__kolomkop";
  kop.textContent = kopTekst;
  vak.appendChild(kop);

  const ul = document.createElement("ul");
  ul.className = "stickerblok__namen";
  if (namen.length === 0) {
    const li = document.createElement("li");
    li.className = "stickerblok__leeg";
    li.textContent = "Niemand";
    ul.appendChild(li);
  } else {
    // Dezelfde ruiler kan er meermaals in zitten (twee kinderen, of dezelfde
    // sticker langs twee kanten); één keer tonen volstaat.
    [...new Set(namen)].sort((a, b) => String(a).localeCompare(String(b), "nl")).forEach((naam) => {
      const li = document.createElement("li");
      li.textContent = naam;
      ul.appendChild(li);
    });
  }
  vak.appendChild(ul);
  return vak;
}

// ---------- groeperen en sorteren ----------

// Landen in de door de gebruiker gekozen volgorde (albumvolgorde of
// alfabetisch op de Engelse naam), stickers daarbinnen op albumnummer.
function groepeerPerLand(rijen) {
  const perLand = new Map();
  rijen.forEach((rij) => {
    if (!perLand.has(rij.land_code)) {
      perLand.set(rij.land_code, {
        land_code: rij.land_code,
        land_naam: rij.land_naam,
        land_naam_en: rij.land_naam_en,
        pagina: rij.pagina,
        rijen: [],
      });
    }
    perLand.get(rij.land_code).rijen.push(rij);
  });

  const landen = [...perLand.values()].sort((a, b) => vergelijkLanden(a, b, landsortering));
  landen.forEach((land) => land.rijen.sort((a, b) => a.nummer - b.nummer));
  return landen;
}

// ---------- afspraken ----------

// Alle stickers waarvan JIJ zei dat ze effectief geruild zijn. Enkel jouw
// eigen bevestiging telt: wat de andere ruiler aanduidt, kleurt jouw scherm
// niet. Beide codes van de ruil horen erbij — je geeft er een en krijgt er een,
// en allebei vragen ze dat je je eigen lijst nakijkt.
function doorMijBevestigd() {
  const codes = new Set();
  afspraken.forEach((r) => {
    const mijnKant =
      (r.eigen_kind_id === actiefKindId && r.eigen_bevestigd) ||
      (r.ander_kind_id === actiefKindId && r.ander_bevestigd);
    if (mijnKant) {
      codes.add(r.eigen_krijgt);
      codes.add(r.ander_krijgt);
    }
  });
  return codes;
}

// Bestaat er al een afspraak met deze ruiler over precies deze twee stickers?
function zoekAfspraak(anderKindId, ikKrijg, anderKrijgt) {
  return afspraken.find(
    (r) =>
      r.eigen_kind_id === actiefKindId &&
      r.ander_kind_id === anderKindId &&
      r.eigen_krijgt === ikKrijg &&
      r.ander_krijgt === anderKrijgt
  );
}

function afsprakenVanKind() {
  return afspraken.filter(
    (r) => r.eigen_kind_id === actiefKindId || r.ander_kind_id === actiefKindId
  );
}

function tekenAfspraken() {
  const kaart = document.getElementById("ruil-afspraken");
  const lijst = document.getElementById("ruil-afspraken-lijst");
  const rijen = afsprakenVanKind();

  lijst.textContent = "";
  kaart.classList.toggle("hidden", rijen.length === 0);
  if (rijen.length === 0) return;

  rijen.forEach((r) => lijst.appendChild(afspraakBlok(r)));
}

function afspraakBlok(r) {
  // mijn_ruilen() draait elke rij naar het eigen gezin toe, maar bij een ruil
  // tussen twee eigen verzamelaars zit de actieve verzamelaar soms aan de
  // "andere" kant. Deze omdraaiing zet hem altijd links.
  const omgedraaid = r.ander_kind_id === actiefKindId && r.eigen_kind_id !== actiefKindId;
  const ik = omgedraaid
    ? { id: r.ander_kind_id, naam: r.ander_kind, krijgt: r.ander_krijgt, naamSticker: r.ander_krijgt_naam, bevestigd: r.ander_bevestigd }
    : { id: r.eigen_kind_id, naam: r.eigen_kind, krijgt: r.eigen_krijgt, naamSticker: r.eigen_krijgt_naam, bevestigd: r.eigen_bevestigd };
  const ander = omgedraaid
    ? { id: r.eigen_kind_id, naam: r.eigen_kind, krijgt: r.eigen_krijgt, naamSticker: r.eigen_krijgt_naam, bevestigd: r.eigen_bevestigd }
    : { id: r.ander_kind_id, naam: r.ander_kind, krijgt: r.ander_krijgt, naamSticker: r.ander_krijgt_naam, bevestigd: r.ander_bevestigd };

  const blok = document.createElement("article");
  blok.className = "afspraak";
  if (r.status === "VOLTOOID") blok.classList.add("afspraak--voltooid");

  const kop = document.createElement("header");
  kop.className = "afspraak__kop";
  const titel = document.createElement("h3");
  titel.textContent = `${ik.krijgt} ⇄ ${ander.krijgt}`;
  kop.appendChild(titel);
  const status = document.createElement("span");
  status.className =
    "chip afspraak__status-chip" + (r.status === "VOLTOOID" ? " afspraak__status-chip--klaar" : "");
  status.textContent = r.status === "VOLTOOID" ? "Voltooid" : "Geregistreerd";
  kop.appendChild(status);
  blok.appendChild(kop);

  const wie = document.createElement("p");
  wie.className = "afspraak__wie";
  wie.textContent =
    `${ik.naam} ontvangt ${stickerTekst(ik.krijgt, ik.naamSticker)} · ` +
    `${ander.naam} ontvangt ${stickerTekst(ander.krijgt, ander.naamSticker)}`;
  blok.appendChild(wie);

  const stappen = document.createElement("ul");
  stappen.className = "afspraak__stappen";
  stappen.appendChild(stap(true, "Registratie aangemaakt"));
  stappen.appendChild(stap(Boolean(ik.bevestigd), `Bevestigd door ${ik.naam}`));
  stappen.appendChild(stap(Boolean(ander.bevestigd), `Bevestigd door ${ander.naam}`));
  blok.appendChild(stappen);

  // Enkel voor je eigen kant een knop. Bij een ruil binnen het eigen gezin
  // zijn beide kanten van jou en krijg je er dus twee.
  const acties = document.createElement("div");
  acties.className = "form-actions afspraak__acties";
  acties.appendChild(bevestigKnop(r.id, ik));
  if (r.eigen_gezin) acties.appendChild(bevestigKnop(r.id, ander));
  blok.appendChild(acties);

  if (ik.bevestigd) {
    const uitleg = document.createElement("p");
    uitleg.className = "form-meta form-meta--plat afspraak__herinnering";
    uitleg.textContent =
      "Jij bevestigde deze ruil — de betrokken stickers staan hierboven lichtrood. Vergeet ze niet zelf aan te passen bij je verzamelaar.";
    blok.appendChild(uitleg);
  }

  return blok;
}

function stap(gedaan, tekst) {
  const li = document.createElement("li");
  li.className = "afspraak__stap" + (gedaan ? " afspraak__stap--gedaan" : "");
  li.textContent = `${gedaan ? "☑" : "☐"} ${tekst}`;
  return li;
}

function bevestigKnop(ruilId, kant) {
  const knop = document.createElement("button");
  knop.type = "button";
  knop.className = kant.bevestigd ? "btn btn--outline btn--sm" : "btn btn--primary btn--sm";
  knop.textContent = kant.bevestigd
    ? `↶ Bevestiging van ${kant.naam} intrekken`
    : `✔ ${kant.naam}: deze sticker werd effectief geruild`;
  knop.addEventListener("click", async () => {
    knop.disabled = true;
    toonAfspraakMelding("");
    try {
      const { error } = await supabase.rpc("ruil_bevestigen", {
        p_ruil_id: ruilId,
        p_kind_id: kant.id,
        p_bevestigd: !kant.bevestigd,
      });
      if (error) throw error;
      await verversNaWijziging();
    } catch (err) {
      knop.disabled = false;
      toonAfspraakMelding("Bevestigen lukte niet: " + err.message);
    }
  });
  return knop;
}

// De melding hangt onder de lijst met afspraken en niet in een alert-venster:
// wat er misging blijft zo staan naast de ruil waar het over gaat.
function toonAfspraakMelding(tekst) {
  const el = document.getElementById("ruil-afspraken-melding");
  if (!el) return;
  el.textContent = tekst;
  el.className = tekst ? "message message--show message--error" : "message";
}

// ---------- registreren ----------

function koppelDialoog() {
  const dialoog = document.getElementById("ruil-dialoog");
  document.getElementById("ruil-dialoog-ok").addEventListener("click", async () => {
    if (!openVoorstel) return;
    const knop = document.getElementById("ruil-dialoog-ok");
    const fout = document.getElementById("ruil-dialoog-fout");
    knop.disabled = true;
    fout.className = "message";
    try {
      const { error } = await supabase.rpc("ruil_registreren", {
        p_eigen_kind: actiefKindId,
        p_ander_kind: openVoorstel.anderKindId,
        p_ik_krijg: openVoorstel.ikKrijg,
        p_ander_krijgt: openVoorstel.anderKrijgt,
      });
      if (error) throw error;
      openVoorstel = null;
      dialoog.close();
      await verversNaWijziging();
      document.getElementById("ruil-afspraken").scrollIntoView({ block: "nearest" });
    } catch (err) {
      fout.textContent = err.message;
      fout.className = "message message--show message--error";
    } finally {
      knop.disabled = false;
    }
  });
}

function openDialoog(info, ikKrijg, anderKrijgt) {
  const kind = actiefKind();
  openVoorstel = { anderKindId: info.ander_kind_id, ikKrijg, anderKrijgt };

  const inhoud = document.getElementById("ruil-dialoog-inhoud");
  inhoud.textContent = "";
  inhoud.appendChild(ontvangtRegel(kind.voornaam, ikKrijg));
  inhoud.appendChild(ontvangtRegel(info.ander_kind, anderKrijgt));

  const fout = document.getElementById("ruil-dialoog-fout");
  fout.textContent = "";
  fout.className = "message";

  document.getElementById("ruil-dialoog").showModal();
}

function ontvangtRegel(naam, code) {
  const regel = document.createElement("div");
  regel.className = "ruil-dialoog__regel";
  const wie = document.createElement("span");
  wie.className = "ruil-dialoog__wie";
  wie.textContent = `${naam} ontvangt`;
  const wat = document.createElement("strong");
  wat.className = "ruil-dialoog__wat";
  wat.textContent = code;
  regel.appendChild(wie);
  regel.appendChild(wat);
  return regel;
}

// ---------- opvolging voor de organisatie ----------

async function toonBeheer() {
  if (isBeheerder === null) {
    try {
      const { data, error } = await supabase.rpc("is_beheerder");
      if (error) throw error;
      isBeheerder = Boolean(data);
    } catch (err) {
      isBeheerder = false; // geen recht of oude databank: gewoon niets tonen
    }
  }
  if (!isBeheerder) return;

  let rijen = [];
  try {
    const { data, error } = await supabase.rpc("ruil_overzicht");
    if (error) throw error;
    rijen = data || [];
  } catch (err) {
    return;
  }

  const kaart = document.getElementById("ruil-beheer");
  kaart.classList.remove("hidden");

  const cijfers = document.getElementById("ruil-beheer-cijfers");
  cijfers.textContent = "";
  const tel = (status) => rijen.filter((r) => r.status === status).length;
  [
    ["🤝", rijen.length, "Ruilen totaal"],
    ["🕓", tel("GEREGISTREERD"), "Nog niemand bevestigd"],
    ["⏳", tel("HALF"), "Half bevestigd"],
    ["✅", tel("VOLTOOID"), "Voltooid"],
  ].forEach(([icoon, getal, label]) => cijfers.appendChild(beheerCijfer(icoon, getal, label)));

  const tabel = document.getElementById("ruil-beheer-tabel");
  tabel.textContent = "";
  const thead = document.createElement("thead");
  const koprij = document.createElement("tr");
  ["Ruil", "Kant A", "Kant B", "Status", "Open sinds"].forEach((tekst) => {
    const th = document.createElement("th");
    th.textContent = tekst;
    koprij.appendChild(th);
  });
  thead.appendChild(koprij);
  tabel.appendChild(thead);

  const body = document.createElement("tbody");
  if (rijen.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "Er is nog geen enkele ruil geregistreerd.";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  rijen.forEach((r) => body.appendChild(beheerRij(r)));
  tabel.appendChild(body);
}

function beheerCijfer(icoon, getal, label) {
  const vak = document.createElement("div");
  vak.className = "wr-cijfer";
  const i = document.createElement("span");
  i.className = "wr-cijfer__icoon";
  i.textContent = icoon;
  const g = document.createElement("span");
  g.className = "wr-cijfer__getal";
  g.textContent = String(getal);
  const l = document.createElement("span");
  l.className = "wr-cijfer__label";
  l.textContent = label;
  vak.appendChild(i);
  vak.appendChild(g);
  vak.appendChild(l);
  return vak;
}

const BEHEER_STATUS = {
  GEREGISTREERD: { tekst: "Nog niemand bevestigd", klasse: "" },
  HALF: { tekst: "Half bevestigd", klasse: "richting--zoekt" },
  VOLTOOID: { tekst: "Voltooid", klasse: "richting--dubbel" },
};

function beheerRij(r) {
  const tr = document.createElement("tr");

  const paar = document.createElement("td");
  paar.textContent = `${r.sticker_a} ⇄ ${r.sticker_b}`;
  tr.appendChild(paar);

  [
    [r.kind_a, r.sticker_a, r.bevestigd_a],
    [r.kind_b, r.sticker_b, r.bevestigd_b],
  ].forEach(([naam, code, bevestigd]) => {
    const td = document.createElement("td");
    td.textContent = `${naam} krijgt ${code} — ${bevestigd ? "bevestigd" : "nog niet bevestigd"}`;
    tr.appendChild(td);
  });

  const status = document.createElement("td");
  const chip = document.createElement("span");
  const beschrijving = BEHEER_STATUS[r.status] || { tekst: r.status, klasse: "" };
  chip.className = "richting " + beschrijving.klasse;
  chip.textContent = beschrijving.tekst + (r.zelfde_gezin ? " (zelfde gezin)" : "");
  status.appendChild(chip);
  tr.appendChild(status);

  const dagen = document.createElement("td");
  dagen.textContent =
    r.status === "VOLTOOID" ? "—" : r.dagen_open === 0 ? "vandaag" : `${r.dagen_open} dagen`;
  tr.appendChild(dagen);

  return tr;
}

// ---------- kleine hulpjes ----------

function stickerTekst(code, naam) {
  return naam ? `${code} — ${naam}` : code;
}

function mailtoLink(email, kind, rij) {
  const onderwerp = encodeURIComponent("Panini-ruil via het Ruilportaal Meulestede");
  const body = encodeURIComponent(ruilBericht(kind, rij));
  return `mailto:${email}?subject=${onderwerp}&body=${body}`;
}

function ruilBericht(kind, rij) {
  const sticker = stickerTekst(rij.code, rij.sticker_naam);
  const aantal = rij.aantal > 1 ? ` (${rij.aantal} exemplaren)` : "";
  const zin =
    rij.richting === "jij_zoekt"
      ? `${kind.voornaam} zoekt ${sticker}, en ${rij.ander_kind} heeft die dubbel${aantal}`
      : `${kind.voornaam} heeft ${sticker} dubbel${aantal}, en ${rij.ander_kind} zoekt die`;
  return `Dag! Via het Panini Ruilportaal Meulestede: ${zin}. Zullen we ruilen?`;
}

function melding(tekst) {
  const kaart = document.createElement("div");
  kaart.className = "card";
  const p = document.createElement("p");
  p.className = "form-meta form-meta--plat";
  p.textContent = tekst;
  kaart.appendChild(p);
  return kaart;
}
