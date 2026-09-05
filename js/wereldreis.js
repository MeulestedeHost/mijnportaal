// wereldreis.js — FIFA Wereldreis, fase 3: gedeelde bouwstenen
//
// Dit bestand bevat alles wat de grote kaart (js/wereldkaart.js) en de widget
// op het dashboard (js/wereldreis-widget.js) samen nodig hebben: de
// coördinaten, de kleurenschaal, het ophalen van de cijfers en het tekenen van
// een Leaflet-kaart met iconen.
//
// VIJF CATEGORIEËN. De iconen en popups zijn bewust geen losse code maar één
// lijst, CATEGORIEEN hieronder — alle vijf categorieën uit de eindvisie
// (stickers, voetbal, land, talen, foto's) staan er sinds fase 3 op
// 'zichtbaar' én 'actief'. Elke categorie beschrijft zichzelf: welk icoon,
// welke eventuele extra kleurklasse, en wat er in de popup komt.
//   - 'zichtbaar' bepaalt of de categorie NU al een icoon en popup krijgt.
//   - 'actief' bepaalt of dat icoon écht gegevens toont, of nog een dof "komt
//     eraan"-icoon is met een placeholderzin. Een zesde categorie in een
//     latere fase kan hier op dezelfde manier binnenkomen: 'zichtbaar' en
//     'actief' aanzetten en een 'popup'-functie schrijven volstaat — het
//     icoon, de legende en de popup volgen vanzelf.
//
// LOSSE POPUP PER ICOON. Tot en met fase 2 deelden alle categorieën één
// popup met tabbladen. Vanaf fase 3 heeft elk icoon zijn EIGEN kleine popup:
// tikken op een icoon opent enkel de info van dat icoon (zie tekenLanden() en
// openIconPopup() verderop). Dat is eenvoudiger voor een kind van een jaar of
// acht dan eerst een tabblad moeten kiezen, en de popups blijven daardoor
// klein genoeg om nooit tegen de rand van de kaart te botsen.
//
// LEAFLET. Wordt als globale L geladen via een <script>-tag in de pagina, niet
// als module: de Content-Security-Policy in _headers laat scripts enkel toe van
// 'self' en cdn.jsdelivr.net, en de stylesheet enkel van 'self' (vandaar
// css/leaflet.css lokaal). Diezelfde CSP verbiedt style-attributen in HTML —
// daarom kleuren en positioneren de iconen via CSS-klassen en niet via
// style="".
import { supabase } from "./supabase.js";
import { voetbalVoor, confederatieNaam, RANKING_STAND } from "./voetbal-data.js";
import { landInfoVoor } from "./land-data.js";
import { talenVoor } from "./talen-data.js";
import { laadFotos } from "./foto-data.js";

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

// Alle vijf categorieën uit de eindvisie, sinds fase 3 allemaal 'zichtbaar'
// én 'actief'. 'klasseVoor' levert enkel nog een EXTRA klasse (naast de vaste
// 'wr-icoon wr-icoon--<id>' die tekenLanden() altijd zet) — enkel de
// stickerscategorie gebruikt dat om zijn percentagekleur toe te voegen.
export const CATEGORIEEN = [
  {
    id: "stickers",
    label: "Stickers",
    icoon: "🃏",
    fase: 1,
    zichtbaar: true,
    actief: true,
    // Het stickerenicoon is het enige dat van kleur verandert: het draagt het
    // verzamelpercentage.
    klasseVoor: (land) => trapVoor(land.procent).klasse,
    popup: (land) => stickerPopup(land),
    placeholder: null,
  },
  {
    id: "voetbal",
    label: "Voetbal",
    icoon: "⚽",
    fase: 2,
    zichtbaar: true,
    actief: true,
    klasseVoor: () => "",
    popup: (land) => voetbalPopup(land),
    // Blijft staan als vangnet: een land uit de catalogus zonder rij in
    // js/voetbal-data.js valt hierop terug in plaats van op een lege popup.
    placeholder: "Voetbalinformatie voor dit land verschijnt in een volgende update.",
  },
  {
    id: "land",
    label: "Landinfo",
    icoon: "🌍",
    fase: 3,
    zichtbaar: true,
    actief: true,
    klasseVoor: () => "",
    popup: (land) => landPopup(land),
    placeholder: "Meer over dit land verschijnt in een volgende update.",
  },
  {
    id: "talen",
    label: "Talen",
    icoon: "🗣️",
    fase: 3,
    zichtbaar: true,
    actief: true,
    klasseVoor: () => "",
    popup: (land) => talenPopup(land),
    placeholder: "Taalinformatie verschijnt in een volgende update.",
  },
  {
    id: "fotos",
    label: "Foto's",
    icoon: "📸",
    fase: 3,
    zichtbaar: true,
    actief: true,
    klasseVoor: () => "",
    // Bouwt meteen een laadskelet; vulFotoPopup() (zie verderop) vult het pas
    // met echte foto's zodra dit icoon ook echt aangetikt wordt.
    popup: (land) => fotoPopup(land),
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

// Zet de iconen op de kaart en geeft de laag terug, zodat de pagina ze bij een
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
        title: land.land_naam,
        keyboard: !mini,
        interactive: !mini,
        // Europa staat vol: op wereldniveau overlappen een stuk of twintig
        // iconengroepen elkaar. Inzoomen trekt ze uit elkaar, en tot dan
        // brengt riseOnHover de groep waar je op mikt naar voren.
        riseOnHover: !mini,
      });
      marker.addTo(laag);

      if (!mini) {
        // Elk icoon heeft zijn EIGEN popup (zie openIconPopup() verderop) in
        // plaats van één gedeelde popup met tabbladen: de listener leest
        // welk icoon precies werd aangeklikt of met Enter/Spatie bevestigd.
        const opIcoon = (doel) => {
          const icoonEl = doel && doel.closest && doel.closest("[data-categorie]");
          const cat = icoonEl && CATEGORIEEN.find((c) => c.id === icoonEl.dataset.categorie);
          if (cat) openIconPopup(kaart, land, cat);
        };
        marker.on("click", (e) => opIcoon(e.originalEvent && e.originalEvent.target));

        // De iconen zijn gewone <span>'s, geen <button>'s (dat zou binnen een
        // L.divIcon extra Leaflet-eigenaardigheden geven), dus toetsenbord-
        // bediening bouwen we hier zelf: elk icoon kreeg tabindex="0" in
        // stippenHtml(), en Enter/Spatie opent dezelfde popup als een klik.
        const el = marker.getElement();
        if (el) {
          el.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            opIcoon(e.target);
          });
        }
      }
    });

  return laag;
}

// Eén kleine, losse popup voor precies het icoon waarop getikt werd. openOn()
// sluit een eventueel nog open popup van een ander land of icoon vanzelf —
// zo blijft er nooit meer dan één popup tegelijk open.
function openIconPopup(kaart, land, cat) {
  const inhoud = bouwMiniPopup(land, cat);
  const popup = L.popup({ minWidth: 230, autoPanPadding: [12, 12] })
    .setLatLng(land.punt)
    .setContent(inhoud)
    .openOn(kaart);

  if (cat.id === "fotos") {
    vulFotoPopup(inhoud.querySelector(".wr-foto-galerij"), land, popup);
  }
}

// De iconen als HTML-string, want zo wil L.divIcon het. Er komt geen enkele
// waarde van een gebruiker in: land_naam en de cijfers staan in de catalogus,
// de klassen komen uit dit bestand. De popup — waar wél tekst uit de databank
// in belandt — bouwen we verderop wél met textContent.
//
// De cluster-CSS in css/style.css geeft elke 'wr-icoon--<id>'-klasse een
// vaste, niet-willekeurige positie rond het middelpunt (voetbal boven,
// stickers links, foto's rechts, talen en landinfo onderaan) — dezelfde
// opstelling op elke herlading en elk zoomniveau. Op de ministip van het
// dashboard blijft alleen het stickerenicoon staan, gecentreerd — zie
// .wr-kaart--mini in css/style.css.
function stippenHtml(land, mini) {
  // De ministip op het dashboard toont enkel het stickerenicoon: daar is geen
  // ruimte voor een cluster, en die kaart is toch niet klikbaar.
  const categorieen = mini
    ? ZICHTBARE_CATEGORIEEN.filter((c) => c.id === "stickers")
    : ZICHTBARE_CATEGORIEEN;
  const stippen = categorieen
    .map((cat) => {
      const isStickers = cat.id === "stickers";
      const tekst = isStickers ? `${cat.label} — ${land.procent} %` : cat.label;
      const aria = `${tekst} van ${land.land_naam}`;
      const klasse = ["wr-icoon", "wr-icoon--" + cat.id, cat.klasseVoor(land), cat.actief ? "" : "wr-icoon--wacht"]
        .filter(Boolean)
        .join(" ");
      const interactief = mini ? "" : ` role="button" tabindex="0"`;
      return `<span class="${klasse}" data-categorie="${cat.id}"${interactief} title="${aria}" aria-label="${aria}">${cat.icoon}</span>`;
    })
    .join("");
  return `<span class="wr-stip-groep">${stippen}</span>`;
}

// ---------- popup ----------

// De kleine popupomkadering rond precies één categorie: icoon + label + land
// in de kop, en daaronder de inhoud die cat.popup(land) teruggeeft (of de
// placeholderzin wanneer een categorie nog niet 'actief' is). openIconPopup()
// in tekenLanden() hierboven roept dit aan.
function bouwMiniPopup(land, cat) {
  const vak = document.createElement("div");
  vak.className = "wr-popup";

  const titel = document.createElement("p");
  titel.className = "wr-popup__titel";
  const icoon = document.createElement("span");
  icoon.setAttribute("aria-hidden", "true");
  icoon.textContent = cat.icoon;
  titel.appendChild(icoon);
  titel.appendChild(document.createTextNode(` ${cat.label} — ${land.land_naam}`));
  vak.appendChild(titel);

  vak.appendChild(cat.actief && cat.popup ? cat.popup(land) : placeholderInhoud(cat));
  return vak;
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

// ---------- voetbal (fase 2) ----------

// De gegevens komen uit js/voetbal-data.js; dit bestand kent enkel de vorm van
// een record, niet de inhoud. De optionele velden onderaan (trainer, stadion,
// prestatie) staan er al: worden ze later in de dataset ingevuld, dan
// verschijnen ze vanzelf, en zolang ze ontbreken slaat de renderer ze over.
function voetbalPopup(land) {
  const info = voetbalVoor(land.land_code);
  if (!info) {
    return placeholderInhoud(CATEGORIEEN.find((c) => c.id === "voetbal"));
  }

  const blok = document.createElement("div");
  blok.className = "wr-popup__blok wr-voetbal";

  const bijnaam = document.createElement("p");
  bijnaam.className = "wr-voetbal__bijnaam";
  bijnaam.textContent = info.bijnaam;
  blok.appendChild(bijnaam);

  const ploeg = document.createElement("p");
  ploeg.className = "wr-voetbal__ploeg";
  ploeg.textContent = "Nationale ploeg van " + info.ploeg;
  blok.appendChild(ploeg);

  // Dezelfde dl-opmaak als het stickerpaneel — één visuele taal voor alle
  // feitenrijen in de popup.
  const lijst = document.createElement("dl");
  lijst.className = "wr-popup__cijfers wr-voetbal__feiten";

  rij(lijst, "Shirt", shirtWaarde(info));
  rij(lijst, "Speelt in", confederatieNaam(info.confederatie));
  if (info.ranking) rij(lijst, "FIFA-ranking", "nr. " + info.ranking);
  info.spelers.forEach((speler, i) => {
    rij(
      lijst,
      i === 0 ? "Bekende speler" : "Ook bekend",
      speler.positie ? `${speler.naam} (${speler.positie.toLowerCase()})` : speler.naam
    );
  });
  if (info.trainer) rij(lijst, "Trainer", info.trainer);
  if (info.stadion) rij(lijst, "Stadion", info.stadion);
  if (info.prestatie) rij(lijst, "Grootste prestatie", info.prestatie);

  blok.appendChild(lijst);

  blok.appendChild(tekstBlok("Zo spelen ze", info.speelstijl));
  blok.appendChild(tekstBlok("💡 Wist je dat?", info.weetje));

  if (info.ranking) {
    const stand = document.createElement("p");
    stand.className = "wr-voetbal__stand";
    stand.textContent = "FIFA-ranking volgens de stand van " + RANKING_STAND + ".";
    blok.appendChild(stand);
  }

  return blok;
}

// De shirtkleuren als echte gekleurde bolletjes naast het woord. De kleur komt
// uit de dataset en wordt via el.style gezet: een style-attribuut in HTML zou
// de CSP tegenhouden, het aanspreken van .style vanuit JavaScript niet.
function shirtWaarde(info) {
  const wrap = document.createElement("span");
  wrap.className = "wr-shirt";

  (info.shirtKleuren || []).forEach((kleur) => {
    const bol = document.createElement("span");
    bol.className = "wr-shirt__kleur";
    bol.style.backgroundColor = kleur;
    wrap.appendChild(bol);
  });

  const tekst = document.createElement("span");
  tekst.textContent = info.shirt;
  wrap.appendChild(tekst);
  return wrap;
}

// Waarde mag een string zijn of een element (zoals de shirtbolletjes).
function rij(lijst, naam, waarde) {
  const dt = document.createElement("dt");
  dt.textContent = naam;
  const dd = document.createElement("dd");
  if (typeof waarde === "string") {
    dd.textContent = waarde;
  } else {
    dd.appendChild(waarde);
  }
  lijst.appendChild(dt);
  lijst.appendChild(dd);
}

// Een kopje plus een zin erna — gebruikt door het voetbalpaneel (speelstijl,
// weetje) én, sinds fase 3, het landinfopaneel (bekend om, weetje). Generieke
// naam en klassen, want de inhoud is niet langer voetbalspecifiek.
function tekstBlok(kop, tekst) {
  const vak = document.createElement("div");
  vak.className = "wr-tekstblok";

  const titel = document.createElement("p");
  titel.className = "wr-tekstblok__kop";
  titel.textContent = kop;

  const inhoud = document.createElement("p");
  inhoud.className = "wr-tekstblok__tekst";
  inhoud.textContent = tekst;

  vak.appendChild(titel);
  vak.appendChild(inhoud);
  return vak;
}

function placeholderInhoud(cat) {
  const p = document.createElement("p");
  p.className = "wr-popup__wacht";
  p.textContent = cat.placeholder;
  return p;
}

// ---------- landinfo (fase 3) ----------

// De gegevens komen uit js/land-data.js — dezelfde scheiding tussen data en
// weergave als bij het voetbalpaneel.
function landPopup(land) {
  const info = landInfoVoor(land.land_code);
  if (!info) {
    return placeholderInhoud(CATEGORIEEN.find((c) => c.id === "land"));
  }

  const blok = document.createElement("div");
  blok.className = "wr-popup__blok";

  const lijst = document.createElement("dl");
  lijst.className = "wr-popup__cijfers";
  rij(lijst, "Hoofdstad", info.hoofdstad);
  rij(lijst, "Continent", info.continent);
  rij(lijst, "Inwoners", info.inwoners);
  blok.appendChild(lijst);

  blok.appendChild(tekstBlok("Bekend om", info.bekendOm));
  blok.appendChild(tekstBlok("💡 Leuk weetje", info.weetje));
  return blok;
}

// ---------- talen (fase 3) ----------

// Bij één officiële taal tonen we de volledige rij (Nederlands/Engels/lokale
// naam/taal); bij meerdere talen bestaat er geen "de taal van dat land" om
// apart uit te lichten, dus dan volstaat een opsomming — zie js/talen-data.js.
function talenPopup(land) {
  const info = talenVoor(land.land_code);
  if (!info) {
    return placeholderInhoud(CATEGORIEEN.find((c) => c.id === "talen"));
  }

  const blok = document.createElement("div");
  blok.className = "wr-popup__blok";

  const lijst = document.createElement("dl");
  lijst.className = "wr-popup__cijfers";

  if (info.talen.length > 1) {
    rij(lijst, "Talen", meervoudigOpsommen(info.talen));
  } else {
    rij(lijst, "Nederlands", land.land_naam);
    if (info.engels) rij(lijst, "Engels", info.engels);
    if (info.lokaleNaam) rij(lijst, "Lokale naam", info.lokaleNaam);
    rij(lijst, "Taal", info.talen[0]);
  }

  blok.appendChild(lijst);
  return blok;
}

function meervoudigOpsommen(lijst) {
  if (lijst.length === 1) return lijst[0];
  return lijst.slice(0, -1).join(", ") + " en " + lijst[lijst.length - 1];
}

// ---------- foto's (fase 3) ----------

// fotoPopup() bouwt meteen een laadskelet — geen netwerkaanvraag hier. Pas
// wanneer dit icoon ook echt aangetikt wordt, roept openIconPopup() hierboven
// vulFotoPopup() aan, die de echte foto's ophaalt (zie js/foto-data.js) en dit
// skelet vervangt. Zo blijft de kaart snel: 48 landen zouden anders 48
// databankaanvragen sturen bij het laden van de kaart, voor foto's die
// misschien nooit bekeken worden.
function fotoPopup(land) {
  void land; // niet nodig hier: bouwMiniPopup() zet landnaam en icoon al in de kop
  const blok = document.createElement("div");
  blok.className = "wr-popup__blok";

  const galerij = document.createElement("div");
  galerij.className = "wr-foto-galerij wr-foto-galerij--laden";
  for (let i = 0; i < 3; i++) {
    const skelet = document.createElement("span");
    skelet.className = "wr-foto-skelet";
    skelet.setAttribute("aria-hidden", "true");
    galerij.appendChild(skelet);
  }
  blok.appendChild(galerij);

  const status = document.createElement("p");
  status.className = "wr-popup__wacht";
  status.textContent = "Foto's laden…";
  blok.appendChild(status);

  return blok;
}

// Vervangt het laadskelet door de echte foto's (of een nette lege boodschap).
// popup.update() is nodig omdat Leaflet de afmetingen van een popup enkel bij
// het openen berekent: zonder deze aanroep zou de popup de nieuwe, vaak
// hogere inhoud niet meenemen en zouden de foto's onderaan afgesneden lijken.
async function vulFotoPopup(galerijEl, land, popup) {
  if (!galerijEl) return;

  let fotos = [];
  try {
    fotos = await laadFotos(land.land_code);
  } catch (err) {
    fotos = [];
  }

  const blok = galerijEl.parentElement;
  const status = blok && blok.querySelector(".wr-popup__wacht");
  galerijEl.classList.remove("wr-foto-galerij--laden");
  galerijEl.innerHTML = "";

  if (fotos.length === 0) {
    if (status) status.textContent = "Nog geen foto's voor dit land — kom later nog eens terug!";
  } else {
    if (status) status.remove();
    fotos.forEach((foto) => {
      const fig = document.createElement("figure");
      fig.className = "wr-foto";

      const img = document.createElement("img");
      img.src = foto.foto_url;
      img.alt = foto.alt_tekst;
      img.loading = "lazy";
      fig.appendChild(img);

      if (foto.titel) {
        const bijschrift = document.createElement("figcaption");
        bijschrift.textContent = foto.titel;
        fig.appendChild(bijschrift);
      }

      galerijEl.appendChild(fig);
    });
  }

  popup.update();
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
