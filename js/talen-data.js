// talen-data.js — FIFA Wereldreis, fase 3: taalgegevens per land
//
// EEN DATASET, GEEN COMPONENT. Zelfde opzet als js/voetbal-data.js en
// js/land-data.js: enkel gegevens en één opzoekfunctie. De renderer staat in
// js/wereldreis.js (talenPopup()).
//
// VORM VAN EEN RECORD. 'talen' is altijd een lijst, ook bij één officiële
// taal — dat houdt de renderer eenvoudig: één taal toont de volledige rij
// (Nederlands/Engels/lokale naam/taal), meerdere talen tonen enkel een
// opsomming ("Engels en Frans"), want dan bestaat er geen taal "specifiek in
// dat land" om apart uit te lichten. 'engels' en 'lokaleNaam' zijn optioneel:
// weggelaten wanneer ze (bijna) gelijk zijn aan de Nederlandse naam, want een
// rij die twee keer hetzelfde zegt, leert een kind niets bij.
export const TALEN = {
  ALG: { engels: "Algeria", talen: ["Arabisch"] },
  ARG: { talen: ["Spaans"] },
  AUS: { talen: ["Engels"] },
  AUT: { engels: "Austria", lokaleNaam: "Österreich", talen: ["Duits"] },
  BEL: { talen: ["Nederlands", "Frans", "Duits"] },
  BIH: { talen: ["Bosnisch", "Kroatisch", "Servisch"] },
  BRA: { engels: "Brazil", lokaleNaam: "Brasil", talen: ["Portugees"] },
  CAN: { talen: ["Engels", "Frans"] },
  CIV: { engels: "Ivory Coast", lokaleNaam: "Côte d'Ivoire", talen: ["Frans"] },
  COD: { engels: "DR Congo", talen: ["Frans"] },
  COL: { talen: ["Spaans"] },
  CPV: { engels: "Cape Verde", lokaleNaam: "Cabo Verde", talen: ["Portugees"] },
  CRO: { engels: "Croatia", lokaleNaam: "Hrvatska", talen: ["Kroatisch"] },
  CUW: { talen: ["Nederlands", "Papiaments", "Engels"] },
  CZE: { engels: "Czechia", lokaleNaam: "Česko", talen: ["Tsjechisch"] },
  ECU: { talen: ["Spaans"] },
  EGY: { engels: "Egypt", talen: ["Arabisch"] },
  ENG: { talen: ["Engels"] },
  ESP: { lokaleNaam: "España", talen: ["Spaans"] },
  FRA: { talen: ["Frans"] },
  GER: { engels: "Germany", lokaleNaam: "Deutschland", talen: ["Duits"] },
  GHA: { talen: ["Engels"] },
  HAI: { talen: ["Frans", "Haïtiaans Creools"] },
  IRN: { engels: "Iran", talen: ["Perzisch (Farsi)"] },
  IRQ: { talen: ["Arabisch", "Koerdisch"] },
  JOR: { engels: "Jordan", talen: ["Arabisch"] },
  JPN: { lokaleNaam: "Nippon", talen: ["Japans"] },
  KOR: { engels: "South Korea", talen: ["Koreaans"] },
  KSA: { engels: "Saudi Arabia", talen: ["Arabisch"] },
  MAR: { talen: ["Arabisch", "Berbers"] },
  MEX: { talen: ["Spaans"] },
  NED: { talen: ["Nederlands"] },
  NOR: { lokaleNaam: "Norge", talen: ["Noors"] },
  NZL: { talen: ["Engels", "Maori"] },
  PAN: { talen: ["Spaans"] },
  PAR: { talen: ["Spaans", "Guaraní"] },
  POR: { talen: ["Portugees"] },
  QAT: { talen: ["Arabisch"] },
  RSA: { talen: ["Zulu", "Xhosa", "Afrikaans", "Engels"] },
  SCO: { talen: ["Engels"] },
  SEN: { talen: ["Frans"] },
  SUI: { engels: "Switzerland", talen: ["Duits", "Frans", "Italiaans", "Reto-Romaans"] },
  SWE: { lokaleNaam: "Sverige", talen: ["Zweeds"] },
  TUN: { engels: "Tunisia", talen: ["Arabisch"] },
  TUR: { lokaleNaam: "Türkiye", talen: ["Turks"] },
  URU: { talen: ["Spaans"] },
  USA: { engels: "United States", talen: ["Engels"] },
  UZB: { lokaleNaam: "O'zbekiston", talen: ["Oezbeeks"] },
};

// De enige toegangsweg tot de gegevens hierboven — zie voetbalVoor() in
// js/voetbal-data.js voor dezelfde redenering.
export function talenVoor(landCode) {
  return TALEN[landCode] || null;
}
