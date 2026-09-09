// landen-data.js — FIFA Wereldreis & stickerbeheer: hoe een land eruitziet
//
// DE NOTATIE. Overal in het portaal wordt een land op dezelfde manier
// geschreven:
//
//     BEL - BELGIUM - België
//
// Eerst de FIFA/Panini-code (die staat op de sticker en op het ruilblad, en is
// dus de primaire identificatie), dan de Engelse albumnaam, dan de
// Nederlandse. landLabel() hieronder is de enige plek waar die volgorde
// vastligt — pas ze daar aan en elke pagina volgt.
//
// GEEN VLAGEMOJI. Bewust niet: Windows toont een vlagemoji niet als vlag maar
// als twee letters ("BE"), en op de vlaggen van Engeland en Schotland struikelt
// nog meer software. Een weergave die op de helft van de toestellen iets
// anders toont dan bedoeld, is geen herkenningspunt maar een raadsel.
//
// WAT HIER STAAT EN WAT NIET. De namen zelf en het paginanummer staan in de
// databank (public.sticker_catalogus, zie sql/013_landen_engels_en_pagina.sql):
// dat zijn catalogusgegevens. Dit bestand vult aan met de twee dingen die daar
// niet thuishoren:
//   - accent:     de accentkleur van het land. Pure opmaak.
//   - naamLokaal: de naam zoals het land zichzelf schrijft (Deutschland,
//                 España). Redactionele tekst, enkel voor de wereldreis-popup.
//
// DE KLEUREN. Eén per land, afgeleid van de nationale kleur of het shirt, en
// stuk voor stuk nagerekend op minstens 3:1 contrast tegen wit — de WCAG-eis
// (1.4.11) voor randen die betekenis dragen. Waar de echte kleur te licht was
// is ze verdiept: geel werd goud (Colombia, Ecuador), Zweden staat op blauw,
// en witte shirts (Engeland, Verenigde Staten, Nieuw-Zeeland, Ghana, Iran,
// Jordanië, Oezbekistan) kregen een kleur uit de vlag.

const LANDEN = {
  PANINI: { accent: "#0b3d91", naamLokaal: "Panini" },
  FWC:    { accent: "#7a1fa2", naamLokaal: "FIFA World Cup 26" },

  ALG: { accent: "#007a3d", naamLokaal: "الجزائر" },
  ARG: { accent: "#4f93cc", naamLokaal: "Argentina" },
  AUS: { accent: "#00843d", naamLokaal: "Australia" },
  AUT: { accent: "#ed2939", naamLokaal: "Österreich" },
  BEL: { accent: "#e30613", naamLokaal: "België" },
  BIH: { accent: "#002395", naamLokaal: "Bosna i Hercegovina" },
  BRA: { accent: "#009c3b", naamLokaal: "Brasil" },
  CAN: { accent: "#d52b1e", naamLokaal: "Canada" },
  CIV: { accent: "#e06b00", naamLokaal: "Côte d'Ivoire" },
  COD: { accent: "#007fff", naamLokaal: "République démocratique du Congo" },
  COL: { accent: "#a07d00", naamLokaal: "Colombia" },
  CPV: { accent: "#003893", naamLokaal: "Cabo Verde" },
  CRO: { accent: "#e60000", naamLokaal: "Hrvatska" },
  CUW: { accent: "#002b7f", naamLokaal: "Kòrsou" },
  CZE: { accent: "#d7141a", naamLokaal: "Česko" },
  ECU: { accent: "#b8860b", naamLokaal: "Ecuador" },
  EGY: { accent: "#c8102e", naamLokaal: "مصر" },
  ENG: { accent: "#12326b", naamLokaal: "England" },
  ESP: { accent: "#c60b1e", naamLokaal: "España" },
  FRA: { accent: "#0055a4", naamLokaal: "France" },
  GER: { accent: "#1a1a1a", naamLokaal: "Deutschland" },
  GHA: { accent: "#006b3f", naamLokaal: "Ghana" },
  HAI: { accent: "#00209f", naamLokaal: "Haïti" },
  IRN: { accent: "#239f40", naamLokaal: "ایران" },
  IRQ: { accent: "#ce1126", naamLokaal: "العراق" },
  JOR: { accent: "#a51931", naamLokaal: "الأردن" },
  JPN: { accent: "#000f8f", naamLokaal: "日本" },
  KOR: { accent: "#cd2e3a", naamLokaal: "대한민국" },
  KSA: { accent: "#006c35", naamLokaal: "السعودية" },
  MAR: { accent: "#c1272d", naamLokaal: "المغرب" },
  MEX: { accent: "#006847", naamLokaal: "México" },
  NED: { accent: "#e2620f", naamLokaal: "Nederland" },
  NOR: { accent: "#ba0c2f", naamLokaal: "Norge" },
  NZL: { accent: "#3d3d3d", naamLokaal: "New Zealand" },
  PAN: { accent: "#da121a", naamLokaal: "Panamá" },
  PAR: { accent: "#b02a37", naamLokaal: "Paraguay" },
  POR: { accent: "#006600", naamLokaal: "Portugal" },
  QAT: { accent: "#8a1538", naamLokaal: "قطر" },
  RSA: { accent: "#007749", naamLokaal: "South Africa" },
  SCO: { accent: "#005eb8", naamLokaal: "Scotland" },
  SEN: { accent: "#00853f", naamLokaal: "Sénégal" },
  SUI: { accent: "#b31217", naamLokaal: "Schweiz" },
  SWE: { accent: "#006aa7", naamLokaal: "Sverige" },
  TUN: { accent: "#e70013", naamLokaal: "تونس" },
  TUR: { accent: "#e30a17", naamLokaal: "Türkiye" },
  URU: { accent: "#3f8fbf", naamLokaal: "Uruguay" },
  USA: { accent: "#0a3161", naamLokaal: "United States" },
  UZB: { accent: "#0099b5", naamLokaal: "Oʻzbekiston" },
};

// Grijs voor een land dat (nog) niet in de lijst staat: liever een neutrale
// rand dan geen rand, want dan verspringt de opmaak niet.
const STANDAARD_ACCENT = "#5a6577";

export function accentVoor(landCode) {
  const land = LANDEN[landCode];
  return land ? land.accent : STANDAARD_ACCENT;
}

export function lokaleNaamVoor(landCode) {
  const land = LANDEN[landCode];
  return land ? land.naamLokaal : null;
}

// De vaste notatie. Verwacht een rij met land_code, land_naam en (optioneel)
// land_naam_en — zo komen ze uit public.sticker_catalogus en uit de RPC's.
// Draaide sql/013 nog niet, dan ontbreekt de Engelse naam en valt het label
// terug op "BEL - België" in plaats van een lege streep.
//
// { pagina: true } zet de albumpagina erachter:
//
//     BEL - BELGIUM - België (p.56)
//
// Bewust een keuze van de oproeper en niet de standaard, want de pagina hoort
// enkel bij een LAND. Ze bestaat om het land in het fysieke album terug te
// vinden; bij een individuele sticker ("BEL3 — Kevin De Bruyne") zou ze doen
// alsof net die sticker op die bladzijde staat. Waar landen in een lijst
// staan, hoort ze er dus bij; op een stickerregel nooit.
export function landLabel(land, { pagina = false } = {}) {
  if (!land) return "";
  const stukken = [land.land_code, land.land_naam_en, land.land_naam];
  const naam = stukken.filter(Boolean).join(" - ");
  if (!pagina || land.pagina == null) return naam;
  return `${naam} (p.${land.pagina})`;
}

// ---------- zoeken ----------

// Accenten en hoofdletters weg, zodat "cote" ook "Côte d'Ivoire" vindt en
// "belgie" ook "België". NFD splitst een letter met accent in de kale letter
// plus een los accentteken; dat tweede deel gooien we weg.
//
// Staat hier en niet in één pagina, omdat elke pagina met een zoekveld
// hetzelfde moet doen: wie op de stickerpagina leert dat "IVOOR" werkt,
// verwacht dat op de ruilpagina ook.
export function normaliseer(tekst) {
  return String(tekst || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

// Matcht een land op alle drie de schrijfwijzen tegelijk: de code (CIV), de
// Engelse albumnaam (Côte d'Ivoire) en de Nederlandse (Ivoorkust). De term
// hoort al door normaliseer() gehaald te zijn.
export function landMatcht(land, term) {
  if (!term) return true;
  return (
    normaliseer(land.land_code).includes(term) ||
    normaliseer(land.land_naam_en).includes(term) ||
    normaliseer(land.land_naam).includes(term)
  );
}

// Zoals landMatcht(), maar ook op het paginanummer: wie met zijn album open
// naast zich zit, kent een land vaak als "die van bladzijde 56" en typt dat
// liever dan een naam. Als voorloop en niet als exacte gelijkheid, zodat "5"
// meteen alles van blz. 5 en 50 tot 59 toont in plaats van niets.
//
// Apart gehouden en niet in landMatcht() verwerkt, want de ruilpagina zoekt
// met diezelfde functie door een lijst STICKERS: daar hoort "56" het
// stickernummer te vinden, niet elke Belgische sticker.
export function landMatchtMetPagina(land, term) {
  if (!term) return true;
  if (land.pagina != null && String(land.pagina).startsWith(term)) return true;
  return landMatcht(land, term);
}

// ---------- sorteren ----------

// Drie manieren om de landenlijst te ordenen:
//   code   — de FIFA/Panini-code alfabetisch. De standaard op de
//            stickerpagina, want dat is wat op de sticker zelf staat.
//   pagina — de volgorde van het album, zoals een kind door zijn boek
//            bladert. Valt terug op de code voor landen zonder paginanummer.
//   engels — de Engelse albumnaam alfabetisch (Argentina, Australia, …), voor
//            wie het land opzoekt zoals het in het boek geschreven staat.
export const SORTEERWIJZEN = [
  { id: "code", label: "Code (A-Z)" },
  { id: "pagina", label: "Albumvolgorde" },
  { id: "engels", label: "Alfabetisch (Engels)" },
];

export function vergelijkLanden(a, b, wijze = "code") {
  if (wijze === "pagina") {
    const pa = a.pagina == null ? Number.MAX_SAFE_INTEGER : a.pagina;
    const pb = b.pagina == null ? Number.MAX_SAFE_INTEGER : b.pagina;
    if (pa !== pb) return pa - pb;
  }
  if (wijze === "engels") {
    // Zonder Engelse naam (sql/013 nog niet gedraaid) achteraan in plaats van
    // bovenaan: een blok naamloze landen bovenaan de lijst oogt als een fout.
    const na = a.land_naam_en || "￿";
    const nb = b.land_naam_en || "￿";
    const verschil = na.localeCompare(nb, "en");
    if (verschil !== 0) return verschil;
  }
  return String(a.land_code).localeCompare(String(b.land_code), "nl");
}
