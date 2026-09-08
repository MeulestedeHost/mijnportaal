// ruilfiche.js — vult print/ruilfiche.html met wat één verzamelaar zoekt en
// dubbel heeft.
//
// WAAROM DIT BESTAAT. Het blanco ruilblad (print/ruilblad.html) somt alle 980
// stickers op; daar moet een kind zelf nog bijna duizend vakjes op invullen.
// Wie zijn lijst al in het portaal heeft staan, hoeft dat niet over te
// schrijven: deze pagina drukt die lijst af, met de vakjes al aangekruist.
// Het is tegelijk de backup waar de nieuwsbrief het over heeft — mocht het
// portaal op de beurs zelf niet bereikbaar zijn, dan heb je alles op papier.
//
// ENKEL WAT AANGEDUID IS. Landen zonder één enkele gezochte of dubbele sticker
// komen niet op het blad. Een fiche van twee bladzijden die klopt, is op een
// ruiltafel meer waard dan vier bladzijden waarvan de helft leeg is.
//
// DE VOLGORDE. Dezelfde als op het blanco blad en in de rest van het portaal:
// de volgorde van het boek (sticker_catalogus.pagina), en de landen lopen van
// links naar rechts. Zo blader je op papier even snel als in het album.
import { supabase, requireAuth } from "./supabase.js";
import { getKind } from "./kinderen.js";

const PAGINA = 1000; // PostgREST levert maximaal 1000 rijen per aanvraag

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;

  const kindId = new URLSearchParams(window.location.search).get("kind");
  if (!kindId) {
    window.location.href = "/dashboard.html";
    return;
  }

  document.getElementById("terug-link").href = `/kind.html?id=${encodeURIComponent(kindId)}`;
  document.getElementById("print-btn").addEventListener("click", () => window.print());

  try {
    const [kind, catalogus, eigen] = await Promise.all([
      getKind(kindId),
      laadCatalogus(),
      laadEigenStickers(kindId),
    ]);
    teken(kind, catalogus, eigen);
  } catch (err) {
    document.getElementById("fiche-samenvatting").textContent =
      "De ruilfiche kon niet geladen worden: " + err.message;
  }
});

// ---------- gegevens ----------

async function laadCatalogus() {
  const alles = [];
  for (let van = 0; ; van += PAGINA) {
    const { data, error } = await supabase
      .from("sticker_catalogus")
      .select("land_code,land_naam,land_naam_en,pagina,nummer,code,naam,glans")
      .order("land_code", { ascending: true })
      .order("nummer", { ascending: true })
      .range(van, van + PAGINA - 1);
    if (error) throw error;
    alles.push(...data);
    if (data.length < PAGINA) return alles;
  }
}

// stickers.nummer bevat de catalogus-CODE ("BEL7"), niet het volgnummer — zie
// de kop van js/stickers.js. Vandaar dat de sleutel hieronder s.nummer is.
async function laadEigenStickers(kindId) {
  const { data, error } = await supabase
    .from("stickers")
    .select("nummer,status,aantal")
    .eq("kind_id", kindId);
  if (error) throw error;
  const perCode = new Map();
  for (const s of data) perCode.set(s.nummer, s);
  return perCode;
}

// ---------- tekenen ----------

function teken(kind, catalogus, eigen) {
  const naam = [kind.voornaam, kind.familienaam].filter(Boolean).join(" ");
  document.getElementById("fiche-titel").textContent = `Ruilfiche — ${naam}`;
  document.title = `Ruilfiche ${naam} — Panini Ruilportaal Meulestede`;

  const landen = groepeer(catalogus, eigen);
  // De Panini-logosticker (code "00") staat niet tussen de landen: één
  // sticker in een tabel met een lege kolom ernaast oogt als een fout, geen
  // land. Zie ook print/genereer-ruilblad.mjs, waar hetzelfde gebeurt voor
  // het blanco blad.
  const paniniLand = haalPaniniLandEruit(landen);
  const zoekt = tel(landen, "ZOEKT") + (paniniLand && paniniLand.stickers[0].status === "ZOEKT" ? 1 : 0);
  const dubbel = tel(landen, "RUILT") + (paniniLand && paniniLand.stickers[0].status === "RUILT" ? 1 : 0);

  const zone = document.getElementById("fiche-landen");
  const leeg = document.getElementById("fiche-leeg");

  if (!landen.length && !paniniLand) {
    document.getElementById("fiche-samenvatting").textContent =
      "Nog niets aangeduid in het portaal.";
    leeg.hidden = false;
    return;
  }

  const landtelling = landen.length + (paniniLand ? 1 : 0);
  document.getElementById("fiche-samenvatting").innerHTML =
    `<b>Z</b> = ik zoek deze nog (<b>${zoekt}</b> stickers) &nbsp;·&nbsp; ` +
    `<b>D</b> = ik heb deze dubbel (<b>${dubbel}</b> stickers) &nbsp;·&nbsp; ` +
    `${landtelling} landen &nbsp;·&nbsp; opgehaald op ${vandaag()}`;

  if (paniniLand) zone.before(logoRegel(paniniLand.stickers[0]));
  for (const land of landen) zone.appendChild(landBlok(land));
}

// Zie haalPaniniStickerEruit() in print/genereer-ruilblad.mjs voor dezelfde
// logica op het blanco blad. Hier muteert het de gegroepeerde landenlijst in
// plaats van de ruwe catalogus, maar het idee is identiek: één sticker
// verdient geen eigen tabelblok.
function haalPaniniLandEruit(landen) {
  const index = landen.findIndex((l) => l.land_code === "PANINI");
  if (index === -1) return null;
  return landen.splice(index, 1)[0];
}

// Eén blok per land, in de volgorde van het boek, met enkel de stickers die
// dit kind heeft aangeduid.
function groepeer(catalogus, eigen) {
  const perLand = new Map();
  for (const s of catalogus) {
    const mijn = eigen.get(s.code);
    if (!mijn) continue;
    if (!perLand.has(s.land_code)) {
      perLand.set(s.land_code, {
        land_code: s.land_code,
        land_naam: s.land_naam,
        land_naam_en: s.land_naam_en,
        // Zonder paginanummer achteraan, zodat één land zonder pagina de
        // albumvolgorde van de rest niet openbreekt.
        pagina: s.pagina ?? Number.MAX_SAFE_INTEGER,
        stickers: [],
      });
    }
    perLand.get(s.land_code).stickers.push({ ...s, status: mijn.status, aantal: mijn.aantal });
  }
  const landen = [...perLand.values()];
  for (const land of landen) land.stickers.sort((a, b) => a.nummer - b.nummer);
  landen.sort(
    (a, b) => a.pagina - b.pagina || a.land_code.localeCompare(b.land_code, "nl")
  );
  return landen;
}

function tel(landen, status) {
  return landen.reduce(
    (n, land) => n + land.stickers.filter((s) => s.status === status).length,
    0
  );
}

function landBlok(land) {
  const blok = document.createElement("section");
  blok.className = "land";

  // Drie regels boven de tabel: landcode groot bold, de Engelse albumnaam er
  // klein en bold onder, en als derde regel het paginanummer met de
  // Nederlandse naam — zonder het woord "pagina" erbij, het cijfer staat al
  // vlak naast de naam.
  const code = document.createElement("p");
  code.className = "land__code";
  code.textContent = land.land_code;
  blok.appendChild(code);

  const en = document.createElement("p");
  en.className = "land__en";
  en.textContent = land.land_naam_en || land.land_naam.toUpperCase();
  blok.appendChild(en);

  const nl = document.createElement("p");
  nl.className = "land__nl";
  nl.textContent =
    land.pagina === Number.MAX_SAFE_INTEGER
      ? land.land_naam
      : `${land.pagina} · ${land.land_naam}`;
  blok.appendChild(nl);

  blok.appendChild(tabel(land.stickers));

  return blok;
}

// DE TABEL: vier kolommen — Z, een lege tussenruimte, D, en dan pas de
// stickercode — zie css/print-ruilfiche.css voor waarom enkel de Z- en de
// D-kolom een rand krijgen.
function tabel(stickers) {
  const table = document.createElement("table");
  table.className = "land__tabel";

  const colgroup = document.createElement("colgroup");
  colgroup.innerHTML = '<col class="v" /><col class="spacer" /><col class="v" /><col class="c" />';
  table.appendChild(colgroup);

  const thead = document.createElement("thead");
  const kopRij = document.createElement("tr");
  kopRij.appendChild(cel("th", "v", "Z"));
  kopRij.appendChild(cel("th", "spacer", ""));
  kopRij.appendChild(cel("th", "v", "D"));
  kopRij.appendChild(cel("th", "c", ""));
  thead.appendChild(kopRij);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const s of stickers) tbody.appendChild(stickerRij(s));
  table.appendChild(tbody);

  return table;
}

function stickerRij(s) {
  const rij = document.createElement("tr");

  // Een sticker heeft precies één status (zie de databank: één rij per
  // kind+sticker), dus er staat altijd maar één van de twee vakjes aan.
  const zoekt = s.status === "ZOEKT";
  const dubbel = s.status === "RUILT";
  rij.appendChild(cel("td", "v" + (zoekt ? " v--aan" : ""), zoekt ? "✗" : ""));
  rij.appendChild(cel("td", "spacer", ""));
  // Bij een dubbel het aantal in plaats van een kruisje: op een ruiltafel is
  // "ik heb er drie" een ander gesprek dan "ik heb er één".
  rij.appendChild(cel("td", "v" + (dubbel ? " v--aan" : ""), dubbel ? String(s.aantal || 1) : ""));
  rij.appendChild(cel("td", "c", s.code + (s.glans ? " ✨" : "")));
  return rij;
}

function cel(tag, klasse, tekst) {
  const el = document.createElement(tag);
  el.className = klasse;
  el.textContent = tekst;
  return el;
}

// De Panini-logosticker staat niet tussen de landen: één sticker in een
// tabel met een lege kolom ernaast oogt als een fout, geen land. Eén regel
// bovenaan het blad, met dezelfde Z/D-vakjes maar zonder tabel eromheen —
// hier al ingevuld als dit kind sticker 00 heeft aangeduid.
function logoRegel(sticker) {
  const p = document.createElement("p");
  p.className = "logoregel";

  const code = document.createElement("span");
  code.className = "logoregel__code";
  code.textContent = sticker.code;
  p.appendChild(code);

  const naam = document.createElement("span");
  naam.textContent = sticker.naam || "Panini-logo";
  p.appendChild(naam);

  const vakjes = document.createElement("span");
  vakjes.className = "logoregel__vakjes";
  const zoekt = sticker.status === "ZOEKT";
  const dubbel = sticker.status === "RUILT";
  vakjes.appendChild(cel("span", "logoregel__label", "Z"));
  vakjes.appendChild(vak(zoekt, zoekt ? "✗" : ""));
  vakjes.appendChild(cel("span", "logoregel__label", "D"));
  vakjes.appendChild(vak(dubbel, dubbel ? String(sticker.aantal || 1) : ""));
  p.appendChild(vakjes);

  return p;
}

function vak(aan, tekst) {
  return cel("span", "logoregel__vak" + (aan ? " logoregel__vak--aan" : ""), tekst);
}

function vandaag() {
  return new Date().toLocaleDateString("nl-BE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
