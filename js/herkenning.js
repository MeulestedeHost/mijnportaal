// herkenning.js — van OCR-tekst naar stickercodes.
//
// Staat los van de camera en van de OCR-bibliotheek: erin gaan woorden (tekst,
// zekerheid, kader, regel), eruit komen kandidaten. Zo is dit deel te testen
// zonder foto, en kan een andere herkenner (later misschien AI) de woorden
// leveren zonder dat hier iets verandert.
//
// WAAROM DIT BETROUWBAARDER IS DAN DE RUWE OCR. We zoeken geen vrije tekst,
// maar codes uit een gekende catalogus: drie letters en één of twee cijfers,
// met een beperkte set landcodes. Daarmee zijn typische leesfouten recht te
// zetten op de plaats waar ze niet kunnen staan — een "0" op een letterplaats
// is een O, een "S" op een cijferplaats een 5. "8EL3" wordt zo BEL3.
//
// NOOIT STIL AANNEMEN. Een rechtgezette code is "onzeker": de gebruiker ziet ze
// wel, maar ze staat niet aangevinkt. Wat op een code lijkt maar niet in de
// catalogus staat (BLE3, QQQ99), is "onbekend". Enkel een exacte, zekere lezing
// staat meteen aangevinkt — en ook dan beslist de gebruiker (js/scanner.js).
import { ontleedCode } from "./inboeken.js";

// Onder deze zekerheid (0–100, van de OCR) is ook een exacte lezing onzeker.
const MIN_ZEKERHEID = 60;

const NAAR_LETTER = { 0: "O", 1: "I", 2: "Z", 4: "A", 5: "S", 6: "G", 8: "B" };
const NAAR_CIJFER = { O: "0", D: "0", Q: "0", U: "0", I: "1", L: "1", J: "1", T: "7", Z: "2", S: "5", B: "8", G: "6", A: "4" };

// Tesseract-TSV (vast formaat) → woorden. level 5 = woord.
export function woordenUitTsv(tsv) {
  const woorden = [];
  String(tsv || "")
    .split("\n")
    .forEach((lijn) => {
      const k = lijn.split("\t");
      if (k.length < 12 || k[0] !== "5") return;
      const tekst = k.slice(11).join("\t").trim();
      if (!tekst) return;
      woorden.push({
        tekst,
        zekerheid: Number(k[10]),
        kader: { x: Number(k[6]), y: Number(k[7]), b: Number(k[8]), h: Number(k[9]) },
        regel: `${k[2]}.${k[3]}.${k[4]}`,
      });
    });
  return woorden;
}

// Eén stuk tekst als stickercode lezen, of null als het er niet op lijkt.
function leesStuk(ruw, catalogus, landen) {
  const schoon = String(ruw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const volledig = leesSchoon(schoon, catalogus, landen);
  if (volledig && volledig.bestaat) return volledig;
  // Eén los teken te veel vóór of achter de code — een rand van de sticker of
  // een schaduw die als letter gelezen wordt ("NED5S", "1BEL3"). Gemeten op
  // gegenereerde foto's kwam dat voor bij een kleine code; wat er dan
  // overblijft, is hoogstens onzeker.
  if (schoon.length === 5 || schoon.length === 6) {
    for (const deel of [schoon.slice(0, -1), schoon.slice(1)]) {
      const lezing = leesSchoon(deel, catalogus, landen);
      if (lezing && lezing.bestaat) return { ...lezing, gecorrigeerd: true };
    }
  }
  return volledig;
}

function leesSchoon(schoon, catalogus, landen) {
  if (!/^[A-Z0-9]{3}[A-Z0-9]{1,2}$/.test(schoon)) return null;

  const letters = [...schoon.slice(0, 3)].map((t) => NAAR_LETTER[t] || t).join("");
  const nummer = [...schoon.slice(3)].map((t) => NAAR_CIJFER[t] || t).join("");
  if (!/^[A-Z]{3}$/.test(letters) || !/^\d{1,2}$/.test(nummer)) return null;
  const gecorrigeerd = letters + nummer !== schoon;

  const ontleed = ontleedCode(letters + nummer);
  if (!ontleed) return null;
  if (catalogus.has(ontleed.code)) return { code: ontleed.code, gecorrigeerd, bestaat: true };
  // Lijkt het letterlijk op een code (letters waar letters horen, cijfers waar
  // cijfers horen), dan is het een onbekende code die de gebruiker moet zien.
  // Moest er eerst iets rechtgezet worden om er een code van te maken, dan is
  // het gewoon tekst op de sticker (een naam als "MESSI") en valt het weg.
  if (gecorrigeerd) return null;
  return { code: ontleed.code, gecorrigeerd: false, bestaat: false, landBekend: landen.has(ontleed.land) };
}

// woorden: [{ tekst, zekerheid, kader: {x,y,b,h}, regel }] in leesvolgorde.
// catalogus: Map code -> rij (js/inboeken.js, haalCatalogus).
//
// Geeft [{ code, aantal, status: "zeker"|"onzeker"|"onbekend", gelezen, kaders }]
// terug, één regel per code, in de volgorde waarin ze voor het eerst gezien
// werden. Dezelfde code op twee plaatsen in de foto telt als twee exemplaren.
export function herkenCodes(woorden, catalogus) {
  const landen = new Set([...catalogus.keys()].filter((c) => /^[A-Z]{3}/.test(c)).map((c) => c.slice(0, 3)));
  const perCode = new Map();

  const voegToe = (lezing, gelezen, zekerheid, kaders) => {
    const status = !lezing.bestaat ? "onbekend" : lezing.gecorrigeerd || zekerheid < MIN_ZEKERHEID ? "onzeker" : "zeker";
    const bestaand = perCode.get(lezing.code);
    if (!bestaand) {
      perCode.set(lezing.code, { code: lezing.code, aantal: 1, status, gelezen: [gelezen], kaders: [...kaders] });
      return;
    }
    bestaand.aantal += 1;
    bestaand.gelezen.push(gelezen);
    bestaand.kaders.push(...kaders);
    // Eén zekere lezing volstaat voor de code; het aantal blijft wel een voorstel.
    if (status === "zeker") bestaand.status = "zeker";
  };

  for (let i = 0; i < woorden.length; i++) {
    const woord = woorden[i];
    const volgende = woorden[i + 1];
    // "FRA 12": OCR splitst een code soms in twee woorden. Enkel als het eerste
    // woord precies drie tekens is en ze op dezelfde regel staan.
    const eersteSchoon = woord.tekst.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (volgende && volgende.regel === woord.regel && eersteSchoon.length === 3) {
      const samen = leesStuk(woord.tekst + volgende.tekst, catalogus, landen);
      if (samen && samen.bestaat) {
        voegToe(samen, `${woord.tekst} ${volgende.tekst}`, Math.min(woord.zekerheid, volgende.zekerheid), [woord.kader, volgende.kader]);
        i += 1;
        continue;
      }
    }
    const lezing = leesStuk(woord.tekst, catalogus, landen);
    if (lezing) voegToe(lezing, woord.tekst, woord.zekerheid, [woord.kader]);
  }

  return [...perCode.values()];
}

const RANG = { zeker: 3, onzeker: 2, onbekend: 1 };

// Dezelfde foto meermaals gelezen (js/ocr-lokaal.js: zoals ze is en zonder
// dunne lijnen): een code die in één poging gevonden werd, telt. Het aantal is
// het hoogste van alle pogingen, niet de som — dezelfde sticker in twee
// pogingen blijft één sticker. De status is de beste. De kaders komen van de
// poging die de meeste exemplaren zag; een filter verschuift geen pixels, dus
// ze passen op dezelfde foto.
export function voegPogingenSamen(pogingen) {
  const perCode = new Map();
  pogingen.forEach((kandidaten) => {
    kandidaten.forEach((k) => {
      const bestaand = perCode.get(k.code);
      if (!bestaand) {
        perCode.set(k.code, { ...k, gelezen: [...k.gelezen], kaders: [...k.kaders] });
        return;
      }
      if (RANG[k.status] > RANG[bestaand.status]) bestaand.status = k.status;
      if (k.aantal > bestaand.aantal) {
        bestaand.aantal = k.aantal;
        bestaand.kaders = [...k.kaders];
      }
      k.gelezen.forEach((g) => {
        if (!bestaand.gelezen.includes(g)) bestaand.gelezen.push(g);
      });
    });
  });
  return [...perCode.values()];
}
