// instellingen.js — Beheerpagina: beursvenster, glansstickers, WhatsApp van de
// organisatie, en de twee getallen achter de statistiekenpagina (prijs van een
// sticker en aantal stickers per pakje).
//
// De pagina is geen beveiliging: ze verbergt hooguit knoppen. Wie mag
// opslaan, beslist RLS op public.instellingen (policy instellingen_update,
// die public.is_beheerder() aanroept). Iemand zonder beheerdersrecht die de
// API rechtstreeks aanspreekt, krijgt daar nul rijen bijgewerkt.
import { supabase, requireAuth } from "./supabase.js";
import { normaliseerTelefoon, toonTelefoon } from "./whatsapp.js";

// De kolommen die deze pagina beheert, op één plek: ze worden bij het laden
// opgehaald en na het opslaan opnieuw teruggevraagd, en die twee lijsten
// mogen niet uit elkaar lopen.
const KOLOMMEN =
  "beurs_start,beurs_einde,toon_glans,whatsapp_nummer,whatsapp_bericht," +
  "stickerwaarde,stickers_per_pakje";

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

async function laadInstellingen() {
  const { data, error } = await supabase
    .from("instellingen")
    .select(KOLOMMEN)
    .eq("id", 1)
    .single();
  if (error) throw error;
  origineel = data;
  vulFormulier();
}

function vulFormulier() {
  document.getElementById("inst-start").value = naarInvoerveld(origineel.beurs_start);
  document.getElementById("inst-einde").value = naarInvoerveld(origineel.beurs_einde);
  document.getElementById("inst-glans").checked = Boolean(origineel.toon_glans);
  document.getElementById("inst-wa-nummer").value = toonTelefoon(origineel.whatsapp_nummer);
  document.getElementById("inst-wa-bericht").value = origineel.whatsapp_bericht || "";
  // Draaide sql/017 nog niet, dan bestaan deze twee kolommen nog niet; dan
  // tonen we dezelfde standaardwaarden als de databank zou gebruiken.
  document.getElementById("inst-stickerwaarde").value =
    origineel.stickerwaarde == null ? "0.25" : String(origineel.stickerwaarde);
  document.getElementById("inst-pakje").value =
    origineel.stickers_per_pakje == null ? "5" : String(origineel.stickers_per_pakje);
  toonVensterStatus();
  document.getElementById("inst-message").className = "message";
}

// <input type="datetime-local"> werkt met lokale tijd zonder zone. De database
// bewaart timestamptz. Heen en weer rekenen doen we via de browser, die op de
// beurs sowieso in de Belgische zone staat.
function naarInvoerveld(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function toonVensterStatus() {
  const el = document.getElementById("inst-status");
  const start = new Date(origineel.beurs_start);
  const einde = new Date(origineel.beurs_einde);
  const nu = new Date();
  const opmaak = new Intl.DateTimeFormat("nl-BE", { dateStyle: "full", timeStyle: "short" });

  if (nu < start) {
    el.textContent = `Nu opgeslagen: van ${opmaak.format(start)} tot ${opmaak.format(
      einde
    )} — de ruilmodule staat nog dicht.`;
    el.className = "inst-status";
  } else if (nu < einde) {
    el.textContent = `De ruilmodule staat NU open, tot ${opmaak.format(einde)}.`;
    el.className = "inst-status inst-status--open";
  } else {
    el.textContent = `Nu opgeslagen: van ${opmaak.format(start)} tot ${opmaak.format(
      einde
    )} — dat venster is voorbij.`;
    el.className = "inst-status";
  }
}

async function bewaar(e) {
  e.preventDefault();
  const messageEl = document.getElementById("inst-message");
  const startTekst = document.getElementById("inst-start").value;
  const eindeTekst = document.getElementById("inst-einde").value;

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

  const knop = document.getElementById("inst-save-btn");
  knop.disabled = true;
  knop.textContent = "Opslaan…";
  try {
    const { data, error } = await supabase
      .from("instellingen")
      .update({
        beurs_start: start.toISOString(),
        beurs_einde: einde.toISOString(),
        toon_glans: document.getElementById("inst-glans").checked,
        whatsapp_nummer: waNummer,
        whatsapp_bericht: waBericht || null,
        stickerwaarde: waarde,
        stickers_per_pakje: pakje,
        updated_by: userId, // wie de beurs verzette, is achteraf de eerste vraag
      })
      .eq("id", 1)
      .select(KOLOMMEN);
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
