// stickers.js — Kinddetail-pagina: kindgegevens tonen + stickers beheren
// (HEEFT / ZOEKT / RUILT) voor één kind.
//
// De sticker wordt gekozen uit public.sticker_catalogus (land + zoeken op
// nummer/code/naam) in plaats van vrij ingetypt, zodat er geen tikfouten of
// onbestaande nummers in de lijst terechtkomen. De kolom stickers.nummer
// bewaart de catalogus-CODE (bv. "BEL7").
import { supabase, requireAuth } from "./supabase.js";
import { getKind } from "./kinderen.js";

const TABEL = "stickers";
const STATUSSEN = ["HEEFT", "ZOEKT", "RUILT"];
const MAX_SUGGESTIES = 60;
const PAGINA = 1000; // PostgREST levert maximaal 1000 rijen per aanvraag

let kindId;
let catalogus = [];
let catalogusPerCode = new Map();
let gekozenSticker = null;
let huidigeStickers = [];

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
    document.getElementById("kind-geboortejaar").textContent = "Geboortejaar: " + kind.geboortejaar;
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
  lijst.innerHTML = "";

  if (!land && !term) return; // niets gekozen, niets te tonen

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
    const leeg = document.createElement("li");
    leeg.className = "sticker-suggestie sticker-suggestie--leeg";
    leeg.textContent = "Geen sticker gevonden.";
    lijst.appendChild(leeg);
    return;
  }

  kandidaten.slice(0, MAX_SUGGESTIES).forEach((sticker) => {
    const li = document.createElement("li");
    const knop = document.createElement("button");
    knop.type = "button";
    knop.className = "sticker-suggestie";
    knop.textContent = omschrijving(sticker);
    knop.addEventListener("click", () => kiesSticker(sticker));
    li.appendChild(knop);
    lijst.appendChild(li);
  });

  if (kandidaten.length > MAX_SUGGESTIES) {
    const meer = document.createElement("li");
    meer.className = "sticker-suggestie sticker-suggestie--leeg";
    meer.textContent = `nog ${kandidaten.length - MAX_SUGGESTIES} andere — verfijn je zoekterm`;
    lijst.appendChild(meer);
  }
}

function rangschik(sticker, term) {
  if (String(sticker.nummer) === term) return 0;
  if (sticker.code.toLowerCase() === term) return 1;
  if (sticker.code.toLowerCase().startsWith(term)) return 2;
  return 3;
}

function kiesSticker(sticker) {
  gekozenSticker = sticker;
  const vak = document.getElementById("sticker-gekozen");
  document.getElementById("sticker-code").value = sticker ? sticker.code : "";
  document.getElementById("sticker-submit-btn").disabled = !sticker;

  if (!sticker) {
    vak.classList.add("hidden");
    return;
  }
  document.getElementById("sticker-gekozen-tekst").textContent = "Gekozen: " + omschrijving(sticker);
  vak.classList.remove("hidden");
  document.getElementById("sticker-suggesties").innerHTML = "";
  document.getElementById("sticker-zoek").value = "";
}

// ---------- lijsten ----------

async function ververs() {
  try {
    const { data, error } = await supabase
      .from(TABEL)
      .select("*")
      .eq("kind_id", kindId);
    if (error) throw error;
    huidigeStickers = data || [];
  } catch (err) {
    toonMelding("Fout bij laden: " + err.message, "error");
    return;
  }

  huidigeStickers.sort(vergelijkStickers);
  toonLijst("zoekt-list", huidigeStickers.filter((s) => s.status === "ZOEKT"));
  toonLijst("ruilt-list", huidigeStickers.filter((s) => s.status === "RUILT"));
  toonLijst("heeft-list", huidigeStickers.filter((s) => s.status === "HEEFT"));
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
    leeg.textContent = "Geen stickers.";
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

// ---------- bewaren / bewerken / verwijderen ----------

function bewerkSticker(sticker) {
  document.getElementById("sticker-id").value = sticker.id;
  document.getElementById("sticker-status").value = sticker.status;
  document.getElementById("sticker-submit-btn").textContent = "Wijziging opslaan";

  const uitCatalogus = catalogusPerCode.get(sticker.nummer);
  if (uitCatalogus) {
    document.getElementById("sticker-land").value = uitCatalogus.land_naam;
    kiesSticker(uitCatalogus);
  } else {
    // Sticker van vóór de catalogus: code staat niet in de lijst.
    kiesSticker(null);
    toonMelding(
      `"${sticker.nummer}" staat niet in de stickerlijst. Kies hierboven de juiste sticker.`,
      "error"
    );
  }
  document.getElementById("sticker-form").scrollIntoView({ behavior: "smooth" });
}

function resetFormulier() {
  document.getElementById("sticker-form").reset();
  document.getElementById("sticker-id").value = "";
  document.getElementById("sticker-suggesties").innerHTML = "";
  document.getElementById("sticker-message").className = "message";
  document.getElementById("sticker-submit-btn").textContent = "Toevoegen";
  kiesSticker(null);
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
    toonMelding("Kies een geldige status.", "error");
    return;
  }

  const dubbel = huidigeStickers.find((s) => s.nummer === code && s.id !== id);
  if (dubbel) {
    toonMelding(
      `${code} staat al in de lijst met status "${dubbel.status}". Pas die aan in plaats van een tweede rij toe te voegen.`,
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
