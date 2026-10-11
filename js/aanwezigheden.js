// aanwezigheden.js — de organisatiepagina: wie komt er, en wie staat er?
//
// Eén tabel met een kolom per ruilbeurs. Een komende beurs krijgt er twee —
// "gepland" (wat de ouder aanduidde) en "aangemeld" (wat de organisatie aan de
// inkom afvinkt) — een afgelopen beurs maar één: wie er was. Die blijft
// afvinkbaar, zodat ook een beurs van vóór dit systeem (6 september) achteraf
// ingevuld kan worden; aanmelden_zetten() weigert een voorbije beurs niet.
//
// WAAROM ÉÉN VINKJE PER VERZAMELAAR EN NIET PER GEZIN. Aan de inkom staat een
// gezin samen, maar het gebeurt dat één kind thuisblijft. Wie per gezin afvinkt,
// zet dan iemand op de beurs die er niet is — en die duikt de hele namiddag op
// in de ruilplanners van anderen. Zoeken op de naam van de ouder zet de
// gezinsleden wel onder elkaar, zodat het afvinken toch in één beweging gaat.
//
// GASTEN (sql/030) staan per kind in dezelfde tabel: wie via de website
// inschreef of aan de inkom zonder account toekwam. Ze zijn op dezelfde manier
// af te vinken, en — enkel zij — ook te verwijderen: de inschrijvingen zijn
// met de hand overgenomen en er zit al eens een kind dubbel of verkeerd tussen.
// Een verzamelaar met een account verwijder je hier nooit; daarom staat zijn
// knop grijs in plaats van weg, zodat de kolom overal even breed blijft.
//
// De pagina is geen beveiliging: is_beheerder() wordt hier gecontroleerd om de
// tabel al dan niet te tonen, maar aanmelden_zetten() (sql/025) controleert het
// opnieuw. Wie de API rechtstreeks aanspreekt, komt er niet verder mee.
import { supabase, requireAuth } from "./supabase.js";
import { datumKort, uur } from "./beurs.js";
import { normaliseer } from "./landen-data.js";
import { opschrift } from "./hoe-gevonden.js";

let events = [];      // [{ id, naam, start, einde, voorbij }]
let verzamelaars = []; // uit aanwezigheden_overzicht() en gast_kinderen_overzicht()
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
  initGasten();
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
  const echte = (ov.data || []).map((r) => ({
    id: r.kind_id,
    gast: null,
    voornaam: r.voornaam,
    familienaam: r.familienaam,
    ouders: r.ouders || "",
    wijk: r.wijk || "",
    aanwezigheid: r.aanwezigheid || {},
  }));

  // Bestaat pas na sql/030; zonder blijft de tabel gewoon zoals vroeger.
  let gasten = [];
  const gk = await supabase.rpc("gast_kinderen_overzicht");
  if (!gk.error) {
    gasten = (gk.data || []).map((r) => ({
      id: r.gast_kind_id,
      gast: { id: r.gast_id, leeftijd: r.leeftijd, heeftAccount: Boolean(r.heeft_account) },
      voornaam: r.naam,
      familienaam: "",
      ouders: r.ouder || "",
      wijk: r.gemeente || "",
      aanwezigheid: r.aanwezigheid || {},
    }));
  }

  verzamelaars = [...echte, ...gasten].sort((a, b) =>
    volledigeNaam(a).localeCompare(volledigeNaam(b), "nl-BE")
  );
}

function volledigeNaam(v) {
  return `${v.voornaam} ${v.familienaam}`.trim();
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
  rij.append(maak("th", "", "Verzamelaar"), maak("th", "", "Ouder"), maak("th", "", "Wijk / gemeente"));

  events.forEach((ev) => {
    if (ev.voorbij) {
      // Een afgelopen beurs heeft aan één kolom genoeg: wie er was, was er —
      // en die kolom is een vinkje, voor wie achteraf nog moet invullen.
      rij.append(maak("th", "aanwezig-kol", `${datumKort(ev.start)} aanwezig`));
    } else {
      rij.append(
        maak("th", "aanwezig-kol", `${datumKort(ev.start)} gepland`),
        maak("th", "aanwezig-kol", `${datumKort(ev.start)} aangemeld`)
      );
    }
  });
  rij.append(maak("th", "", "Actie"));
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
    td.colSpan = 4 + events.reduce((n, ev) => n + (ev.voorbij ? 1 : 2), 0);
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
  const aantalGasten = zichtbaar.filter((v) => v.gast).length;
  const wie = `${zichtbaar.length} verzamelaars` + (aantalGasten ? ` (waarvan ${aantalGasten} gast)` : "");
  if (!komend) {
    el.textContent = wie;
    return;
  }
  const gepland = zichtbaar.filter((v) => stand(v, komend).komt).length;
  const binnen = zichtbaar.filter((v) => stand(v, komend).aangemeld).length;
  el.textContent = `${wie} — ${gepland} gepland, ${binnen} aangemeld voor ${komend.naam}`;
}

function stand(v, ev) {
  return v.aanwezigheid[ev.id] || { komt: false, aangemeld: false };
}

function bouwRij(v) {
  const tr = maak("tr");
  const naam = maak("td", "aanwezig-tabel__naam", volledigeNaam(v));
  if (v.gast) {
    naam.append(" ", maak("span", "aanwezig-gast", v.gast.leeftijd ? `gast · ${v.gast.leeftijd} j` : "gast"));
  }
  tr.append(
    naam,
    maak("td", "aanwezig-tabel__ouder", v.gast?.heeftAccount ? `${v.ouders} · heeft een account` : v.ouders),
    maak("td", "aanwezig-tabel__ouder", v.wijk)
  );

  events.forEach((ev) => {
    const s = stand(v, ev);
    if (ev.voorbij) {
      tr.appendChild(bouwVinkje(v, ev, s.aangemeld));
      return;
    }
    tr.appendChild(
      s.komt
        ? maak("td", "aanwezig-kol aanwezig-gepland", "✓")
        : maak("td", "aanwezig-kol aanwezig-leeg", "–")
    );
    tr.appendChild(bouwVinkje(v, ev, s.aangemeld));
  });

  const acties = maak("td");
  const weg = maak("button", "btn btn--outline btn--sm", "Verwijderen");
  weg.type = "button";
  if (v.gast) {
    weg.addEventListener("click", () => verwijderGastKind(v));
  } else {
    weg.disabled = true;
    weg.title = "Een verzamelaar met een account beheert zijn gezin zelf.";
  }
  acties.appendChild(weg);
  tr.appendChild(acties);

  return tr;
}

function bouwVinkje(v, ev, aangemeld) {
  const td = maak("td", "aanwezig-kol");
  const label = maak("label");
  label.setAttribute("aria-label", `${volledigeNaam(v)} aangemeld voor ${ev.naam}`);
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
    const { error } = v.gast
      ? await supabase.rpc("gast_aanmelden_zetten", { p_gast_kind_id: v.id, p_event_id: ev.id, p_aangemeld: aan })
      : await supabase.rpc("aanmelden_zetten", { p_kind_id: v.id, p_event_id: ev.id, p_aangemeld: aan });
    if (error) throw error;

    const s = { ...stand(v, ev), aangemeld: aan };
    if (aan) s.komt = true; // aanmelden_zetten() doet hetzelfde in de databank
    v.aanwezigheid[ev.id] = s;

    melding.textContent = aan
      ? `${volledigeNaam(v)} is aangemeld voor ${ev.naam}.`
      : `${volledigeNaam(v)} staat niet meer aangemeld voor ${ev.naam}.`;
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

// Eén kind weg, niet het hele gezin: de overgenomen lijsten hebben eerder een
// kind te veel dan te weinig. Is het het laatste kind, dan gaat de gast mee —
// een ouder zonder kinderen is een regel die nergens meer verschijnt.
async function verwijderGastKind(v) {
  if (!window.confirm(`${volledigeNaam(v)} (gast) van de lijst halen?`)) return;
  const melding = document.getElementById("aanw-message");
  try {
    const { error } = await supabase.from("gast_kinderen").delete().eq("id", v.id);
    if (error) throw error;
    const laatste = !verzamelaars.some((w) => w.gast && w.gast.id === v.gast.id && w.id !== v.id);
    if (laatste) {
      const { error: fout } = await supabase.from("gasten").delete().eq("id", v.gast.id);
      if (fout) throw fout;
    }
    verzamelaars = verzamelaars.filter((w) => w.id !== v.id);
    melding.textContent = `${volledigeNaam(v)} staat niet meer op de lijst.`;
    melding.className = "message message--show message--success";
    tekenRijen();
    void tekenGasten();
    void tekenStatistiek();
  } catch (err) {
    melding.textContent = "Kon niet verwijderen: " + err.message;
    melding.className = "message message--show message--error";
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
      maak("td", "aanwezig-kol", String(r.anoniem)),
      maak("td", "aanwezig-kol", String(r.gasten ?? 0))
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

// ---------- snel een gezin toevoegen (gasten, sql/029) ----------
//
// Een gast is enkel een regel op de presentielijst van één beurs — geen
// verzamelaar in het portaal, want die hangt vast aan een ouder-account. Met
// een e-mailadres sturen we dezelfde inlogmail als op de loginpagina; de ouder
// maakt daarna zelf zijn gezin en verzamelaars aan. De mail wordt bewust vanuit
// dit scherm verstuurd: de organisatie ziet meteen of het gelukt is, en een
// foutief adres hoeft niet eerst een gast te blokkeren.

function initGasten() {
  const keuze = document.getElementById("gast-event");
  if (!keuze) return;

  if (!events.length) {
    document.getElementById("aanw-gast-kaart").classList.add("hidden");
    return;
  }

  events.forEach((ev) => {
    const optie = document.createElement("option");
    optie.value = ev.id;
    optie.textContent = `${ev.naam} — ${datumKort(ev.start)}${ev.voorbij ? " (voorbij)" : ""}`;
    keuze.appendChild(optie);
  });
  // De beurs waar het nu over gaat: de eerstvolgende, anders de laatste.
  keuze.value = (events.find((ev) => !ev.voorbij) || events[events.length - 1]).id;

  keuze.addEventListener("change", () => void tekenGasten());
  document.getElementById("gast-toevoegen").addEventListener("click", voegGastToe);
  void tekenGasten();
}

function gastMelding(tekst, type) {
  const el = document.getElementById("gast-message");
  el.textContent = tekst;
  el.className = "message message--show message--" + type;
}

async function tekenGasten() {
  const body = document.getElementById("gast-rijen");
  body.textContent = "";
  let rijen = [];
  try {
    const { data, error } = await supabase.rpc("gasten_overzicht", {
      p_event_id: document.getElementById("gast-event").value,
    });
    if (error) throw error;
    rijen = data || [];
  } catch (err) {
    // Nog geen tabel (sql/029): dan blijft het formulier weg in plaats van te falen.
    document.getElementById("aanw-gast-kaart").classList.add("hidden");
    return;
  }

  if (!rijen.length) {
    const tr = maak("tr");
    const td = maak("td", "aanwezig-leeg", "Nog niemand toegevoegd voor deze beurs.");
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rijen.forEach((g) => {
    const tr = maak("tr");
    const mail = g.email
      ? `${g.email} — ${g.heeft_account ? "heeft een account" : g.uitgenodigd ? "uitgenodigd" : "nog niet uitgenodigd"}`
      : "";
    const weg = maak("button", "btn btn--outline btn--sm", "Verwijderen");
    weg.type = "button";
    weg.addEventListener("click", () => verwijderGast(g));
    const acties = maak("td");
    acties.appendChild(weg);
    tr.append(
      maak("td", "aanwezig-tabel__naam", g.ouder),
      maak("td", "", (g.kinderen || []).join(", ")),
      maak("td", "aanwezig-tabel__ouder", g.gemeente || ""),
      maak("td", "aanwezig-tabel__ouder", mail),
      acties
    );
    body.appendChild(tr);
  });
}

async function voegGastToe() {
  const ouder = document.getElementById("gast-ouder").value.trim();
  const email = document.getElementById("gast-email").value.trim().toLowerCase();
  const gemeente = document.getElementById("gast-gemeente").value.trim();
  const kinderen = [1, 2, 3]
    .map((i) => document.getElementById(`gast-kind-${i}`).value.trim())
    .filter(Boolean);

  if (!ouder) return gastMelding("Vul de naam van de ouder in.", "error");
  if (!kinderen.length) return gastMelding("Vul minstens één verzamelaar in.", "error");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return gastMelding("Dat e-mailadres klopt niet.", "error");
  }

  const knop = document.getElementById("gast-toevoegen");
  knop.disabled = true;
  try {
    // Eén RPC (sql/030), zodat gezin, kinderen en "komt" samen bewaard worden of niet.
    const { data: gastId, error } = await supabase.rpc("gast_toevoegen", {
      p_event_id: document.getElementById("gast-event").value,
      p_ouder: ouder,
      p_email: email || null,
      p_gemeente: gemeente || null,
      p_kinderen: kinderen,
    });
    if (error) throw error;

    let tekst = `${ouder} met ${kinderen.join(", ")} staat op de lijst.`;
    let type = "success";
    if (email) {
      const { error: mailFout } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/dashboard.html` },
      });
      if (mailFout) {
        // De gast staat er al; enkel de mail faalde. Niet terugdraaien — de
        // organisatie kan het adres nog nakijken en zelf een link doorgeven.
        tekst += ` De uitnodiging kon niet verstuurd worden: ${mailFout.message}`;
        type = "error";
      } else {
        await supabase.from("gasten").update({ uitgenodigd: true }).eq("id", gastId);
        tekst += ` Een inloglink is gemaild naar ${email}.`;
      }
    }

    ["gast-ouder", "gast-email", "gast-gemeente", "gast-kind-1", "gast-kind-2", "gast-kind-3"].forEach(
      (id) => (document.getElementById(id).value = "")
    );
    document.getElementById("gast-ouder").focus();
    gastMelding(tekst, type);
    await tekenGasten();
    // Ook in de grote tabel, om ze straks aan de inkom te kunnen afvinken.
    await laadGegevens();
    tekenRijen();
  } catch (err) {
    gastMelding("Kon niet toevoegen: " + err.message, "error");
  } finally {
    knop.disabled = false;
  }
}

async function verwijderGast(g) {
  if (!window.confirm(`${g.ouder} van de lijst halen?`)) return;
  try {
    const { error } = await supabase.from("gasten").delete().eq("id", g.id);
    if (error) throw error;
    gastMelding(`${g.ouder} staat niet meer op de lijst.`, "success");
    await tekenGasten();
    await laadGegevens();
    tekenRijen();
  } catch (err) {
    gastMelding("Kon niet verwijderen: " + err.message, "error");
  }
}
