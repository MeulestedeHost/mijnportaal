// genereer-ruilblad.mjs — bouwt ruilblad.html uit de SQL-seed.
//
// WAAROM GEGENEREERD EN NIET MET DE HAND GESCHREVEN. Het ruilblad somt elke
// sticker van het album op — bijna duizend regels. Met de hand bijhouden is
// vragen om een blad dat niet meer klopt met public.sticker_catalogus, en
// precies dát blad neemt een kind mee als de app het laat afweten. Daarom
// leest dit script dezelfde twee bestanden die de databank vullen:
//
//   sql/005_seed_stickers.sql          — welke stickers bestaan
//   sql/013_landen_engels_en_pagina.sql — Engelse albumnaam + paginanummer
//
// Verandert daar iets, dan draai je dit script opnieuw en klopt het blad weer.
//
// Gebruik (vanuit de map print/):
//   node genereer-ruilblad.mjs
//
// Daarna ruilblad.html openen en met Ctrl+P → "Opslaan als PDF" het bestand
// Ruilblad_Panini_FIFA_2026_Nieuw.pdf vernieuwen dat op de startpagina hangt.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SQL = path.join(HIER, "..", "sql");

// GLANSVARIANTEN (BEL2s naast BEL2) STAAN NIET OP HET BLAD. Ze bestaan enkel
// in de Europese albums, en public.instellingen.toon_glans staat standaard uit
// — het papieren blad volgt die standaard, anders draagt elk kind 54 regels
// mee voor stickers die het niet kan hebben.
const MET_GLANS = false;

// ---------- de seed uitlezen ----------

// De regels zien er zo uit:
//   ('team', 'BEL', 'België', 7, 'BEL7', 'Kevin De Bruyne', false),
// Namen met een apostrof staan in SQL verdubbeld ('Côte d''Ivoire'); die
// verdubbeling draaien we hieronder terug.
function leesStickers() {
  const tekst = fs.readFileSync(path.join(SQL, "005_seed_stickers.sql"), "utf8");
  const regel =
    /^\s*\('([^']*)',\s*'([^']*)',\s*'((?:[^']|'')*)',\s*(\d+),\s*'([^']*)',\s*'((?:[^']|'')*)',\s*(true|false)\)/gm;
  const rijen = [];
  for (const m of tekst.matchAll(regel)) {
    rijen.push({
      categorie: m[1],
      land_code: m[2],
      land_naam: m[3].replace(/''/g, "'"),
      nummer: Number(m[4]),
      code: m[5],
      naam: m[6].replace(/''/g, "'"),
      glans: m[7] === "true",
    });
  }
  return rijen;
}

// Uit sql/013, de values-tabel:
//   ('BEL',    'BELGIUM',                 56),
function leesLandInfo() {
  const tekst = fs.readFileSync(path.join(SQL, "013_landen_engels_en_pagina.sql"), "utf8");
  const regel = /^\s*\('([A-Z]{3}|PANINI|FWC)',\s*'((?:[^']|'')*)',\s*(\d+)\)/gm;
  const info = new Map();
  for (const m of tekst.matchAll(regel)) {
    info.set(m[1], { naam_en: m[2].replace(/''/g, "'"), pagina: Number(m[3]) });
  }
  return info;
}

// ---------- groeperen per land, in albumvolgorde ----------

function bouwLanden() {
  const stickers = leesStickers().filter((s) => MET_GLANS || !s.glans);
  const info = leesLandInfo();

  const perLand = new Map();
  for (const s of stickers) {
    if (!perLand.has(s.land_code)) {
      const extra = info.get(s.land_code) || {};
      perLand.set(s.land_code, {
        code: s.land_code,
        naam: s.land_naam,
        naam_en: extra.naam_en || s.land_naam.toUpperCase(),
        // Zonder paginanummer achteraan in plaats van vooraan: een land dat
        // nog niet in sql/013 staat mag de albumvolgorde niet openbreken.
        pagina: extra.pagina ?? Number.MAX_SAFE_INTEGER,
        stickers: [],
      });
    }
    perLand.get(s.land_code).stickers.push(s);
  }

  const landen = [...perLand.values()];
  for (const land of landen) land.stickers.sort((a, b) => a.nummer - b.nummer);
  // De volgorde van het boek: dat is de volgorde waarin een kind bladert, en
  // dus de enige volgorde waarin het zijn sticker terugvindt.
  landen.sort((a, b) => a.pagina - b.pagina || a.code.localeCompare(b.code, "nl"));
  return landen;
}

// De Panini-logosticker (code "00") is het enige lid van zijn "land" PANINI
// in de catalogus. Eén sticker verdient geen eigen tabelblok met een lege
// D-kolom ernaast tussen de 49 echte landen — die krijgt een losse regel
// bovenaan het blad. Muteert landen (splice) en geeft de sticker terug, of
// null als PANINI niet in de lijst zit.
function haalPaniniStickerEruit(landen) {
  const index = landen.findIndex((l) => l.code === "PANINI");
  if (index === -1) return null;
  const [land] = landen.splice(index, 1);
  return land.stickers[0] || null;
}

// ---------- HTML ----------

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function landBlok(land) {
  // Pagina + Nederlandse naam op één regel, zonder het woord "pagina" erbij:
  // het cijfer staat al vlak naast de naam, dat is duidelijk genoeg.
  const nlRegel =
    land.pagina === Number.MAX_SAFE_INTEGER
      ? esc(land.naam)
      : `${land.pagina} · ${esc(land.naam)}`;
  const rijen = land.stickers
    .map(
      (s) =>
        `          <tr><td class="v"></td><td class="spacer"></td><td class="v"></td><td class="c">${esc(s.code)}</td></tr>`
    )
    .join("\n");
  return `      <section class="land">
        <p class="land__code">${esc(land.code)}</p>
        <p class="land__en">${esc(land.naam_en)}</p>
        <p class="land__nl">${nlRegel}</p>
        <table class="land__tabel">
          <colgroup><col class="v" /><col class="spacer" /><col class="v" /><col class="c" /></colgroup>
          <thead>
            <tr><th class="v">Z</th><th class="spacer"></th><th class="v">D</th><th class="c"></th></tr>
          </thead>
          <tbody>
${rijen}
          </tbody>
        </table>
      </section>`;
}

// De Panini-logosticker staat niet tussen de landen: één sticker in een
// tabel met een lege kolom ernaast oogt als een fout, geen land. Eén regel
// bovenaan het blad, met dezelfde Z/D-vakjes maar zonder tabel eromheen.
function logoRegel(sticker) {
  if (!sticker) return "";
  return `  <p class="logoregel">
    <span class="logoregel__code">${esc(sticker.code)}</span>
    <span class="logoregel__naam">${esc(sticker.naam || "Panini-logo")}</span>
    <span class="logoregel__vakjes">
      <span class="logoregel__label">Z</span><span class="logoregel__vak"></span>
      <span class="logoregel__label">D</span><span class="logoregel__vak"></span>
    </span>
  </p>`;
}

const landen = bouwLanden();
const paniniSticker = haalPaniniStickerEruit(landen);
const totaal = landen.reduce((n, l) => n + l.stickers.length, 0) + (paniniSticker ? 1 : 0);

const html = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ruilblad — Panini-ruilbeurs Meulestede</title>
  <!-- LET OP: dit bestand wordt gegenereerd door print/genereer-ruilblad.mjs.
       Wijzigingen met de hand gaan verloren zodra dat script opnieuw draait.
       Moet er iets anders? Pas het script aan en draai het opnieuw:
           cd print && node genereer-ruilblad.mjs

       Papieren hulpmiddel voor op de beurs, en de backup als het portaal het
       laat afweten. Bewust zwart-wit: het moet leesbaar blijven op een gewone
       kantoorprinter en er moet met een balpen op geschreven kunnen worden.
       Afdrukken: openen in de browser en Ctrl+P. Als PDF bewaren via
       "Bestemming: Opslaan als PDF" — dat is het bestand voor in bijlage. -->
  <style>
    @page { size: A4 portrait; margin: 8mm; }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color: #000;
      background: #fff;
      font-size: 9pt;
      line-height: 1.3;
      max-width: 194mm;
      margin: 0 auto;
      padding: 6mm;
    }

    header { border-bottom: 2px solid #000; padding-bottom: 2mm; margin-bottom: 2.5mm; }
    h1 { font-size: 15pt; line-height: 1.2; }
    .kop-regel { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; }
    .kop-datum { font-size: 9pt; text-align: right; white-space: nowrap; }

    /* Invulregels: een lijn is duidelijker dan een kader wanneer er met de
       hand op geschreven wordt. */
    .naamrij { display: flex; gap: 8mm; margin-bottom: 2.5mm; font-size: 9.5pt; }
    .naamveld { flex: 1; display: flex; align-items: baseline; gap: 2mm; }
    .naamveld .lijn { flex: 1; border-bottom: 1px solid #000; height: 5mm; }

    .uitleg {
      border: 1.5px solid #000;
      padding: 1.5mm 2.5mm;
      margin-bottom: 3mm;
      font-size: 8.5pt;
    }
    .uitleg b { font-weight: 700; }

    /* DE LANDEN LOPEN VAN LINKS NAAR RECHTS. Zeven blokken naast elkaar, en
       pas daarna een rij lager — grid vult standaard rijgewijs. Met
       column-count zou de lijst kolomsgewijs van boven naar onder lopen, en
       dan staat MEX (pagina 8) bovenaan links en RSA (pagina 10) een halve
       bladzijde lager: precies niet de volgorde van het boek.
       Zeven kolommen en niet zes: 49 landen (na de Panini-logosticker eruit
       te halen) is exact 7×7. Bij zes kolommen bleef er een rij over met
       nét één land erin en vijf lege vakken ernaast — bij zeven kolommen
       vult elke rij helemaal op en blijft er geen vak leeg. */
    .landen {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2.6mm 3mm;
      align-items: start;
    }

    /* Een land nooit over twee bladzijden splitsen: zoek je BEL14, dan wil je
       niet dat de helft van België op de volgende pagina staat. */
    .land { break-inside: avoid; page-break-inside: avoid; }

    /* Landcode bovenaan en groot, de Engelse albumnaam er klein en bold
       onder, en als derde regel het paginanummer met de Nederlandse naam —
       zo lees je van boven naar onder precies wat er op het album staat en
       hoe je het thuis noemt. */
    .land__code { font-size: 12.5pt; font-weight: 700; line-height: 1.15; }
    .land__en {
      font-size: 7.8pt;
      font-weight: 700;
      /* Lange albumnamen (BOSNIA AND HERZEGOVINA) mogen de kolom niet
         verbreden; ze breken gewoon af binnen de kolom. */
      overflow-wrap: anywhere;
    }
    .land__nl { font-size: 8.8pt; margin-bottom: 1.1mm; }

    /* DE TABEL: vier kolommen — Z, een lege tussenruimte, D, en dan pas de
       stickercode. Enkel de Z- en de D-kolom krijgen een rand; border-collapse
       smelt die randen tussen de rijen van eenzelfde kolom samen tot één
       doorlopende reeks vakjes. De kale spacer-kolom ertussen zorgt dat Z en D
       niet aan elkaar plakken. De codekolom blijft helemaal kaal: dat is een
       label, geen vakje om iets in aan te vinken. */
    .land__tabel { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .land__tabel col.v { width: 5mm; }
    .land__tabel th, .land__tabel td { padding: 0; }
    .land__tabel th.v, .land__tabel td.v {
      height: 5mm;
      border: 0.8px solid #666;
      text-align: center;
      font-size: 7.8pt;
      font-weight: 700;
    }
    .land__tabel td.c, .land__tabel th.c {
      text-align: left;
      font-size: 8.2pt;
      line-height: 5mm;
      padding-left: 1mm;
      overflow: hidden;
      white-space: nowrap;
    }
    /* De vrije ruimte tussen de Z- en de D-kolom: een kale kolom zonder rand,
       zodat de twee vakjes duidelijk apart staan in plaats van tegen elkaar
       aan te schuren zoals bij een doorlopend raster. */
    .land__tabel col.spacer { width: 1.4mm; }
    .land__tabel th.spacer, .land__tabel td.spacer { border: none; }

    /* De Panini-logosticker: geen land, dus geen tabelblok. Eén regel
       bovenaan het blad met dezelfde Z/D-vakjes als de landentabellen. */
    .logoregel {
      display: flex;
      align-items: center;
      gap: 2.4mm;
      margin-bottom: 3.5mm;
      font-size: 10pt;
    }
    .logoregel__code { font-weight: 700; font-size: 11.5pt; }
    .logoregel__vakjes { display: flex; align-items: center; gap: 1.4mm; margin-left: auto; }
    .logoregel__label { font-weight: 700; font-size: 8.2pt; }
    .logoregel__vak { display: inline-block; width: 5mm; height: 5mm; border: 0.8px solid #666; }

    .voet { border-top: 1.5px solid #000; padding-top: 2mm; margin-top: 3mm; font-size: 8.5pt; }

    /* Deze regel hoort op papier niet thuis: ze legt uit hoe je afdrukt. */
    .schermhulp {
      border: 1px dashed #999;
      padding: 3mm;
      margin-bottom: 4mm;
      font-size: 9pt;
      background: #f4f6f9;
    }
    @media print { .schermhulp { display: none; } }
  </style>
</head>
<body>

  <p class="schermhulp">
    <strong>Afdrukken:</strong> Ctrl+P (of ⌘P), <strong>enkelzijdig</strong> (niet
    dubbelzijdig). Wil je er een PDF van om mee te sturen, kies dan bij
    <em>Bestemming</em> voor “Opslaan als PDF”. Deze grijze kader wordt niet mee
    afgedrukt.
  </p>

  <header>
    <div class="kop-regel">
      <h1>Mijn ruilblad</h1>
      <p class="kop-datum">
        Panini-ruilbeurs Meulestede<br />
        zaterdag 11 oktober, 14u – 17u
      </p>
    </div>
  </header>

  <div class="naamrij">
    <span class="naamveld">Naam <span class="lijn"></span></span>
    <span class="naamveld">Tafel / plaats <span class="lijn"></span></span>
  </div>

  <p class="uitleg">
    De landen staan in de volgorde van het album, van links naar rechts. Achter
    elke stickercode staan twee vakjes: <b>Z</b> = deze <b>zoek</b> ik nog,
    <b>D</b> = deze heb ik <b>dubbel</b>. Kruis aan wat voor jou geldt.
    <b>Streep een vakje door</b> zodra je de sticker te pakken hebt, of zodra je
    dubbel weg is — dan zie je in één oogopslag wat er nog openstaat.
    <br /><br />
    <b>Druk dit blad enkelzijdig af</b> (niet dubbelzijdig): zo kan je het tegen
    het blad van een andere verzamelaar houden en tegen het licht bekijken welke
    stickers precies matchen.
  </p>

${logoRegel(paniniSticker)}

  <div class="landen">
${landen.map(landBlok).join("\n")}
  </div>

  <div class="voet">
    <strong>Na de beurs:</strong> zet je blad over op
    <strong>panini.meulestede.gent</strong> — dan zoekt het portaal voor jou
    verder wie de stickers heeft die je nog mist. Werkt het portaal al voor je?
    Dan haal je met <strong>Export ruilfiche</strong> een blad op dat al ingevuld is.
  </div>

</body>
</html>
`;

const doel = path.join(HIER, "ruilblad.html");
fs.writeFileSync(doel, html, "utf8");
console.log(`Klaar: ${doel}`);
console.log(
  `${landen.length} landen${paniniSticker ? " + de Panini-logosticker" : ""}, ` +
    `${totaal} stickers${MET_GLANS ? " (incl. glans)" : " (zonder glansvarianten)"}.`
);
