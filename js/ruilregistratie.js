// ruilregistratie.js — een ruildossier vastleggen, los van welke pagina daarom
// vraagt. De ruilpagina (js/ruilen.js) en ⚡ Snelruilen (js/snelruilen.js)
// stellen allebei dezelfde bundel samen (js/ruilbundel.js); dit bestand kiest
// de ruiler en registreert de bundel.
//
// Bouwt zijn eigen <dialog>-elementen lazy op, net als snelruilen.js: een
// pagina die dit nooit gebruikt, merkt er niets van.
//
// ZOLANG sql/022 NIET GEDRAAID IS. Registreren valt dan terug op de losse
// functies uit sql/016 (per paar registreren en de eigen kant bevestigen) —
// niet alles-of-niets, maar de pagina blijft werken. Ruilen met iemand zonder
// account en weigeren kunnen pas na de migratie; dat zegt de foutmelding.
import { supabase } from "./supabase.js";
import { normaliseer } from "./landen-data.js";

// ---------- gegevens ----------

// Eén aanvraag per kind_id per paginabezoek. Verandert de lijst intussen echt,
// dan vangt de databank dat bij het registreren toch op (de match wordt daar
// opnieuw gecontroleerd, sql/016).
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

// Een onbekende functie of tabel (migratie niet gedraaid) meldt PostgREST met
// één van deze zinsneden; een gewone weigering van de databank nooit.
function ontbreektInDatabank(err) {
  const tekst = String((err && err.message) || "");
  return tekst.includes("Could not find the function") || tekst.includes("schema cache") || tekst.includes("does not exist");
}

const MIGRATIE_NODIG = "Draai eerst sql/022_ruildossiers.sql in Supabase — dit kan pas daarna.";

// Na elke geslaagde registratie, op document: de ruilpagina ververst dan haar
// afspraken, ook als de registratie vanuit Snelruilen kwam.
export const GEREGISTREERD_EVENT = "ruilregistratie:geregistreerd";

// ---------- ruiler kiezen ----------

let kiesVenster = null;

function maak(tag, klasse, tekst) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (tekst !== undefined) el.textContent = tekst;
  return el;
}

function bouwKiesVenster() {
  const dialoog = maak("dialog", "ruiler-kies");
  dialoog.setAttribute("aria-labelledby", "ruiler-kies-titel");

  const form = maak("form", "ruiler-kies__form");
  form.method = "dialog";

  const titel = maak("h2", "ruiler-kies__titel", "Met wie ben je aan het ruilen?");
  titel.id = "ruiler-kies-titel";

  // Stap 1: bestaande ruiler.
  const bestaand = maak("div", "ruiler-kies__stap");
  const zoekLabel = maak("label", "form-label", "Kies bestaande ruiler");
  zoekLabel.htmlFor = "ruiler-kies-zoek";
  const zoekVeld = maak("input", "form-input ruiler-kies__zoek");
  zoekVeld.id = "ruiler-kies-zoek";
  zoekVeld.type = "search";
  zoekVeld.placeholder = "Zoek op voornaam of eerste letter van de familienaam…";
  zoekVeld.autocomplete = "off";
  const leeg = maak("p", "form-meta ruiler-kies__leeg hidden");
  const lijst = maak("ul", "ruiler-kies__lijst");
  const nieuwKnop = maak("button", "btn btn--outline btn--sm ruiler-kies__nieuw", "+ Nieuwe ruiler (zonder account)");
  nieuwKnop.type = "button";
  bestaand.append(zoekLabel, zoekVeld, leeg, lijst, nieuwKnop);

  // Stap 2: nieuwe ruiler zonder account.
  const nieuw = maak("div", "ruiler-kies__stap hidden");
  const nieuwUitleg = maak(
    "p",
    "form-meta",
    "Voor iemand zonder account. De ruil wordt enkel bij jou vastgelegd en is meteen afgerond vanaf jouw kant."
  );
  const voornaamLabel = maak("label", "form-label", "Voornaam");
  voornaamLabel.htmlFor = "ruiler-kies-voornaam";
  const voornaam = maak("input", "form-input");
  voornaam.id = "ruiler-kies-voornaam";
  voornaam.autocomplete = "off";
  const familienaamLabel = maak("label", "form-label", "Familienaam");
  familienaamLabel.htmlFor = "ruiler-kies-familienaam";
  const familienaam = maak("input", "form-input");
  familienaam.id = "ruiler-kies-familienaam";
  familienaam.autocomplete = "off";
  const nieuwFout = maak("p", "form-meta ruiler-kies__fout");
  nieuwFout.setAttribute("role", "alert");
  const nieuwActies = maak("div", "form-actions");
  const nieuwOk = maak("button", "btn btn--primary btn--sm", "Ruiler toevoegen");
  nieuwOk.type = "button";
  const nieuwTerug = maak("button", "btn btn--outline btn--sm", "Terug");
  nieuwTerug.type = "button";
  nieuwActies.append(nieuwOk, nieuwTerug);
  nieuw.append(nieuwUitleg, voornaamLabel, voornaam, familienaamLabel, familienaam, nieuwFout, nieuwActies);

  const annuleer = maak("button", "btn btn--outline btn--sm", "Annuleren");
  annuleer.type = "submit";
  annuleer.value = "annuleer";

  form.append(titel, bestaand, nieuw, annuleer);
  dialoog.append(form);
  dialoog.addEventListener("click", (e) => {
    if (e.target === dialoog) dialoog.close();
  });
  document.body.appendChild(dialoog);
  return { dialoog, zoekVeld, leeg, lijst, nieuwKnop, bestaand, nieuw, voornaam, familienaam, nieuwFout, nieuwOk, nieuwTerug };
}

// Geeft { id, naam, letter } terug, { id: null, naam, tijdelijk: true } voor
// een nieuwe ruiler zonder account, of null bij annuleren.
//
// Enkel ruilers waarmee vandaag effectief iets kan (get_matches) staan in de
// lijst. Zoeken gaat op voornaam en de eerste letter van de familienaam: meer
// van een ander gezin tonen we bewust niet (sql/015, sql/021).
export async function kiesRuiler({ eigenKindId }) {
  let matches = [];
  try {
    matches = await haalRuilkansen(eigenKindId);
  } catch (err) {
    matches = [];
  }
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
  const ruilers = [...perRuiler.values()].sort((a, b) => String(a.naam).localeCompare(String(b.naam), "nl"));

  if (!kiesVenster) kiesVenster = bouwKiesVenster();
  const v = kiesVenster;
  v.zoekVeld.value = "";
  v.voornaam.value = "";
  v.familienaam.value = "";
  v.nieuwFout.textContent = "";
  v.bestaand.classList.remove("hidden");
  v.nieuw.classList.add("hidden");

  return new Promise((resolve) => {
    let opgelost = false;
    const klaar = (ruiler) => {
      opgelost = true;
      v.dialoog.close();
      resolve(ruiler);
    };

    const teken = () => {
      const term = normaliseer(v.zoekVeld.value.trim());
      const zichtbaar = ruilers.filter(
        (r) => !term || normaliseer(`${r.naam} ${r.letter}`).includes(term)
      );
      v.lijst.textContent = "";
      v.leeg.textContent = ruilers.length
        ? "Geen ruiler gevonden."
        : "Je hebt nog met niemand een geldige ruilkans. Ruil je met iemand zonder account? Voeg hem hieronder toe.";
      v.leeg.classList.toggle("hidden", zichtbaar.length > 0);
      zichtbaar.forEach((ruiler) => {
        const li = maak("li");
        const knop = maak("button", "ruilvoorstel-item", ruiler.naam + (ruiler.letter ? ` ${ruiler.letter}.` : ""));
        knop.type = "button";
        knop.addEventListener("click", () => klaar(ruiler));
        li.append(knop);
        v.lijst.append(li);
      });
    };

    const opInvoer = () => teken();
    const naarNieuw = () => {
      v.bestaand.classList.add("hidden");
      v.nieuw.classList.remove("hidden");
      v.voornaam.focus();
    };
    const naarBestaand = () => {
      v.nieuw.classList.add("hidden");
      v.bestaand.classList.remove("hidden");
      v.zoekVeld.focus();
    };
    const voegNieuwToe = () => {
      const vn = v.voornaam.value.trim();
      const fn = v.familienaam.value.trim();
      if (!vn || !fn) {
        v.nieuwFout.textContent = "Vul voornaam en familienaam in.";
        return;
      }
      klaar({ id: null, naam: `${vn} ${fn}`, letter: "", tijdelijk: true });
    };

    v.zoekVeld.addEventListener("input", opInvoer);
    v.nieuwKnop.addEventListener("click", naarNieuw);
    v.nieuwTerug.addEventListener("click", naarBestaand);
    v.nieuwOk.addEventListener("click", voegNieuwToe);
    v.dialoog.addEventListener(
      "close",
      () => {
        v.zoekVeld.removeEventListener("input", opInvoer);
        v.nieuwKnop.removeEventListener("click", naarNieuw);
        v.nieuwTerug.removeEventListener("click", naarBestaand);
        v.nieuwOk.removeEventListener("click", voegNieuwToe);
        if (!opgelost) resolve(null);
      },
      { once: true }
    );

    teken();
    v.dialoog.showModal();
    v.zoekVeld.focus();
  });
}

// ---------- registreren ----------

// Alle volledige paren van de bundel als één dossier. Gooit een Error met een
// tekst die zo op het scherm mag.
export async function registreerDossier({ eigenKindId, ruiler, paren }) {
  if (!paren.length) throw new Error("Kies minstens één volledige ruil (een sticker aan elke kant).");

  if (ruiler.tijdelijk) {
    // Sinds sql/023 via de databank: die legt de ruil vast en werkt de eigen
    // lijst in dezelfde transactie bij.
    const { data, error } = await supabase.rpc("eenzijdig_registreren", {
      p_eigen_kind: eigenKindId,
      p_tegenpartij: ruiler.naam,
      p_paren: paren.map((p) => ({ ik_krijg: p.ik, ander_krijgt: p.ander })),
    });
    if (!error) return data;
    if (!ontbreektInDatabank(error)) throw new Error(error.message);

    // Zonder sql/023: enkel vastleggen, zoals sql/022 het deed.
    const dossier = crypto.randomUUID();
    const vastgelegd = await supabase.from("eenzijdige_ruilen").insert(
      paren.map((p) => ({
        kind_id: eigenKindId,
        dossier_id: dossier,
        tegenpartij: ruiler.naam,
        ik_krijg: p.ik,
        ik_geef: p.ander,
      }))
    );
    if (vastgelegd.error) {
      throw new Error(ontbreektInDatabank(vastgelegd.error) ? MIGRATIE_NODIG : vastgelegd.error.message);
    }
    return dossier;
  }

  const { data, error } = await supabase.rpc("ruil_dossier_registreren", {
    p_eigen_kind: eigenKindId,
    p_ander_kind: ruiler.id,
    p_paren: paren.map((p) => ({ ik_krijg: p.ik, ander_krijgt: p.ander })),
  });
  if (!error) return data;
  if (!ontbreektInDatabank(error)) throw new Error(error.message);

  // Terugval zonder sql/022: per paar, met de eigen kant meteen bevestigd.
  for (const p of paren) {
    const reg = await supabase.rpc("ruil_registreren", {
      p_eigen_kind: eigenKindId,
      p_ander_kind: ruiler.id,
      p_ik_krijg: p.ik,
      p_ander_krijgt: p.ander,
    });
    if (reg.error) throw new Error(reg.error.message);
    const bev = await supabase.rpc("ruil_bevestigen", {
      p_ruil_id: reg.data,
      p_kind_id: eigenKindId,
      p_bevestigd: true,
    });
    if (bev.error) throw new Error(bev.error.message);
  }
  return null;
}

export async function bevestigRuil(ruilId, kindId, bevestigd = true) {
  const { error } = await supabase.rpc("ruil_bevestigen", {
    p_ruil_id: ruilId,
    p_kind_id: kindId,
    p_bevestigd: bevestigd,
  });
  if (error) throw new Error(error.message);
}

export async function weigerRuil(ruilId, kindId) {
  const { error } = await supabase.rpc("ruil_weigeren", { p_ruil_id: ruilId, p_kind_id: kindId });
  if (error) throw new Error(ontbreektInDatabank(error) ? MIGRATIE_NODIG : error.message);
}

// Ruilen waarop de andere kant niet binnen de termijn antwoordde, afhandelen
// (sql/023): de reservering vervalt en de eigen lijst gaat terug. Zonder die
// migratie geeft dit een fout, en dan is er ook niets af te handelen.
export async function verwerkVerlopenRuilen() {
  await supabase.rpc("ruilen_verlopen_verwerken");
}

// Leeg zolang sql/022 niet gedraaid is — dan bestaan er ook geen. 'verwerkt'
// bestaat pas sinds sql/023; zonder die kolom de vraag van daarvoor.
export async function haalEenzijdigeRuilen(kindId) {
  const vraag = (kolommen) =>
    supabase
      .from("eenzijdige_ruilen")
      .select(kolommen)
      .eq("kind_id", kindId)
      .order("created_at", { ascending: false });
  const basis = "id,dossier_id,tegenpartij,ik_krijg,ik_geef,created_at";
  let { data, error } = await vraag(basis + ",verwerkt");
  if (error && ontbreektInDatabank(error)) ({ data, error } = await vraag(basis));
  return error ? [] : data || [];
}

// ---------- bevestigingsvenster ----------

let bevestigVenster = null;

function bouwBevestigVenster() {
  const dialoog = maak("dialog", "ruil-dialoog");
  dialoog.setAttribute("aria-labelledby", "ruil-dialoog-titel");

  const form = maak("form", "ruil-dialoog__form");
  form.method = "dialog";

  const titel = maak("h2", "", "Ruil registreren");
  titel.id = "ruil-dialoog-titel";
  const met = maak("p", "ruil-dialoog__met");
  const inhoud = maak("div", "ruil-dialoog__inhoud");
  const uitleg = maak("p", "form-meta");
  const hint = maak(
    "p",
    "form-meta ruil-dialoog__hint",
    "Heb je beide kaarten al aan elkaar gegeven? Registreer dan hieronder — dat bevestigt in dezelfde klik meteen ook jouw kant."
  );
  const fout = maak("div", "message");
  fout.setAttribute("role", "alert");
  fout.setAttribute("aria-live", "polite");

  const acties = maak("div", "form-actions");
  const ok = maak("button", "btn btn--primary", "Ruil registreren");
  ok.type = "button";
  const annuleer = maak("button", "btn btn--outline", "Annuleren");
  annuleer.type = "submit";
  annuleer.value = "annuleer";
  acties.append(ok, annuleer);

  form.append(titel, met, inhoud, uitleg, hint, fout, acties);
  dialoog.append(form);
  dialoog.addEventListener("click", (e) => {
    if (e.target === dialoog) dialoog.close();
  });
  document.body.appendChild(dialoog);
  return { dialoog, met, inhoud, uitleg, fout, ok };
}

// eigenKind: { id, naam }; ruiler: zie ruilbundel.js; paren: [{ ik, ander }].
export function openRuilBevestiging({ eigenKind, ruiler, paren, onGeregistreerd }) {
  if (!bevestigVenster) bevestigVenster = bouwBevestigVenster();
  const { dialoog, met, inhoud, uitleg, fout, ok } = bevestigVenster;

  met.textContent = `Ruil met ${ruiler.naam}${ruiler.tijdelijk ? " (zonder account)" : ""}`;
  inhoud.textContent = "";
  paren.forEach((p, i) => {
    const regel = maak("div", "ruil-dialoog__regel");
    regel.append(maak("span", "ruil-dialoog__wie", `Ruil ${i + 1}`));
    regel.append(maak("strong", "ruil-dialoog__wat", `${p.ik} ⇄ ${p.ander}`));
    inhoud.append(regel);
  });
  uitleg.textContent = ruiler.tijdelijk
    ? `${eigenKind.naam} ontvangt telkens de eerste sticker. De ruil wordt enkel bij jou vastgelegd, is meteen afgerond, en je stickerlijst wordt meteen bijgewerkt.`
    : `${eigenKind.naam} ontvangt telkens de eerste sticker, ${ruiler.naam} de tweede. Registreren bevestigt jouw kant en werkt je stickerlijst meteen bij. ${ruiler.naam} bevestigt (of weigert) elke ruil apart, binnen 3 dagen — tot dan zijn die stickers voor niemand anders beschikbaar. Weigert ${ruiler.naam}, of komt er geen antwoord, dan zet het portaal je lijst terug.`;
  fout.textContent = "";
  fout.className = "message";
  ok.textContent = paren.length === 1 ? "Ruil registreren" : `${paren.length} ruilen registreren`;

  const opKlik = async () => {
    ok.disabled = true;
    fout.textContent = "";
    fout.className = "message";
    try {
      await registreerDossier({ eigenKindId: eigenKind.id, ruiler, paren });
      dialoog.close();
      if (onGeregistreerd) onGeregistreerd();
      document.dispatchEvent(new CustomEvent(GEREGISTREERD_EVENT));
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
