// ruilen.js — Ruilpagina: alle ruilkansen van alle verzamelaars van deze
// ouder op één rij, met de kolom "Contacteren".
//
// De ruilmodule staat open tijdens het beursvenster uit public.instellingen
// (in te stellen op instellingen.html). Buiten dat venster blijft de LIJST
// zichtbaar — dát er geruild kan worden is geen geheim — maar staat er bij
// een ander gezin geen naam. Die grens ligt in de database: get_matches geeft
// de voornaam buiten het venster gewoon niet terug. Wat hier gebeurt is dus
// presentatie, geen beveiliging.
//
// Hetzelfde geldt voor de WhatsApp-knop: get_matches geeft ander_whatsapp enkel
// terug tijdens het beursvenster, en enkel wanneer dát gezin zijn nummer wil
// delen (vinkje op gezin.html). Staat er geen nummer, dan blijft het bij
// "zoek elkaar op de beurs" — de knop verschijnt dan gewoon niet.
import { supabase, requireAuth } from "./supabase.js";
import { loadKinderen } from "./kinderen.js";
import { whatsappKnop, toonOrganisatorKnop } from "./whatsapp.js";

const RICHTING = {
  jij_zoekt: { tekst: "zoekt deze", klasse: "richting--zoekt" },
  jij_hebt_dubbel: { tekst: "heeft deze dubbel", klasse: "richting--dubbel" },
};

let beursOpen = false;

document.addEventListener("DOMContentLoaded", async () => {
  const inhoud = document.getElementById("ruil-inhoud");
  if (!inhoud) return; // niet op ruilen.html

  const user = await requireAuth();
  if (!user) return;

  await toonVenster();
  toonOrganisatorKnop("organisator-knop", "💬 WhatsApp de organisator");

  const loading = document.getElementById("ruil-loading");
  let kinderen;
  try {
    kinderen = await loadKinderen();
  } catch (err) {
    loading.textContent = "Fout bij laden: " + err.message;
    return;
  }

  if (kinderen.length === 0) {
    loading.classList.add("hidden");
    inhoud.appendChild(
      melding("Je hebt nog geen verzamelaars. Voeg er eerst een toe op het dashboard.")
    );
    return;
  }

  // Eén aanroep per verzamelaar. Bij een handvol kinderen is dat goedkoper dan
  // er een aparte functie voor te schrijven die alles in één keer ophaalt.
  let resultaten;
  try {
    resultaten = await Promise.all(
      kinderen.map(async (kind) => ({
        kind,
        rijen: await haalMatches(kind.id),
      }))
    );
  } catch (err) {
    loading.textContent =
      "Ruilkansen konden niet geladen worden — draai sql/008_matches_eigen_gezin.sql in Supabase. (" +
      err.message +
      ")";
    return;
  }

  loading.classList.add("hidden");

  const totaal = resultaten.reduce((som, r) => som + r.rijen.length, 0);
  if (totaal === 0) {
    inhoud.appendChild(
      melding(
        "Nog geen ruilkansen. Die verschijnen zodra iemand anders een sticker dubbel heeft die jij zoekt, of omgekeerd."
      )
    );
    return;
  }

  resultaten.forEach(({ kind, rijen }) => inhoud.appendChild(bouwKaart(kind, rijen)));
});

async function haalMatches(kindId) {
  const { data, error } = await supabase.rpc("get_matches", { p_kind_id: kindId });
  if (error) throw error;
  return data || [];
}

// ---------- beursvenster ----------

async function toonVenster() {
  const el = document.getElementById("ruil-venster");
  let start;
  let einde;
  try {
    const { data, error } = await supabase
      .from("instellingen")
      .select("beurs_start,beurs_einde")
      .eq("id", 1)
      .single();
    if (error) throw error;
    start = new Date(data.beurs_start);
    einde = new Date(data.beurs_einde);
  } catch (err) {
    el.textContent = "Het beursvenster kon niet opgehaald worden.";
    return;
  }

  const nu = new Date();
  const opmaak = new Intl.DateTimeFormat("nl-BE", { dateStyle: "full", timeStyle: "short" });
  const uur = new Intl.DateTimeFormat("nl-BE", { timeStyle: "short" });

  if (nu < start) {
    beursOpen = false;
    el.className = "ruil-venster ruil-venster--dicht";
    el.textContent = `De ruilmodule staat nog uit. Ze gaat open op ${opmaak.format(
      start
    )} en sluit om ${uur.format(einde)}. Tot dan zie je wél je ruilkansen, maar nog niet bij wie ze liggen.`;
  } else if (nu < einde) {
    beursOpen = true;
    el.className = "ruil-venster ruil-venster--open";
    el.textContent = `De ruilbeurs is bezig — nog tot ${uur.format(
      einde
    )}. Je ziet nu bij wie elke sticker ligt.`;
  } else {
    beursOpen = false;
    el.className = "ruil-venster ruil-venster--dicht";
    el.textContent = `De ruilbeurs van ${opmaak.format(
      start
    )} is voorbij. De ruilmodule staat weer uit tot een beheerder een nieuw beursvenster instelt.`;
  }
}

// ---------- lijst ----------

function bouwKaart(kind, rijen) {
  const sectie = document.createElement("section");
  sectie.className = "card";

  const titel = document.createElement("h2");
  titel.textContent = `${kind.voornaam} ${kind.familienaam}`;
  sectie.appendChild(titel);

  if (rijen.length === 0) {
    const leeg = document.createElement("p");
    leeg.className = "form-meta";
    leeg.textContent = "Nog geen ruilkansen voor deze verzamelaar.";
    sectie.appendChild(leeg);
    return sectie;
  }

  const aantal = document.createElement("p");
  aantal.className = "form-meta";
  aantal.textContent = `${rijen.length} ruilkans${rijen.length === 1 ? "" : "en"}`;
  sectie.appendChild(aantal);

  const wrapper = document.createElement("div");
  wrapper.className = "table-wrapper";
  const tabel = document.createElement("table");
  tabel.className = "data-table";
  tabel.appendChild(kop());

  const body = document.createElement("tbody");
  rijen.forEach((rij) => body.appendChild(bouwRij(kind, rij)));
  tabel.appendChild(body);
  wrapper.appendChild(tabel);
  sectie.appendChild(wrapper);
  return sectie;
}

function kop() {
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  ["Sticker", "Land", "Wat", "Contacteren"].forEach((tekst) => {
    const th = document.createElement("th");
    th.textContent = tekst;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  return thead;
}

function bouwRij(kind, rij) {
  const tr = document.createElement("tr");

  const sticker = document.createElement("td");
  sticker.textContent = rij.sticker_naam ? `${rij.code} — ${rij.sticker_naam}` : rij.code;
  tr.appendChild(sticker);

  const land = document.createElement("td");
  land.textContent = rij.land_naam;
  tr.appendChild(land);

  // "Guus zoekt deze" / "Guus heeft deze dubbel" — vanuit jouw verzamelaar
  // gezien, want dat is de kant die je zelf in handen hebt.
  const wat = document.createElement("td");
  const richting = RICHTING[rij.richting] || { tekst: rij.richting, klasse: "" };
  const label = document.createElement("span");
  label.className = "richting " + richting.klasse;
  label.textContent = `${kind.voornaam} ${richting.tekst}`;
  wat.appendChild(label);
  tr.appendChild(wat);

  tr.appendChild(contactCel(kind, rij));
  return tr;
}

function contactCel(kind, rij) {
  const td = document.createElement("td");

  if (rij.eigen_gezin) {
    td.className = "contact contact--eigen";
    td.textContent = `${rij.ander_kind} — je eigen verzamelaar, dat regel je thuis`;
    return td;
  }
  if (beursOpen && rij.ander_kind) {
    td.className = "contact contact--open";
    const naam = document.createElement("span");
    naam.textContent = `Zoek ${rij.ander_kind} op de beurs`;
    td.appendChild(naam);

    // Deelt dat gezin zijn nummer, dan hoeft niemand te zoeken. Het bericht is
    // vooraf ingevuld: wie er belt, over welke sticker het gaat en welke kant
    // de ruil op moet. Zo begint het gesprek niet bij "hallo, wie ben jij?".
    const knop = whatsappKnop(rij.ander_whatsapp, ruilBericht(kind, rij), "💬 WhatsApp");
    if (knop) td.appendChild(knop);
    return td;
  }
  td.className = "contact contact--dicht";
  td.textContent = "Beschikbaar tijdens de ruilbeurs";
  return td;
}

function ruilBericht(kind, rij) {
  const sticker = rij.sticker_naam ? `${rij.code} — ${rij.sticker_naam}` : rij.code;
  const zin =
    rij.richting === "jij_zoekt"
      ? `${kind.voornaam} zoekt ${sticker}, en ${rij.ander_kind} heeft die dubbel`
      : `${kind.voornaam} heeft ${sticker} dubbel, en ${rij.ander_kind} zoekt die`;
  return `Dag! Via het Panini Ruilportaal Meulestede: ${zin}. Zullen we ruilen?`;
}

function melding(tekst) {
  const kaart = document.createElement("div");
  kaart.className = "card";
  const p = document.createElement("p");
  p.className = "form-meta";
  p.style.marginBottom = "0";
  p.textContent = tekst;
  kaart.appendChild(p);
  return kaart;
}
