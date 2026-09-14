// ruilbundel.js — de ruil die je aan tafel aan het samenstellen bent: met wie,
// en welke stickers er van hand wisselen.
//
// Eén bundel, gedeeld door de ruilpagina (js/ruilen.js) en ⚡ Snelruilen
// (js/snelruilen.js). Kies je op de ruilpagina FRA12 en typ je daarna in
// Snelruilen GER7, dan zit dat in dezelfde bundel en registreert één knop
// allebei.
//
// BEWAARD IN localStorage, PER TABBLAD. Een ruilbeurs is geen plek om werk te
// verliezen: een refresh, een crash of een per ongeluk gesloten tabblad mag een
// half samengestelde bundel niet wissen. Maar een bundel die zomaar terugkomt
// in een nieuw tabblad, zet je de volgende dag nog op "Sol". Daarom:
//   - elk tabblad krijgt een id in sessionStorage (dat overleeft een refresh,
//     en in Chrome ook "gesloten tabblad heropenen");
//   - de bundel staat in localStorage onder "ruilbundel:<tabblad>";
//   - een bundel mét ruilen van een ánder tabblad komt enkel terug na een
//     expliciete keuze: "Herstellen" of "Verwijderen" (teHerstellen());
//   - na 7 dagen vervalt een bundel stil.
// Twee tabbladen tegelijk open: het tweede ziet de bundel van het eerste als
// "te herstellen". Herstellen kopieert hem; dubbel registreren kan niet, want
// de databank geeft een openstaand paar gewoon terug (sql/016).
//
// VORM
//   { eigenKindId, ruiler: { id, naam, letter, tijdelijk }, ruilen: [{ ik, ander }], bewaard }
//   ik    — de code die jouw verzamelaar KRIJGT (de ander heeft ze dubbel)
//   ander — de code die de ander krijgt (jij hebt ze dubbel)
//   ruiler.id is null bij een tijdelijke ruiler zonder account (tijdelijk: true).
// Een ruil mag half zijn (één kant null): zo werkt "om beurt klikken" — links,
// rechts, links, rechts — en ook twee keer na elkaar links.
const PREFIX = "ruilbundel:";
const TABBLAD_SLEUTEL = "ruilbundel.tabblad";
const HOUDBAAR_MS = 7 * 24 * 60 * 60 * 1000;

export const BUNDEL_EVENT = "ruilbundel:gewijzigd";

let tabbladId = null;

function eigenTabblad() {
  if (tabbladId) return tabbladId;
  try {
    tabbladId = sessionStorage.getItem(TABBLAD_SLEUTEL);
    if (!tabbladId) {
      tabbladId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(TABBLAD_SLEUTEL, tabbladId);
    }
  } catch (err) {
    tabbladId = "tabblad";
  }
  return tabbladId;
}

function eigenSleutel() {
  return PREFIX + eigenTabblad();
}

function leesSleutel(sleutel) {
  try {
    const bundel = JSON.parse(localStorage.getItem(sleutel));
    if (!bundel) return null;
    if (!bundel.bewaard || Date.now() - bundel.bewaard > HOUDBAAR_MS) {
      localStorage.removeItem(sleutel);
      return null;
    }
    return bundel;
  } catch (err) {
    return null;
  }
}

function lees() {
  return leesSleutel(eigenSleutel());
}

function meld(bundel) {
  document.dispatchEvent(new CustomEvent(BUNDEL_EVENT, { detail: bundel }));
}

function schrijf(bundel) {
  try {
    if (bundel) localStorage.setItem(eigenSleutel(), JSON.stringify({ ...bundel, bewaard: Date.now() }));
    else localStorage.removeItem(eigenSleutel());
  } catch (err) {
    /* privémodus zonder opslag: de bundel leeft dan enkel tot de volgende paginalading */
  }
  meld(bundel);
}

// De bundel van dit tabblad, ongeacht voor welke verzamelaar.
export function eigenBundel() {
  return lees();
}

// Een bundel hoort bij één eigen verzamelaar. Wissel je van verzamelaar, dan
// is er voor die verzamelaar gewoon (nog) geen bundel — de oude blijft staan
// voor als je terugwisselt.
export function huidigeBundel(eigenKindId) {
  const bundel = lees();
  return bundel && bundel.eigenKindId === eigenKindId ? bundel : null;
}

// Voor een pagina die nog geen verzamelaar gekozen heeft (Snelruilen, of de
// ruilpagina na een paginawissel): voor wie staat er aan tafel een bundel open?
export function bundelKindId() {
  const bundel = lees();
  return bundel ? bundel.eigenKindId : null;
}

// De jongste bundel mét ruilen uit een ander (of gesloten) tabblad, of null.
// Een bundel zonder ruilen komt nooit terug: daar valt niets te verliezen, en
// "Ruil met Sol" mag niet ongevraagd een nieuw tabblad binnenwandelen.
export function teHerstellen() {
  let sleutels = [];
  try {
    sleutels = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && k !== eigenSleutel());
  } catch (err) {
    return null;
  }
  let beste = null;
  sleutels.forEach((sleutel) => {
    const bundel = leesSleutel(sleutel);
    if (!bundel || !bundel.ruiler || !Array.isArray(bundel.ruilen) || !bundel.ruilen.length) return;
    if (!beste || bundel.bewaard > beste.bundel.bewaard) beste = { sleutel, bundel };
  });
  return beste;
}

export function herstelBundel(sleutel) {
  const bundel = leesSleutel(sleutel);
  try {
    localStorage.removeItem(sleutel);
  } catch (err) {
    /* niets aan te doen */
  }
  if (bundel) schrijf(bundel);
  else meld(lees());
}

export function verwijderHerstel(sleutel) {
  try {
    localStorage.removeItem(sleutel);
  } catch (err) {
    /* niets aan te doen */
  }
  meld(lees());
}

function zelfdeRuiler(a, b) {
  if (!a || !b) return false;
  if (a.id || b.id) return a.id === b.id;
  return a.naam === b.naam;
}

// Dezelfde ruiler opnieuw kiezen laat de gekozen ruilen staan; een andere
// begint leeg — FRA12 die je bij Sol koos, bestaat bij Jules niet.
export function kiesRuiler(eigenKindId, ruiler) {
  const bundel = huidigeBundel(eigenKindId);
  if (bundel && zelfdeRuiler(bundel.ruiler, ruiler)) {
    bundel.ruiler = { ...bundel.ruiler, ...ruiler };
    schrijf(bundel);
    return;
  }
  schrijf({ eigenKindId, ruiler, ruilen: [] });
}

export function vergeetRuiler() {
  schrijf(null);
}

export function isRuiler(eigenKindId, anderKindId) {
  const bundel = huidigeBundel(eigenKindId);
  return Boolean(bundel && bundel.ruiler && bundel.ruiler.id === anderKindId);
}

function pas(eigenKindId, wijziging) {
  const bundel = huidigeBundel(eigenKindId);
  if (!bundel) return;
  wijziging(bundel);
  // Volledig lege ruilen weg: de nummering sluit dan vanzelf aan ("Ruil 3"
  // wordt "Ruil 2" als je Ruil 2 helemaal leegmaakt).
  bundel.ruilen = bundel.ruilen.filter((r) => r.ik || r.ander);
  schrijf(bundel);
}

// Klik op een sticker in een kolom. Staat hij al in een ruil: eruit. Anders in
// de eerste ruil waar die kant nog open is, of in een nieuwe ruil.
export function wisselSticker(eigenKindId, kant, code) {
  pas(eigenKindId, (bundel) => {
    const al = bundel.ruilen.find((r) => r[kant] === code);
    if (al) {
      al[kant] = null;
      return;
    }
    plaats(bundel, kant, code);
  });
}

// Zoals wisselSticker, maar haalt nooit iets weg: voor Snelruilen, waar twee
// keer dezelfde code typen geen "eruit" mag betekenen.
export function voegToe(eigenKindId, kant, code) {
  pas(eigenKindId, (bundel) => {
    if (bundel.ruilen.some((r) => r[kant] === code)) return;
    plaats(bundel, kant, code);
  });
}

function plaats(bundel, kant, code) {
  const open = bundel.ruilen.find((r) => !r[kant]);
  if (open) open[kant] = code;
  else bundel.ruilen.push({ ik: kant === "ik" ? code : null, ander: kant === "ander" ? code : null });
}

// Een kant-en-klaar paar (kolom "Ruilvoorstellen"). Staat precies dat paar er
// al in, dan gaat het eruit; anders komt het erbij als het geen van beide
// stickers al elders gebruikt.
export function wisselPaar(eigenKindId, ik, ander) {
  pas(eigenKindId, (bundel) => {
    const index = bundel.ruilen.findIndex((r) => r.ik === ik && r.ander === ander);
    if (index >= 0) {
      bundel.ruilen.splice(index, 1);
      return;
    }
    if (bundel.ruilen.some((r) => r.ik === ik || r.ander === ander)) return;
    bundel.ruilen.push({ ik, ander });
  });
}

export function zetKant(eigenKindId, index, kant, code) {
  pas(eigenKindId, (bundel) => {
    if (!bundel.ruilen[index]) return;
    if (code && bundel.ruilen.some((r, i) => i !== index && r[kant] === code)) return;
    bundel.ruilen[index][kant] = code || null;
  });
}

export function verwijderRuil(eigenKindId, index) {
  pas(eigenKindId, (bundel) => bundel.ruilen.splice(index, 1));
}

export function leegRuilen(eigenKindId) {
  pas(eigenKindId, (bundel) => {
    bundel.ruilen = [];
  });
}

// 1-gebaseerd ruilnummer van een sticker, of 0.
export function ruilNummer(bundel, kant, code) {
  if (!bundel) return 0;
  return bundel.ruilen.findIndex((r) => r[kant] === code) + 1;
}

export function volledigeParen(bundel) {
  return bundel ? bundel.ruilen.filter((r) => r.ik && r.ander) : [];
}

export function ruilerLabel(ruiler) {
  if (!ruiler) return "";
  return ruiler.naam + (ruiler.letter ? ` ${ruiler.letter}.` : "");
}

// De vraag "Herstellen of verwijderen?", zowel op de ruilpagina als in
// Snelruilen — op één plek gebouwd, zodat beide hetzelfde zeggen.
// naHerstel(bundel) laat de pagina daarna naar de juiste verzamelaar wisselen.
export function herstelMelding({ sleutel, bundel }, { naHerstel } = {}) {
  const vak = document.createElement("div");
  vak.className = "bundel-herstel";
  vak.setAttribute("role", "status");

  const tekst = document.createElement("p");
  const paren = bundel.ruilen.map((r) => `${r.ik || "…"} ⇄ ${r.ander || "…"}`).join(", ");
  tekst.textContent = `Je had nog een niet-geregistreerde ruil klaarstaan met ${ruilerLabel(bundel.ruiler)}: ${paren}.`;

  const acties = document.createElement("div");
  acties.className = "bundel-herstel__acties";
  const herstel = document.createElement("button");
  herstel.type = "button";
  herstel.className = "btn btn--primary btn--sm";
  herstel.textContent = "Herstellen";
  herstel.addEventListener("click", () => {
    herstelBundel(sleutel);
    if (naHerstel) naHerstel(bundel);
  });
  const weg = document.createElement("button");
  weg.type = "button";
  weg.className = "btn btn--outline btn--sm";
  weg.textContent = "Verwijderen";
  weg.addEventListener("click", () => verwijderHerstel(sleutel));
  acties.append(herstel, weg);

  vak.append(tekst, acties);
  return vak;
}
