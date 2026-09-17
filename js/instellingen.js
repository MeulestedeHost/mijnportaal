// instellingen.js — Beheerpagina: de ruilbeurzen, de aanwezigheidsfilter,
// glansstickers, WhatsApp van de organisatie, en de twee getallen achter de
// statistiekenpagina (prijs van een sticker en aantal stickers per pakje).
//
// SINDS sql/025 STAAN DE BEURSDATA NIET MEER HIER. Er was één venster op de
// singleton-rij; nu is er een lijst public.events, en die wordt per rij bewaard
// in plaats van met het grote formulier mee. Reden: "wijzigingen ongedaan
// maken" mag nooit een voorbije beursdag wissen — dat is historiek.
//
// De pagina is geen beveiliging: ze verbergt hooguit knoppen. Wie mag
// opslaan, beslist RLS op public.instellingen (policy instellingen_update,
// die public.is_beheerder() aanroept) en op public.events. Iemand zonder
// beheerdersrecht die de API rechtstreeks aanspreekt, krijgt nul rijen bij.
import { supabase, requireAuth } from "./supabase.js";
import { normaliseerTelefoon, toonTelefoon } from "./whatsapp.js";
import { haalEvent, vergeetEvent, wanneer } from "./beurs.js";

// De kolommen die deze pagina beheert, op één plek: ze worden bij het laden
// opgehaald en na het opslaan opnieuw teruggevraagd, en die twee lijsten
// mogen niet uit elkaar lopen.
const KOLOMMEN =
  "toon_glans,whatsapp_nummer,whatsapp_bericht,stickerwaarde,stickers_per_pakje";
// Apart, want zolang sql/024 respectievelijk sql/025 niet gedraaid is, bestaan
// deze kolommen niet — en dan mogen ze het laden en opslaan van al de rest niet
// meesleuren.
const KAART_KOLOM = "kaart_ingezoomd_vanaf";
const FILTER_KOLOM = "filter_dagen_vooraf";
let metKaartKolom = true;
let metFilterKolom = true;

function kolommen() {
  return [KOLOMMEN, metKaartKolom ? KAART_KOLOM : null, metFilterKolom ? FILTER_KOLOM : null]
    .filter(Boolean)
    .join(",");
}

let origineel = null;
let userId = null;

document.addEventListener("DOMContentLoaded", async () => {
  const paneel = document.getElementById("inst-paneel");
  if (!paneel) return; // niet op instellingen.html

  const user = await requireAuth();
  if (!user) return;
  userId = user.id;

  const loading = document.getElementById("inst-loading");

  let beheerder = false;
  try {
    const { data, error } = await supabase.rpc("is_beheerder");
    if (error) throw error;
    beheerder = Boolean(data);
  } catch (err) {
    loading.textContent =
      "Kon je rechten niet controleren — draai sql/007_instellingen.sql in Supabase. (" +
      err.message +
      ")";
    return;
  }

  if (!beheerder) {
    loading.classList.add("hidden");
    document.getElementById("inst-geen-toegang").classList.remove("hidden");
    return;
  }

  try {
    await laadInstellingen();
  } catch (err) {
    loading.textContent = "Fout bij laden: " + err.message;
    return;
  }

  loading.classList.add("hidden");
  paneel.classList.remove("hidden");

  document.getElementById("inst-form").addEventListener("submit", bewaar);
  document.getElementById("inst-reset-btn").addEventListener("click", vulFormulier);
  document.getElementById("inst-ev-toevoegen").addEventListener("click", voegEventToe);

  // Los van het instellingenformulier: bestaat public.events nog niet
  // (sql/025), dan verdwijnt de kaart en blijft de rest gewoon werken.
  void tekenEvents();

  // Los van de rest van de pagina: version.json bestaat pas na de eerste
  // Cloudflare-build met het aangepaste buildcommando (zie README.md), en
  // ontbreekt altijd lokaal/in de proefopstelling. Een fout hier mag het
  // instellingenformulier nooit blokkeren.
  void toonVersie();
});

// Welke Cloudflare Pages-deployment staat er nu achter
// ruilbeurs.meulestede.gent? version.json wordt tijdens de build geschreven
// (CF_PAGES_* omgevingsvariabelen bestaan enkel op dat moment, niet meer
// zodra de site draait) en hier gewoon als statisch bestand opgehaald — geen
// databank, geen RLS, dus ook geen aparte foutafhandeling voor "tabel
// ontbreekt nog" zoals elders op deze pagina.
async function toonVersie() {
  const blok = document.getElementById("inst-versie");
  const fout = document.getElementById("inst-versie-fout");
  try {
    const resp = await fetch("/version.json", { cache: "no-store" });
    if (!resp.ok) throw new Error("nog niet aangemaakt");
    const info = await resp.json();

    document.getElementById("inst-versie-commit").innerHTML = info.commit
      ? `<a href="https://github.com/MeulestedeHost/mijnportaal/commit/${encodeURIComponent(info.commit)}">${escapeHtml((info.commit || "").slice(0, 8))}</a>`
      : "onbekend";
    document.getElementById("inst-versie-branch").textContent = info.branch || "onbekend";
    document.getElementById("inst-versie-url").innerHTML = info.deployUrl
      ? `<a href="${escapeHtml(info.deployUrl)}">${escapeHtml(info.deployUrl)}</a>`
      : "onbekend";
    document.getElementById("inst-versie-tijd").textContent = info.gebouwdOp
      ? new Intl.DateTimeFormat("nl-BE", { dateStyle: "full", timeStyle: "short" }).format(
          new Date(info.gebouwdOp)
        )
      : "onbekend";

    blok.classList.remove("hidden");
    fout.textContent = "";
  } catch {
    fout.textContent =
      "Geen deploymentgegevens gevonden — normaal bij lokaal draaien, of zolang het " +
      "buildcommando uit README.md nog niet in Cloudflare Pages ingesteld staat.";
  }
}

// Enkel voor de twee velden hierboven die uit version.json komen: dat bestand
// wordt door Cloudflare's build zelf geschreven (zie README.md) en niet door
// een gebruiker ingevuld, maar het staat als gewoon statisch bestand naast de
// rest van de site — dus geen enkele reden om innerHTML zonder escapen te
// vertrouwen.
function escapeHtml(tekst) {
  const div = document.createElement("div");
  div.textContent = tekst;
  return div.innerHTML;
}

// Twee kolommen zijn optioneel (sql/024 en sql/025). Welke van de twee
// ontbreekt zegt PostgREST niet met zoveel woorden, dus laten we ze één voor
// één vallen tot het lukt — de rest van de pagina hoort niet stil te vallen
// omdat er één migratie achterloopt.
async function laadInstellingen() {
  let laatste = null;
  for (let poging = 0; poging < 3; poging++) {
    const { data, error } = await supabase
      .from("instellingen")
      .select(kolommen())
      .eq("id", 1)
      .single();
    if (!error) {
      document.getElementById("inst-kaart-zoom").disabled = !metKaartKolom;
      document.getElementById("inst-filter-dagen").disabled = !metFilterKolom;
      origineel = data;
      vulFormulier();
      return;
    }
    laatste = error;
    if (metFilterKolom) metFilterKolom = false;
    else if (metKaartKolom) metKaartKolom = false;
    else break;
  }
  throw laatste;
}

function vulFormulier() {
  document.getElementById("inst-filter-dagen").value =
    origineel.filter_dagen_vooraf == null ? "14" : String(origineel.filter_dagen_vooraf);
  document.getElementById("inst-glans").checked = Boolean(origineel.toon_glans);
  document.getElementById("inst-wa-nummer").value = toonTelefoon(origineel.whatsapp_nummer);
  document.getElementById("inst-wa-bericht").value = origineel.whatsapp_bericht || "";
  // Draaide sql/017 nog niet, dan bestaan deze twee kolommen nog niet; dan
  // tonen we dezelfde standaardwaarden als de databank zou gebruiken.
  document.getElementById("inst-stickerwaarde").value =
    origineel.stickerwaarde == null ? "0.25" : String(origineel.stickerwaarde);
  document.getElementById("inst-pakje").value =
    origineel.stickers_per_pakje == null ? "5" : String(origineel.stickers_per_pakje);
  document.getElementById("inst-kaart-zoom").value =
    origineel.kaart_ingezoomd_vanaf == null ? "10" : String(origineel.kaart_ingezoomd_vanaf);
  void toonVensterStatus();
  document.getElementById("inst-message").className = "message";
}

// ---------- de ruilbeurzen ----------
//
// <input type="datetime-local"> werkt met lokale tijd zonder zone; de database
// bewaart timestamptz. Heen en weer rekenen doet de browser, die op de beurs
// sowieso in de Belgische zone staat.

// Voorbije beurzen staan bovenaan noch onderaan buiten beeld: ze blijven in de
// lijst staan, want dat is de historiek waar de aanwezigheden aan hangen.
// Verwijderen kan wel, maar enkel met een waarschuwing die zegt wat er mee
// verdwijnt.
async function tekenEvents() {
  const body = document.getElementById("inst-events-rijen");
  let rijen = [];
  try {
    const { data, error } = await supabase
      .from("events")
      .select("id,naam,start,einde")
      .order("start", { ascending: true });
    if (error) throw error;
    rijen = data || [];
  } catch (err) {
    document.getElementById("inst-events-kaart").classList.add("hidden");
    return;
  }

  const nu = new Date();
  const opmaak = new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" });
  body.textContent = "";

  if (!rijen.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "aanwezig-leeg";
    td.colSpan = 4;
    td.textContent = "Er staat nog geen ruilbeurs in de kalender.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rijen.forEach((ev) => {
    const start = new Date(ev.start);
    const einde = new Date(ev.einde);
    const tr = document.createElement("tr");

    const naam = document.createElement("td");
    naam.className = "aanwezig-tabel__naam";
    naam.textContent = ev.naam + (einde <= nu ? " (voorbij)" : "");
    const van = document.createElement("td");
    van.textContent = opmaak.format(start);
    const tot = document.createElement("td");
    tot.textContent = opmaak.format(einde);

    const acties = document.createElement("td");
    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "btn btn--outline btn--sm";
    weg.textContent = "Verwijderen";
    weg.addEventListener("click", () => verwijderEvent(ev));
    acties.appendChild(weg);

    tr.append(naam, van, tot, acties);
    body.appendChild(tr);
  });
}

async function voegEventToe() {
  const messageEl = document.getElementById("inst-events-message");
  const naam = document.getElementById("inst-ev-naam").value.trim();
  const startTekst = document.getElementById("inst-ev-start").value;
  const eindeTekst = document.getElementById("inst-ev-einde").value;

  if (!naam) {
    toonMelding(messageEl, "Geef de ruilbeurs een naam.", "error");
    return;
  }
  if (!startTekst || !eindeTekst) {
    toonMelding(messageEl, "Vul een start- en einddatum in.", "error");
    return;
  }
  const start = new Date(startTekst);
  const einde = new Date(eindeTekst);
  if (Number.isNaN(start.getTime()) || Number.isNaN(einde.getTime())) {
    toonMelding(messageEl, "Die datum kan ik niet lezen.", "error");
    return;
  }
  // Dezelfde regel staat als CHECK op de tabel; hier vooral om een nette
  // melding te tonen in plaats van een databasefout.
  if (einde <= start) {
    toonMelding(messageEl, "Het einde moet na de start liggen.", "error");
    return;
  }

  const knop = document.getElementById("inst-ev-toevoegen");
  knop.disabled = true;
  try {
    const { data, error } = await supabase
      .from("events")
      .insert({ naam, start: start.toISOString(), einde: einde.toISOString(), updated_by: userId })
      .select("id");
    if (error) throw error;
    // RLS weigert stil: geen recht betekent nul rijen, geen fout.
    if (!data || data.length === 0) {
      throw new Error("De database heeft niets toegevoegd — je account heeft geen beheerdersrecht.");
    }
    document.getElementById("inst-ev-naam").value = "";
    document.getElementById("inst-ev-start").value = "";
    document.getElementById("inst-ev-einde").value = "";
    await naEventWijziging(messageEl, `${naam} staat in de kalender.`);
  } catch (err) {
    toonMelding(messageEl, "Kon de ruilbeurs niet toevoegen: " + err.message, "error");
  } finally {
    knop.disabled = false;
  }
}

async function verwijderEvent(ev) {
  const messageEl = document.getElementById("inst-events-message");
  const nu = new Date();
  const voorbij = new Date(ev.einde) <= nu;
  const waarschuwing = voorbij
    ? `"${ev.naam}" is een voorbije ruilbeurs. Verwijderen wist ook wie er toen aanwezig was, en dat is niet terug te halen. Toch verwijderen?`
    : `"${ev.naam}" verwijderen? Wie al aanduidde dat hij komt, verliest die aanduiding.`;
  if (!window.confirm(waarschuwing)) return;

  try {
    const { error } = await supabase.from("events").delete().eq("id", ev.id);
    if (error) throw error;
    await naEventWijziging(messageEl, `${ev.naam} is verwijderd.`);
  } catch (err) {
    toonMelding(messageEl, "Kon de ruilbeurs niet verwijderen: " + err.message, "error");
  }
}

// Een event bijmaken of weghalen kan de fase verzetten, dus de status eronder
// mag niet het antwoord van daarnet blijven tonen.
async function naEventWijziging(messageEl, tekst) {
  vergeetEvent();
  await tekenEvents();
  await toonVensterStatus();
  toonMelding(messageEl, tekst, "success");
}

// In welke fase staat het portaal nu, en wat betekent dat? De fase komt uit de
// databank (public.huidig_event), niet uit een berekening hier: de filter in
// get_matches() rekent met diezelfde klok.
async function toonVensterStatus() {
  const el = document.getElementById("inst-status");
  const ev = await haalEvent();

  if (!ev.start) {
    el.textContent = "Er staat geen ruilbeurs gepland: iedereen doet mee en alle contactgegevens zijn zichtbaar.";
    el.className = "inst-status";
    return;
  }

  if (ev.fase === "tijdens") {
    el.textContent = `${ev.naam} is NU bezig. De ruilmodules tonen enkel verzamelaars die aan de inkom aangemeld zijn.`;
    el.className = "inst-status inst-status--open";
  } else if (ev.fase === "voor") {
    el.textContent = `Aanloop naar ${ev.naam} (${wanneer(ev)}). De ruilmodules tonen enkel verzamelaars die aangeduid hebben dat ze komen; e-mail en WhatsApp zijn verborgen.`;
    el.className = "inst-status inst-status--open";
  } else {
    const volgt = ev.start > new Date();
    el.textContent = volgt
      ? `Volgende ruilbeurs: ${ev.naam} (${wanneer(ev)}). De filter staat nog uit — iedereen doet mee.`
      : `Laatste ruilbeurs: ${ev.naam} (${wanneer(ev)}). Die is voorbij: iedereen doet mee en de contactgegevens zijn zichtbaar.`;
    el.className = "inst-status";
  }
}

async function bewaar(e) {
  e.preventDefault();
  const messageEl = document.getElementById("inst-message");

  // Dezelfde keuzes als de CHECK op de tabel (sql/025). Een waarde die daar
  // niet in staat, komt enkel van een aangepaste keuzelijst.
  const filterDagen = Number(document.getElementById("inst-filter-dagen").value);
  if (metFilterKolom && ![7, 14, 21, 30].includes(filterDagen)) {
    toonMelding(messageEl, "Kies 7, 14, 21 of 30 dagen.", "error");
    return;
  }

  // Leeg mag: dan is er geen WhatsApp-knop. Onleesbaar niet — de database heeft
  // er een CHECK op staan, en die foutmelding leest niemand graag.
  const waInvoer = document.getElementById("inst-wa-nummer").value.trim();
  const waNummer = waInvoer ? normaliseerTelefoon(waInvoer) : null;
  if (waInvoer && !waNummer) {
    toonMelding(
      messageEl,
      "Dat WhatsApp-nummer herken ik niet. Schrijf het als 0470 12 34 56 of +32 470 12 34 56.",
      "error"
    );
    return;
  }
  const waBericht = document.getElementById("inst-wa-bericht").value.trim();

  // Dezelfde grenzen als de CHECK op de tabel, maar met een leesbare melding
  // in plaats van een databasefout.
  const waarde = Number(document.getElementById("inst-stickerwaarde").value);
  if (!Number.isFinite(waarde) || waarde < 0) {
    toonMelding(messageEl, "De stickerwaarde moet een bedrag van 0 of meer zijn.", "error");
    return;
  }
  const pakje = Number(document.getElementById("inst-pakje").value);
  if (!Number.isInteger(pakje) || pakje < 1) {
    toonMelding(messageEl, "Een pakje bevat minstens één sticker.", "error");
    return;
  }
  const kaartZoom = Number(document.getElementById("inst-kaart-zoom").value);
  if (metKaartKolom && (!Number.isInteger(kaartZoom) || kaartZoom < 1 || kaartZoom > 12)) {
    toonMelding(messageEl, "De zoomtrap van de wereldkaart is een geheel getal van 1 tot 12.", "error");
    return;
  }

  const knop = document.getElementById("inst-save-btn");
  knop.disabled = true;
  knop.textContent = "Opslaan…";
  try {
    const { data, error } = await supabase
      .from("instellingen")
      .update({
        toon_glans: document.getElementById("inst-glans").checked,
        whatsapp_nummer: waNummer,
        whatsapp_bericht: waBericht || null,
        stickerwaarde: waarde,
        stickers_per_pakje: pakje,
        ...(metKaartKolom ? { [KAART_KOLOM]: kaartZoom } : {}),
        ...(metFilterKolom ? { [FILTER_KOLOM]: filterDagen } : {}),
        updated_by: userId, // wie de beurs verzette, is achteraf de eerste vraag
      })
      .eq("id", 1)
      .select(kolommen());
    if (error) throw error;
    // RLS weigert stil: geen recht betekent nul bijgewerkte rijen, geen fout.
    if (!data || data.length === 0) {
      throw new Error("De database heeft niets bijgewerkt — je account heeft geen beheerdersrecht.");
    }
    origineel = data[0];
    vulFormulier();
    toonMelding(messageEl, "Opgeslagen.", "success");
  } catch (err) {
    toonMelding(messageEl, "Fout bij opslaan: " + err.message, "error");
  }
  knop.disabled = false;
  knop.textContent = "Opslaan";
}

function toonMelding(el, tekst, type) {
  el.textContent = tekst;
  el.className = "message message--show message--" + type;
}
