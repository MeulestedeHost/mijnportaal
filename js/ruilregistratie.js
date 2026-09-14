// ruilregistratie.js — een ruil vastleggen (of bevestigen), los van welke
// pagina daarom vraagt. De Ruilvoorstellen-pagina (ruilen.js) kent de
// tegenpartij al; Snelruilen niet — vandaar kiesRuiler() en vindRuilpaar()
// als eerste stappen die daar ontbreken. Het registreren/bevestigen zelf
// (openRuilBevestiging) is voor allebei identiek: dezelfde databankregels
// (ruil_registreren / ruil_bevestigen, sql/016) gelden overal.
//
// Bouwt zijn eigen <dialog>-elementen lazy op, net als snelruilen.js: een
// pagina die dit nooit gebruikt, merkt er niets van.
import { supabase } from "./supabase.js";
import { normaliseer } from "./landen-data.js";

// ---------- gegevens ----------

// Eén aanvraag per kind_id per paginabezoek. get_matches() verandert niet
// terwijl je aan het kiezen bent; wisselt de lijst intussen echt (iemand
// boekte iets in), dan merk je dat toch pas bij de volgende poging omdat
// ruil_registreren() de match hoe dan ook opnieuw controleert (sql/016).
const matchesPerKind = new Map();

export function haalRuilkansen(kindId) {
  if (!matchesPerKind.has(kindId)) {
    const ophaling = (async () => {
      const { data, error } = await supabase.rpc("get_matches", { p_kind_id: kindId });
      if (error) throw error;
      return data || [];
    })();
    ophaling.catch(() => matchesPerKind.delete(kindId));
    matchesPerKind.set(kindId, ophaling);
  }
  return matchesPerKind.get(kindId);
}

let afsprakenOphaling = null;

export function haalAfspraken() {
  if (!afsprakenOphaling) {
    afsprakenOphaling = (async () => {
      const { data, error } = await supabase.rpc("mijn_ruilen");
      if (error) throw error;
      return data || [];
    })();
    afsprakenOphaling.catch(() => {
      afsprakenOphaling = null;
    });
  }
  return afsprakenOphaling;
}

// Na een registratie of bevestiging klopt de gecachte lijst niet meer.
export function vergeetAfspraken() {
  afsprakenOphaling = null;
}

export function zoekAfspraak(afspraken, eigenKindId, anderKindId, ikKrijg, anderKrijgt) {
  return afspraken.find(
    (r) =>
      r.eigen_kind_id === eigenKindId &&
      r.ander_kind_id === anderKindId &&
      r.eigen_krijgt === ikKrijg &&
      r.ander_krijgt === anderKrijgt
  );
}

// ---------- ruiler kiezen ----------

// Enkel ruilers waarmee vandaag effectief iets kan (get_matches geeft alleen
// echte matches terug) — een naam typen die nergens toe leidt, helpt aan
// tafel niemand vooruit.
export async function kiesRuiler({ eigenKindId }) {
  const matches = await haalRuilkansen(eigenKindId);
  const perRuiler = new Map();
  matches.forEach((rij) => {
    if (!perRuiler.has(rij.ander_kind_id)) {
      perRuiler.set(rij.ander_kind_id, {
        id: rij.ander_kind_id,
        naam: rij.ander_kind,
        letter: rij.ander_kind_letter || "",
      });
    }
  });
  if (perRuiler.size === 0) {
    throw new Error("Je hebt op dit moment met niemand een geldige ruilkans — er is nog niemand om mee te registreren.");
  }
  const ruilers = [...perRuiler.values()].sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  return kiesUitLijst({
    titel: "Met wie ruil je?",
    leegTekst: "Geen ruiler gevonden.",
    zoeken: true,
    items: ruilers,
    // "eerste letter achternaam" komt er pas bij zodra sql/021 gedraaid is —
    // tot dan is ander_kind_letter leeg en toont de lijst enkel de voornaam.
    labelVoor: (r) => r.naam + (r.letter ? ` ${r.letter}.` : ""),
  });
}

// ---------- de ruil zelf vinden ----------

// Bestaat er, met deze specifieke ruiler, effectief een geldig paar rond
// `ikKrijg`? Dat moet apart gecontroleerd worden: kiesRuiler() zegt alleen
// dat er ÍETS mogelijk is met deze persoon, niet dat het net deze sticker is.
export async function vindRuilpaar({ eigenKindId, anderKindId, ikKrijg }) {
  const matches = await haalRuilkansen(eigenKindId);
  const vanDezeRuiler = matches.filter((r) => r.ander_kind_id === anderKindId);
  const heeftIkKrijg = vanDezeRuiler.some((r) => r.richting === "jij_zoekt" && r.code === ikKrijg);
  if (!heeftIkKrijg) {
    throw new Error(`Deze ruiler heeft ${ikKrijg} niet (meer) als dubbel staan.`);
  }
  const kandidaten = vanDezeRuiler.filter((r) => r.richting === "jij_hebt_dubbel");
  if (kandidaten.length === 0) {
    throw new Error("Er is niets dat deze ruiler van jou zoekt — een ruil kan hier niet geregistreerd worden.");
  }
  if (kandidaten.length === 1) return kandidaten[0].code;
  const gekozen = await kiesUitLijst({
    titel: "Welke van je dubbels geef je terug?",
    zoeken: false,
    items: kandidaten,
    labelVoor: (r) => `${r.code}${r.sticker_naam ? " — " + r.sticker_naam : ""}`,
  });
  return gekozen ? gekozen.code : null;
}

// ---------- generieke kies-uit-lijst ----------

let kiesVenster = null;

function bouwKiesVenster() {
  const dialoog = document.createElement("dialog");
  dialoog.className = "ruiler-kies";
  dialoog.setAttribute("aria-labelledby", "ruiler-kies-titel");

  const form = document.createElement("form");
  form.className = "ruiler-kies__form";
  form.method = "dialog";

  const titel = document.createElement("h2");
  titel.id = "ruiler-kies-titel";
  titel.className = "ruiler-kies__titel";

  const zoekVeld = document.createElement("input");
  zoekVeld.type = "text";
  zoekVeld.className = "form-input ruiler-kies__zoek hidden";
  zoekVeld.placeholder = "Typ een naam…";
  zoekVeld.autocomplete = "off";

  const leeg = document.createElement("p");
  leeg.className = "form-meta ruiler-kies__leeg hidden";

  const lijst = document.createElement("ul");
  lijst.className = "ruiler-kies__lijst";

  const annuleer = document.createElement("button");
  annuleer.type = "submit";
  annuleer.className = "btn btn--outline btn--sm";
  annuleer.value = "annuleer";
  annuleer.textContent = "Annuleren";

  form.append(titel, zoekVeld, leeg, lijst, annuleer);
  dialoog.append(form);
  // Klik op de achtergrond sluit ook, zoals bij de andere vensters in dit
  // portaal (bv. snelruilen.js).
  dialoog.addEventListener("click", (e) => {
    if (e.target === dialoog) dialoog.close();
  });
  document.body.appendChild(dialoog);
  return { dialoog, titel, zoekVeld, lijst, leeg };
}

// Geeft het gekozen item terug, of null bij annuleren.
function kiesUitLijst({ titel, zoeken = false, leegTekst = "Niets gevonden.", items, labelVoor }) {
  if (!kiesVenster) kiesVenster = bouwKiesVenster();
  const { dialoog, titel: titelEl, zoekVeld, lijst, leeg } = kiesVenster;
  titelEl.textContent = titel;
  zoekVeld.classList.toggle("hidden", !zoeken);
  zoekVeld.value = "";

  return new Promise((resolve) => {
    let opgelost = false;

    const teken = (term) => {
      const genormaliseerd = normaliseer(term);
      const zichtbaar = items.filter(
        (item) => !genormaliseerd || normaliseer(labelVoor(item)).includes(genormaliseerd)
      );
      lijst.textContent = "";
      leeg.textContent = leegTekst;
      leeg.classList.toggle("hidden", zichtbaar.length > 0);
      zichtbaar.forEach((item) => {
        const li = document.createElement("li");
        const knop = document.createElement("button");
        knop.type = "button";
        knop.className = "ruilvoorstel-item";
        knop.textContent = labelVoor(item);
        knop.addEventListener("click", () => {
          opgelost = true;
          dialoog.close();
          resolve(item);
        });
        li.append(knop);
        lijst.append(li);
      });
    };
    teken("");

    const opInvoer = () => teken(zoekVeld.value);
    zoekVeld.addEventListener("input", opInvoer);
    dialoog.addEventListener(
      "close",
      () => {
        zoekVeld.removeEventListener("input", opInvoer);
        if (!opgelost) resolve(null);
      },
      { once: true }
    );

    dialoog.showModal();
    if (zoeken) zoekVeld.focus();
  });
}

// ---------- registreren of bevestigen ----------

let bevestigVenster = null;

function bouwBevestigVenster() {
  const dialoog = document.createElement("dialog");
  dialoog.className = "ruil-dialoog";
  dialoog.setAttribute("aria-labelledby", "ruil-dialoog-titel");

  const form = document.createElement("form");
  form.className = "ruil-dialoog__form";
  form.method = "dialog";

  const titel = document.createElement("h2");
  titel.id = "ruil-dialoog-titel";
  titel.textContent = "Ruil registreren";

  const inhoud = document.createElement("div");
  inhoud.className = "ruil-dialoog__inhoud";

  const uitleg = document.createElement("p");
  uitleg.className = "form-meta";
  uitleg.textContent =
    "Na het registreren bevestigt elke ruiler apart dat de sticker effectief geruild is. " +
    "Je stickerlijsten blijven ongewijzigd — die pas je zelf aan.";

  const hint = document.createElement("p");
  hint.className = "form-meta";
  hint.textContent = "Heb je beide kaarten aan elkaar gegeven? Dan is je ruil enkel nog te registreren.";

  const fout = document.createElement("div");
  fout.className = "message";
  fout.setAttribute("role", "alert");
  fout.setAttribute("aria-live", "polite");

  const acties = document.createElement("div");
  acties.className = "form-actions";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "btn btn--primary";
  ok.textContent = "Ruil registreren";
  const annuleer = document.createElement("button");
  annuleer.type = "submit";
  annuleer.className = "btn btn--outline";
  annuleer.value = "annuleer";
  annuleer.textContent = "Annuleren";
  acties.append(ok, annuleer);

  form.append(titel, inhoud, uitleg, hint, fout, acties);
  dialoog.append(form);
  dialoog.addEventListener("click", (e) => {
    if (e.target === dialoog) dialoog.close();
  });
  document.body.appendChild(dialoog);
  return { dialoog, inhoud, fout, ok };
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
  regel.append(wie, wat);
  return regel;
}

// bestaandeAfspraak: de rij uit mijn_ruilen() als dit paar al geregistreerd
// staat (dan bevestigt de knop in plaats van te registreren) — of null.
export function openRuilBevestiging({ eigenKind, ander, ikKrijg, anderKrijgt, bestaandeAfspraak, onGeregistreerd }) {
  if (!bevestigVenster) bevestigVenster = bouwBevestigVenster();
  const { dialoog, inhoud, fout, ok } = bevestigVenster;

  inhoud.textContent = "";
  inhoud.append(ontvangtRegel(eigenKind.naam, ikKrijg), ontvangtRegel(ander.naam, anderKrijgt));
  fout.textContent = "";
  fout.className = "message";

  const opKlik = async () => {
    ok.disabled = true;
    fout.textContent = "";
    fout.className = "message";
    try {
      const { error } = bestaandeAfspraak
        ? await supabase.rpc("ruil_bevestigen", {
            p_ruil_id: bestaandeAfspraak.id,
            p_kind_id: eigenKind.id,
            p_bevestigd: true,
          })
        : await supabase.rpc("ruil_registreren", {
            p_eigen_kind: eigenKind.id,
            p_ander_kind: ander.id,
            p_ik_krijg: ikKrijg,
            p_ander_krijgt: anderKrijgt,
          });
      if (error) throw error;
      vergeetAfspraken();
      dialoog.close();
      onGeregistreerd && onGeregistreerd();
    } catch (err) {
      fout.textContent = err.message;
      fout.className = "message message--show message--error";
    } finally {
      ok.disabled = false;
    }
  };
  ok.addEventListener("click", opKlik);
  dialoog.addEventListener("close", () => ok.removeEventListener("click", opKlik), { once: true });

  dialoog.showModal();
}
