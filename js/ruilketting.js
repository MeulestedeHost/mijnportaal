// ruilketting.js — 🔗 Kettingruil: een kring van 3 of 4 verzamelaars waarin
// iedereen aan de volgende geeft. Jij → Sol → Jules → jij.
//
// WAAROM. Een gewone ruil vraagt dat het in beide richtingen klopt. Vaak wil
// Sol jouw dubbel maar heeft hij niets voor jou; dan kan een derde (of vierde)
// de kring sluiten. get_matches() kan dat niet tonen: die kent enkel wat
// tussen jou en één ander past. Zie Todo.md, "Ruilkringen", en
// supabase/migrations/…_032_kettingruil.sql.
//
// GEEN NIEUWE RUILVORM IN DE DATABANK. Elke deelnemer legt zijn eigen deel vast
// als één eenzijdige ruil (eenzijdig_registreren, sql/023): "ik kreeg X van
// Jules, ik gaf Y aan Sol". Dat verwerkt meteen de eigen lijst — dezelfde regel
// als elders: bevestigen = je eigen lijst verwerken — en er blijft niets
// hangen omdat één schakel niet antwoordt. De anderen doen hetzelfde vanaf
// hun eigen account, met dezelfde groep.
//
// HOOGSTENS ÉÉN GAST. Van iemand zonder account kent het portaal niets: zijn
// twee pijlen (wat hij heeft, wat hij zoekt) vul je in ⚡ Snelruilen in door
// codes te typen. Met twee gasten is de pijl tússen hen door niemand te kennen,
// en dan valt er niets te berekenen.
//
// Gedeeld door de ruilpagina (blok "Kettingruil") en Snelruilen. De groep staat
// in sessionStorage: een refresh laat hem staan, een nieuw tabblad begint leeg
// — een kring hoort bij één moment aan één tafel.
import { supabase } from "./supabase.js";
import { stelOnlineVoor } from "./online.js";
import { normaliseer } from "./landen-data.js";
import { GEREGISTREERD_EVENT } from "./ruilregistratie.js";

export const KETTING_EVENT = "ruilketting:gewijzigd";

const SLEUTEL = "ruilketting";
const MAX_ANDEREN = 3; // samen met je eigen verzamelaar: 4
const MIN_ANDEREN = 2; // samen: 3 — met twee is het een gewone ruil
const TOON_KRINGEN = 3;

// ---------- de groep ----------

// { eigenKindId, leden: [{ id, naam, letter, eigenGezin }], gast: null | { naam, heeft: [], zoekt: [] } }
function lees() {
  try {
    return JSON.parse(sessionStorage.getItem(SLEUTEL)) || null;
  } catch (err) {
    return null;
  }
}

function schrijf(ketting, detail = {}) {
  try {
    if (ketting) sessionStorage.setItem(SLEUTEL, JSON.stringify(ketting));
    else sessionStorage.removeItem(SLEUTEL);
  } catch (err) {
    /* privémodus: dan leeft de groep enkel tot de volgende pagina */
  }
  geheugen = ketting;
  document.dispatchEvent(new CustomEvent(KETTING_EVENT, { detail }));
}

// Ook zonder sessionStorage moet de groep blijven bestaan zolang je op de
// pagina staat.
let geheugen = undefined;

export function huidigeKetting(eigenKindId) {
  if (geheugen === undefined) geheugen = lees();
  return geheugen && geheugen.eigenKindId === eigenKindId ? geheugen : null;
}

export function stopKetting() {
  vergeetLijsten();
  melding = null;
  schrijf(null);
}

// Wat de gast zei: "die heb ik dubbel" of "die zoek ik". Aan of uit.
export function zetGastWeet(eigenKindId, soort, code, aan) {
  const ketting = huidigeKetting(eigenKindId);
  if (!ketting || !ketting.gast) return;
  const lijst = new Set(ketting.gast[soort]);
  if (aan) lijst.add(code);
  else lijst.delete(code);
  // Een sticker die hij zoekt, heeft hij niet dubbel — en omgekeerd.
  const ander = soort === "heeft" ? "zoekt" : "heeft";
  const andere = new Set(ketting.gast[ander]);
  if (aan) andere.delete(code);
  schrijf({ ...ketting, gast: { ...ketting.gast, [soort]: [...lijst], [ander]: [...andere] } });
}

// Wiens stickers worden er in Snelruilen getypt? null = je eigen verzamelaar
// (zoals altijd), een kind_id = een lid van de groep, "gast" = de gast.
// Aan tafel blader je door de stapel van één persoon tegelijk; zo hoeft niet
// bij elke code opnieuw gezegd te worden van wie hij is.
export function zetStapel(eigenKindId, wie) {
  const ketting = huidigeKetting(eigenKindId);
  if (!ketting || (ketting.stapel || null) === (wie || null)) return;
  schrijf({ ...ketting, stapel: wie || null });
}

export function groepNamen(ketting) {
  const namen = ketting.leden.map((l) => l.naam + (l.letter ? ` ${l.letter}.` : ""));
  if (ketting.gast) namen.push(`${ketting.gast.naam} (gast)`);
  return namenZin(namen);
}

function namenZin(namen) {
  if (namen.length < 2) return namen.join("");
  return namen.slice(0, -1).join(", ") + " en " + namen[namen.length - 1];
}

// ---------- gegevens ----------

function ontbreektInDatabank(err) {
  const tekst = String((err && err.message) || "");
  return tekst.includes("Could not find the function") || tekst.includes("schema cache") || tekst.includes("does not exist");
}

const MIGRATIE_NODIG = "De kettingruil werkt pas zodra migratie 032 (kettingruil) in de databank staat.";

async function haalKandidaten(eigenKindId) {
  const { data, error } = await supabase.rpc("ketting_kandidaten", { p_kind_id: eigenKindId });
  if (error) throw new Error(ontbreektInDatabank(error) ? MIGRATIE_NODIG : error.message);
  return (data || []).map((r) => ({ id: r.kind_id, naam: r.voornaam, letter: r.letter || "", eigenGezin: Boolean(r.eigen_gezin) }));
}

// Eén aanvraag per groep; daarna gaat er per getypte code niets meer over het
// netwerk (zie de migratie: beurswifi). Opnieuw ophalen bij een nieuwe groep,
// na het vastleggen, en wanneer Snelruilen opent.
let lijsten = { sleutel: null, belofte: null };

function lijstSleutel(ketting) {
  return [ketting.eigenKindId, ...ketting.leden.map((l) => l.id).sort()].join("|");
}

export function vergeetLijsten() {
  lijsten = { sleutel: null, belofte: null };
}

// Map kindId -> { zoekt: Set<code>, dubbel: Map<code, vrij aantal> }
export function haalKettingLijsten(ketting) {
  const sleutel = lijstSleutel(ketting);
  if (lijsten.sleutel !== sleutel) {
    const belofte = (async () => {
      const { data, error } = await supabase.rpc("ketting_lijsten", {
        p_kind_id: ketting.eigenKindId,
        p_kinderen: ketting.leden.map((l) => l.id),
      });
      if (error) throw new Error(ontbreektInDatabank(error) ? MIGRATIE_NODIG : error.message);
      const perKind = new Map([ketting.eigenKindId, ...ketting.leden.map((l) => l.id)].map((id) => [id, { zoekt: new Set(), dubbel: new Map() }]));
      (data || []).forEach((r) => {
        const kind = perKind.get(r.kind_id);
        if (!kind) return;
        if (r.status === "ZOEKT") kind.zoekt.add(r.code);
        else if (r.status === "RUILT" && Number(r.aantal) > 0) kind.dubbel.set(r.code, Number(r.aantal));
      });
      return perKind;
    })();
    belofte.catch(() => {
      if (lijsten.belofte === belofte) vergeetLijsten();
    });
    lijsten = { sleutel, belofte };
  }
  return lijsten.belofte;
}

// Per lid van de groep: zoekt hij deze code, en hoeveel heeft hij vrij dubbel?
// Voor de gast: wat er over hem ingevuld is.
export function kettingAntwoord(ketting, perKind, code) {
  const rijen = ketting.leden.map((lid) => {
    const l = perKind.get(lid.id) || { zoekt: new Set(), dubbel: new Map() };
    return { naam: lid.naam, gast: false, zoekt: l.zoekt.has(code), dubbel: l.dubbel.get(code) || 0 };
  });
  if (ketting.gast) {
    rijen.push({
      naam: ketting.gast.naam,
      gast: true,
      zoekt: ketting.gast.zoekt.includes(code),
      dubbel: ketting.gast.heeft.includes(code) ? 1 : 0,
    });
  }
  return rijen;
}

// ---------- kringen zoeken (los van de DOM) ----------

const codeVolgorde = (a, b) => a.localeCompare(b, "nl", { numeric: true });

// deelnemers: [{ sleutel, naam, zoekt: Set, dubbel: Map }], de eigen
// verzamelaar op plaats 0. Geeft de kringen die bij de eigen verzamelaar
// beginnen, best eerst:
//   [{ leden: [i, j, k], pijlen: [{ van, naar, codes, gekozen }], rondes }]
//
// Een ronde = elke deelnemer geeft één sticker aan de volgende. Zo krijgt en
// geeft iedereen er evenveel, en is het voor elk kind aan tafel uit te leggen:
// "jij geeft er twee aan Sol, je krijgt er twee van Jules". Het aantal rondes
// is dus de kleinste pijl.
//
// Bij 4 deelnemers ook de kringen van 3: past de volledige kring niet, dan
// misschien wel één zonder Mila. Bewust geen optimalisatie over alle
// mogelijke combinaties heen (Todo.md, "niet globaal optimaliseren"): met
// hoogstens 4 mensen zijn het 12 kringen, die elk in één zin uit te leggen zijn.
export function zoekKringen(deelnemers) {
  const n = deelnemers.length;
  const pijlCache = new Map();
  const pijl = (van, naar) => {
    const sleutel = `${van}>${naar}`;
    if (!pijlCache.has(sleutel)) {
      const gever = deelnemers[van];
      const ontvanger = deelnemers[naar];
      pijlCache.set(sleutel, [...gever.dubbel.keys()].filter((c) => gever.dubbel.get(c) > 0 && ontvanger.zoekt.has(c)).sort(codeVolgorde));
    }
    return pijlCache.get(sleutel);
  };

  const anderen = [...Array(n).keys()].slice(1);
  const volgordes = [];
  const permuteer = (gekozen, rest, lengte) => {
    if (gekozen.length === lengte) {
      volgordes.push([0, ...gekozen]);
      return;
    }
    rest.forEach((x) => permuteer([...gekozen, x], rest.filter((y) => y !== x), lengte));
  };
  for (let lengte = n - 1; lengte >= 2; lengte--) permuteer([], anderen, lengte);

  const kringen = [];
  volgordes.forEach((leden) => {
    const pijlen = leden.map((van, i) => ({ van, naar: leden[(i + 1) % leden.length], codes: pijl(van, leden[(i + 1) % leden.length]) }));
    const rondes = Math.min(...pijlen.map((p) => p.codes.length));
    if (rondes < 1) return;
    pijlen.forEach((p) => (p.gekozen = p.codes.slice(0, rondes)));
    kringen.push({ leden, pijlen, rondes });
  });

  // Iedereen uit de groep erin gaat voor: daarvoor koos je die groep. Daarna
  // het meeste rondes, en bij gelijkstand een vaste volgorde op naam.
  const route = (k) => k.leden.map((i) => deelnemers[i].naam).join(">");
  kringen.sort((a, b) => b.leden.length - a.leden.length || b.rondes - a.rondes || route(a).localeCompare(route(b), "nl"));
  return kringen;
}

// Elke pijl met minstens één sticker: als er (nog) geen kring is, zie je zo
// welke schakel ontbreekt.
export function allePijlen(deelnemers) {
  const uit = [];
  deelnemers.forEach((gever, van) =>
    deelnemers.forEach((ontvanger, naar) => {
      if (van === naar) return;
      const codes = [...gever.dubbel.keys()].filter((c) => gever.dubbel.get(c) > 0 && ontvanger.zoekt.has(c));
      if (codes.length) uit.push({ van, naar, codes: codes.sort(codeVolgorde) });
    })
  );
  return uit;
}

function deelnemersVan(ketting, eigenKind, perKind) {
  const leeg = { zoekt: new Set(), dubbel: new Map() };
  const lijst = [
    { sleutel: eigenKind.id, naam: eigenKind.voornaam, eigenGezin: true, ...(perKind.get(eigenKind.id) || leeg) },
    ...ketting.leden.map((l) => ({ sleutel: l.id, naam: l.naam, eigenGezin: l.eigenGezin, ...(perKind.get(l.id) || leeg) })),
  ];
  if (ketting.gast) {
    lijst.push({
      sleutel: null,
      naam: ketting.gast.naam,
      gast: true,
      eigenGezin: false,
      zoekt: new Set(ketting.gast.zoekt),
      dubbel: new Map(ketting.gast.heeft.map((c) => [c, 1])),
    });
  }
  return lijst;
}

// ---------- vastleggen ----------

// Voor elke deelnemer uit het eigen gezin één eenzijdige ruil per ronde: wat
// hij kreeg van wie vóór hem staat, wat hij gaf aan wie na hem staat. Meestal
// is dat enkel je eigen verzamelaar; staat een broer of zus mee in de kring,
// dan ook die. Niet in één transactie over de kinderen heen — elk kind is een
// eigen aanroep die zelf alles-of-niets is.
export async function legKringVast(kring, deelnemers) {
  const gedaan = [];
  for (let i = 0; i < kring.leden.length; i++) {
    const wie = deelnemers[kring.leden[i]];
    if (!wie.eigenGezin || !wie.sleutel) continue;
    const krijgt = kring.pijlen[(i - 1 + kring.pijlen.length) % kring.pijlen.length];
    const geeft = kring.pijlen[i];
    const { error } = await supabase.rpc("eenzijdig_registreren", {
      p_eigen_kind: wie.sleutel,
      p_tegenpartij: `Kettingruil: van ${deelnemers[krijgt.van].naam}, aan ${deelnemers[geeft.naar].naam}`,
      p_paren: krijgt.gekozen.map((code, r) => ({ ik_krijg: code, ander_krijgt: geeft.gekozen[r] })),
    });
    if (error) {
      const al = gedaan.length ? ` (voor ${namenZin(gedaan)} is het wel al vastgelegd)` : "";
      throw new Error(`${wie.naam}: ${error.message}${al}`);
    }
    gedaan.push(wie.naam);
  }
  vergeetLijsten();
  // Vóór de events: die tekenen het blok opnieuw, en dan hoort de bevestiging
  // er al bij — in elk blok dat de groep toont (ruilpagina én Snelruilen).
  melding = { tekst: `✓ Kettingruil vastgelegd voor ${namenZin(gedaan)}.`, tot: Date.now() + 20000 };
  document.dispatchEvent(new CustomEvent(GEREGISTREERD_EVENT));
  document.dispatchEvent(new CustomEvent(KETTING_EVENT, { detail: { geregistreerd: true } }));
  return gedaan;
}

// ---------- groep kiezen ----------

let kiesVenster = null;

function maak(tag, klasse, tekst) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (tekst !== undefined) el.textContent = tekst;
  return el;
}

function bouwKiesVenster() {
  const dialoog = maak("dialog", "ruiler-kies ketting-kies");
  dialoog.setAttribute("aria-labelledby", "ketting-kies-titel");
  const form = maak("form", "ruiler-kies__form");
  form.method = "dialog";

  const titel = maak("h2", "ruiler-kies__titel", "🔗 Kettingruil: met wie?");
  titel.id = "ketting-kies-titel";
  const uitleg = maak("p", "form-meta ketting-kies__uitleg");

  const zoekLabel = maak("label", "form-label", "Verzamelaars");
  zoekLabel.htmlFor = "ketting-kies-zoek";
  const zoekVeld = maak("input", "form-input ruiler-kies__zoek");
  zoekVeld.id = "ketting-kies-zoek";
  zoekVeld.type = "search";
  zoekVeld.placeholder = "Zoek op voornaam of eerste letter van de familienaam…";
  zoekVeld.autocomplete = "off";
  const leeg = maak("p", "form-meta ruiler-kies__leeg hidden");
  const lijst = maak("ul", "ruiler-kies__lijst ketting-kies__lijst");

  const gastVak = maak("div", "ketting-kies__gast");
  const gastLabel = maak("label", "ketting-kies__optie");
  const gastVink = maak("input");
  gastVink.type = "checkbox";
  gastLabel.append(gastVink, maak("span", "", "Er doet een gast zonder account mee"));
  const gastNaamLabel = maak("label", "form-label hidden", "Voornaam van de gast");
  gastNaamLabel.htmlFor = "ketting-kies-gast";
  const gastNaam = maak("input", "form-input hidden");
  gastNaam.id = "ketting-kies-gast";
  gastNaam.autocomplete = "off";
  gastVak.append(gastLabel, gastNaamLabel, gastNaam);

  const fout = maak("p", "form-meta ruiler-kies__fout");
  fout.setAttribute("role", "alert");

  const acties = maak("div", "form-actions");
  const ok = maak("button", "btn btn--primary btn--sm", "Kettingruil starten");
  ok.type = "button";
  const annuleer = maak("button", "btn btn--outline btn--sm", "Annuleren");
  annuleer.type = "submit";
  annuleer.value = "annuleer";
  acties.append(ok, annuleer);

  form.append(titel, uitleg, zoekLabel, zoekVeld, leeg, lijst, gastVak, fout, acties);
  dialoog.append(form);
  dialoog.addEventListener("click", (e) => {
    if (e.target === dialoog) dialoog.close();
  });
  document.body.appendChild(dialoog);
  return { dialoog, uitleg, zoekVeld, leeg, lijst, gastVink, gastNaamLabel, gastNaam, fout, ok };
}

// Geeft de nieuwe groep terug, of null bij annuleren. Gooit een Error met een
// tekst voor op het scherm als de kandidaten niet op te halen zijn.
export async function kiesKettingGroep({ eigenKind }) {
  const kandidaten = await haalKandidaten(eigenKind.id);
  const vorige = huidigeKetting(eigenKind.id);
  const gekozen = new Set(vorige ? vorige.leden.map((l) => l.id).filter((id) => kandidaten.some((k) => k.id === id)) : []);

  if (!kiesVenster) kiesVenster = bouwKiesVenster();
  const v = kiesVenster;
  v.uitleg.textContent =
    `Kies 2 of 3 verzamelaars — samen met ${eigenKind.voornaam} een kring van 3 of 4. ` +
    "Iedereen geeft aan de volgende in de kring. Hoogstens één gast zonder account: van hem typ je in ⚡ Snelruilen wat hij heeft en zoekt.";
  v.zoekVeld.value = "";
  v.fout.textContent = "";
  v.gastVink.checked = Boolean(vorige && vorige.gast);
  v.gastNaam.value = vorige && vorige.gast ? vorige.gast.naam : "";

  return new Promise((resolve) => {
    let opgelost = false;
    const aantalAnderen = () => gekozen.size + (v.gastVink.checked ? 1 : 0);

    const tekenGast = () => {
      v.gastNaamLabel.classList.toggle("hidden", !v.gastVink.checked);
      v.gastNaam.classList.toggle("hidden", !v.gastVink.checked);
      v.gastVink.disabled = !v.gastVink.checked && aantalAnderen() >= MAX_ANDEREN;
    };

    const teken = () => {
      const term = normaliseer(v.zoekVeld.value.trim());
      // Wie al aangevinkt is, blijft zichtbaar: anders vink je iemand aan,
      // zoek je de volgende, en zie je niet meer wie er al in zit.
      const zichtbaar = kandidaten.filter((k) => gekozen.has(k.id) || !term || normaliseer(`${k.naam} ${k.letter}`).includes(term));
      v.lijst.textContent = "";
      v.leeg.textContent = kandidaten.length ? "Geen verzamelaar gevonden." : "Er doet nu niemand anders mee.";
      v.leeg.classList.toggle("hidden", zichtbaar.length > 0);
      const vol = aantalAnderen() >= MAX_ANDEREN;
      zichtbaar.forEach((k) => {
        const li = maak("li");
        const label = maak("label", "ketting-kies__optie");
        const vink = maak("input");
        vink.type = "checkbox";
        vink.checked = gekozen.has(k.id);
        vink.disabled = !vink.checked && vol;
        vink.addEventListener("change", () => {
          if (vink.checked) gekozen.add(k.id);
          else gekozen.delete(k.id);
          v.fout.textContent = "";
          teken();
        });
        label.append(vink, maak("span", "", k.naam + (k.letter ? ` ${k.letter}.` : "") + (k.eigenGezin ? " (eigen gezin)" : "")));
        li.append(label);
        v.lijst.append(li);
      });
      tekenGast();
    };

    const klaar = (groep) => {
      opgelost = true;
      v.dialoog.close();
      resolve(groep);
    };

    const opGast = () => {
      v.fout.textContent = "";
      teken();
      if (v.gastVink.checked) v.gastNaam.focus();
    };
    const opZoek = () => teken();
    const opOk = () => {
      const gastNaam = v.gastNaam.value.trim();
      if (v.gastVink.checked && !gastNaam) {
        v.fout.textContent = "Vul de voornaam van de gast in.";
        return;
      }
      if (!gekozen.size) {
        v.fout.textContent = "Kies minstens één verzamelaar met een account.";
        return;
      }
      if (aantalAnderen() < MIN_ANDEREN) {
        v.fout.textContent = "Een kring heeft minstens 3 deelnemers. Met één andere ruil je gewoon rechtstreeks.";
        return;
      }
      // Dezelfde gast houdt wat er al over hem ingevuld was; een andere naam
      // is een andere gast.
      const zelfdeGast = vorige && vorige.gast && vorige.gast.naam === gastNaam;
      const groep = {
        eigenKindId: eigenKind.id,
        leden: kandidaten.filter((k) => gekozen.has(k.id)),
        gast: v.gastVink.checked ? (zelfdeGast ? vorige.gast : { naam: gastNaam, heeft: [], zoekt: [] }) : null,
        stapel: null,
      };
      // Wiens stapel er getypt werd, blijft staan zolang die persoon nog in
      // de groep zit.
      const vorigeStapel = vorige && vorige.stapel;
      if (vorigeStapel === "gast" ? groep.gast && zelfdeGast : groep.leden.some((l) => l.id === vorigeStapel)) {
        groep.stapel = vorigeStapel;
      }
      vergeetLijsten();
      melding = null; // die ging over de vorige groep
      schrijf(groep);
      klaar(groep);
    };

    v.gastVink.addEventListener("change", opGast);
    v.zoekVeld.addEventListener("input", opZoek);
    v.ok.addEventListener("click", opOk);
    v.dialoog.addEventListener(
      "close",
      () => {
        v.gastVink.removeEventListener("change", opGast);
        v.zoekVeld.removeEventListener("input", opZoek);
        v.ok.removeEventListener("click", opOk);
        if (!opgelost) resolve(null);
      },
      { once: true }
    );

    teken();
    v.dialoog.showModal();
    v.zoekVeld.focus();
  });
}

// ---------- tekenen ----------

// Eén weergave voor de ruilpagina en Snelruilen. `groepKnoppen`: kiezen,
// wijzigen en stoppen staan erbij (op de ruilpagina; in Snelruilen staan die
// bovenaan het venster). `opSnelruilen`: een knop om verder te gaan in
// Snelruilen — waar je de codes van de gast typt.
const tekenRonde = new WeakMap();

export async function tekenKetting(doel, { eigenKind, groepKnoppen = false, opSnelruilen = null }) {
  const ronde = (tekenRonde.get(doel) || 0) + 1;
  tekenRonde.set(doel, ronde);
  const actueel = () => tekenRonde.get(doel) === ronde;

  const ketting = huidigeKetting(eigenKind.id);
  doel.textContent = "";
  const fout = maak("div", "message");
  fout.setAttribute("role", "alert");

  const kies = async () => {
    try {
      await kiesKettingGroep({ eigenKind });
    } catch (err) {
      fout.textContent = err.message;
      fout.className = "message message--show message--error";
    }
  };

  if (!ketting) {
    if (groepKnoppen) {
      const knop = maak("button", "btn btn--outline btn--sm", "🔗 Kettingruil zoeken");
      knop.type = "button";
      knop.addEventListener("click", () => void kies());
      doel.append(knop, fout);
    }
    return;
  }

  const kop = maak("p", "ketting__groep");
  kop.append("Kring met ", maak("strong", "", groepNamen(ketting)));
  if (groepKnoppen) {
    const wijzig = maak("button", "snelruil__ruiler-wijzig", "wijzig");
    wijzig.type = "button";
    wijzig.addEventListener("click", () => void kies());
    const stop = maak("button", "snelruil__ruiler-wijzig", "stoppen");
    stop.type = "button";
    stop.addEventListener("click", stopKetting);
    kop.append(" ", wijzig, " ", stop);
  }
  doel.append(kop, fout);
  if (melding && melding.tot > Date.now()) doel.append(maak("div", "message message--show message--success ketting__ok", melding.tekst));

  const laden = maak("p", "form-meta", "Lijsten ophalen…");
  doel.append(laden);
  let perKind;
  try {
    perKind = await haalKettingLijsten(ketting);
  } catch (err) {
    if (!actueel()) return;
    laden.remove();
    fout.textContent = err.message;
    fout.className = "message message--show message--error";
    return;
  }
  if (!actueel()) return;
  laden.remove();

  const deelnemers = deelnemersVan(ketting, eigenKind, perKind);
  if (ketting.gast && !ketting.gast.heeft.length && !ketting.gast.zoekt.length) {
    doel.append(
      maak(
        "p",
        "form-meta ketting__gast-hint",
        `Van ${ketting.gast.naam} weet het portaal nog niets. Typ in ⚡ Snelruilen de codes die ${ketting.gast.naam} dubbel heeft of zoekt, en duid bij elke code aan wat klopt.`
      )
    );
  }
  if (opSnelruilen) {
    const knop = maak("button", "btn btn--outline btn--sm ketting__snelruilen", "⚡ Verder in Snelruilen");
    knop.type = "button";
    knop.addEventListener("click", opSnelruilen);
    doel.append(knop);
  }

  const kringen = zoekKringen(deelnemers);
  if (!kringen.length) {
    doel.append(maak("p", "ketting__geen", "Met deze groep sluit er (nog) geen kring."));
    const pijlen = allePijlen(deelnemers);
    if (pijlen.length) {
      doel.append(maak("p", "form-meta form-meta--plat", "Wat er wél kan — er ontbreekt nog een schakel:"));
      const ul = maak("ul", "ketting__pijlen");
      pijlen.forEach((p) => ul.append(maak("li", "", `${deelnemers[p.van].naam} → ${deelnemers[p.naar].naam}: ${p.codes.join(", ")}`)));
      doel.append(ul);
    }
    return;
  }

  const ol = maak("ol", "ketting__kringen");
  kringen.slice(0, TOON_KRINGEN).forEach((kring, index) => ol.append(kringBlok(kring, index, deelnemers, ketting)));
  doel.append(ol);
  if (kringen.length > TOON_KRINGEN) {
    doel.append(maak("p", "form-meta form-meta--plat", `Nog ${kringen.length - TOON_KRINGEN} andere kringen mogelijk; hierboven de beste.`));
  }
}

function kringBlok(kring, index, deelnemers, ketting) {
  const li = maak("li", "ketting__kring");
  const naam = (i) => deelnemers[i].naam;
  const route = [...kring.leden, kring.leden[0]].map(naam).join(" → ");
  const kop = maak("p", "ketting__kring-kop");
  kop.append(maak("span", "ruilbadge", `Kring ${index + 1}`), " ", maak("strong", "", route));
  const rondes = kring.rondes === 1 ? "1 sticker elk" : `${kring.rondes} stickers elk`;
  kop.append(maak("span", "ketting__rondes", ` · ${rondes}`));
  li.append(kop);

  const buiten = deelnemers.map((d, i) => i).filter((i) => !kring.leden.includes(i));
  if (buiten.length) li.append(maak("p", "form-meta form-meta--plat", `${namenZin(buiten.map(naam))} doet in deze kring niet mee.`));

  const ul = maak("ul", "ketting__stappen");
  kring.pijlen.forEach((p) => {
    const stap = maak("li", "ketting__stap");
    stap.append(`${naam(p.van)} geeft ${naam(p.naar)}: `, maak("strong", "", p.gekozen.join(", ")));
    const rest = p.codes.filter((c) => !p.gekozen.includes(c));
    if (rest.length) stap.append(maak("span", "ketting__rest", ` (kan ook: ${rest.join(", ")})`));
    ul.append(stap);
  });
  li.append(ul);

  // Vastleggen in twee stappen, binnen het blok: een tweede venster bovenop
  // Snelruilen zou de tafel enkel trager maken, en dit verandert je lijst.
  const eigen = kring.leden.filter((i) => deelnemers[i].eigenGezin && deelnemers[i].sleutel);
  const anderen = kring.leden.filter((i) => !deelnemers[i].eigenGezin);
  const vak = maak("div", "ketting__vastleggen");
  const melding = maak("div", "message");
  melding.setAttribute("role", "alert");
  melding.setAttribute("aria-live", "polite");
  const knop = maak("button", "btn btn--primary btn--sm", `Vastleggen voor ${namenZin(eigen.map(naam))}`);
  knop.type = "button";
  knop.addEventListener("click", () => {
    vak.textContent = "";
    const regels = eigen.map((i) => {
      const plaats = kring.leden.indexOf(i);
      const krijgt = kring.pijlen[(plaats - 1 + kring.pijlen.length) % kring.pijlen.length];
      const geeft = kring.pijlen[plaats];
      return `${naam(i)} kreeg ${krijgt.gekozen.join(", ")} en gaf ${geeft.gekozen.join(", ")}.`;
    });
    // Een gast heeft niets vast te leggen: het portaal kent zijn lijst niet.
    const metAccount = anderen.filter((i) => !deelnemers[i].gast);
    const anderenZin = metAccount.length
      ? ` ${namenZin(metAccount.map(naam))} ${metAccount.length === 1 ? "legt dat deel zelf vast" : "leggen hun deel zelf vast"}, vanaf het eigen account.`
      : "";
    vak.append(
      maak("p", "form-meta form-meta--plat", `Zijn de stickers van hand gewisseld? ${regels.join(" ")} Je lijst wordt meteen bijgewerkt.${anderenZin}`)
    );
    const ja = maak("button", "btn btn--primary btn--sm", "Ja, vastleggen");
    ja.type = "button";
    const nee = maak("button", "btn btn--outline btn--sm", "Annuleren");
    nee.type = "button";
    nee.addEventListener("click", () => {
      vak.textContent = "";
      vak.append(knop, melding);
    });
    ja.addEventListener("click", async () => {
      ja.disabled = true;
      nee.disabled = true;
      try {
        await legKringVast(kring, deelnemers);
        // De groep blijft: aan tafel volgt vaak een tweede kring met dezelfde
        // mensen. Wie klaar is, drukt op stoppen.
        if (ketting.gast) {
          // Wat de gast gaf en kreeg, heeft of zoekt hij niet meer.
          const weg = new Set(kring.pijlen.filter((p) => deelnemers[p.van].gast || deelnemers[p.naar].gast).flatMap((p) => p.gekozen));
          const huidig = huidigeKetting(ketting.eigenKindId);
          if (huidig && huidig.gast) {
            schrijf({
              ...huidig,
              gast: { ...huidig.gast, heeft: huidig.gast.heeft.filter((c) => !weg.has(c)), zoekt: huidig.gast.zoekt.filter((c) => !weg.has(c)) },
            }, { geregistreerd: true });
          }
        }
      } catch (err) {
        vak.textContent = "";
        vak.append(knop, melding);
        melding.textContent = err.message;
        melding.className = "message message--show message--error";
      }
    });
    const acties = maak("div", "form-actions");
    acties.append(ja, nee);
    vak.append(acties);
  });
  vak.append(knop, melding);
  const online = onlineKringKnop(kring, deelnemers, melding);
  if (online) vak.append(online);
  li.append(vak);
  return li;
}

// Online (migratie 033): dezelfde kring als voorstel met een groepsgesprek,
// in plaats van vastleggen achteraf. Niet met een gast — die heeft geen
// account om mee te praten — en niet als iedereen uit het eigen gezin komt.
function onlineKringKnop(kring, deelnemers, melding) {
  const leden = kring.leden.map((i) => deelnemers[i]);
  if (leden.some((d) => d.gast || !d.sleutel) || leden.every((d) => d.eigenGezin)) return null;
  const knop = maak("button", "btn btn--outline btn--sm", "💬 Online voorstellen");
  knop.type = "button";
  knop.title = "Stuur deze kring als voorstel naar de andere gezinnen en spreek samen af hoe jullie ruilen.";
  knop.addEventListener("click", async () => {
    knop.disabled = true;
    try {
      const items = kring.pijlen.flatMap((p) =>
        p.gekozen.map((sticker) => ({ van: deelnemers[p.van].sleutel, naar: deelnemers[p.naar].sleutel, sticker }))
      );
      await stelOnlineVoor({
        eigenKindId: deelnemers[0].sleutel,
        soort: kring.leden.length > 2 ? "ketting" : "ruil",
        items,
      });
    } catch (err) {
      knop.disabled = false;
      melding.textContent = err.message;
      melding.className = "message message--show message--error";
    }
  });
  return knop;
}

// Na het vastleggen tekent het blok zich opnieuw (de lijsten veranderden). De
// bevestiging blijft er even bij staan — niet voor altijd, anders lees je bij
// de volgende kring nog "vastgelegd" van de vorige.
let melding = null;
