// stickers.js — Kinddetail-pagina: stickers beheren voor één verzamelaar.
//
// Twee statussen, meer niet: ZOEKT ("zoek ik") en RUILT ("heb ik dubbel").
// Wat een kind al in het album heeft plakken we niet bij: dat is werk zonder
// opbrengst, want ruilen draait enkel om zoeken en dubbels.
//
// De sticker wordt gekozen uit public.sticker_catalogus in plaats van vrij
// ingetypt, zodat er geen tikfouten of onbestaande nummers in de lijst
// belanden. De kolom stickers.nummer bewaart de catalogus-CODE (bv. "BEL7").
//
// Bediening is op een telefoon door een kind te doen: zoekveld eerst, de
// lijst filtert al terwijl je typt, en één tik kiest de sticker.
import { supabase, requireAuth } from "./supabase.js";
import { getKind } from "./kinderen.js";

const TABEL = "stickers";
const STATUSSEN = ["ZOEKT", "RUILT"];
const STATUS_TEKST = { ZOEKT: "zoek ik", RUILT: "heb ik dubbel" };
const MAX_SUGGESTIES = 200;
const PAGINA = 1000; // PostgREST levert maximaal 1000 rijen per aanvraag

let kindId;
let catalogus = [];
let catalogusPerCode = new Map();
let huidigeStickers = [];
let statusPerCode = new Map(); // code -> status van DIT kind

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("sticker-form");
  if (!form) return;

  const user = await requireAuth();
  if (!user) return;

  kindId = new URLSearchParams(window.location.search).get("id");
  if (!kindId) {
    window.location.href = "/dashboard.html";
    return;
  }

  try {
    const kind = await getKind(kindId);
    document.getElementById("kind-naam").textContent = `${kind.voornaam} ${kind.familienaam}`;
    document.getElementById("kind-geboortejaar").textContent = kind.is_volwassen
      ? "Volwassen verzamelaar"
      : kind.geboortejaar
      ? "Geboortejaar: " + kind.geboortejaar
      : "";
  } catch (err) {
    document.getElementById("kind-naam").textContent = "Kind niet gevonden.";
    form.classList.add("hidden");
    return;
  }

  try {
    catalogus = await laadCatalogus();
    catalogusPerCode = new Map(catalogus.map((s) => [s.code, s]));
    vulLandKeuzelijst();
  } catch (err) {
    toonMelding("Stickerlijst kon niet geladen worden: " + err.message, "error");
  }

  form.addEventListener("submit", bewaarSticker);
  document.getElementById("sticker-cancel-btn").addEventListener("click", resetFormulier);
  document.getElementById("sticker-wis-btn").addEventListener("click", () => kiesSticker(null));
  document.getElementById("sticker-land").addEventListener("change", toonSuggesties);
  document.getElementById("sticker-zoek").addEventListener("input", toonSuggesties);

  await ververs();
  document.getElementById("sticker-zoek").focus();
});

// ---------- catalogus ----------

async function laadCatalogus() {
  const alles = [];
  for (let van = 0; ; van += PAGINA) {
    const { data, error } = await supabase
      .from("sticker_catalogus")
      .select("categorie,land_code,land_naam,nummer,code,naam,glans")
      .order("land_naam", { ascending: true })
      .order("nummer", { ascending: true })
      .order("glans", { ascending: true })
      .range(van, van + PAGINA - 1);
    if (error) throw error;
    alles.push(...data);
    if (data.length < PAGINA) return alles;
  }
}

function vulLandKeuzelijst() {
  const select = document.getElementById("sticker-land");
  const landen = [...new Set(catalogus.map((s) => s.land_naam))].sort((a, b) =>
    a.localeCompare(b, "nl")
  );
  landen.forEach((land) => {
    const optie = document.createElement("option");
    optie.value = land;
    optie.textContent = land;
    select.appendChild(optie);
  });
}

function omschrijving(sticker) {
  const glans = sticker.glans ? " ✨" : "";
  return sticker.naam ? `${sticker.code}${glans} — ${sticker.naam}` : sticker.code + glans;
}

// ---------- suggesties ----------

function toonSuggesties() {
  const land = document.getElementById("sticker-land").value;
  const term = document.getElementById("sticker-zoek").value.trim().toLowerCase();
  const lijst = document.getElementById("sticker-suggesties");
  const teller = document.getElementById("sticker-teller");
  lijst.innerHTML = "";

  let kandidaten = land ? catalogus.filter((s) => s.land_naam === land) : catalogus;
  if (term) {
    kandidaten = kandidaten
      .filter(
        (s) =>
          String(s.nummer) === term ||
          s.code.toLowerCase().startsWith(term) ||
          (s.naam || "").toLowerCase().includes(term)
      )
      .sort((a, b) => rangschik(a, term) - rangschik(b, term));
  }

  if (kandidaten.length === 0) {
    teller.textContent = "";
    const leeg = document.createElement("li");
    leeg.className = "sticker-suggestie-leeg";
    leeg.textContent = "Geen sticker gevonden. Probeer een ander nummer of een stukje van de naam.";
    lijst.appendChild(leeg);
    return;
  }

  const getoond = Math.min(kandidaten.length, MAX_SUGGESTIES);
  teller.textContent =
    kandidaten.length > MAX_SUGGESTIES
      ? `${kandidaten.length} stickers gevonden — eerste ${getoond} getoond, typ verder om te verfijnen`
      : `${kandidaten.length} sticker${kandidaten.length === 1 ? "" : "s"}`;

  // Het huidige sticker-id: bij "Wijzig" moet die ene sticker wél kiesbaar
  // blijven, ook al staat hij natuurlijk al in de lijst van dit kind.
  const bewerktCode = document.getElementById("sticker-id").value
    ? document.getElementById("sticker-code").value
    : "";

  kandidaten.slice(0, MAX_SUGGESTIES).forEach((sticker) => {
    const al = sticker.code === bewerktCode ? null : statusPerCode.get(sticker.code);
    const li = document.createElement("li");

    if (al) {
      // Staat al in de lijst van dit kind: tonen, maar niet nog eens te kiezen.
      const span = document.createElement("span");
      span.className = "sticker-suggestie sticker-suggestie--al";
      span.title = omschrijving(sticker) + " — staat al in je lijst";
      span.textContent = `${omschrijving(sticker)} · ${STATUS_TEKST[al]} ✓`;
      li.appendChild(span);
    } else {
      const knop = document.createElement("button");
      knop.type = "button";
      knop.className = "sticker-suggestie";
      knop.title = omschrijving(sticker);
      knop.textContent = omschrijving(sticker);
      knop.addEventListener("click", () => kiesSticker(sticker));
      li.appendChild(knop);
    }
    lijst.appendChild(li);
  });
}

function rangschik(sticker, term) {
  if (String(sticker.nummer) === term) return 0;
  if (sticker.code.toLowerCase() === term) return 1;
  if (sticker.code.toLowerCase().startsWith(term)) return 2;
  return 3;
}

function kiesSticker(sticker) {
  const vak = document.getElementById("sticker-keuze");
  document.getElementById("sticker-code").value = sticker ? sticker.code : "";
  document.getElementById("sticker-submit-btn").disabled = !sticker;
  werkStatusKeuzesBij(sticker);

  if (!sticker) {
    vak.classList.add("hidden");
    return;
  }
  document.getElementById("sticker-gekozen-tekst").textContent = omschrijving(sticker);
  vak.classList.remove("hidden");
  vak.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// "POR15 — Cristiano Ronaldo zoek ik" leest voor een kind een pak duidelijker
// dan een kaal "ZOEKT" in een keuzelijst met de titel "Status".
function werkStatusKeuzesBij(sticker) {
  const select = document.getElementById("sticker-status");
  const voorvoegsel = sticker ? omschrijving(sticker) + " " : "";
  [...select.options].forEach((optie) => {
    optie.textContent = voorvoegsel + STATUS_TEKST[optie.value];
  });
}

// ---------- lijsten ----------

async function ververs() {
  try {
    const { data, error } = await supabase.from(TABEL).select("*").eq("kind_id", kindId);
    if (error) throw error;
    huidigeStickers = data || [];
  } catch (err) {
    toonMelding("Fout bij laden: " + err.message, "error");
    return;
  }

  statusPerCode = new Map(huidigeStickers.map((s) => [s.nummer, s.status]));
  huidigeStickers.sort(vergelijkStickers);
  toonLijst("zoekt-list", huidigeStickers.filter((s) => s.status === "ZOEKT"));
  toonLijst("ruilt-list", huidigeStickers.filter((s) => s.status === "RUILT"));
  toonSuggesties();
  await verversMatches();
}

function vergelijkStickers(a, b) {
  const ca = catalogusPerCode.get(a.nummer);
  const cb = catalogusPerCode.get(b.nummer);
  if (ca && cb) {
    return ca.land_naam.localeCompare(cb.land_naam, "nl") || ca.nummer - cb.nummer;
  }
  return String(a.nummer).localeCompare(String(b.nummer), "nl");
}

function toonLijst(lijstId, stickers) {
  const ul = document.getElementById(lijstId);
  ul.innerHTML = "";
  if (stickers.length === 0) {
    const leeg = document.createElement("li");
    leeg.className = "sticker-item sticker-item--empty";
    leeg.textContent = "Nog niets.";
    ul.appendChild(leeg);
    return;
  }

  stickers.forEach((sticker) => {
    const uitCatalogus = catalogusPerCode.get(sticker.nummer);
    const li = document.createElement("li");
    li.className = "sticker-item";

    const label = document.createElement("span");
    label.className = "sticker-item__nummer";
    label.textContent = uitCatalogus ? omschrijving(uitCatalogus) : sticker.nummer;

    const acties = document.createElement("div");
    acties.className = "sticker-item__actions";

    const wijzig = document.createElement("button");
    wijzig.className = "btn btn--outline btn--sm";
    wijzig.textContent = "Wijzig";
    wijzig.addEventListener("click", () => bewerkSticker(sticker));

    const verwijder = document.createElement("button");
    verwijder.className = "btn btn--danger btn--sm";
    verwijder.textContent = "Verwijder";
    verwijder.addEventListener("click", () => verwijderSticker(sticker.id));

    acties.appendChild(wijzig);
    acties.appendChild(verwijder);
    li.appendChild(label);
    li.appendChild(acties);
    ul.appendChild(li);
  });
}

// ---------- matches ----------

// get_matches() draait als security definer in de database: enkel zo kan ze
// de stickers van andere gezinnen zien. Buiten het beursvenster geeft ze wel
// de stickers terug maar niet bij wie ze liggen (ander_kind is dan null).
async function verversMatches() {
  const ul = document.getElementById("match-list");
  const uitleg = document.getElementById("match-uitleg");
  ul.innerHTML = "";

  let rijen;
  try {
    const { data, error } = await supabase.rpc("get_matches", { p_kind_id: kindId });
    if (error) throw error;
    rijen = (data || []).filter((r) => r.richting === "jij_zoekt");
  } catch (err) {
    uitleg.textContent = "";
    const leeg = document.createElement("li");
    leeg.className = "sticker-item sticker-item--empty";
    leeg.textContent = "Ruilkansen konden niet geladen worden.";
    ul.appendChild(leeg);
    return;
  }

  const metNaam = rijen.some((r) => r.ander_kind);
  uitleg.textContent = metNaam
    ? "De beurs loopt: je ziet bij wie de sticker ligt."
    : "Stickers die jij zoekt en die iemand anders dubbel heeft. Bij wie precies, zie je tijdens de ruilbeurs.";

  if (rijen.length === 0) {
    const leeg = document.createElement("li");
    leeg.className = "sticker-item sticker-item--empty";
    leeg.textContent = "Nog geen ruilkansen.";
    ul.appendChild(leeg);
    return;
  }

  rijen.forEach((rij) => {
    const li = document.createElement("li");
    li.className = "sticker-item";

    const label = document.createElement("span");
    label.className = "sticker-item__nummer";
    label.textContent = rij.sticker_naam ? `${rij.code} — ${rij.sticker_naam}` : rij.code;

    const bij = document.createElement("span");
    bij.className = "sticker-item__bij";
    bij.textContent = rij.ander_kind ? "bij " + rij.ander_kind : "bij iemand";

    li.appendChild(label);
    li.appendChild(bij);
    ul.appendChild(li);
  });
}

// ---------- bewaren / bewerken / verwijderen ----------

function bewerkSticker(sticker) {
  document.getElementById("sticker-id").value = sticker.id;
  document.getElementById("sticker-status").value = sticker.status;
  document.getElementById("sticker-submit-btn").textContent = "Wijziging opslaan";

  const uitCatalogus = catalogusPerCode.get(sticker.nummer);
  if (uitCatalogus) {
    document.getElementById("sticker-land").value = uitCatalogus.land_naam;
    document.getElementById("sticker-zoek").value = "";
    kiesSticker(uitCatalogus);
    document.getElementById("sticker-status").value = sticker.status;
  } else {
    // Sticker van vóór de catalogus: code staat niet in de lijst.
    kiesSticker(null);
    toonMelding(
      `"${sticker.nummer}" staat niet in de stickerlijst. Kies hierboven de juiste sticker.`,
      "error"
    );
  }
  toonSuggesties();
  document.getElementById("sticker-form").scrollIntoView({ behavior: "smooth" });
}

function resetFormulier() {
  document.getElementById("sticker-id").value = "";
  document.getElementById("sticker-zoek").value = "";
  document.getElementById("sticker-message").className = "message";
  document.getElementById("sticker-submit-btn").textContent = "Toevoegen";
  kiesSticker(null);
  toonSuggesties();
}

async function bewaarSticker(e) {
  e.preventDefault();
  const id = document.getElementById("sticker-id").value;
  const code = document.getElementById("sticker-code").value;
  const status = document.getElementById("sticker-status").value;

  if (!code || !catalogusPerCode.has(code)) {
    toonMelding("Kies eerst een sticker uit de lijst.", "error");
    return;
  }
  if (!STATUSSEN.includes(status)) {
    toonMelding("Kies eerst wat je met deze sticker wil.", "error");
    return;
  }

  const dubbel = huidigeStickers.find((s) => s.nummer === code && s.id !== id);
  if (dubbel) {
    toonMelding(
      `${code} staat al in je lijst bij "${STATUS_TEKST[dubbel.status]}". Wijzig die regel in plaats van er een tweede bij te zetten.`,
      "error"
    );
    return;
  }

  const knop = document.getElementById("sticker-submit-btn");
  knop.disabled = true;
  try {
    if (id) {
      const { error } = await supabase.from(TABEL).update({ nummer: code, status }).eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from(TABEL).insert({ kind_id: kindId, nummer: code, status });
      if (error) throw error;
    }
    resetFormulier();
    await ververs();
    // Meteen klaar voor de volgende sticker: dat scheelt een tik per sticker.
    document.getElementById("sticker-zoek").focus();
  } catch (err) {
    toonMelding("Fout bij opslaan: " + err.message, "error");
    knop.disabled = false;
  }
}

async function verwijderSticker(id) {
  if (!confirm("Deze sticker verwijderen?")) return;
  try {
    const { error } = await supabase.from(TABEL).delete().eq("id", id);
    if (error) throw error;
    await ververs();
  } catch (err) {
    toonMelding("Fout bij verwijderen: " + err.message, "error");
  }
}

function toonMelding(tekst, type) {
  const el = document.getElementById("sticker-message");
  el.textContent = tekst;
  el.className = "message message--show message--" + type;
}
