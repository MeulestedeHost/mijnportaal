// ruilmomenten-beheer.js — ruilmomenten in het CC Meulestede beheren
// (instellingen.html, migratie 033).
//
// Apart van instellingen.js: die pagina is al lang, en een ruilmoment heeft
// niets gemeen met de beurzen erboven behalve een begin en een einde. De kaart
// staat binnen het beheerpaneel, dat instellingen.js enkel toont aan een
// beheerder; de databank (RLS op public.ruilmomenten) controleert dat opnieuw.
// Bestaat de tabel nog niet, dan verdwijnt de kaart.
import { supabase } from "./supabase.js";

const opmaak = new Intl.DateTimeFormat("nl-BE", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const uur = new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit" });

document.addEventListener("DOMContentLoaded", () => {
  const kaart = document.getElementById("inst-momenten-kaart");
  if (!kaart) return;
  document.getElementById("inst-mo-toevoegen").addEventListener("click", voegToe);
  void teken();
});

async function teken() {
  const body = document.getElementById("inst-momenten-rijen");
  const { data, error } = await supabase
    .from("ruilmomenten")
    .select("id,start,einde,opmerking")
    .order("start", { ascending: true });
  if (error) {
    document.getElementById("inst-momenten-kaart").classList.add("hidden");
    return;
  }
  body.textContent = "";
  const nu = new Date();
  const rijen = (data || []).filter((m) => new Date(m.einde) > new Date(nu.getTime() - 30 * 864e5));
  if (!rijen.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.className = "aanwezig-leeg";
    td.textContent = "Er staat nog geen ruilmoment gepland.";
    tr.append(td);
    body.append(tr);
    return;
  }
  rijen.forEach((m) => {
    const tr = document.createElement("tr");
    const wanneer = document.createElement("td");
    wanneer.textContent = `${opmaak.format(new Date(m.start))}–${uur.format(new Date(m.einde))}` + (new Date(m.einde) <= nu ? " (voorbij)" : "");
    const opm = document.createElement("td");
    opm.textContent = m.opmerking || "";
    const actie = document.createElement("td");
    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "btn btn--outline btn--sm";
    weg.textContent = "Verwijderen";
    // Een afspraak die dit moment koos, houdt haar wijze "afhalen" maar
    // verliest het moment (on delete set null); de gezinnen kiezen een ander.
    weg.addEventListener("click", async () => {
      weg.disabled = true;
      const { error: fout } = await supabase.from("ruilmomenten").delete().eq("id", m.id);
      if (fout) {
        weg.disabled = false;
        melding(fout.message, "error");
        return;
      }
      void teken();
    });
    actie.append(weg);
    tr.append(wanneer, opm, actie);
    body.append(tr);
  });
}

async function voegToe() {
  const startTekst = document.getElementById("inst-mo-start").value;
  const duur = Number(document.getElementById("inst-mo-duur").value) || 120;
  const opmerking = document.getElementById("inst-mo-opmerking").value.trim();
  if (!startTekst) {
    melding("Kies een start.", "error");
    return;
  }
  const start = new Date(startTekst);
  const einde = new Date(start.getTime() + duur * 60000);
  const knop = document.getElementById("inst-mo-toevoegen");
  knop.disabled = true;
  const { error } = await supabase
    .from("ruilmomenten")
    .insert({ start: start.toISOString(), einde: einde.toISOString(), opmerking });
  knop.disabled = false;
  if (error) {
    melding(error.message, "error");
    return;
  }
  document.getElementById("inst-mo-start").value = "";
  document.getElementById("inst-mo-opmerking").value = "";
  melding("✓ Ruilmoment toegevoegd.", "success");
  void teken();
}

function melding(tekst, soort) {
  const el = document.getElementById("inst-momenten-message");
  el.textContent = tekst;
  el.className = `message message--show message--${soort}`;
}
