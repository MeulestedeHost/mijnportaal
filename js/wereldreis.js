// wereldreis.js — FIFA Wereldreis, fase 1: gedeelde bouwstenen
//
// Dit bestand bevat alles wat de grote kaart (js/wereldkaart.js) en de widget
// op het dashboard (js/wereldreis-widget.js) samen nodig hebben: de
// coördinaten, de kleurenschaal, het ophalen van de cijfers en het tekenen van
// een Leaflet-kaart met stippen.
//
// VIJF CATEGORIEËN. De stippen en popupsecties zijn bewust geen losse code
// maar één lijst, CATEGORIEEN hieronder — voorbereid op alle vijf categorieën
// uit de eindvisie (stickers, voetbal, land, talen, foto's), ook al toont
// fase 1 er maar drie. Elke categorie beschrijft zichzelf: welk icoon, welke
// kleurklasse, en wat er in de popup komt.
//   - 'zichtbaar' bepaalt of de categorie NU al een stip en een popupsectie
//     krijgt. Fase 1 zet dit enkel aan voor stickers, voetbal en land; talen
//     en foto's staan klaar (met label, icoon en placeholdertekst) maar
//     blijven onzichtbaar tot een latere fase ze aanzet.
//   - 'actief' bepaalt of die stip écht gegevens toont (kleur naar
//     verzamelpercentage, een gevulde popup) of nog een dof "komt eraan"-punt
//     is met een placeholderzin. Enkel stickers is actief in fase 1.
// Een latere fase hoeft dus geen tekencode te schrijven: 'zichtbaar' en
// 'actief' aanzetten en een 'popup'-functie schrijven volstaat — de stip, de
// legende en de popup volgen vanzelf.
//
// LEAFLET. Wordt als globale L geladen via een <script>-tag in de pagina, niet
// als module: de Content-Security-Policy in _headers laat scripts enkel toe van
// 'self' en cdn.jsdelivr.net, en de stylesheet enkel van 'self' (vandaar
// css/leaflet.css lokaal). Diezelfde CSP verbiedt style-attributen in HTML —
// daarom kleuren en positioneren de stippen via CSS-klassen en niet via
// style="".
import { supabase } from "./supabase.js";

// ---------- coördinaten ----------

// Eén punt per land uit public.sticker_catalogus, ruwweg het middelpunt van
// het land. Het hoeft niet exact te zijn: de stip wijst een land aan op een
// wereldkaart, hij markeert geen plek.
//
// Engeland en Schotland staan er los in, want dat doet het album ook. Een
// landenbestand met grenzen zou ze allebei op "Verenigd Koninkrijk" laten
// vallen; met punten kan elk zijn eigen plaats houden. Curaçao (CUW) is om
// dezelfde reden een eigen punt en geen stukje Nederland.
export const LAND_PUNTEN = {
  ALG: [28.03, 1.66],     // Algerije
  ARG: [-38.42, -63.62],  // Argentinië
  AUS: [-25.27, 133.78],  // Australië
  AUT: [47.52, 14.55],    // Oostenrijk
  BEL: [50.5, 4.47],      // België
  BIH: [43.92, 17.68],    // Bosnië-Herzegovina
  BRA: [-14.24, -51.93],  // Brazilië
  CAN: [56.13, -106.35],  // Canada
  CIV: [7.54, -5.55],     // Ivoorkust
  COD: [-4.04, 21.76],    // DR Congo
  COL: [4.57, -74.3],     // Colombia
  CPV: [16.0, -24.01],    // Kaapverdië
  CRO: [45.1, 15.2],      // Kroatië
  CUW: [12.17, -68.99],   // Curaçao
  CZE: [49.82, 15.47],    // Tsjechië
  ECU: [-1.83, -78.18],   // Ecuador
  EGY: [26.82, 30.8],     // Egypte
  ENG: [52.36, -1.17],    // Engeland
  ESP: [40.46, -3.75],    // Spanje
  FRA: [46.23, 2.21],     // Frankrijk
  GER: [51.17, 10.45],    // Duitsland
  GHA: [7.95, -1.02],     // Ghana
  HAI: [18.97, -72.29],   // Haïti
  IRN: [32.43, 53.69],    // Iran
  IRQ: [33.22, 43.68],    // Irak
  JOR: [30.59, 36.24],    // Jordanië
  JPN: [36.2, 138.25],    // Japan
  KOR: [35.91, 127.77],   // Zuid-Korea
  KSA: [23.89, 45.08],    // Saoedi-Arabië
  MAR: [31.79, -7.09],    // Marokko
  MEX: [23.63, -102.55],  // Mexico
  NED: [52.13, 5.29],     // Nederland
  NOR: [60.47, 8.47],     // Noorwegen
  NZL: [-40.9, 174.89],   // Nieuw-Zeeland
  PAN: [8.54, -80.78],    // Panama
  PAR: [-23.44, -58.44],  // Paraguay
  POR: [39.4, -8.22],     // Portugal
  QAT: [25.35, 51.18],    // Qatar
  RSA: [-30.56, 22.94],   // Zuid-Afrika
  SCO: [56.49, -4.2],     // Schotland
  SEN: [14.5, -14.45],    // Senegal
  SUI: [46.82, 8.23],     // Zwitserland
  SWE: [60.13, 18.64],    // Zweden
  TUN: [33.89, 9.54],     // Tunesië
  TUR: [38.96, 35.24],    // Turkije
  URU: [-32.52, -55.77],  // Uruguay
  USA: [39.83, -98.58],   // Verenigde Staten
  UZB: [41.38, 64.59],    // Oezbekistan
};

// ---------- kleurenschaal ----------

// De vier trappen uit de opdracht. Klassenamen in plaats van kleurcodes, want
// de CSP laat geen style="background:…" toe; css/style.css houdt de echte
// kleuren bij, zodat de kaart, de legende en de balk niet uit elkaar lopen.
const TRAPPEN = [
  { vanaf: 100, klasse: "wr-vol",    bereik: "100 %",    label: "compleet" },
  { vanaf: 75,  klasse: "wr-hoog",   bereik: "75 – 99 %", label: "bijna compleet" },
  { vanaf: 25,  klasse: "wr-midden", bereik: "25 – 74 %", label: "halfweg" },
  { vanaf: 0,   klasse: "wr-laag",   bereik: "0 – 24 %",  label: "net begonnen" },
];

export function trapVoor(procent) {
  return TRAPPEN.find((t) => procent >= t.vanaf) || TRAPPEN[TRAPPEN.length - 1];
}

export const LEGENDE = TRAPPEN;

// ---------- categorieën ----------

// Alle vijf categorieën uit de eindvisie. 'zichtbaar: false' betekent: geen
// stip, geen popupsectie — de categorie bestaat enkel als voorbereiding.
// 'actief: false' (maar wel zichtbaar) betekent: wel een dof stipje en een
// popupsectie, maar met een placeholderzin in plaats van echte gegevens.
export const CATEGORIEEN = [
  {
    id: "stickers",
    label: "Stickers",
    icoon: "🧩",
    fase: 1,
    zichtbaar: true,
    actief: true,
    // De stickerstip is de enige die van kleur verandert: hij draagt het cijfer.
    klasseVoor: (land) => "wr-stip--stickers " + trapVoor(land.procent).klasse,
    popup: (land) => stickerPopup(land),
    placeholder: null,
  },
  {
    id: "voetbal",
    label: "Voetbal",
    icoon: "⚽",
    fase: 2,
    zichtbaar: true,
    actief: false,
    klasseVoor: () => "wr-stip--voetbal",
    popup: null,
    placeholder: "Voetbalinformatie verschijnt in de volgende update.",
  },
  {
    id: "land",
    label: "Land",
    icoon: "📍",
    fase: 3,
    zichtbaar: true,
    actief: false,
    klasseVoor: () => "wr-stip--land",
    popup: null,
    placeholder: "Meer over dit land verschijnt in een volgende update.",
  },
  // Talen en foto's staan klaar voor een latere fase, maar tekenen in fase 1
  // nog geen stip en krijgen geen popupsectie: 'zichtbaar' blijft false tot
  // die fase ze aanzet. Er is dan geen enkele tekencode meer nodig — enkel
  // deze twee regels aanpassen.
  {
    id: "talen",
    label: "Talen",
    icoon: "🗣️",
    fase: 3,
    zichtbaar: false,
    actief: false,
    klasseVoor: () => "wr-stip--talen",
    popup: null,
    placeholder: "Taalinformatie verschijnt in een volgende update.",
  },
  {
    id: "fotos",
    label: "Foto's",
    icoon: "📷",
    fase: 3,
    zichtbaar: false,
    actief: false,
    klasseVoor: () => "wr-stip--fotos",
    popup: null,
    placeholder: "Foto's verschijnen in een volgende update.",
  },
];

// De categorieën die in de huidige fase echt een stip en een popupsectie
// krijgen — overal elders in dit bestand en in js/wereldkaart.js gebruikt in
// plaats van rechtstreeks over CATEGORIEEN te lopen.
export const ZICHTBARE_CATEGORIEEN = CATEGORIEEN.filter((c) => c.zichtbaar);

// ---------- gegevens ----------

// Eén aanroep levert alle landen van één verzamelaar. De RPC staat in
// sql/010_wereldreis.sql; draait die migratie nog niet, dan gooit dit een
// fout die de pagina zelf opvangt en uitlegt.
export async function laadLanden(kindId) {
  const { data, error } = await supabase.rpc("wereldreis_landen", { p_kind_id: kindId });
  if (error) throw error;

  return (data || []).map((rij) => ({
    ...rij,
    punt: LAND_PUNTEN[rij.land_code] || null,
    opKaart: rij.categorie === "team" && Boolean(LAND_PUNTEN[rij.land_code]),
  }));
}

// De cijfers boven de kaart en in de widget. "Voltooid" is hier: elk plaatje
// van dat land geplakt, dus 100 %. Niet "ontdekt" — dat datamodel kan niet
// betrouwbaar bepalen wánneer een land voor het eerst iets kreeg, enkel hoe
// ver het nu staat. Een lagere drempel dan 100 % zou bovendien niets
// betekenen: wie nog niets aanduidde staat overal op 100 %, en dan is "je
// hebt er minstens één" waar voor iedereen, altijd.
export function samenvatting(landen) {
  const opKaart = landen.filter((l) => l.opKaart);
  const stickersTotaal = landen.reduce((som, l) => som + l.totaal, 0);
  const stickersHeeft = landen.reduce((som, l) => som + l.heeft, 0);
  return {
    voltooid: opKaart.filter((l) => l.procent >= 100).length,
    landen: opKaart.length,
    stickersHeeft,
    stickersTotaal,
    gezocht: landen.reduce((som, l) => som + l.gezocht, 0),
    dubbel: landen.reduce((som, l) => som + l.dubbel, 0),
    procent: stickersTotaal ? Math.round((100 * stickersHeeft) / stickersTotaal) : 0,
  };
}

// ---------- kaart ----------

const WERELD = [
  [-58, -170],
  [78, 180],
];

// De kaart zelf. 'mini' schakelt alles uit waar je op een dashboardwidget niets
// aan hebt: slepen, zoomen, knoppen. Wie de kaart écht wil gebruiken, klikt
// door naar wereldreis.html.
export function maakKaart(element, { mini = false } = {}) {
  const kaart = L.map(element, {
    zoomControl: !mini,
    attributionControl: true,
    dragging: !mini,
    scrollWheelZoom: !mini,
    doubleClickZoom: !mini,
    touchZoom: !mini,
    boxZoom: !mini,
    keyboard: !mini,
    // De minikaart mag tot zoomtrap 0 uitzoomen: in een vak van 156 pixels
    // hoog past de hele wereld pas op die trap. De grote kaart begint op 1 —
    // daar is ruimte zat en wordt 0 onnodig klein.
    minZoom: mini ? 0 : 1,
    maxZoom: 6,
    worldCopyJump: !mini,
  });

  // De tegels van OpenStreetMap zelf: gratis, zonder sleutel, met landsgrenzen
  // en landnamen erop. Daarom staat tile.openstreetmap.org in de img-src van
  // _headers — zonder die regel blokkeert de CSP elke tegel en blijft de kaart
  // leeg grijs.
  //
  // Wil je ooit een rustiger kaartbeeld: de meeste alternatieven (CARTO
  // Positron, Stadia, Mapbox) vragen intussen een API-sleutel en een account.
  // Vervang dan deze URL, zet de nieuwe host in _headers, en pas de attributie
  // hieronder aan — meer is er niet aan.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    minZoom: mini ? 0 : 1,
    maxZoom: 6,
    // De grote kaart mag horizontaal doorlopen (worldCopyJump verplaatst de
    // stippen dan mee naar de zichtbare kopie). Op de minikaart, waar je niet
    // kan slepen, zou een tweede wereld zonder stippen enkel verwarren.
    //
    // noWrap alleen volstaat niet: op zoomtrap 0 is de wereld 256 pixels breed
    // en het vak breder, en dan vraagt Leaflet toch de tegels links en rechts
    // ernaast op — die bestaan niet en geven een 400 in de console. 'bounds'
    // knipt die aanvragen weg.
    noWrap: mini,
    bounds: mini ? L.latLngBounds([-85.05, -180], [85.05, 180]) : undefined,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers',
  }).addTo(kaart);

  kaart.fitBounds(WERELD);
  if (mini) kaart.attributionControl.setPrefix("");
  return kaart;
}

// Zet de stippen op de kaart en geeft de laag terug, zodat de pagina ze bij een
// andere verzamelaar in één keer kan vervangen.
export function tekenLanden(kaart, landen, { mini = false } = {}) {
  const laag = L.layerGroup().addTo(kaart);

  landen
    .filter((land) => land.opKaart)
    .forEach((land) => {
      const marker = L.marker(land.punt, {
        icon: L.divIcon({
          className: "wr-marker",
          html: stippenHtml(land, mini),
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        title: `${land.land_naam} — ${land.procent} %`,
        keyboard: !mini,
        interactive: !mini,
        // Europa staat vol: op wereldniveau overlappen een stuk of twintig
        // stippen elkaar. Inzoomen trekt ze uit elkaar, en tot dan brengt
        // riseOnHover de stip waar je op mikt naar voren.
        riseOnHover: !mini,
      });
      if (!mini) marker.bindPopup(() => bouwPopup(land));
      marker.addTo(laag);
    });

  return laag;
}

// De stippen als HTML-string, want zo wil L.divIcon het. Er komt geen enkele
// waarde van een gebruiker in: land_naam en de cijfers staan in de catalogus,
// de klassen komen uit dit bestand. De popup — waar wél tekst uit de databank
// in belandt — bouwen we verderop wél met textContent.
//
// De volgorde van de stippen (voetbal, land, stickers) bepaalt welke plek elke
// stip krijgt in de driehoeksopstelling uit css/style.css — daar staan per
// klasse vaste, niet-willekeurige offsets (wr-stip--voetbal boven,
// wr-stip--land rechtsonder, wr-stip--stickers linksonder), zodat een land
// altijd dezelfde opstelling toont. Op een klein scherm of de ministip op het
// dashboard blijft alleen de stickerstip staan, en die wordt daar herzet naar
// het midden — zie de media query en .wr-kaart--mini in css/style.css.
function stippenHtml(land, mini) {
  const categorieen = mini
    ? ZICHTBARE_CATEGORIEEN.filter((c) => c.actief)
    : ZICHTBARE_CATEGORIEEN;
  const stippen = categorieen
    .map((cat) => `<span class="wr-stip ${cat.klasseVoor(land)}"></span>`)
    .join("");
  return `<span class="wr-stip-groep">${stippen}</span>`;
}

// ---------- popup ----------

// Eén sectie per zichtbare categorie, elk met dezelfde kop (icoon + label) —
// zo leest de popup als één geheel in plaats van "de stickerinfo, plus twee
// losse zinnetjes". Fase 2 en 3 hoeven deze opbouw niet aan te raken: zodra
// hun categorie 'actief' wordt, verschijnt hun popup(land) hier vanzelf in
// plaats van de placeholderzin.
function bouwPopup(land) {
  const vak = document.createElement("div");
  vak.className = "wr-popup";

  const titel = document.createElement("p");
  titel.className = "wr-popup__titel";
  titel.textContent = land.land_naam;
  vak.appendChild(titel);

  const code = document.createElement("span");
  code.className = "wr-popup__code";
  code.textContent = land.land_code;
  titel.appendChild(code);

  ZICHTBARE_CATEGORIEEN.forEach((cat) => {
    const inhoud = cat.actief && cat.popup ? cat.popup(land) : placeholderInhoud(cat);
    vak.appendChild(sectie(cat, inhoud));
  });

  return vak;
}

function sectie(cat, inhoud) {
  const wrap = document.createElement("div");
  wrap.className = "wr-popup__sectie";

  const kop = document.createElement("p");
  kop.className = "wr-popup__sectie-kop";
  const icoon = document.createElement("span");
  icoon.className = "wr-popup__sectie-icoon";
  icoon.textContent = cat.icoon;
  const label = document.createElement("span");
  label.textContent = cat.label;
  kop.appendChild(icoon);
  kop.appendChild(label);

  wrap.appendChild(kop);
  wrap.appendChild(inhoud);
  return wrap;
}

function stickerPopup(land) {
  const blok = document.createElement("div");
  blok.className = "wr-popup__blok";

  const kop = document.createElement("p");
  kop.className = "wr-popup__procent " + trapVoor(land.procent).klasse;
  kop.textContent = `${land.procent} % verzameld`;
  blok.appendChild(kop);

  blok.appendChild(balk(land.procent));

  const lijst = document.createElement("dl");
  lijst.className = "wr-popup__cijfers";
  [
    ["In bezit", `${land.heeft} van ${land.totaal}`],
    ["Gezocht", String(land.gezocht)],
    ["Dubbel", String(land.dubbel)],
  ].forEach(([naam, waarde]) => {
    const dt = document.createElement("dt");
    dt.textContent = naam;
    const dd = document.createElement("dd");
    dd.textContent = waarde;
    lijst.appendChild(dt);
    lijst.appendChild(dd);
  });
  blok.appendChild(lijst);
  return blok;
}

function placeholderInhoud(cat) {
  const p = document.createElement("p");
  p.className = "wr-popup__wacht";
  p.textContent = cat.placeholder;
  return p;
}

// De vulling wordt via el.style gezet en niet via een style-attribuut in de
// HTML: de CSP blokkeert dat attribuut, maar niet het aanspreken van .style
// vanuit JavaScript.
export function balk(procent) {
  const buiten = document.createElement("div");
  buiten.className = "wr-balk";
  buiten.setAttribute("role", "progressbar");
  buiten.setAttribute("aria-valuenow", String(procent));
  buiten.setAttribute("aria-valuemin", "0");
  buiten.setAttribute("aria-valuemax", "100");

  const binnen = document.createElement("div");
  binnen.className = "wr-balk__vulling " + trapVoor(procent).klasse;
  binnen.style.width = Math.max(0, Math.min(100, procent)) + "%";
  buiten.appendChild(binnen);
  return buiten;
}

// ---------- welke verzamelaar ----------

// De grote kaart en de widget kijken naar dezelfde verzamelaar: kies je op het
// dashboard je dochter, dan opent de grote kaart ook bij haar. De keuze staat
// in localStorage, niet in de databank — het is een voorkeur van dit toestel,
// geen gegeven van het gezin.
const KEUZE_SLEUTEL = "wereldreis.kind";

export function bewaarKeuze(kindId) {
  try {
    localStorage.setItem(KEUZE_SLEUTEL, kindId);
  } catch (err) {
    /* privémodus of opslag vol: dan kiest de pagina gewoon de eerste */
  }
}

export function leesKeuze(kinderen) {
  if (kinderen.length === 0) return null;
  let bewaard = null;
  try {
    bewaard = localStorage.getItem(KEUZE_SLEUTEL);
  } catch (err) {
    /* zie hierboven */
  }
  const gevonden = kinderen.find((k) => k.id === bewaard);
  return gevonden ? gevonden.id : kinderen[0].id;
}
