// gesprekken.js — online ruilen afspreken (migratie 033).
//
// Eén pagina voor alle online ruilen van het gezin: links de lijst, rechts het
// gekozen gesprek met de fase, wat er van hand wisselt, de knoppen die bij die
// fase horen en het gesprek zelf.
//
// WAAROM DE FASES HIER EN NIET OP DE RUILPAGINA. De ruilpagina is de ruiltafel:
// registreren gebeurt nadat de kaarten van hand wisselden. Online komt de
// afspraak eerst en de stickers dagen later — dat is een gesprek, en een
// gesprek wil een eigen plek die je terugvindt via 💬 Berichten of de bel.
//
// HET ACCOUNT IS VAN HET GEZIN. Ouders delen het toestel met hun kinderen; wie
// schrijft, kies je in "Wie schrijft er?". Iedereen van het gezin leest alles.
// Een mail gaat enkel naar de ouders (Edge Function berichten-mail).
//
// Geen realtime-verbinding: zolang de pagina zichtbaar is, haalt ze het open
// gesprek elke 20 seconden opnieuw op. Voor een ruil per post is dat ruim
// genoeg, en het houdt de site zonder extra diensten.
import { supabase, requireAuth } from "./supabase.js";
import { loadKinderen } from "./kinderen.js";
import { haalSterren, sterrenElement } from "./online.js";
import { ACTIES_EVENT } from "./acties.js";

const VERVERS_MS = 20000;

let kinderen = [];
let lijst = [];
let detail = null;
let openId = null;
let isBeheerder = false;
let ruilmomenten = [];
let sterren = new Map();
let auteurKeuze = ""; // kind-id of "" voor een ouder; blijft over hertekenen heen

const STATUS = {
  VOORGESTELD: { tekst: "Voorgesteld", klasse: "wacht" },
  GERESERVEERD: { tekst: "Gereserveerd", klasse: "bezig" },
  BEVESTIGD: { tekst: "Bevestigd", klasse: "bezig" },
  GEREALISEERD: { tekst: "Gerealiseerd", klasse: "klaar" },
  VRIJGEGEVEN: { tekst: "Vrijgegeven", klasse: "dicht" },
  AFGESPRONGEN: { tekst: "Afgesprongen", klasse: "dicht" },
  VERVALLEN: { tekst: "Vervallen", klasse: "dicht" },
  GESCHIL: { tekst: "Bij de organisatie", klasse: "geschil" },
};
const OPEN = ["VOORGESTELD", "GERESERVEERD", "BEVESTIGD", "GESCHIL"];
const WIJZE = { verzenden: "📮 per post", afspreken: "🤝 afspreken", afhalen: "🏠 afhalen in het CC Meulestede" };

const datumUur = new Intl.DateTimeFormat("nl-BE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
const datumKort = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "long", timeZone: "Europe/Brussels" });
const uurKort = new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });

document.addEventListener("DOMContentLoaded", async () => {
  await requireAuth();
  try {
    kinderen = (await loadKinderen()) || [];
  } catch {
    kinderen = [];
  }
  openId = new URLSearchParams(location.search).get("id");

  // Promise.resolve: de builder van supabase-js heeft enkel then(), geen catch().
  const [, beheer] = await Promise.all([
    Promise.resolve(supabase.rpc("afspraken_verlopen_verwerken")).catch(() => null),
    Promise.resolve(supabase.rpc("is_beheerder")).catch(() => ({ data: false })),
  ]);
  isBeheerder = Boolean(beheer && beheer.data);

  await laadLijst();
  if (openId) await laadDetail(openId);
  if (isBeheerder) void tekenBeheer();
  void laadRuilmomenten();

  setInterval(() => {
    if (document.hidden) return;
    void laadLijst();
    if (openId && !bezigMetTypen()) void laadDetail(openId, { stil: true });
  }, VERVERS_MS);
  window.addEventListener("popstate", () => {
    openId = new URLSearchParams(location.search).get("id");
    if (openId) void laadDetail(openId);
    else sluitDetail();
  });
});

// ---------- gegevens ----------

async function laadLijst() {
  const doel = document.getElementById("gesprekken-lijst");
  const { data, error } = await supabase.rpc("mijn_afspraken");
  if (error) {
    doel.textContent = "";
    doel.append(p("form-meta form-meta--plat", /function|schema cache/i.test(error.message || "")
      ? "Online ruilen staat nog niet aan in de databank (migratie 033)."
      : "De gesprekken konden niet geladen worden: " + error.message));
    return;
  }
  lijst = Array.isArray(data) ? data : [];
  const ids = lijst.flatMap((a) => (a.deelnemers || []).filter((d) => !d.eigen_gezin).map((d) => d.kind_id));
  sterren = await haalSterren(ids);
  tekenLijst();
}

async function laadDetail(id, { stil = false } = {}) {
  const { data, error } = await supabase.rpc("afspraak_detail", { p_afspraak: id });
  if (error) {
    if (!stil) toonDetailFout(error.message);
    return;
  }
  detail = data;
  openId = id;
  const extra = (detail.deelnemers || []).filter((d) => !d.eigen_gezin && !sterren.has(d.kind_id)).map((d) => d.kind_id);
  if (extra.length) (await haalSterren(extra)).forEach((v, k) => sterren.set(k, v));
  tekenDetail({ stil });
  // Het gesprek is nu gelezen: de bel en de lijst mogen dat meteen weten.
  const rij = lijst.find((a) => a.id === id);
  if (rij && rij.ongelezen) {
    rij.ongelezen = 0;
    tekenLijst();
    document.dispatchEvent(new CustomEvent(ACTIES_EVENT));
  }
}

async function laadRuilmomenten() {
  const { data } = await supabase
    .from("ruilmomenten")
    .select("id,start,einde,plaats,opmerking")
    .gt("einde", new Date().toISOString())
    .order("start");
  ruilmomenten = Array.isArray(data) ? data : [];
}

// Een actie uitvoeren en daarna alles opnieuw ophalen: de databank beslist,
// de pagina toont enkel wat er nu geldt.
async function doe(knop, rpc, params, foutDoel) {
  if (knop) knop.disabled = true;
  const { error } = await supabase.rpc(rpc, params);
  if (error) {
    if (knop) knop.disabled = false;
    toonFout(foutDoel, error.message);
    return false;
  }
  await Promise.all([laadLijst(), laadDetail(openId, { stil: true })]);
  document.dispatchEvent(new CustomEvent(ACTIES_EVENT));
  return true;
}

// ---------- lijst ----------

function tekenLijst() {
  const doel = document.getElementById("gesprekken-lijst");
  doel.textContent = "";
  if (!lijst.length) {
    doel.append(p("form-meta form-meta--plat",
      "Nog geen gesprekken. Kies op de ruilpagina een ruiler en tik op “💬 Online voorstellen”."));
    const a = document.createElement("a");
    a.href = "/ruilen.html";
    a.className = "btn btn--primary btn--sm";
    a.textContent = "Naar de ruilpagina";
    doel.append(a);
    return;
  }
  const open = lijst.filter((a) => OPEN.includes(a.status));
  const dicht = lijst.filter((a) => !OPEN.includes(a.status));
  const ul = document.createElement("ul");
  ul.className = "gesprekken__items";
  open.forEach((a) => ul.append(lijstItem(a)));
  doel.append(ul);
  if (!open.length) doel.prepend(p("form-meta form-meta--plat", "Geen lopende ruilen."));
  if (dicht.length) {
    const details = document.createElement("details");
    details.className = "gesprekken__archief";
    details.open = dicht.some((a) => a.id === openId || a.actie);
    const kop = document.createElement("summary");
    kop.textContent = `Afgesloten (${dicht.length})`;
    const ul2 = document.createElement("ul");
    ul2.className = "gesprekken__items";
    dicht.forEach((a) => ul2.append(lijstItem(a)));
    details.append(kop, ul2);
    doel.append(details);
  }
}

function lijstItem(a) {
  const li = document.createElement("li");
  const knop = document.createElement("a");
  knop.href = `/gesprekken.html?id=${encodeURIComponent(a.id)}`;
  knop.className = "gesprekken__item" + (a.id === openId ? " gesprekken__item--open" : "");
  if (a.id === openId) knop.setAttribute("aria-current", "true");
  knop.addEventListener("click", (e) => {
    e.preventDefault();
    history.pushState(null, "", knop.href);
    void laadDetail(a.id);
  });
  const anderen = (a.deelnemers || []).filter((d) => !d.eigen_gezin).map((d) => d.naam);
  const eigen = (a.deelnemers || []).filter((d) => d.eigen_gezin).map((d) => d.voornaam || d.naam);
  const titel = p("gesprekken__naam", (a.soort === "ketting" ? "🔗 " : "") + anderen.join(", "));
  const sub = p("gesprekken__sub", `${eigen.join(", ")} · ${(a.items || []).length} stickers`);
  const rechts = document.createElement("span");
  rechts.className = "gesprekken__rechts";
  rechts.append(statusChip(a.status));
  if (a.ongelezen) {
    const n = document.createElement("span");
    n.className = "gesprekken__nieuw";
    n.textContent = String(a.ongelezen);
    n.setAttribute("aria-label", `${a.ongelezen} nieuw`);
    rechts.append(n);
  }
  const links = document.createElement("span");
  links.className = "gesprekken__links";
  links.append(titel, sub);
  knop.append(links, rechts);
  li.append(knop);
  return li;
}

// ---------- detail ----------

function sluitDetail() {
  detail = null;
  document.getElementById("gesprek").classList.add("hidden");
  tekenLijst();
}

function toonDetailFout(tekst) {
  const vak = document.getElementById("gesprek");
  vak.classList.remove("hidden");
  vak.textContent = "";
  vak.append(p("message message--show message--error", tekst));
}

function bezigMetTypen() {
  const veld = document.getElementById("gesprek-tekst");
  return Boolean(veld && (veld.value.trim() || document.activeElement === veld && veld.value));
}

function eigenKinderen() {
  return (detail.deelnemers || []).filter((d) => d.eigen_gezin);
}

function naamVan(kindId) {
  const d = (detail.deelnemers || []).find((x) => x.kind_id === kindId);
  return d ? d.voornaam || d.naam : "?";
}

function tekenDetail({ stil = false } = {}) {
  const vak = document.getElementById("gesprek");
  const scrollWasOnder = (() => {
    const b = document.getElementById("gesprek-berichten");
    return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 40;
  })();
  vak.classList.remove("hidden");
  vak.textContent = "";
  tekenLijst();

  const status = detail.status;
  const kop = document.createElement("div");
  kop.className = "gesprek__kop";
  const h2 = document.createElement("h2");
  h2.textContent = (detail.soort === "ketting" ? "🔗 Kettingruil met " : "Ruil met ") +
    (detail.deelnemers || []).filter((d) => !d.eigen_gezin).map((d) => d.naam).join(", ");
  kop.append(h2, statusChip(status));
  vak.append(kop);

  // Wie doet mee, met sterren.
  const wie = document.createElement("ul");
  wie.className = "gesprek__deelnemers";
  (detail.deelnemers || []).forEach((d) => {
    const li = document.createElement("li");
    li.append(document.createTextNode(d.naam + (d.eigen_gezin ? " (jij)" : " ")));
    if (!d.eigen_gezin) li.append(sterrenElement(sterren.get(d.kind_id), { klein: true }));
    if (status === "VOORGESTELD") li.append(vinkje(d.geantwoord, d.geantwoord ? "antwoordde" : "nog geen antwoord"));
    if (["BEVESTIGD", "GESCHIL", "GEREALISEERD"].includes(status)) li.append(vinkje(d.gerealiseerd, d.gerealiseerd ? "ontvangen" : "nog niet ontvangen"));
    wie.append(li);
  });
  vak.append(wie);

  vak.append(fasebalk(status));
  if (detail.als_beheerder) vak.append(p("message message--show gesprek__beheer", "Je leest mee als organisatie."));
  if (detail.vervalt_op && OPEN.includes(status)) {
    vak.append(p("form-meta form-meta--plat", `Termijn: tot ${datumKort.format(new Date(detail.vervalt_op))}. Daarna vervalt de ruil en komen de stickers weer vrij.`));
  }
  if (eigenKinderen().some((d) => d.nazien)) {
    vak.append(p("message message--show message--warning",
      "Kijk je lijst even na: het portaal kon niet alles automatisch terugzetten of verwerken, omdat je lijst intussen veranderd was."));
  }

  vak.append(itemsBlok());
  if (detail.wijze) vak.append(afspraakBlok());
  const acties = actiesBlok();
  if (acties) vak.append(acties);
  vak.append(gesprekBlok());
  if (!detail.als_beheerder) vak.append(problemenBlok());

  const berichten = document.getElementById("gesprek-berichten");
  if (berichten && (!stil || scrollWasOnder)) berichten.scrollTop = berichten.scrollHeight;
  if (!stil) vak.scrollIntoView({ block: "nearest" });
}

function fasebalk(status) {
  const stappen = ["VOORGESTELD", "GERESERVEERD", "BEVESTIGD", "GEREALISEERD"];
  const ol = document.createElement("ol");
  ol.className = "fasebalk";
  ol.setAttribute("aria-label", "Fases van de ruil");
  let bereikt = stappen.indexOf(status);
  if (status === "GESCHIL") bereikt = 2;
  if (bereikt < 0) {
    // Afgesloten zonder ruil: toon tot waar het kwam.
    bereikt = detail.bevestigd_op ? 2 : detail.gereserveerd_op ? 1 : 0;
  }
  stappen.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "fasebalk__stap" + (i < bereikt ? " fasebalk__stap--gedaan" : i === bereikt ? " fasebalk__stap--nu" : "");
    if (i === bereikt) li.setAttribute("aria-current", "step");
    li.textContent = STATUS[s].tekst;
    ol.append(li);
  });
  if (!OPEN.includes(status) && status !== "GEREALISEERD") {
    const li = document.createElement("li");
    li.className = "fasebalk__stap fasebalk__stap--einde";
    li.textContent = STATUS[status].tekst;
    ol.append(li);
  }
  return ol;
}

function itemsBlok() {
  const blok = document.createElement("div");
  blok.className = "gesprek__items";
  blok.append(p("gesprek__subkop", "Wat er van hand wisselt"));
  const groepen = new Map();
  (detail.items || []).forEach((i) => {
    const sleutel = `${i.van}>${i.naar}`;
    if (!groepen.has(sleutel)) groepen.set(sleutel, { van: i.van, naar: i.naar, items: [] });
    groepen.get(sleutel).items.push(i);
  });
  const ul = document.createElement("ul");
  groepen.forEach((g) => {
    const li = document.createElement("li");
    li.append(document.createTextNode(`${naamVan(g.van)} geeft ${naamVan(g.naar)}: `));
    g.items.forEach((i, n) => {
      if (n) li.append(", ");
      const code = document.createElement("strong");
      code.textContent = i.sticker;
      li.append(code);
      if (i.naam) li.append(` (${i.naam})`);
    });
    ul.append(li);
  });
  if (!groepen.size) ul.append(p("form-meta form-meta--plat", "Geen stickers meer in deze ruil."));
  blok.append(ul);
  return blok;
}

function afspraakBlok() {
  const blok = document.createElement("div");
  blok.className = "gesprek__afspraak";
  let tekst = `Afgesproken: ${WIJZE[detail.wijze] || detail.wijze}`;
  if (detail.wijze === "afhalen" && detail.ruilmoment) {
    tekst += `, ruilmoment ${datumUur.format(new Date(detail.ruilmoment.start))}–${uurKort.format(new Date(detail.ruilmoment.einde))}`;
  }
  blok.append(p("", tekst + "."));
  if (detail.afspraak_tekst) blok.append(p("form-meta form-meta--plat", "“" + detail.afspraak_tekst + "”"));
  if (detail.geschil_beslissing) blok.append(p("form-meta form-meta--plat", "Beslissing organisatie: " + detail.geschil_beslissing));
  return blok;
}

// De knoppen die bij de fase horen, telkens per eigen verzamelaar wanneer de
// databank dat per kind bijhoudt (ontvangen), anders voor het gezin.
function actiesBlok() {
  const status = detail.status;
  const blok = document.createElement("div");
  blok.className = "gesprek__acties";
  const fout = p("message", "");
  fout.setAttribute("role", "alert");
  const eigen = eigenKinderen();
  const eerste = eigen[0] && eigen[0].kind_id;

  if (detail.als_beheerder) {
    if (status !== "GESCHIL") return null;
    blok.append(p("gesprek__subkop", "Beslissen over dit geschil"));
    const toel = tekstveld("Toelichting voor de gezinnen (optioneel)", 500);
    const ja = knop("De ruil is gerealiseerd", "btn--primary");
    const nee = knop("De ruil is afgesprongen", "btn--outline");
    ja.addEventListener("click", () => doe(ja, "afspraak_geschil_beslissen", { p_afspraak: detail.id, p_uitkomst: "GEREALISEERD", p_toelichting: toel.veld.value }, fout));
    nee.addEventListener("click", () => doe(nee, "afspraak_geschil_beslissen", { p_afspraak: detail.id, p_uitkomst: "AFGESPRONGEN", p_toelichting: toel.veld.value }, fout));
    blok.append(toel.label, rij(ja, nee), fout);
    return blok;
  }

  if (status === "VOORGESTELD") {
    const wacht = eigen.some((d) => !d.geantwoord);
    blok.append(p("form-meta form-meta--plat", wacht
      ? "Antwoord hieronder in het gesprek: zodra iedereen geantwoord heeft, worden de stickers gereserveerd. Niet akkoord? Geef het voorstel dan vrij."
      : "Wachten tot iedereen antwoordt. Daarna worden de stickers gereserveerd."));
    const akkoord = wacht ? knop("👍 Akkoord", "btn--primary") : null;
    if (akkoord) akkoord.addEventListener("click", () => doe(akkoord, "afspraak_bericht", { p_afspraak: detail.id, p_kind: auteurKeuze || null, p_tekst: "👍 Akkoord!" }, fout));
    const vrij = knop("Voorstel vrijgeven", "btn--outline");
    vrij.addEventListener("click", () => doe(vrij, "afspraak_vrijgeven", { p_afspraak: detail.id, p_kind: eerste }, fout));
    blok.append(akkoord ? rij(akkoord, vrij) : rij(vrij), fout);
    return blok;
  }

  if (status === "GERESERVEERD" || (status === "BEVESTIGD" && !(detail.deelnemers || []).some((d) => d.gerealiseerd))) {
    const details = document.createElement("details");
    details.className = "gesprek__bevestig";
    details.open = status === "GERESERVEERD";
    const kop = document.createElement("summary");
    kop.textContent = status === "GERESERVEERD" ? "🤝 Ruil bevestigen: hoe ruilen jullie?" : "Afspraak aanpassen";
    details.append(kop, bevestigFormulier(eerste, fout));
    blok.append(details);
  }

  if (status === "BEVESTIGD" || status === "GESCHIL") {
    eigen.filter((d) => !d.gerealiseerd).forEach((d) => {
      const k = knop(`📬 ${d.voornaam || d.naam} heeft de stickers ontvangen`, "btn--primary");
      k.addEventListener("click", () => doe(k, "afspraak_gerealiseerd", { p_afspraak: detail.id, p_kind: d.kind_id }, fout));
      blok.append(rij(k));
    });
    if (eigen.some((d) => !d.gerealiseerd)) {
      blok.append(p("form-meta form-meta--plat", "Je lijst wordt bijgewerkt op het moment dat je aanduidt dat je stickers binnen zijn."));
    }
  }

  if (status === "GERESERVEERD") {
    const vrij = knop("Reservatie vrijgeven", "btn--outline");
    vrij.addEventListener("click", () => doe(vrij, "afspraak_vrijgeven", { p_afspraak: detail.id, p_kind: eerste }, fout));
    blok.append(rij(vrij));
  }

  if (status === "BEVESTIGD") {
    const det = document.createElement("details");
    det.className = "gesprek__afgesprongen";
    const kop = document.createElement("summary");
    kop.textContent = "Ging de ruil toch niet door?";
    const reden = tekstveld("Wat liep er mis? (optioneel)", 500);
    const k = knop("Ruil afgesprongen", "btn--danger");
    k.addEventListener("click", () => doe(k, "afspraak_afgesprongen", { p_afspraak: detail.id, p_kind: eerste, p_reden: reden.veld.value }, fout));
    det.append(kop,
      p("form-meta form-meta--plat", "Heeft nog niemand iets ontvangen, dan is de ruil gewoon gesloten en komen de stickers weer vrij. Heeft iemand al ontvangen, dan gaat de ruil naar de organisatie."),
      reden.label, rij(k));
    blok.append(det);
  }

  if (status === "GESCHIL") {
    blok.append(p("message message--show message--warning", "De organisatie bekijkt deze ruil en beslist. Je kan intussen verder chatten."));
  }

  if (status === "GEREALISEERD" || status === "AFGESPRONGEN") {
    const anderen = (detail.deelnemers || []).filter((d) => !d.eigen_gezin);
    const gezien = new Set();
    anderen.forEach((d) => {
      if (gezien.has(d.gezin)) return;
      gezien.add(d.gezin);
      blok.append(beoordeling(d, fout));
    });
  }

  if (!blok.childElementCount) return null;
  blok.append(fout);
  return blok;
}

function bevestigFormulier(eersteKind, fout) {
  const form = document.createElement("form");
  form.className = "gesprek__formulier";
  const fs = document.createElement("fieldset");
  const lg = document.createElement("legend");
  lg.textContent = "Hoe ruilen jullie?";
  fs.append(lg);
  const keuzes = [
    ["verzenden", "📮 Verzenden per post", "Spreek af wie eerst verstuurt. Je adres geef je enkel in dit gesprek, nooit openbaar."],
    ["afspreken", "🤝 Afspreken", "Liefst op een openbare plek, met een ouder erbij."],
    ["afhalen", "🏠 Afhalen in het CC Meulestede", "Op een ruilmoment, tijdens de openingsuren."],
  ];
  keuzes.forEach(([waarde, label, uitleg], i) => {
    const l = document.createElement("label");
    l.className = "gesprek__keuze";
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "wijze";
    r.value = waarde;
    r.checked = detail.wijze ? detail.wijze === waarde : i === 0;
    const t = document.createElement("span");
    t.append(Object.assign(document.createElement("strong"), { textContent: label }), document.createElement("br"), uitleg);
    l.append(r, t);
    fs.append(l);
  });
  form.append(fs);

  const momentVak = document.createElement("label");
  momentVak.className = "gesprek__moment";
  momentVak.append("Ruilmoment ");
  const select = document.createElement("select");
  select.name = "ruilmoment";
  if (!ruilmomenten.length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "Er staat nog geen ruilmoment gepland";
    select.append(o);
    select.disabled = true;
  }
  ruilmomenten.forEach((m) => {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = `${datumUur.format(new Date(m.start))}–${uurKort.format(new Date(m.einde))}${m.opmerking ? " · " + m.opmerking : ""}`;
    if (detail.ruilmoment && detail.ruilmoment.id === m.id) o.selected = true;
    select.append(o);
  });
  momentVak.append(select);
  form.append(momentVak);
  const zetMoment = () => momentVak.classList.toggle("hidden", form.elements.wijze.value !== "afhalen");
  form.addEventListener("change", zetMoment);
  zetMoment();

  const tekst = tekstveld("Afspraak (wie verstuurt wanneer, waar en hoe laat, …)", 500);
  tekst.veld.value = detail.afspraak_tekst || "";
  form.append(tekst.label);

  const opslaan = knop(detail.status === "GERESERVEERD" ? "Ruil bevestigen" : "Afspraak aanpassen", "btn--primary");
  opslaan.type = "submit";
  form.append(rij(opslaan));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const wijze = form.elements.wijze.value;
    void doe(opslaan, "afspraak_bevestigen", {
      p_afspraak: detail.id,
      p_kind: eersteKind,
      p_wijze: wijze,
      p_ruilmoment: wijze === "afhalen" ? select.value || null : null,
      p_tekst: tekst.veld.value,
    }, fout);
  });
  return form;
}

function beoordeling(d, fout) {
  const vak = document.createElement("div");
  vak.className = "beoordeling";
  const huidig = (detail.mijn_beoordelingen || {})[d.gezin] || 0;
  vak.append(p("gesprek__subkop", `⭐ Hoe verliep de ruil met het gezin van ${d.voornaam || d.naam}?`));
  const groep = document.createElement("div");
  groep.className = "beoordeling__sterren";
  groep.setAttribute("role", "group");
  groep.setAttribute("aria-label", `Sterren voor het gezin van ${d.voornaam || d.naam}`);
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement("button");
    s.type = "button";
    s.className = "beoordeling__ster" + (i <= huidig ? " beoordeling__ster--aan" : "");
    s.textContent = "★";
    s.setAttribute("aria-label", `${i} ${i === 1 ? "ster" : "sterren"}`);
    s.setAttribute("aria-pressed", String(i === huidig));
    s.addEventListener("click", () => doe(s, "beoordelen", { p_afspraak: detail.id, p_ander_kind: d.kind_id, p_sterren: i }, fout));
    groep.append(s);
  }
  vak.append(groep);
  vak.append(p("form-meta form-meta--plat", huidig
    ? `Jij gaf ${huidig} ${huidig === 1 ? "ster" : "sterren"}. Aanpassen kan nog.`
    : "Kwam alles op tijd en zoals afgesproken? Dat is waar de sterren over gaan."));
  return vak;
}

// ---------- het gesprek ----------

function gesprekBlok() {
  const blok = document.createElement("div");
  blok.className = "chat";
  blok.append(p("gesprek__subkop", "Gesprek"));

  const tot = detail.schrijven_tot ? new Date(detail.schrijven_tot) : null;
  const dicht = !OPEN.includes(detail.status) || detail.als_beheerder;
  if (tot && OPEN.includes(detail.status)) {
    const voorbij = tot <= new Date();
    blok.append(p("message message--show message--warning chat__sper", voorbij
      ? "⚠️ Er komt een ruilbeurs aan: gesprekken liggen stil tot na de beurs. Je kan de ruil wel nog afronden (ontvangen, vrijgeven, afgesprongen)."
      : `⚠️ Er komt een ruilbeurs aan. Dit gesprek blijft nog open tot ${datumUur.format(tot)}; daarna kan je de ruil enkel nog afronden. Ruil gerust op de beurs zelf verder!`));
  }

  const ul = document.createElement("ol");
  ul.className = "chat__berichten";
  ul.id = "gesprek-berichten";
  const namen = vermeldbareNamen();
  (detail.berichten || []).forEach((b) => ul.append(bericht(b, namen)));
  blok.append(ul);

  if (dicht || (tot && tot <= new Date())) {
    if (!detail.als_beheerder && !OPEN.includes(detail.status)) blok.append(p("form-meta form-meta--plat", "Deze ruil is afgesloten; het gesprek is gesloten."));
    return blok;
  }
  blok.append(schrijfvak(namen));
  return blok;
}

function vermeldbareNamen() {
  const namen = new Set();
  (detail.deelnemers || []).forEach((d) => d.voornaam && namen.add(d.voornaam));
  (detail.ouders || []).forEach((o) => o.voornaam && namen.add(o.voornaam.trim()));
  return [...namen].filter(Boolean).sort((a, b) => b.length - a.length);
}

// @Naam vet zetten, enkel voor wie echt in het gesprek zit. Tekst blijft tekst
// (textContent), nooit HTML: een bericht mag de pagina niet kunnen opmaken.
function metVermeldingen(tekst, namen) {
  const frag = document.createDocumentFragment();
  if (!namen.length) {
    frag.append(tekst);
    return frag;
  }
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@(${namen.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  let vorige = 0;
  for (const m of tekst.matchAll(re)) {
    frag.append(tekst.slice(vorige, m.index));
    const s = document.createElement("strong");
    s.className = "vermelding";
    s.textContent = m[0];
    frag.append(s);
    vorige = m.index + m[0].length;
  }
  frag.append(tekst.slice(vorige));
  return frag;
}

function bericht(b, namen) {
  const li = document.createElement("li");
  li.className = "chat__bericht" + (b.systeem ? " chat__bericht--systeem" : b.eigen ? " chat__bericht--eigen" : "");
  if (!b.systeem) {
    const wie = document.createElement("span");
    wie.className = "chat__wie";
    wie.textContent = b.auteur;
    li.append(wie);
  }
  const tekst = document.createElement("p");
  tekst.className = "chat__tekst";
  tekst.append(metVermeldingen(b.tekst, b.systeem ? [] : namen));
  const tijd = document.createElement("time");
  tijd.className = "chat__tijd";
  tijd.dateTime = b.op;
  tijd.textContent = datumUur.format(new Date(b.op));
  li.append(tekst, tijd);
  if (!b.systeem && !b.eigen && !detail.als_beheerder) {
    const meld = document.createElement("button");
    meld.type = "button";
    meld.className = "chat__meld";
    meld.textContent = "Melden";
    meld.setAttribute("aria-label", `Bericht van ${b.auteur} melden aan de organisatie`);
    meld.addEventListener("click", () => meldBericht(li, b));
    li.append(meld);
  }
  return li;
}

function meldBericht(li, b) {
  if (li.querySelector(".chat__meldvak")) return;
  const vak = document.createElement("div");
  vak.className = "chat__meldvak";
  const reden = tekstveld("Waarom meld je dit bericht? De organisatie leest het gesprek dan mee.", 500);
  const ok = knop("Melden", "btn--danger");
  const nee = knop("Annuleren", "btn--outline");
  const fout = p("message", "");
  nee.addEventListener("click", () => vak.remove());
  ok.addEventListener("click", async () => {
    ok.disabled = true;
    const { error } = await supabase.rpc("bericht_melden", { p_afspraak: detail.id, p_bericht: b.id, p_reden: reden.veld.value });
    if (error) {
      ok.disabled = false;
      toonFout(fout, error.message);
      return;
    }
    vak.textContent = "";
    vak.append(p("message message--show message--success", "Bedankt. De organisatie bekijkt het."));
  });
  vak.append(reden.label, rij(ok, nee), fout);
  li.append(vak);
}

function schrijfvak(namen) {
  const form = document.createElement("form");
  form.className = "chat__schrijf";
  const eigen = eigenKinderen();

  const wieVak = document.createElement("label");
  wieVak.className = "chat__auteur";
  wieVak.append("Wie schrijft er? ");
  const wie = document.createElement("select");
  wie.id = "gesprek-auteur";
  eigen.forEach((d) => {
    const o = document.createElement("option");
    o.value = d.kind_id;
    o.textContent = d.voornaam || d.naam;
    wie.append(o);
  });
  const ouder = document.createElement("option");
  ouder.value = "";
  ouder.textContent = "Ouder";
  wie.append(ouder);
  if ([...wie.options].some((o) => o.value === auteurKeuze)) wie.value = auteurKeuze;
  else auteurKeuze = wie.value;
  wie.addEventListener("change", () => (auteurKeuze = wie.value));
  wieVak.append(wie);

  const veldVak = document.createElement("div");
  veldVak.className = "chat__veldvak";
  const veld = document.createElement("textarea");
  veld.id = "gesprek-tekst";
  veld.rows = 2;
  veld.maxLength = 1000;
  veld.placeholder = "Schrijf een bericht… Typ @ om iemand aan te spreken.";
  veld.setAttribute("aria-label", "Bericht");
  const suggesties = document.createElement("ul");
  suggesties.className = "chat__suggesties hidden";
  suggesties.setAttribute("role", "listbox");
  veldVak.append(veld, suggesties);
  koppelVermeldingen(veld, suggesties, namen);

  const stuur = knop("Versturen", "btn--primary");
  stuur.type = "submit";
  const fout = p("message", "");
  fout.setAttribute("role", "alert");

  form.append(wieVak, veldVak, rij(stuur), fout);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tekst = veld.value.trim();
    if (!tekst) return;
    stuur.disabled = true;
    const { error } = await supabase.rpc("afspraak_bericht", { p_afspraak: detail.id, p_kind: wie.value || null, p_tekst: tekst });
    stuur.disabled = false;
    if (error) {
      toonFout(fout, error.message);
      return;
    }
    veld.value = "";
    await Promise.all([laadLijst(), laadDetail(openId, { stil: true })]);
    document.getElementById("gesprek-berichten")?.lastElementChild?.scrollIntoView({ block: "nearest" });
    document.getElementById("gesprek-tekst")?.focus();
    document.dispatchEvent(new CustomEvent(ACTIES_EVENT));
  });
  // Ctrl/Cmd+Enter verstuurt; gewone Enter is een nieuwe regel (kinderen
  // drukken anders per ongeluk halve zinnen door).
  veld.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && suggesties.classList.contains("hidden")) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  return form;
}

// @ typen toont de namen uit het gesprek; pijltjes, Enter/Tab of klikken kiest.
function koppelVermeldingen(veld, lijstEl, namen) {
  let keuzes = [];
  let actief = 0;
  const huidigWoord = () => {
    const voor = veld.value.slice(0, veld.selectionStart);
    const m = voor.match(/(^|\s)@([\p{L}\p{N}-]*)$/u);
    return m ? { start: voor.length - m[2].length - 1, deel: m[2] } : null;
  };
  const sluit = () => {
    lijstEl.classList.add("hidden");
    lijstEl.textContent = "";
    keuzes = [];
  };
  const kies = (naam) => {
    const w = huidigWoord();
    if (!w) return;
    const na = veld.value.slice(veld.selectionStart);
    veld.value = veld.value.slice(0, w.start) + "@" + naam + " " + na;
    const pos = w.start + naam.length + 2;
    veld.setSelectionRange(pos, pos);
    sluit();
    veld.focus();
  };
  const toon = () => {
    const w = huidigWoord();
    if (!w) return sluit();
    const deel = w.deel.toLocaleLowerCase("nl-BE");
    keuzes = namen.filter((n) => n.toLocaleLowerCase("nl-BE").startsWith(deel)).sort((a, b) => a.localeCompare(b, "nl"));
    if (!keuzes.length) return sluit();
    actief = Math.min(actief, keuzes.length - 1);
    lijstEl.textContent = "";
    keuzes.forEach((n, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.className = "chat__suggestie" + (i === actief ? " chat__suggestie--actief" : "");
      li.setAttribute("aria-selected", String(i === actief));
      li.textContent = "@" + n;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        kies(n);
      });
      lijstEl.append(li);
    });
    lijstEl.classList.remove("hidden");
  };
  veld.addEventListener("input", () => {
    actief = 0;
    toon();
  });
  veld.addEventListener("click", toon);
  veld.addEventListener("blur", () => setTimeout(sluit, 100));
  veld.addEventListener("keydown", (e) => {
    if (!keuzes.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      actief = (actief + (e.key === "ArrowDown" ? 1 : keuzes.length - 1)) % keuzes.length;
      toon();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      kies(keuzes[actief]);
    } else if (e.key === "Escape") {
      sluit();
    }
  });
}

function problemenBlok() {
  const det = document.createElement("details");
  det.className = "gesprek__problemen";
  const kop = document.createElement("summary");
  kop.textContent = "Een probleem?";
  det.append(kop, p("form-meta form-meta--plat",
    "Voelt iets niet goed, of vraagt iemand iets dat niet over stickers gaat? Meld het bericht (knop bij elk bericht) of blokkeer het gezin. Lees ook de platformregels."));
  const fout = p("message", "");
  (detail.deelnemers || []).filter((d) => !d.eigen_gezin).forEach((d) => {
    const k = knop(`Gezin van ${d.voornaam || d.naam} blokkeren`, "btn--outline");
    k.addEventListener("click", () => {
      k.replaceWith(bevestigBlokkeren(d, fout));
    });
    det.append(rij(k));
  });
  const regels = document.createElement("a");
  regels.href = "/regels.html";
  regels.textContent = "Platformregels lezen";
  const regel = p("", "");
  regel.append(regels);
  det.append(regel, fout);
  return det;
}

function bevestigBlokkeren(d, fout) {
  const vak = document.createElement("div");
  vak.append(p("form-meta form-meta--plat",
    `Na blokkeren zie je het gezin van ${d.voornaam || d.naam} niet meer bij je ruilkansen en kan niemand van beide gezinnen nog een ruil voorstellen. Is deze ruil nog niet bevestigd, dan gaat hij dicht.`));
  const ja = knop("Ja, blokkeren", "btn--danger");
  const nee = knop("Annuleren", "btn--outline");
  ja.addEventListener("click", () => doe(ja, "gezin_blokkeren", { p_afspraak: detail.id, p_ander_kind: d.kind_id }, fout));
  nee.addEventListener("click", () => tekenDetail({ stil: true }));
  vak.append(rij(ja, nee));
  return vak;
}

// ---------- organisatie ----------

async function tekenBeheer() {
  const sectie = document.getElementById("gesprekken-beheer");
  const doel = document.getElementById("gesprekken-beheer-lijst");
  const { data, error } = await supabase.rpc("beheer_afspraken");
  if (error) return;
  sectie.classList.remove("hidden");
  doel.textContent = "";
  const rijen = Array.isArray(data) ? data : [];
  if (!rijen.length) {
    doel.append(p("form-meta form-meta--plat", "Geen open geschillen of meldingen."));
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "gesprekken__beheer";
  rijen.forEach((r) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `/gesprekken.html?id=${encodeURIComponent(r.afspraak_id)}`;
    a.textContent = `${r.reden === "geschil" ? "⚖️ Geschil" : "🚩 Melding"}: ${r.deelnemers}`;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      history.pushState(null, "", a.href);
      void laadDetail(r.afspraak_id);
    });
    li.append(a, ` · ${r.sinds ? datumUur.format(new Date(r.sinds)) : ""}`);
    if (r.melding) li.append(p("form-meta form-meta--plat", r.melding));
    if (r.reden === "melding") {
      const k = knop("Behandeld", "btn--outline");
      k.addEventListener("click", async () => {
        k.disabled = true;
        await supabase.rpc("melding_behandeld", { p_afspraak: r.afspraak_id });
        void tekenBeheer();
      });
      li.append(" ", k);
    }
    ul.append(li);
  });
  doel.append(ul);
}

// ---------- kleine bouwstenen ----------

function p(klasse, tekst) {
  const el = document.createElement("p");
  if (klasse) el.className = klasse;
  el.textContent = tekst;
  return el;
}

function knop(tekst, soort) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn ${soort} btn--sm`;
  b.textContent = tekst;
  return b;
}

function rij(...knoppen) {
  const div = document.createElement("div");
  div.className = "form-actions";
  div.append(...knoppen);
  return div;
}

function tekstveld(label, max) {
  const l = document.createElement("label");
  l.className = "gesprek__veld";
  l.append(label);
  const veld = document.createElement("textarea");
  veld.rows = 2;
  veld.maxLength = max;
  l.append(veld);
  return { label: l, veld };
}

function statusChip(status) {
  const s = STATUS[status] || { tekst: status, klasse: "dicht" };
  const chip = document.createElement("span");
  chip.className = `chip status-chip status-chip--${s.klasse}`;
  chip.textContent = s.tekst;
  return chip;
}

function vinkje(aan, tekst) {
  const span = document.createElement("span");
  span.className = "gesprek__vinkje" + (aan ? " gesprek__vinkje--aan" : "");
  span.textContent = aan ? ` ✓ ${tekst}` : ` · ${tekst}`;
  return span;
}

function toonFout(el, tekst) {
  if (!el) return;
  el.textContent = tekst;
  el.className = "message message--show message--error";
}
