// talen-data.js — FIFA Wereldreis, fase 3: welke taal spreekt men er?
//
// EEN DATASET, GEEN COMPONENT. Zelfde opzet als js/voetbal-data.js en
// js/land-data.js: enkel gegevens en één opzoekfunctie. De renderer staat in
// js/wereldreis.js (talenPopup()).
//
// ENKEL NOG DE TALEN. Dit bestand bevatte vroeger ook de Engelse en de lokale
// landsnaam. Die staan nu op één plek elders: de Engelse naam in de databank
// (public.sticker_catalogus.land_naam_en) en de lokale naam in
// js/landen-data.js. Twee kopieën van dezelfde naam lopen vroeg of laat uit
// elkaar, dus is er nog maar één.
//
// 'talen' is altijd een lijst, ook bij één officiële taal — dat houdt de
// renderer eenvoudig: hij kiest zelf tussen "Taal" en "Talen".
export const TALEN = {
  ALG: ["Arabisch"],
  ARG: ["Spaans"],
  AUS: ["Engels"],
  AUT: ["Duits"],
  BEL: ["Nederlands", "Frans", "Duits"],
  BIH: ["Bosnisch", "Kroatisch", "Servisch"],
  BRA: ["Portugees"],
  CAN: ["Engels", "Frans"],
  CIV: ["Frans"],
  COD: ["Frans"],
  COL: ["Spaans"],
  CPV: ["Portugees"],
  CRO: ["Kroatisch"],
  CUW: ["Nederlands", "Papiaments", "Engels"],
  CZE: ["Tsjechisch"],
  ECU: ["Spaans"],
  EGY: ["Arabisch"],
  ENG: ["Engels"],
  ESP: ["Spaans"],
  FRA: ["Frans"],
  GER: ["Duits"],
  GHA: ["Engels"],
  HAI: ["Frans", "Haïtiaans Creools"],
  IRN: ["Perzisch (Farsi)"],
  IRQ: ["Arabisch", "Koerdisch"],
  JOR: ["Arabisch"],
  JPN: ["Japans"],
  KOR: ["Koreaans"],
  KSA: ["Arabisch"],
  MAR: ["Arabisch", "Berbers"],
  MEX: ["Spaans"],
  NED: ["Nederlands"],
  NOR: ["Noors"],
  NZL: ["Engels", "Maori"],
  PAN: ["Spaans"],
  PAR: ["Spaans", "Guaraní"],
  POR: ["Portugees"],
  QAT: ["Arabisch"],
  RSA: ["Zulu", "Xhosa", "Afrikaans", "Engels"],
  SCO: ["Engels"],
  SEN: ["Frans"],
  SUI: ["Duits", "Frans", "Italiaans", "Reto-Romaans"],
  SWE: ["Zweeds"],
  TUN: ["Arabisch"],
  TUR: ["Turks"],
  URU: ["Spaans"],
  USA: ["Engels"],
  UZB: ["Oezbeeks"],
};

// De enige toegangsweg tot de gegevens hierboven — zie voetbalVoor() in
// js/voetbal-data.js voor dezelfde redenering.
export function talenVoor(landCode) {
  return TALEN[landCode] || null;
}
