// acties.js — 🔔 Openstaande acties: wat er op jou wacht, zonder dat je het
// zelf moet gaan zoeken.
//
// Eén lijst, twee plekken: een bel in de navigatiebalk (op elke ingelogde
// pagina met Snelruilen) en een blok op het dashboard. Bewust geen derde
// pagina "Mijn acties": dezelfde lijst op drie plekken is drie keer onderhoud,
// en de ruilpagina toont de dossiers zelf al.
//
// DE TELLER TELT ENKEL WAT JIJ MOET DOEN — een ruil bevestigen die een ander
// registreerde, of een bundel uit een gesloten tabblad herstellen of weggooien.
// Wat op iemand anders wacht, staat eronder als informatie maar telt niet mee:
// een teller die altijd iets toont, leer je negeren.
//
// Geen realtime-verbinding: de lijst ververst bij elke paginalading en na elke
// registratie of bevestiging op de ruilpagina (ACTIES_EVENT). Aan de ruiltafel
// wissel je toch voortdurend van pagina.
import { supabase } from "./supabase.js";
import { BUNDEL_EVENT, eigenBundel, teHerstellen, ruilerLabel } from "./ruilbundel.js";

export const ACTIES_EVENT = "acties:verversen";

let afspraken = null; // null = nog niet opgehaald
let bel = null;

document.addEventListener("DOMContentLoaded", () => {
  bel = bouwBel();
  void ververs();
});
document.addEventListener(BUNDEL_EVENT, teken);
document.addEventListener(ACTIES_EVENT, () => void ververs());

// Registreerde de ANDERE kant deze ruil, en wacht hij nog op jouw antwoord?
// door_eigen_gezin bestaat pas sinds sql/022; daarvoor volstaat "de ander
// bevestigde al, jij nog niet" als benadering. Ook gebruikt door js/ruilen.js.
export function wachtOpMij(r) {
  if (r.eigen_gezin || r.status !== "GEREGISTREERD" || r.eigen_bevestigd) return false;
  if (typeof r.door_eigen_gezin !== "boolean") return Boolean(r.ander_bevestigd);
  return !r.door_eigen_gezin;
}

function wachtOpAnder(r) {
  return !r.eigen_gezin && r.status === "GEREGISTREERD" && Boolean(r.eigen_bevestigd) && !r.ander_bevestigd;
}

async function ververs() {
  try {
    // Eerst ruilen afhandelen waarop de andere kant niet binnen de termijn
    // antwoordde (sql/023) — anders telt een vervallen ruil hier nog mee. Een
    // fout (die migratie nog niet gedraaid) houdt niets tegen.
    await supabase.rpc("ruilen_verlopen_verwerken");
    const { data, error } = await supabase.rpc("mijn_ruilen");
    if (error) throw error;
    afspraken = data || [];
  } catch (err) {
    // Geen verbinding of databank onbereikbaar: toon wat er lokaal bekend is.
    afspraken = afspraken || [];
  }
  teken();
}

function perDossier(rijen) {
  const groepen = new Map();
  rijen.forEach((r) => {
    const sleutel = r.dossier_id || r.id;
    if (!groepen.has(sleutel)) groepen.set(sleutel, []);
    groepen.get(sleutel).push(r);
  });
  return [...groepen.values()];
}

function aantalRuilen(n) {
  return `${n} ${n === 1 ? "ruil" : "ruilen"}`;
}

// ?kind= zodat de ruilpagina meteen bij de juiste verzamelaar opent — in een
// gezin met twee kinderen staat de ruil anders onder het verkeerde kind.
function naarRuilen(kindId, anker) {
  const kind = kindId ? `?kind=${encodeURIComponent(kindId)}` : "";
  return `/ruilen.html${kind}${anker ? "#" + anker : ""}`;
}

export function berekenActies(rijen) {
  const teDoen = [];
  const info = [];

  const herstel = teHerstellen();
  if (herstel) {
    teDoen.push({
      tekst: `Niet-geregistreerde ruil met ${ruilerLabel(herstel.bundel.ruiler)} — herstellen of verwijderen`,
      href: naarRuilen(herstel.bundel.eigenKindId),
    });
  }
  perDossier(rijen.filter(wachtOpMij)).forEach((d) => {
    teDoen.push({
      tekst: `${d[0].ander_kind} wacht op bevestiging van ${d[0].eigen_kind} (${aantalRuilen(d.length)})`,
      href: naarRuilen(d[0].eigen_kind_id, "ruil-te-bevestigen"),
    });
  });

  const eigen = eigenBundel();
  if (eigen && eigen.ruiler && eigen.ruilen.length) {
    info.push({
      tekst: `Ruil met ${ruilerLabel(eigen.ruiler)} klaar om te registreren (${aantalRuilen(eigen.ruilen.length)})`,
      href: naarRuilen(eigen.eigenKindId),
    });
  }
  perDossier(rijen.filter(wachtOpAnder)).forEach((d) => {
    info.push({
      tekst: `${d[0].ander_kind} moet nog bevestigen (${aantalRuilen(d.length)})`,
      href: naarRuilen(d[0].eigen_kind_id, "ruil-afspraken"),
    });
  });

  return { teDoen, info };
}

// ---------- tekenen ----------

function teken() {
  if (afspraken === null) return;
  const { teDoen, info } = berekenActies(afspraken);
  tekenBel(teDoen, info);
  tekenBlok(teDoen, info);
}

function lijst(items, klasse) {
  const ul = document.createElement("ul");
  ul.className = "acties__lijst " + klasse;
  items.forEach((item) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = "acties__link";
    a.href = item.href;
    a.textContent = item.tekst;
    li.appendChild(a);
    ul.appendChild(li);
  });
  return ul;
}

function inhoudVan(teDoen, info) {
  if (!teDoen.length && !info.length) {
    const leeg = document.createElement("p");
    leeg.className = "acties__leeg";
    leeg.textContent = "Niets dat op jou wacht.";
    return [leeg];
  }
  const delen = [];
  if (teDoen.length) delen.push(lijst(teDoen, "acties__lijst--te-doen"));
  if (info.length) delen.push(lijst(info, "acties__lijst--info"));
  return delen;
}

function bouwBel() {
  const balk = document.querySelector(".navbar__actions");
  if (!balk) return null;

  const houder = document.createElement("div");
  houder.className = "acties-bel";

  const knop = document.createElement("button");
  knop.type = "button";
  knop.id = "acties-bel";
  knop.className = "btn btn--outline btn--sm acties-bel__knop";
  knop.setAttribute("aria-expanded", "false");
  knop.setAttribute("aria-controls", "acties-paneel");
  knop.setAttribute("aria-label", "Openstaande acties");
  const icoon = document.createElement("span");
  icoon.setAttribute("aria-hidden", "true");
  icoon.textContent = "🔔";
  const aantal = document.createElement("span");
  aantal.className = "acties-bel__aantal hidden";
  aantal.setAttribute("aria-hidden", "true");
  knop.append(icoon, aantal);

  const paneel = document.createElement("div");
  paneel.id = "acties-paneel";
  paneel.className = "acties-paneel hidden";

  houder.append(knop, paneel);
  const uitloggen = document.getElementById("logout-btn");
  balk.insertBefore(houder, uitloggen && uitloggen.parentElement === balk ? uitloggen : null);

  const zet = (open) => {
    paneel.classList.toggle("hidden", !open);
    knop.setAttribute("aria-expanded", String(open));
  };
  knop.addEventListener("click", () => zet(paneel.classList.contains("hidden")));
  document.addEventListener("click", (e) => {
    if (!houder.contains(e.target)) zet(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || paneel.classList.contains("hidden")) return;
    zet(false);
    knop.focus();
  });
  return { knop, aantal, paneel };
}

function tekenBel(teDoen, info) {
  if (!bel) return;
  const { knop, aantal, paneel } = bel;
  aantal.textContent = String(teDoen.length);
  aantal.classList.toggle("hidden", teDoen.length === 0);
  knop.setAttribute("aria-label", teDoen.length ? `Openstaande acties: ${teDoen.length}` : "Openstaande acties: geen");
  paneel.textContent = "";
  const kop = document.createElement("p");
  kop.className = "acties-paneel__kop";
  kop.textContent = "🔔 Openstaande acties";
  paneel.append(kop, ...inhoudVan(teDoen, info));
}

function tekenBlok(teDoen, info) {
  const blok = document.getElementById("acties-blok");
  const doel = document.getElementById("acties-blok-lijst");
  if (!blok || !doel) return;
  doel.textContent = "";
  const leeg = !teDoen.length && !info.length;
  blok.classList.toggle("hidden", leeg);
  if (!leeg) doel.append(...inhoudVan(teDoen, info));
}
