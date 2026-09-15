// ocr-lokaal.js — tekst lezen uit een foto, op het toestel zelf.
//
// Tesseract.js (WebAssembly, in een aparte worker): geen foto verlaat het
// toestel, het kost niets, en na de eerste keer werkt het zonder internet.
// Alle bestanden staan in /vendor/tesseract/ in plaats van op een CDN: de CSP
// (_headers) laat enkel 'self' toe voor fetch en workers, en aan een ruiltafel
// wil je niet afhangen van een derde partij. Wel nodig: 'wasm-unsafe-eval' in
// script-src, anders mag de browser WebAssembly niet compileren.
//
// Achter twee functies — bereidFotoVoor() en leesWoorden() — zodat een andere
// herkenner (later misschien AI) dit bestand kan vervangen zonder dat
// js/herkenning.js of js/scanner.js iets merken.
import { woordenUitTsv } from "./herkenning.js";

const BASIS = "/vendor/tesseract";

// De foto wordt verkleind tot hoogstens zoveel pixels aan zijn lange kant.
// Groter geeft Tesseract niet meer detail maar wel veel meer rekenwerk op een
// gsm; kleiner maakt de codes van 30 stickers op één foto te klein om te lezen.
const MAX_ZIJDE = 2400;

let bibliotheek = null; // Promise<Tesseract>
let werker = null; // Promise<worker>
// Eén worker leeft over scans heen, maar zijn logger ligt vast bij het maken;
// daarom wijst die logger naar de callback van de scan die nu bezig is.
let opVoortgangNu = null;

function laadBibliotheek() {
  if (!bibliotheek) {
    bibliotheek = new Promise((klaar, fout) => {
      if (window.Tesseract) return klaar(window.Tesseract);
      const script = document.createElement("script");
      script.src = `${BASIS}/tesseract.min.js`;
      script.onload = () => (window.Tesseract ? klaar(window.Tesseract) : fout(new Error("de herkenning laadde niet")));
      script.onerror = () => fout(new Error("de herkenning kon niet geladen worden"));
      document.head.appendChild(script);
    });
    bibliotheek.catch(() => {
      bibliotheek = null;
    });
  }
  return bibliotheek;
}

function haalWerker() {
  if (!werker) {
    werker = (async () => {
      const Tesseract = await laadBibliotheek();
      // OEM 1 = enkel LSTM: het kleinste taalmodel en de kleinste kern.
      // corePath is een map: Tesseract kiest zelf de kern die dit toestel aankan
      // (relaxed SIMD, SIMD of geen van beide) — alle drie staan erin.
      const w = await Tesseract.createWorker("eng", 1, {
        workerPath: `${BASIS}/worker.min.js`,
        corePath: `${BASIS}/core`,
        langPath: `${BASIS}/lang`,
        // Onverpakt: een .gz dat een server of CDN onderweg zelf uitpakt, breekt
        // het inlezen — en voor de overdracht comprimeert Cloudflare toch al.
        gzip: false,
        // Een worker uit een blob-URL laat de CSP niet toe; uit 'self' wel.
        workerBlobURL: false,
        logger: (m) => {
          if (opVoortgangNu) opVoortgangNu(m);
        },
      });
      await w.setParameters({
        // Enkel hoofdletters en cijfers: een stickercode bestaat uit niets anders,
        // en elke andere kandidaat is een kans op een verkeerde lezing.
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        // 11 = verspreide tekst zonder vaste volgorde: stickers liggen kriskras,
        // niet in alinea's.
        tessedit_pageseg_mode: "11",
        user_defined_dpi: "300",
      });
      return w;
    })();
    werker.catch(() => {
      werker = null;
    });
  }
  return werker;
}

// Een foto klaarmaken voor herkenning: de juiste stand (EXIF van een gsm-foto),
// verkleind, grijs en met opgerekt contrast — een schaduw over de stapel of een
// gele tafel mag de codes niet doen verbleken.
export async function bereidFotoVoor(bestand) {
  const beeld = await createImageBitmap(bestand, { imageOrientation: "from-image" });
  const schaal = Math.min(1, MAX_ZIJDE / Math.max(beeld.width, beeld.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(beeld.width * schaal);
  canvas.height = Math.round(beeld.height * schaal);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(beeld, 0, 0, canvas.width, canvas.height);
  if (beeld.close) beeld.close();

  const afbeelding = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = afbeelding.data;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const grijs = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = grijs;
    histogram[grijs] += 1;
  }
  // Het 1e en 99e percentiel worden zwart en wit: een paar schitteringen of
  // diepe schaduwen mogen de rek niet bepalen.
  const pixels = d.length / 4;
  let som = 0;
  let laag = 0;
  let hoog = 255;
  for (let g = 0; g < 256; g++) {
    som += histogram[g];
    if (som <= pixels * 0.01) laag = g;
    if (som <= pixels * 0.99) hoog = g;
  }
  const bereik = Math.max(hoog - laag, 1);
  for (let i = 0; i < d.length; i += 4) {
    const waarde = Math.max(0, Math.min(255, Math.round(((d[i] - laag) * 255) / bereik)));
    d[i] = d[i + 1] = d[i + 2] = waarde;
  }
  ctx.putImageData(afbeelding, 0, 0);
  return canvas;
}

// Dunne donkere lijnen weg: de kaderlijnen rond een sticker. Gemeten op
// gegenereerde stapels: met een schuine kaderlijn van 2 px las Tesseract NIETS
// meer — ook de codes niet — zodra de stapel 1,5° of meer gedraaid lag; zonder
// die lijnen alle vijf codes, ook bij ±3° en 4°. Een "sluiting" in grijs: eerst
// de lichtste waarde in een venster van 2·straal+1 px (dunne donkere lijnen
// verdwijnen), dan de donkerste (dikkere lettertekens krijgen hun dikte terug).
// Een venster van 5 px tastte al tekens aan; daarom 3.
function zonderDunneLijnen(bron, straal = 1) {
  const b = bron.width;
  const h = bron.height;
  const doel = document.createElement("canvas");
  doel.width = b;
  doel.height = h;
  const ctx = doel.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bron, 0, 0);
  const afbeelding = ctx.getImageData(0, 0, b, h);
  const d = afbeelding.data;
  let grijs = new Uint8ClampedArray(b * h);
  for (let i = 0; i < b * h; i++) grijs[i] = d[i * 4];

  // Horizontaal en daarna verticaal: hetzelfde resultaat als een vierkant
  // venster, maar lineair in de straal.
  const filter = (bronwaarden, lichtste) => {
    const tussen = new Uint8ClampedArray(b * h);
    const uit = new Uint8ClampedArray(b * h);
    const kies = lichtste ? (x, y) => (x > y ? x : y) : (x, y) => (x < y ? x : y);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        let v = bronwaarden[y * b + x];
        for (let k = -straal; k <= straal; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < b) v = kies(v, bronwaarden[y * b + xx]);
        }
        tussen[y * b + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        let v = tussen[y * b + x];
        for (let k = -straal; k <= straal; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < h) v = kies(v, tussen[yy * b + x]);
        }
        uit[y * b + x] = v;
      }
    }
    return uit;
  };
  grijs = filter(filter(grijs, true), false);
  for (let i = 0; i < b * h; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = grijs[i];
  ctx.putImageData(afbeelding, 0, 0);
  return doel;
}

// Twee pogingen op dezelfde foto: zoals ze is, en zonder dunne lijnen. De
// tweede redt schuine stapels; de eerste blijft nodig voor wat het filter zou
// kunnen aantasten. js/herkenning.js voegt ze samen (voegPogingenSamen).
// opVoortgang krijgt er { poging, pogingen } bij.
export async function leesWoordenPogingen(canvas, { opVoortgang } = {}) {
  const maakVariant = [() => canvas, () => zonderDunneLijnen(canvas)];
  const uit = [];
  for (let i = 0; i < maakVariant.length; i++) {
    const melding = opVoortgang ? (m) => opVoortgang({ ...m, poging: i + 1, pogingen: maakVariant.length }) : undefined;
    uit.push(await leesWoorden(maakVariant[i](), { opVoortgang: melding }));
  }
  return uit;
}

// Geeft de woorden terug zoals js/herkenning.js ze verwacht. opVoortgang krijgt
// Tesseracts meldingen ({ status, progress }).
export async function leesWoorden(canvas, { opVoortgang } = {}) {
  opVoortgangNu = opVoortgang || null;
  try {
    const w = await haalWerker();
    const { data } = await w.recognize(canvas, {}, { text: false, tsv: true });
    return woordenUitTsv(data.tsv);
  } finally {
    opVoortgangNu = null;
  }
}
