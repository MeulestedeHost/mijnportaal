// statistieken.js — Statistiekenpagina: het hele portaal in cijfers.
//
// ALLES KOMT UIT SQL. Deze pagina telt zelf niets op. Vijf RPC's leveren
// kant-en-klare aggregaties (sql/017_statistieken.sql); hier gebeurt enkel
// opmaak, sortering en het tekenen van de grafieken. Dat is geen stijlkeuze:
// zelf optellen zou betekenen dat de browser de stickerrijen van álle
// deelnemers moet ophalen, en dat zijn precies de gegevens die niemand hoort
// te zien.
//
// "GEPLAKT" IS EEN AFLEIDING. De databank kent maar twee statussen, ZOEKT en
// RUILT — wat een kind al in zijn album heeft staat nergens. Net als de FIFA
// Wereldreis rekent deze pagina daarom: alles wat niet als gezocht is
// aangeduid, geldt als aanwezig. Dat klopt enkel voor wie zijn lijst invulde,
// dus tellen alleen verzamelaars mee die al minstens één sticker registreerden.
// Elke tooltip die op die afleiding steunt, zegt dat er ook bij.
//
// GEEN GRAFIEKBIBLIOTHEEK. De staafdiagrammen zijn gewone elementen met een
// breedte in procent, de lijngrafieken zijn met de hand getekende SVG. Een
// bibliotheek van 200 kB binnenhalen voor zes grafiekjes weegt niet op tegen
// de laadtijd — en het project heeft verder geen enkele build-stap.
//
// TOOLTIPS. Elk cijfer heeft er een, met dezelfde componenten als de
// wereldreis (.wr-tooltip-wrap / .wr-info-knop / .wr-tooltip): op een muis via
// hover, op een touchscreen door het ℹ️-knopje aan te tikken.
import { supabase, requireAuth } from "./supabase.js";
import { landLabel, accentVoor } from "./landen-data.js";

const GETAL = new Intl.NumberFormat("nl-BE");
const KOMMA = new Intl.NumberFormat("nl-BE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const EURO = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" });
const DATUM = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short" });
const UUR = new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit" });

// Hoeveel landen en stickers er in een toplijst of staafdiagram passen zonder
// dat het een muur van balkjes wordt.
const TOP_LANDEN = 10;
const TOP_STICKERS = 10;
const TOP_VERZAMELAARS = 10;

// De periodekeuze vertaalt naar een begindatum en een tijdvak voor SQL.
// 'alles' laat de begindatum leeg: de databank begint dan bij de allereerste
// verzamelaar of ruil.
const PERIODES = {
  "24u": { uren: 24, stap: "hour" },
  7: { uren: 24 * 7, stap: "day" },
  30: { uren: 24 * 30, stap: "day" },
  90: { uren: 24 * 90, stap: "day" },
  alles: { uren: null, stap: "day" },
};

let cijfers = null;
let landen = [];
let verzamelaars = []; // enkel gevuld als de ranglijst getoond mag worden
let tipTeller = 0;

document.addEventListener("DOMContentLoaded", async () => {
  if (!document.getElementById("stat-inhoud")) return; // niet op statistieken.html

  const user = await requireAuth();
  if (!user) return;

  try {
    [cijfers, landen] = await Promise.all([haalCijfers(), haalLanden()]);
  } catch (err) {
    toonFout(
      "De statistieken konden niet berekend worden — draai sql/017_statistieken.sql in Supabase. (" +
        err.message +
        ")"
    );
    return;
  }

  document.getElementById("stat-loading").classList.add("hidden");

  if (!cijfers || !cijfers.verzamelaars) {
    document.getElementById("stat-leeg").classList.remove("hidden");
    return;
  }

  document.getElementById("stat-inhoud").classList.remove("hidden");

  tekenBasis();
  tekenWaarde();
  tekenVoortgang();
  tekenLanden();
  tekenRuilen();

  document.getElementById("stat-periode").addEventListener("change", laadActiviteit);
  await laadActiviteit();

  await tekenToplijsten();
  tekenInzichten();
});

// ---------- gegevens ----------

async function haalCijfers() {
  const { data, error } = await supabase.rpc("statistieken");
  if (error) throw error;
  return (data || [])[0] || null;
}

async function haalLanden() {
  const { data, error } = await supabase.rpc("statistieken_landen");
  if (error) throw error;
  return data || [];
}

function toonFout(tekst) {
  document.getElementById("stat-loading").classList.add("hidden");
  const el = document.getElementById("stat-fout");
  el.textContent = tekst;
  el.className = "message message--show message--error";
}

// ---------- bouwstenen ----------

// Het ℹ️-knopje met zijn uitleg. Een <button>, niet een span met :hover: op
// een touchscreen bestaat hover niet, en een knop krijgt bij aantikken altijd
// focus — waar de CSS op inhaakt.
function tooltip(tekst) {
  const wrap = document.createElement("span");
  wrap.className = "wr-tooltip-wrap";

  const id = "stat-tip-" + ++tipTeller;
  const knop = document.createElement("button");
  knop.type = "button";
  knop.className = "wr-info-knop";
  knop.setAttribute("aria-describedby", id);
  knop.setAttribute("aria-label", "Uitleg bij dit cijfer");
  const icoon = document.createElement("span");
  icoon.setAttribute("aria-hidden", "true");
  icoon.textContent = "ℹ️";
  knop.appendChild(icoon);

  const tip = document.createElement("span");
  tip.className = "wr-tooltip";
  tip.id = id;
  tip.setAttribute("role", "tooltip");
  tip.textContent = tekst;

  wrap.appendChild(knop);
  wrap.appendChild(tip);
  return wrap;
}

function cijferKaart({ icoon, getal, label, uitleg }) {
  const vak = document.createElement("div");
  vak.className = "wr-cijfer stat-cijfer";

  const i = document.createElement("span");
  i.className = "wr-cijfer__icoon";
  i.setAttribute("aria-hidden", "true");
  i.textContent = icoon;

  const g = document.createElement("span");
  g.className = "wr-cijfer__getal";
  g.textContent = getal;

  const voet = document.createElement("div");
  voet.className = "stat-cijfer__voet";
  const l = document.createElement("span");
  l.className = "wr-cijfer__label";
  l.textContent = label;
  voet.appendChild(l);
  voet.appendChild(tooltip(uitleg));

  vak.appendChild(i);
  vak.appendChild(g);
  vak.appendChild(voet);
  return vak;
}

function vulKaarten(id, kaarten) {
  const doel = document.getElementById(id);
  doel.textContent = "";
  kaarten.forEach((k) => doel.appendChild(cijferKaart(k)));
}

// ---------- blok 1: verzamelaars en stickers ----------

function tekenBasis() {
  vulKaarten("stat-basis", [
    {
      icoon: "👥",
      getal: GETAL.format(cijfers.verzamelaars),
      label: "Verzamelaars",
      uitleg:
        "Aantal verzamelaars met minstens één geregistreerde sticker — dus iedereen die al iets als gezocht of dubbel aanduidde. Wie nog niets invulde, telt niet mee.",
    },
    {
      icoon: "📖",
      getal: GETAL.format(cijfers.geplakt),
      label: "Geplakte stickers",
      uitleg:
        "Berekend, niet geteld: per verzamelaar het volledige album (" +
        GETAL.format(cijfers.album_totaal) +
        " stickers) min wat hij als gezocht aanduidde. Alles wat niet gezocht wordt, geldt als aanwezig.",
    },
    {
      icoon: "🔍",
      getal: GETAL.format(cijfers.gezocht),
      label: "Gezochte stickers",
      uitleg:
        "Som van alle stickers die verzamelaars op dit moment als gezocht hebben aangeduid.",
    },
    {
      icoon: "📦",
      getal: GETAL.format(cijfers.dubbels),
      label: "Dubbels",
      uitleg:
        "Som van alle dubbels van alle verzamelaars, met het aantal exemplaren meegerekend — vijf keer dezelfde sticker telt als vijf.",
    },
  ]);
}

// ---------- blok 2: waarde ----------

function tekenWaarde() {
  const waarde = Number(cijfers.stickerwaarde);
  const totaal = cijfers.geplakt * waarde;
  const dubbels = cijfers.dubbels * waarde;

  document.getElementById("stat-waarde-uitleg").textContent =
    "Alle bedragen zijn nominaal: het aantal stickers maal de winkelprijs van één sticker (" +
    EURO.format(waarde) +
    "). Die prijs is in te stellen op de instellingenpagina.";

  vulKaarten("stat-waarde", [
    {
      icoon: "💰",
      getal: EURO.format(totaal),
      label: "Totale collectie",
      uitleg: `Geschatte nominale waarde van alle geregistreerde stickers: ${GETAL.format(
        cijfers.geplakt
      )} geplakte stickers × ${EURO.format(waarde)}.`,
    },
    {
      icoon: "📦",
      getal: EURO.format(dubbels),
      label: "Waarde van alle dubbels",
      uitleg: `Geschatte nominale waarde van alle geregistreerde dubbels: ${GETAL.format(
        cijfers.dubbels
      )} dubbels × ${EURO.format(waarde)}.`,
    },
    {
      icoon: "👤",
      getal: EURO.format(totaal / cijfers.verzamelaars),
      label: "Gemiddelde collectie",
      uitleg: `Gemiddelde nominale waarde van één verzameling: totale collectie gedeeld door ${GETAL.format(
        cijfers.verzamelaars
      )} verzamelaars.`,
    },
  ]);
}

// ---------- blok 9: voortgang album ----------

function tekenVoortgang() {
  vulKaarten("stat-voortgang", [
    {
      icoon: "📊",
      getal: KOMMA.format(cijfers.albumvulling) + " %",
      label: "Gemiddelde albumvulling",
      uitleg: `Gemiddeld percentage van het album dat ingevuld is: geplakte stickers gedeeld door de ${GETAL.format(
        cijfers.album_totaal
      )} stickers die het album telt.`,
    },
    {
      icoon: "📦",
      getal: KOMMA.format(cijfers.dubbels_gemiddeld),
      label: "Dubbels per verzamelaar",
      uitleg: "Totaal aantal dubbels gedeeld door het aantal verzamelaars.",
    },
    {
      icoon: "🔍",
      getal: KOMMA.format(cijfers.gezocht_gemiddeld),
      label: "Ontbrekend per verzamelaar",
      uitleg: "Totaal aantal gezochte stickers gedeeld door het aantal verzamelaars.",
    },
  ]);
}

// ---------- blok 3: landen ----------

function tekenLanden() {
  vulKaarten("stat-landen-cijfers", [
    {
      icoon: "🌍",
      getal: KOMMA.format(cijfers.landen_gemiddeld),
      label: "Landen per verzamelaar",
      uitleg:
        "Per verzamelaar wordt geteld van hoeveel landen er minstens één sticker aanwezig is; daarvan het gemiddelde. Een land telt mee zodra niet álle stickers ervan gezocht worden.",
    },
  ]);

  staafGrafiek("stat-land-geplakt", {
    titel: "Meest verzamelde landen",
    uitleg:
      "Aantal geplakte stickers per land, opgeteld over alle verzamelaars. Grote landen hebben meer stickers in het album en staan daardoor vanzelf hoger — kijk voor de verhouding naar de inzichten onderaan.",
    rijen: bovensteLanden("geplakt"),
  });

  staafGrafiek("stat-land-gezocht", {
    titel: "Meest gezochte landen",
    uitleg: "Aantal gezochte stickers per land, opgeteld over alle verzamelaars.",
    rijen: bovensteLanden("gezocht"),
  });

  staafGrafiek("stat-land-dubbels", {
    titel: "Meeste dubbels per land",
    uitleg:
      "Aantal dubbels per land, opgeteld over alle verzamelaars en met het aantal exemplaren meegerekend.",
    rijen: bovensteLanden("dubbels"),
  });
}

function bovensteLanden(veld) {
  return landen
    .slice()
    .sort((a, b) => Number(b[veld]) - Number(a[veld]))
    .slice(0, TOP_LANDEN)
    .map((land) => ({
      label: landLabel(land),
      waarde: Number(land[veld]),
      kleur: accentVoor(land.land_code),
      titel: `${landLabel(land)}: ${GETAL.format(Number(land[veld]))}`,
    }));
}

// ---------- blok 4, 5 en 6: ruilen ----------

function tekenRuilen() {
  const waarde = Number(cijfers.stickerwaarde);
  const ratio = cijfers.ruilen_totaal
    ? (100 * cijfers.ruilen_voltooid) / cijfers.ruilen_totaal
    : 0;

  vulKaarten("stat-ruilen", [
    {
      icoon: "🤝",
      getal: GETAL.format(cijfers.ruilen_totaal),
      label: "Geregistreerde ruilen",
      uitleg: "Aantal ruilen dat via het platform geregistreerd werd, in welke stand ook.",
    },
    {
      icoon: "✅",
      getal: GETAL.format(cijfers.ruilen_voltooid),
      label: "Voltooide ruilen",
      uitleg: "Aantal ruilen dat door beide ruilers bevestigd werd.",
    },
    {
      icoon: "⏳",
      getal: GETAL.format(cijfers.ruilen_open),
      label: "Openstaande ruilen",
      uitleg:
        "Aantal ruilen waarvoor nog minstens één bevestiging ontbreekt — zowel de ruilen waar nog niemand bevestigde als die waar er één van de twee al bevestigde.",
    },
    {
      icoon: "📈",
      getal: KOMMA.format(ratio) + " %",
      label: "Succesratio",
      uitleg:
        "Percentage geregistreerde ruilen dat volledig afgewerkt werd: voltooide ruilen gedeeld door alle geregistreerde ruilen.",
    },
    {
      icoon: "💸",
      getal: EURO.format(cijfers.ruilen_voltooid * waarde),
      label: "Geruilde stickerwaarde",
      uitleg: `Nominale waarde van de succesvol geruilde stickers: ${GETAL.format(
        cijfers.ruilen_voltooid
      )} voltooide ruilen × ${EURO.format(
        waarde
      )}. Dit is geen besparing, maar de waarde van de geruilde stickers. Bij elke ruil wisselen er trouwens twee stickers van eigenaar — één per kant.`,
    },
    {
      icoon: "🎁",
      getal: GETAL.format(Math.round(Number(cijfers.vermeden_pakjes))),
      label: "Geschatte vermeden pakjes",
      uitleg:
        "Statistische schatting van hoeveel pakjes er minder gekocht hoefden te worden doordat ontbrekende stickers via ruilen binnenkwamen. Berekend met het coupon collector-model: hoe voller een album, hoe meer pakjes een nieuwe sticker kost.",
    },
  ]);

  document.getElementById("stat-ruilen-voetnoot").textContent =
    "Dit is een schatting en geen exacte besparing. Het model gaat ervan uit dat alle stickers even vaak in pakjes zitten; bovendien geef je bij een ruil zelf ook een sticker weg, die ergens vandaan moest komen.";
}

// ---------- blok 7: activiteit ----------

async function laadActiviteit() {
  const doel = document.getElementById("stat-activiteit");
  doel.textContent = "";
  const bezig = document.createElement("p");
  bezig.className = "loading";
  bezig.textContent = "Activiteit ophalen…";
  doel.appendChild(bezig);

  const keuze = document.getElementById("stat-periode").value;
  const periode = PERIODES[keuze] || PERIODES[30];
  const vanaf = periode.uren
    ? new Date(Date.now() - periode.uren * 3600 * 1000).toISOString()
    : null;

  let rijen;
  try {
    const { data, error } = await supabase.rpc("statistieken_activiteit", {
      p_vanaf: vanaf,
      p_stap: periode.stap,
    });
    if (error) throw error;
    rijen = data || [];
  } catch (err) {
    doel.textContent = "";
    const fout = document.createElement("p");
    fout.className = "form-meta form-meta--plat";
    fout.textContent = "De activiteit kon niet opgehaald worden: " + err.message;
    doel.appendChild(fout);
    return;
  }

  doel.textContent = "";
  const perUur = periode.stap === "hour";
  [
    {
      veld: "nieuwe_verzamelaars",
      titel: "Nieuwe verzamelaars",
      klasse: "stat-lijn--verzamelaars",
      uitleg:
        "Aantal verzamelaars dat in dit tijdvak werd aangemaakt, op basis van het moment van aanmaken.",
      eenheid: "nieuwe verzamelaars",
    },
    {
      veld: "nieuwe_ruilen",
      titel: "Nieuwe ruilen",
      klasse: "stat-lijn--ruilen",
      uitleg: "Aantal ruilen dat in dit tijdvak geregistreerd werd.",
      eenheid: "geregistreerde ruilen",
    },
    {
      veld: "voltooide_ruilen",
      titel: "Voltooide ruilen",
      klasse: "stat-lijn--voltooid",
      uitleg:
        "Aantal ruilen dat in dit tijdvak volledig rond raakte, geteld op het moment van de tweede bevestiging.",
      eenheid: "voltooide ruilen",
    },
  ].forEach((reeks) => {
    const vak = document.createElement("div");
    vak.className = "stat-grafiek";
    doel.appendChild(vak);
    lijnGrafiek(vak, {
      titel: reeks.titel,
      uitleg: reeks.uitleg,
      klasse: reeks.klasse,
      eenheid: reeks.eenheid,
      perUur,
      punten: rijen.map((r) => ({
        moment: new Date(r.moment),
        waarde: Number(r[reeks.veld]) || 0,
      })),
    });
  });
}

// ---------- blok 8: toplijsten ----------

async function tekenToplijsten() {
  const [gezocht, verzameld] = await Promise.all([
    haalTop("top_gezochte_stickers", TOP_STICKERS),
    haalTop("top_verzamelde_stickers", TOP_STICKERS),
  ]);

  if (cijfers.mag_topverzamelaars) {
    verzamelaars = await haalTop("top_verzamelaars", TOP_VERZAMELAARS);
  }
  tekenTopVerzamelaars();

  toplijst("stat-top-gezocht", {
    icoon: "🔥",
    titel: "Meest gezochte stickers",
    uitleg:
      "Aantal verzamelaars dat deze sticker op dit moment als gezocht heeft staan.",
    rijen: gezocht.map((r) => ({
      label: r.code,
      bij: r.naam || "",
      kleur: accentVoor(r.land_code),
      waarde: `${GETAL.format(r.zoekers)} ${r.zoekers === 1 ? "zoeker" : "zoekers"}`,
    })),
  });

  toplijst("stat-top-verzameld", {
    icoon: "⭐",
    titel: "Meest verzamelde stickers",
    uitleg:
      "Aantal verzamelaars dat deze sticker heeft — dus die hem niet als gezocht aanduidde. Let op: omdat 'heeft' hier het tegendeel van 'zoekt' is, is deze lijst het spiegelbeeld van de lijst hiernaast. Bovenaan staan de stickers die bijna niemand mist.",
    rijen: verzameld.map((r) => ({
      label: r.code,
      bij: r.naam || "",
      kleur: accentVoor(r.land_code),
      waarde: `${GETAL.format(r.verzamelaars)} ×`,
    })),
  });
}

async function haalTop(functie, limiet) {
  try {
    const { data, error } = await supabase.rpc(functie, { p_limiet: limiet });
    if (error) throw error;
    return data || [];
  } catch (err) {
    return [];
  }
}

// De ranglijst met voornamen heeft als enige een schakelaar: op geplakte
// stickers of op voltooide ruilen. Beide keren dezelfde rijen, alleen anders
// geordend — daarom wordt er niets opnieuw opgehaald.
function tekenTopVerzamelaars() {
  const doel = document.getElementById("stat-top-verzamelaars");
  doel.textContent = "";

  if (!cijfers.mag_topverzamelaars) {
    doel.appendChild(
      toplijstKop("🏆", "Actiefste verzamelaars", "Deze lijst toont voornamen van kinderen.")
    );
    const uitleg = document.createElement("p");
    uitleg.className = "form-meta form-meta--plat stat-toplijst__leeg";
    uitleg.textContent =
      "Een ranglijst met voornamen staat standaard uit — de andere cijfers op deze pagina zijn optellingen, deze lijst gaat over herkenbare kinderen. De organisatie kan ze op de instellingenpagina voor iedereen openzetten; beheerders zien ze altijd.";
    doel.appendChild(uitleg);
    return;
  }

  let sortering = "geplakt";
  const kop = toplijstKop(
    "🏆",
    "Actiefste verzamelaars",
    "Enkel voornamen. Sorteer op het aantal geplakte stickers (een berekening: album min gezocht) of op het aantal voltooide ruilen."
  );
  doel.appendChild(kop);

  const knoppen = document.createElement("div");
  knoppen.className = "stat-toggle";
  const lijstVak = document.createElement("ol");
  lijstVak.className = "stat-toplijst__lijst";

  const opties = [
    { id: "geplakt", label: "Meeste stickers" },
    { id: "voltooide_ruilen", label: "Meeste ruilen" },
  ];
  opties.forEach((optie) => {
    const knop = document.createElement("button");
    knop.type = "button";
    knop.className = "stat-toggle__knop";
    knop.textContent = optie.label;
    knop.addEventListener("click", () => {
      sortering = optie.id;
      [...knoppen.children].forEach((k) => k.classList.remove("stat-toggle__knop--aan"));
      knop.classList.add("stat-toggle__knop--aan");
      vulVerzamelaars(lijstVak, sortering);
    });
    if (optie.id === sortering) knop.classList.add("stat-toggle__knop--aan");
    knoppen.appendChild(knop);
  });

  doel.appendChild(knoppen);
  doel.appendChild(lijstVak);
  vulVerzamelaars(lijstVak, sortering);
}

function vulVerzamelaars(lijst, veld) {
  lijst.textContent = "";
  const rijen = verzamelaars
    .slice()
    .sort((a, b) => Number(b[veld]) - Number(a[veld]))
    .slice(0, TOP_VERZAMELAARS);

  if (rijen.length === 0) {
    lijst.appendChild(legeRegel("Nog geen verzamelaars om te tonen."));
    return;
  }

  rijen.forEach((r, i) =>
    lijst.appendChild(
      toplijstRegel({
        plaats: i + 1,
        label: r.voornaam,
        bij:
          veld === "geplakt"
            ? `${GETAL.format(r.voltooide_ruilen)} voltooide ruilen`
            : `${GETAL.format(r.geplakt)} stickers`,
        waarde:
          veld === "geplakt"
            ? `${GETAL.format(r.geplakt)} stickers`
            : `${GETAL.format(r.voltooide_ruilen)} ruilen`,
      })
    )
  );
}

function toplijst(id, { icoon, titel, uitleg, rijen }) {
  const doel = document.getElementById(id);
  doel.textContent = "";
  doel.appendChild(toplijstKop(icoon, titel, uitleg));

  const lijst = document.createElement("ol");
  lijst.className = "stat-toplijst__lijst";
  if (rijen.length === 0) {
    lijst.appendChild(legeRegel("Nog geen gegevens."));
  } else {
    rijen.forEach((r, i) =>
      lijst.appendChild(toplijstRegel({ plaats: i + 1, ...r }))
    );
  }
  doel.appendChild(lijst);
}

function toplijstKop(icoon, titel, uitleg) {
  const kop = document.createElement("div");
  kop.className = "stat-toplijst__kop";
  const h3 = document.createElement("h3");
  h3.textContent = `${icoon} ${titel}`;
  kop.appendChild(h3);
  kop.appendChild(tooltip(uitleg));
  return kop;
}

function toplijstRegel({ plaats, label, bij, waarde, kleur }) {
  const li = document.createElement("li");
  li.className = "stat-toplijst__regel";

  const nr = document.createElement("span");
  nr.className = "stat-toplijst__plaats";
  nr.textContent = plaats;
  li.appendChild(nr);

  const naam = document.createElement("span");
  naam.className = "stat-toplijst__naam";
  if (kleur) {
    const streep = document.createElement("span");
    streep.className = "land-streep";
    streep.style.backgroundColor = kleur;
    naam.appendChild(streep);
  }
  const hoofd = document.createElement("strong");
  hoofd.textContent = label;
  naam.appendChild(hoofd);
  if (bij) {
    const extra = document.createElement("span");
    extra.className = "stat-toplijst__bij";
    extra.textContent = bij;
    naam.appendChild(extra);
  }
  li.appendChild(naam);

  const w = document.createElement("span");
  w.className = "stat-toplijst__waarde";
  w.textContent = waarde;
  li.appendChild(w);
  return li;
}

function legeRegel(tekst) {
  const li = document.createElement("li");
  li.className = "stat-toplijst__leeg";
  li.textContent = tekst;
  return li;
}

// ---------- blok 10: inzichten ----------

function tekenInzichten() {
  const doel = document.getElementById("stat-inzichten");
  doel.textContent = "";

  // "Populair" mag hier niet gewoon "veel stickers" betekenen: een land met
  // 20 stickers in het album haalt anders altijd een groter totaal dan een
  // land met 5. Daarom de verhouding: welk deel van dat land is bij de
  // verzamelaars samen ingevuld.
  const metVulling = landen
    .filter((l) => l.totaal > 0)
    .map((l) => ({
      ...l,
      vulling: (100 * Number(l.geplakt)) / (cijfers.verzamelaars * l.totaal),
    }));

  const kaarten = [];

  if (metVulling.length) {
    const best = metVulling.slice().sort((a, b) => b.vulling - a.vulling)[0];
    const slechtst = metVulling.slice().sort((a, b) => a.vulling - b.vulling)[0];
    kaarten.push({
      icoon: "🌟",
      titel: "Meest populaire land",
      waarde: landLabel(best),
      bij: `${KOMMA.format(best.vulling)} % van dit land is ingevuld`,
      uitleg:
        "Het land waarvan het grootste deel ingevuld is, over alle verzamelaars samen. Bewust een verhouding en geen aantal: een land met veel stickers in het album haalt anders altijd het hoogste totaal.",
      kleur: accentVoor(best.land_code),
    });
    kaarten.push({
      icoon: "🧩",
      titel: "Moeilijkst te vinden land",
      waarde: landLabel(slechtst),
      bij: `${KOMMA.format(slechtst.vulling)} % ingevuld · ${GETAL.format(
        Number(slechtst.gezocht)
      )} keer gezocht`,
      uitleg:
        "Het land waarvan het kleinste deel ingevuld is. Dat kan betekenen dat de stickers zeldzaam zijn, maar ook dat er nog weinig verzamelaars aan dat land toe zijn.",
      kleur: accentVoor(slechtst.land_code),
    });
  }

  const meesteDubbels = landen
    .slice()
    .sort((a, b) => Number(b.dubbels) - Number(a.dubbels))[0];
  if (meesteDubbels && Number(meesteDubbels.dubbels) > 0) {
    kaarten.push({
      icoon: "📦",
      titel: "Land met de meeste dubbels",
      waarde: landLabel(meesteDubbels),
      bij: `${GETAL.format(Number(meesteDubbels.dubbels))} dubbels in omloop`,
      uitleg:
        "Het land waarvan de verzamelaars samen de meeste dubbels hebben liggen, exemplaren meegerekend.",
      kleur: accentVoor(meesteDubbels.land_code),
    });
  }

  if (cijfers.mag_topverzamelaars && verzamelaars.length) {
    const meesteStickers = verzamelaars
      .slice()
      .sort((a, b) => b.geplakt - a.geplakt)[0];
    const meesteRuilen = verzamelaars
      .slice()
      .sort((a, b) => b.voltooide_ruilen - a.voltooide_ruilen)[0];
    kaarten.push({
      icoon: "🏅",
      titel: "Verzamelaar met de meeste stickers",
      waarde: meesteStickers.voornaam,
      bij: `${GETAL.format(meesteStickers.geplakt)} van ${GETAL.format(
        cijfers.album_totaal
      )} stickers`,
      uitleg:
        "Op basis van de berekening album min gezocht. Wie zijn ontbrekende stickers nog niet volledig invulde, staat hier dus te hoog.",
    });
    if (meesteRuilen.voltooide_ruilen > 0) {
      kaarten.push({
        icoon: "🤝",
        titel: "Verzamelaar met de meeste ruilen",
        waarde: meesteRuilen.voornaam,
        bij: `${GETAL.format(meesteRuilen.voltooide_ruilen)} voltooide ruilen`,
        uitleg: "Aantal ruilen dat door beide kanten bevestigd werd.",
      });
    }
  }

  if (kaarten.length === 0) {
    const leeg = document.createElement("p");
    leeg.className = "form-meta form-meta--plat";
    leeg.textContent = "Er is nog te weinig ingevuld om hier iets zinnigs over te zeggen.";
    doel.appendChild(leeg);
    return;
  }

  kaarten.forEach((k) => doel.appendChild(inzichtKaart(k)));
}

function inzichtKaart({ icoon, titel, waarde, bij, uitleg, kleur }) {
  const vak = document.createElement("article");
  vak.className = "stat-inzicht";
  if (kleur) vak.style.borderLeftColor = kleur;

  const kop = document.createElement("div");
  kop.className = "stat-inzicht__kop";
  const t = document.createElement("h3");
  t.textContent = `${icoon} ${titel}`;
  kop.appendChild(t);
  kop.appendChild(tooltip(uitleg));
  vak.appendChild(kop);

  const w = document.createElement("p");
  w.className = "stat-inzicht__waarde";
  w.textContent = waarde;
  vak.appendChild(w);

  const b = document.createElement("p");
  b.className = "stat-inzicht__bij";
  b.textContent = bij;
  vak.appendChild(b);
  return vak;
}

// ---------- grafieken ----------

function grafiekKop(titel, uitleg) {
  const kop = document.createElement("div");
  kop.className = "stat-grafiek__kop";
  const h3 = document.createElement("h3");
  h3.textContent = titel;
  kop.appendChild(h3);
  kop.appendChild(tooltip(uitleg));
  return kop;
}

// Staafdiagram als gewone elementen: de vulling krijgt een breedte in procent
// van de hoogste waarde. Schaalt vanzelf mee met de kolombreedte, dus er valt
// niets te hertekenen bij het draaien van een telefoon.
function staafGrafiek(id, { titel, uitleg, rijen }) {
  const doel = document.getElementById(id);
  doel.textContent = "";
  doel.appendChild(grafiekKop(titel, uitleg));

  const max = Math.max(...rijen.map((r) => r.waarde), 0);
  if (!rijen.length || max === 0) {
    const leeg = document.createElement("p");
    leeg.className = "form-meta form-meta--plat";
    leeg.textContent = "Nog geen gegevens.";
    doel.appendChild(leeg);
    return;
  }

  const lijst = document.createElement("ul");
  lijst.className = "stat-staven";
  rijen.forEach((r) => {
    const li = document.createElement("li");
    li.className = "stat-staaf";
    li.title = r.titel;

    const label = document.createElement("span");
    label.className = "stat-staaf__label";
    label.textContent = r.label;

    const spoor = document.createElement("span");
    spoor.className = "stat-staaf__spoor";
    const vulling = document.createElement("span");
    vulling.className = "stat-staaf__vulling";
    vulling.style.width = Math.max(2, (100 * r.waarde) / max) + "%";
    if (r.kleur) vulling.style.backgroundColor = r.kleur;
    spoor.appendChild(vulling);

    const waarde = document.createElement("span");
    waarde.className = "stat-staaf__waarde";
    waarde.textContent = GETAL.format(r.waarde);

    li.appendChild(label);
    li.appendChild(spoor);
    li.appendChild(waarde);
    lijst.appendChild(li);
  });
  doel.appendChild(lijst);
}

// Lijngrafiek met de hand getekend in SVG. Een viewBox met width:100% maakt
// hem responsief zonder JavaScript bij het schalen. Elk punt krijgt een
// <title>, zodat je bij het zweven ziet wanneer en hoeveel.
const BREEDTE = 640;
const HOOGTE = 200;
const MARGE = { links: 34, rechts: 8, boven: 12, onder: 26 };

function lijnGrafiek(doel, { titel, uitleg, punten, klasse, eenheid, perUur }) {
  doel.textContent = "";
  doel.appendChild(grafiekKop(titel, uitleg));

  const totaal = punten.reduce((som, p) => som + p.waarde, 0);
  if (punten.length === 0 || totaal === 0) {
    const leeg = document.createElement("p");
    leeg.className = "form-meta form-meta--plat";
    leeg.textContent = "Niets gebeurd in deze periode.";
    doel.appendChild(leeg);
    return;
  }

  const max = Math.max(...punten.map((p) => p.waarde), 1);
  const binnenB = BREEDTE - MARGE.links - MARGE.rechts;
  const binnenH = HOOGTE - MARGE.boven - MARGE.onder;
  const x = (i) =>
    MARGE.links + (punten.length === 1 ? binnenB / 2 : (binnenB * i) / (punten.length - 1));
  const y = (w) => MARGE.boven + binnenH - (binnenH * w) / max;

  const svg = maakSvg("svg");
  svg.setAttribute("viewBox", `0 0 ${BREEDTE} ${HOOGTE}`);
  svg.setAttribute("class", "stat-lijngrafiek " + klasse);
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${titel}: ${GETAL.format(totaal)} in deze periode, hoogste waarde ${GETAL.format(max)}.`
  );

  // Basislijn en de lijn op de hoogste waarde, met hun getal ernaast.
  [
    { waarde: 0, tekst: "0" },
    { waarde: max, tekst: GETAL.format(max) },
  ].forEach((lijn) => {
    const l = maakSvg("line");
    l.setAttribute("x1", MARGE.links);
    l.setAttribute("x2", BREEDTE - MARGE.rechts);
    l.setAttribute("y1", y(lijn.waarde));
    l.setAttribute("y2", y(lijn.waarde));
    l.setAttribute("class", "stat-lijngrafiek__raster");
    svg.appendChild(l);

    const t = maakSvg("text");
    t.setAttribute("x", MARGE.links - 6);
    t.setAttribute("y", y(lijn.waarde) + 4);
    t.setAttribute("class", "stat-lijngrafiek__as");
    t.setAttribute("text-anchor", "end");
    t.textContent = lijn.tekst;
    svg.appendChild(t);
  });

  // Vlak onder de lijn: maakt een lage lijn beter zichtbaar dan een dun
  // streepje op een grote witte kaart.
  const vlak = maakSvg("polygon");
  vlak.setAttribute(
    "points",
    `${x(0)},${y(0)} ` +
      punten.map((p, i) => `${x(i)},${y(p.waarde)}`).join(" ") +
      ` ${x(punten.length - 1)},${y(0)}`
  );
  vlak.setAttribute("class", "stat-lijngrafiek__vlak");
  svg.appendChild(vlak);

  const lijn = maakSvg("polyline");
  lijn.setAttribute("points", punten.map((p, i) => `${x(i)},${y(p.waarde)}`).join(" "));
  lijn.setAttribute("class", "stat-lijngrafiek__lijn");
  svg.appendChild(lijn);

  // Bij veel punten zou een stip per tijdvak één zwarte massa worden; dan
  // enkel de tijdvakken waarin iets gebeurde.
  const toonAlles = punten.length <= 40;
  punten.forEach((p, i) => {
    if (!toonAlles && p.waarde === 0) return;
    const stip = maakSvg("circle");
    stip.setAttribute("cx", x(i));
    stip.setAttribute("cy", y(p.waarde));
    stip.setAttribute("r", 3);
    stip.setAttribute("class", "stat-lijngrafiek__stip");
    const uitlegPunt = maakSvg("title");
    uitlegPunt.textContent = `${momentTekst(p.moment, perUur)}: ${GETAL.format(
      p.waarde
    )} ${eenheid}`;
    stip.appendChild(uitlegPunt);
    svg.appendChild(stip);
  });

  // Enkel het eerste en het laatste tijdvak als bijschrift: alle datums
  // eronder zetten wordt op een telefoon toch onleesbaar.
  [
    { i: 0, anker: "start" },
    { i: punten.length - 1, anker: "end" },
  ].forEach(({ i, anker }) => {
    if (punten.length === 1 && anker === "end") return;
    const t = maakSvg("text");
    t.setAttribute("x", x(i));
    t.setAttribute("y", HOOGTE - 6);
    t.setAttribute("class", "stat-lijngrafiek__as");
    t.setAttribute("text-anchor", anker);
    t.textContent = momentTekst(punten[i].moment, perUur);
    svg.appendChild(t);
  });

  doel.appendChild(svg);

  const som = document.createElement("p");
  som.className = "stat-grafiek__som";
  som.textContent = `${GETAL.format(totaal)} ${eenheid} in deze periode`;
  doel.appendChild(som);
}

function maakSvg(naam) {
  return document.createElementNS("http://www.w3.org/2000/svg", naam);
}

function momentTekst(moment, perUur) {
  return perUur ? UUR.format(moment) : DATUM.format(moment);
}
