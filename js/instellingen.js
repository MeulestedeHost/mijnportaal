// instellingen.js — Beheerpagina voor het beursvenster en de glansstickers.
//
// De pagina is geen beveiliging: ze verbergt hooguit knoppen. Wie mag
// opslaan, beslist RLS op public.instellingen (policy instellingen_update,
// die public.is_beheerder() aanroept). Iemand zonder beheerdersrecht die de
// API rechtstreeks aanspreekt, krijgt daar nul rijen bijgewerkt.
import { supabase, requireAuth } from "./supabase.js";

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
});

async function laadInstellingen() {
  const { data, error } = await supabase
    .from("instellingen")
    .select("beurs_start,beurs_einde,toon_glans")
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
        updated_by: userId, // wie de beurs verzette, is achteraf de eerste vraag
      })
      .eq("id", 1)
      .select("beurs_start,beurs_einde,toon_glans");
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
