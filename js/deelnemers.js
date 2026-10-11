// deelnemers.js — het organisatieblok op statistieken.html: wie kwam er naar de
// ruilbeurzen, van waar, hoe oud, langs welk kanaal, en wanneer ingeschreven.
//
// ENKEL VOOR DE ORGANISATIE. De rest van de statistiekenpagina toont bewust
// geen namen en telt alles in SQL (zie js/statistieken.js). Dit blok is anders:
// het verschijnt enkel voor een beheerder, en de rijen zijn dezelfde kinderen
// die die op aanwezigheden.html al met naam ziet. deelnemers_overzicht()
// (migratie 030) controleert is_beheerder() opnieuw — de pagina beveiligt niets.
//
// HIER WORDT WÉL GETELD. Het gaat om enkele honderden rijen, en de organisatie
// wil kunnen wisselen tussen beurzen en tussen "ingeschreven" en "aanwezig"
// zonder telkens de databank te bevragen. Eén RPC, de rest in de browser.
//
// Verzamelaars en gasten staan samen: voor de vraag "van waar komen ze" maakt
// het niet uit of iemand al een account heeft.
import { supabase, requireAuth } from "./supabase.js";
import { opschrift } from "./hoe-gevonden.js";
import { normaliseer } from "./landen-data.js";
import { GETAL, tooltip, vulKaarten, staafGrafiek } from "./statistieken.js";

const DAG = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", year: "numeric" });
const WEEK = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short" });
const PROCENT = new Intl.NumberFormat("nl-BE", { style: "percent", maximumFractionDigits: 0 });
const KOMMA = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 1 });

// Meer gemeenten dan dit wordt een muur van balkjes; de rest gaat samen.
const TOP_GEMEENTEN = 12;

const KOLOMMEN = [
  { sleutel: "naam", titel: "Naam" },
  { sleutel: "soort", titel: "Soort" },
  { sleutel: "ouder", titel: "Ouder" },
  { sleutel: "gemeente", titel: "Wijk / gemeente" },
  { sleutel: "leeftijd", titel: "Leeftijd" },
  { sleutel: "kanaal", titel: "Gevonden via" },
  { sleutel: "ingeschreven", titel: "Ingeschreven" },
  { sleutel: "status", titel: "Status" },
];

let events = [];
let alle = [];
let rijen = []; // na filter, met de velden die de tabel toont
let sortering = { sleutel: "ingeschreven", op: true };
let zoekterm = "";

document.addEventListener("DOMContentLoaded", async () => {
  const kaart = document.getElementById("deeln-kaart");
  if (!kaart) return;

  const user = await requireAuth();
  if (!user) return;

  try {
    const { data: beheerder } = await supabase.rpc("is_beheerder");
    if (!beheerder) return;
    const ev = await supabase.from("events").select("id,naam,start,einde").order("start", { ascending: true });
    if (ev.error) throw ev.error;
    const dn = await supabase.rpc("deelnemers_overzicht");
    if (dn.error) throw dn.error;
    events = (ev.data || []).map((e) => ({ ...e, start: new Date(e.start) }));
    alle = dn.data || [];
  } catch (err) {
    return; // migratie 030 nog niet gedraaid: het blok blijft gewoon weg
  }

  kaart.classList.remove("hidden");
  document.getElementById("deeln-titel-uitleg").appendChild(
    tooltip(
      "Verzamelaars met een account én gasten (ingeschreven via de website of aan de inkom). " +
        "Leeftijd van een verzamelaar = dit jaar min het geboortejaar dat de ouder invulde."
    )
  );

  const keuze = document.getElementById("deeln-event");
  keuze.appendChild(new Option("Alle beurzen", ""));
  events.forEach((e) => keuze.appendChild(new Option(`${e.naam}`, e.id)));
  // De beurs waar het nu om draait: de eerstvolgende, anders de laatste.
  const nu = new Date();
  keuze.value = (events.find((e) => new Date(e.einde) > nu) || events[events.length - 1] || { id: "" }).id;

  const sorteer = document.getElementById("deeln-sorteer");
  KOLOMMEN.forEach((k) => sorteer.appendChild(new Option(k.titel, k.sleutel)));
  sorteer.value = sortering.sleutel;

  keuze.addEventListener("change", teken);
  document.getElementById("deeln-wie").addEventListener("change", teken);
  sorteer.addEventListener("change", () => {
    sortering = { sleutel: sorteer.value, op: sortering.op };
    tekenTabel();
  });
  document.getElementById("deeln-richting").addEventListener("click", () => {
    sortering.op = !sortering.op;
    tekenTabel();
  });
  document.getElementById("deeln-zoek").addEventListener("input", (e) => {
    zoekterm = normaliseer(e.target.value.trim());
    tekenTabel();
  });

  teken();
});

// ---------- filteren ----------

// De stand van één kind voor de gekozen beurs, of samengevat over alle beurzen.
function stand(d, eventId) {
  const a = d.aanwezigheid || {};
  if (eventId) {
    const s = a[eventId];
    return s
      ? { komt: Boolean(s.komt), aanwezig: Boolean(s.aangemeld), op: s.komt_op ? new Date(s.komt_op) : null, beurzen: s.aangemeld ? 1 : 0 }
      : null;
  }
  const lijst = Object.values(a).filter((s) => s.komt || s.aangemeld);
  if (!lijst.length) return null;
  const data = lijst.map((s) => s.komt_op && new Date(s.komt_op)).filter(Boolean);
  return {
    komt: true,
    aanwezig: lijst.some((s) => s.aangemeld),
    op: data.length ? new Date(Math.min(...data)) : null,
    beurzen: lijst.filter((s) => s.aangemeld).length,
  };
}

// Een wijk of gemeente zoals ze getypt werd, samengevoegd zonder onderscheid in
// hoofdletters of accenten: "meulestede", "Meulestede " en "Meulestede" zijn één staaf.
function gemeenteSleutel(t) {
  return normaliseer((t || "").trim());
}

function filter() {
  const eventId = document.getElementById("deeln-event").value;
  const wie = document.getElementById("deeln-wie").value;

  return alle
    .map((d) => ({ d, s: stand(d, eventId) }))
    .filter(({ s }) => {
      if (!s) return false;
      if (wie === "aanwezig") return s.aanwezig;
      if (wie === "afwezig") return s.komt && !s.aanwezig;
      return true;
    })
    .map(({ d, s }) => ({
      id: d.id,
      naam: d.naam,
      soort: d.soort === "gast" ? "gast" : "verzamelaar",
      ouder: d.ouder || "",
      gemeente: (d.gemeente || "").trim(),
      leeftijd: d.leeftijd ?? null,
      kanaal: d.hoe_gevonden ? opschrift(d.hoe_gevonden) : "",
      ingeschreven: s.op,
      aanwezig: s.aanwezig,
      status: eventId ? (s.aanwezig ? "aanwezig" : "ingeschreven") : `${s.beurzen}× aanwezig`,
    }));
}

// ---------- tekenen ----------

function teken() {
  rijen = filter();
  tekenCijfers();
  tekenGrafieken();
  tekenTabel();
}

function tekenCijfers() {
  const eventId = document.getElementById("deeln-event").value;
  const ingeschreven = rijen.length;
  const aanwezig = rijen.filter((r) => r.aanwezig).length;
  const gasten = rijen.filter((r) => r.soort === "gast").length;
  const gezinnen = new Set(rijen.map((r) => normaliseer(r.ouder))).size;
  const leeftijden = rijen.map((r) => r.leeftijd).filter((l) => l != null);
  const gemiddeld = leeftijden.length ? leeftijden.reduce((a, b) => a + b, 0) / leeftijden.length : null;
  const gemeenten = new Set(rijen.map((r) => gemeenteSleutel(r.gemeente)).filter(Boolean)).size;

  vulKaarten("deeln-cijfers", [
    { icoon: "📝", getal: GETAL.format(ingeschreven), label: "kinderen in de selectie",
      uitleg: "Wie ingeschreven was of aanwezig was, binnen de keuze hierboven." },
    { icoon: "✅", getal: GETAL.format(aanwezig), label: "aanwezig",
      uitleg: "Aan de inkom afgevinkt (of achteraf aangeduid)." },
    { icoon: "📈", getal: ingeschreven ? PROCENT.format(aanwezig / ingeschreven) : "–", label: "opkomst",
      uitleg: eventId
        ? "Aanwezig gedeeld door het aantal in de selectie. Wie zonder inschrijving binnenkwam, telt aan beide kanten mee."
        : "Over alle beurzen: wie minstens één keer aanwezig was." },
    { icoon: "👨‍👩‍👧", getal: GETAL.format(gezinnen), label: "gezinnen",
      uitleg: "Geteld op de naam van de ouder — een benadering, want een gezin kan op twee namen staan." },
    { icoon: "🎟️", getal: GETAL.format(gasten), label: "gasten zonder account",
      uitleg: "Ingeschreven via de website of aan de inkom, en (nog) geen verzamelaar in het portaal." },
    { icoon: "🎂", getal: gemiddeld == null ? "–" : KOMMA.format(gemiddeld), label: "gemiddelde leeftijd",
      uitleg: `Van de ${GETAL.format(leeftijden.length)} kinderen van wie we de leeftijd kennen.` },
    { icoon: "📍", getal: GETAL.format(gemeenten), label: "wijken en gemeenten",
      uitleg: "Verschillende ingevulde wijken of gemeenten, zonder onderscheid in hoofdletters." },
  ]);
}

function telPer(sleutelVan, labelVan) {
  const tel = new Map();
  for (const r of rijen) {
    const s = sleutelVan(r);
    const t = tel.get(s) || { label: labelVan(r), waarde: 0 };
    t.waarde++;
    tel.set(s, t);
  }
  return [...tel.values()];
}

function tekenGrafieken() {
  // Per wijk / gemeente: de grootste eerst, de staart samen.
  let gemeenten = telPer(
    (r) => gemeenteSleutel(r.gemeente) || "~",
    (r) => r.gemeente || "Niet ingevuld"
  ).sort((a, b) => b.waarde - a.waarde);
  if (gemeenten.length > TOP_GEMEENTEN) {
    const rest = gemeenten.slice(TOP_GEMEENTEN - 1);
    gemeenten = [
      ...gemeenten.slice(0, TOP_GEMEENTEN - 1),
      { label: `${rest.length} andere`, waarde: rest.reduce((n, r) => n + r.waarde, 0) },
    ];
  }
  staafGrafiek("deeln-gemeente", {
    titel: "Per wijk of gemeente",
    uitleg: "Zoals de ouder het invulde. De september-inschrijving vroeg er niet naar: die staan onder 'Niet ingevuld'.",
    rijen: gemeenten.map((g) => ({ ...g, titel: `${g.label}: ${g.waarde}` })),
  });

  const leeftijd = telPer((r) => (r.leeftijd == null ? 99 : r.leeftijd), (r) => (r.leeftijd == null ? "Onbekend" : `${r.leeftijd} jaar`))
    .sort((a, b) => (a.label === "Onbekend") - (b.label === "Onbekend") || parseInt(a.label) - parseInt(b.label));
  staafGrafiek("deeln-leeftijd", {
    titel: "Per leeftijd",
    uitleg: "Gasten: de leeftijd uit de inschrijving. Verzamelaars: dit jaar min het geboortejaar.",
    rijen: leeftijd.map((g) => ({ ...g, titel: `${g.label}: ${g.waarde}` })),
  });

  const kanaal = telPer((r) => r.kanaal || "~", (r) => r.kanaal || "Niet ingevuld").sort((a, b) => b.waarde - a.waarde);
  staafGrafiek("deeln-kanaal", {
    titel: "Gevonden via",
    uitleg: "Per kind geteld, niet per gezin — een gezin met drie kinderen weegt hier drie keer. De telling per gezin staat op aanwezigheden.html.",
    rijen: kanaal.map((g) => ({ ...g, titel: `${g.label}: ${g.waarde}` })),
  });

  // Inschrijvingen per week (maandag als begin), in de tijd.
  const weken = new Map();
  for (const r of rijen) {
    if (!r.ingeschreven) continue;
    const d = new Date(r.ingeschreven);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const s = d.getTime();
    weken.set(s, (weken.get(s) || 0) + 1);
  }
  const perWeek = [...weken.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, waarde]) => ({ label: `week van ${WEEK.format(new Date(s))}`, waarde, titel: `${waarde} inschrijvingen` }));
  staafGrafiek("deeln-weken", {
    titel: "Inschrijvingen per week",
    uitleg: "Wanneer een kind ingeschreven werd voor de beurs (bij 'Alle beurzen': de eerste keer). Wie zonder inschrijving binnenkwam, telt hier niet mee.",
    rijen: perWeek,
  });
}

function vergelijk(a, b, sleutel) {
  const x = a[sleutel];
  const y = b[sleutel];
  if (x instanceof Date) return x - y;
  if (typeof x === "number") return x - y;
  return String(x).localeCompare(String(y), "nl-BE", { sensitivity: "base" });
}

function tekenTabel() {
  const { sleutel, op } = sortering;
  const zichtbaar = rijen
    .filter((r) => !zoekterm || normaliseer(`${r.naam} ${r.ouder} ${r.gemeente} ${r.kanaal}`).includes(zoekterm))
    .sort((a, b) => {
      // Lege waarden altijd achteraan, welke richting ook.
      const leeg = (v) => v == null || v === "";
      if (leeg(a[sleutel]) !== leeg(b[sleutel])) return leeg(a[sleutel]) ? 1 : -1;
      const v = vergelijk(a, b, sleutel);
      return (op ? v : -v) || vergelijk(a, b, "naam");
    });

  document.getElementById("deeln-sorteer").value = sleutel;
  const knop = document.getElementById("deeln-richting");
  knop.textContent = op ? "↑ oplopend" : "↓ aflopend";

  const kop = document.getElementById("deeln-kop");
  kop.textContent = "";
  KOLOMMEN.forEach((k) => {
    const th = document.createElement("th");
    th.setAttribute("aria-sort", k.sleutel === sleutel ? (op ? "ascending" : "descending") : "none");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "deeln-kopknop";
    b.textContent = k.titel + (k.sleutel === sleutel ? (op ? " ▲" : " ▼") : "");
    // Nog eens op dezelfde kolom klikken draait de richting om.
    b.addEventListener("click", () => {
      sortering = { sleutel: k.sleutel, op: k.sleutel === sleutel ? !op : true };
      tekenTabel();
    });
    th.appendChild(b);
    kop.appendChild(th);
  });

  const body = document.getElementById("deeln-rijen");
  body.textContent = "";
  zichtbaar.forEach((r) => {
    const tr = document.createElement("tr");
    const cellen = [
      [r.naam, "aanwezig-tabel__naam"],
      [r.soort, "aanwezig-tabel__ouder"],
      [r.ouder, "aanwezig-tabel__ouder"],
      [r.gemeente, ""],
      [r.leeftijd == null ? "" : String(r.leeftijd), "aanwezig-kol"],
      [r.kanaal, ""],
      [r.ingeschreven ? DAG.format(r.ingeschreven) : "", ""],
      [r.status, r.aanwezig ? "aanwezig-vast" : "aanwezig-leeg"],
    ];
    cellen.forEach(([tekst, klasse]) => {
      const td = document.createElement("td");
      if (klasse) td.className = klasse;
      td.textContent = tekst;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  if (!zichtbaar.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = KOLOMMEN.length;
    td.className = "aanwezig-leeg";
    td.textContent = "Niemand in deze selectie.";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  document.getElementById("deeln-telling").textContent =
    `${GETAL.format(zichtbaar.length)} van ${GETAL.format(rijen.length)} kinderen`;
}
