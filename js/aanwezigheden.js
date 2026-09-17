// aanwezigheden.js — de organisatiepagina: wie komt er, en wie staat er?
//
// Eén tabel met een kolom per ruilbeurs. Een komende beurs krijgt er twee —
// "gepland" (wat de ouder aanduidde) en "aangemeld" (wat de organisatie aan de
// inkom afvinkt) — een afgelopen beurs maar één, want daar valt niets meer aan
// te veranderen.
//
// WAAROM ÉÉN VINKJE PER VERZAMELAAR EN NIET PER GEZIN. Aan de inkom staat een
// gezin samen, maar het gebeurt dat één kind thuisblijft. Wie per gezin afvinkt,
// zet dan iemand op de beurs die er niet is — en die duikt de hele namiddag op
// in de ruilplanners van anderen. Zoeken op de naam van de ouder zet de
// gezinsleden wel onder elkaar, zodat het afvinken toch in één beweging gaat.
//
// De pagina is geen beveiliging: is_beheerder() wordt hier gecontroleerd om de
// tabel al dan niet te tonen, maar aanmelden_zetten() (sql/025) controleert het
// opnieuw. Wie de API rechtstreeks aanspreekt, komt er niet verder mee.
import { supabase, requireAuth } from "./supabase.js";
import { datumKort, uur } from "./beurs.js";
import { normaliseer } from "./landen-data.js";
import { opschrift } from "./hoe-gevonden.js";

let events = [];      // [{ id, naam, start, einde, voorbij }]
let verzamelaars = []; // uit aanwezigheden_overzicht()
let zoekterm = "";

document.addEventListener("DOMContentLoaded", async () => {
  const paneel = document.getElementById("aanw-paneel");
  if (!paneel) return; // niet op aanwezigheden.html

  const user = await requireAuth();
  if (!user) return;

  const loading = document.getElementById("aanw-loading");

  let beheerder = false;
  try {
    const { data, error } = await supabase.rpc("is_beheerder");
    if (error) throw error;
    beheerder = Boolean(data);
  } catch (err) {
    loading.textContent = "Kon je rechten niet controleren: " + err.message;
    return;
  }

  if (!beheerder) {
    loading.classList.add("hidden");
    document.getElementById("aanw-geen-toegang").classList.remove("hidden");
    return;
  }

  try {
    await laadGegevens();
  } catch (err) {
    loading.textContent =
      "Kon de aanwezigheden niet laden — draai sql/025_events_en_aanwezigheid.sql in Supabase. (" +
      err.message +
      ")";
    return;
  }

  loading.classList.add("hidden");
  paneel.classList.remove("hidden");

  document.getElementById("aanw-zoek").addEventListener("input", (e) => {
    zoekterm = normaliseer(e.target.value.trim());
    tekenRijen();
  });

  teken();
  // Twee bijzaken: ze mogen de tabel nooit tegenhouden, en de tweede bestaat
  // pas na sql/026.
  void tekenStatistiek();
  void tekenHoeGevonden();
});

async function laadGegevens() {
  const nu = new Date();

  const ev = await supabase.from("events").select("id,naam,start,einde").order("start", { ascending: true });
  if (ev.error) throw ev.error;
  events = (ev.data || []).map((e) => ({
    id: e.id,
    naam: e.naam,
    start: new Date(e.start),
    einde: new Date(e.einde),
    voorbij: new Date(e.einde) <= nu,
  }));

  const ov = await supabase.rpc("aanwezigheden_overzicht");
  if (ov.error) throw ov.error;
  verzamelaars = (ov.data || []).map((r) => ({
    id: r.kind_id,
    voornaam: r.voornaam,
    familienaam: r.familienaam,
    ouders: r.ouders || "",
    wijk: r.wijk || "",
    aanwezigheid: r.aanwezigheid || {},
  }));
}

function teken() {
  tekenKop();
  tekenRijen();
}

function maak(tag, klasse, tekst) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (tekst !== undefined) el.textContent = tekst;
  return el;
}

function tekenKop() {
  const rij = document.getElementById("aanw-kop");
  rij.textContent = "";
  rij.append(maak("th", "", "Verzamelaar"), maak("th", "", "Ouder"), maak("th", "", "Wijk"));

  events.forEach((ev) => {
    if (ev.voorbij) {
      // Een afgelopen beurs heeft aan één kolom genoeg: wie er was, was er.
      rij.append(maak("th", "aanwezig-kol", `${datumKort(ev.start)} aanwezig`));
    } else {
      rij.append(
        maak("th", "aanwezig-kol", `${datumKort(ev.start)} gepland`),
        maak("th", "aanwezig-kol", `${datumKort(ev.start)} aangemeld`)
      );
    }
  });
}

function past(v) {
  if (!zoekterm) return true;
  return normaliseer(`${v.voornaam} ${v.familienaam} ${v.ouders} ${v.wijk}`).includes(zoekterm);
}

function tekenRijen() {
  const body = document.getElementById("aanw-rijen");
  body.textContent = "";

  const zichtbaar = verzamelaars.filter(past);
  zichtbaar.forEach((v) => body.appendChild(bouwRij(v)));

  if (!zichtbaar.length) {
    const tr = maak("tr");
    const td = maak("td", "aanwezig-leeg", verzamelaars.length ? "Geen verzamelaar gevonden." : "Er zijn nog geen verzamelaars.");
    td.colSpan = 3 + events.reduce((n, ev) => n + (ev.voorbij ? 1 : 2), 0);
    tr.appendChild(td);
    body.appendChild(tr);
  }

  toonTelling(zichtbaar);
}

// Wat de organisator aan de inkom wil weten: hoeveel er verwacht worden en
// hoeveel er al binnen zijn, voor de eerstvolgende beurs die nog niet voorbij is.
function toonTelling(zichtbaar) {
  const el = document.getElementById("aanw-telling");
  const komend = events.find((ev) => !ev.voorbij);
  if (!komend) {
    el.textContent = `${zichtbaar.length} verzamelaars`;
    return;
  }
  const gepland = zichtbaar.filter((v) => stand(v, komend).komt).length;
  const binnen = zichtbaar.filter((v) => stand(v, komend).aangemeld).length;
  el.textContent = `${zichtbaar.length} verzamelaars — ${gepland} gepland, ${binnen} aangemeld voor ${komend.naam}`;
}

function stand(v, ev) {
  return v.aanwezigheid[ev.id] || { komt: false, aangemeld: false };
}

function bouwRij(v) {
  const tr = maak("tr");
  tr.append(
    maak("td", "aanwezig-tabel__naam", `${v.voornaam} ${v.familienaam}`),
    maak("td", "aanwezig-tabel__ouder", v.ouders),
    maak("td", "aanwezig-tabel__ouder", v.wijk)
  );

  events.forEach((ev) => {
    const s = stand(v, ev);
    if (ev.voorbij) {
      tr.appendChild(
        s.aangemeld
          ? maak("td", "aanwezig-kol aanwezig-vast", "✓")
          : maak("td", "aanwezig-kol aanwezig-leeg", "–")
      );
      return;
    }
    tr.appendChild(
      s.komt
        ? maak("td", "aanwezig-kol aanwezig-gepland", "✓")
        : maak("td", "aanwezig-kol aanwezig-leeg", "–")
    );
    tr.appendChild(bouwVinkje(v, ev, s.aangemeld));
  });

  return tr;
}

function bouwVinkje(v, ev, aangemeld) {
  const td = maak("td", "aanwezig-kol");
  const label = maak("label");
  label.setAttribute("aria-label", `${v.voornaam} ${v.familienaam} aangemeld voor ${ev.naam}`);
  const vinkje = document.createElement("input");
  vinkje.type = "checkbox";
  vinkje.checked = aangemeld;
  vinkje.addEventListener("change", () => zetAangemeld(v, ev, vinkje));
  label.appendChild(vinkje);
  td.appendChild(label);
  return td;
}

// Meteen wegschrijven, zonder opslaan-knop: aan de inkom staat er iemand te
// wachten, en een tabel met dertig onopgeslagen vinkjes is één verkeerde tik
// van alles kwijt.
async function zetAangemeld(v, ev, vinkje) {
  const melding = document.getElementById("aanw-message");
  const aan = vinkje.checked;
  vinkje.disabled = true;
  try {
    const { error } = await supabase.rpc("aanmelden_zetten", {
      p_kind_id: v.id,
      p_event_id: ev.id,
      p_aangemeld: aan,
    });
    if (error) throw error;

    const s = { ...stand(v, ev), aangemeld: aan };
    if (aan) s.komt = true; // aanmelden_zetten() doet hetzelfde in de databank
    v.aanwezigheid[ev.id] = s;

    melding.textContent = aan
      ? `${v.voornaam} ${v.familienaam} is aangemeld voor ${ev.naam}.`
      : `${v.voornaam} ${v.familienaam} staat niet meer aangemeld voor ${ev.naam}.`;
    melding.className = "message message--show message--success";
    tekenRijen();
  } catch (err) {
    vinkje.checked = !aan;
    melding.textContent = "Kon dit niet bewaren: " + err.message;
    melding.className = "message message--show message--error";
  } finally {
    vinkje.disabled = false;
  }
}

async function tekenStatistiek() {
  const body = document.getElementById("aanw-stat-rijen");
  body.textContent = "";
  let rijen = [];
  try {
    const { data, error } = await supabase.rpc("aanwezigheid_statistiek");
    if (error) throw error;
    rijen = data || [];
  } catch (err) {
    return;
  }

  rijen.forEach((r) => {
    const tr = maak("tr");
    const start = new Date(r.start);
    tr.append(
      maak("td", "", `${r.naam} — ${datumKort(start)}, ${uur(start)}`),
      maak("td", "aanwezig-kol", String(r.gepland)),
      maak("td", "aanwezig-kol", String(r.aangemeld)),
      maak("td", "aanwezig-kol", String(r.anoniem))
    );
    body.appendChild(tr);
  });
}

async function tekenHoeGevonden() {
  const kaart = document.getElementById("aanw-gevonden-kaart");
  const lijst = document.getElementById("aanw-gevonden");
  let rijen = [];
  try {
    const { data, error } = await supabase.rpc("hoe_gevonden_statistiek");
    if (error) throw error;
    rijen = data || [];
  } catch (err) {
    kaart.classList.add("hidden"); // sql/026 nog niet gedraaid
    return;
  }

  lijst.textContent = "";
  rijen.forEach((r) => {
    const li = maak("li", "", `${opschrift(r.hoe_gevonden)}: ${r.aantal}`);
    lijst.appendChild(li);
  });

  const houder = document.getElementById("aanw-gevonden-ander");
  houder.textContent = "";
  try {
    const { data, error } = await supabase.rpc("hoe_gevonden_toelichtingen");
    if (error) throw error;
    const toelichtingen = (data || []).map((r) => r.toelichting).filter(Boolean);
    if (!toelichtingen.length) return;
    houder.appendChild(maak("p", "form-meta", "Toelichtingen bij “Andere”:"));
    const ul = maak("ul", "aanwezig-lijst");
    toelichtingen.forEach((t) => ul.appendChild(maak("li", "", t)));
    houder.appendChild(ul);
  } catch (err) {
    /* geen toelichtingen: dan staat er gewoon niets */
  }
}
