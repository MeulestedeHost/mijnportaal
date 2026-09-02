// dashboard.js — Dashboard: welkomstbericht, onboarding wizard, verzamelaarslijst
//
// Een "verzamelaar" is een rij in public.kinderen. Volwassenen staan in
// dezelfde tabel met is_volwassen = true en zonder geboortejaar: ze ruilen
// op precies dezelfde manier mee.
import { requireAuth, supabase } from "./supabase.js";
import { loadKinderen, addKind, updateKind, deleteKind, isValidGeboortejaar } from "./kinderen.js";

let user;
let statistieken = new Map(); // kind_id -> { zoekt, dubbel, matches }

document.addEventListener("DOMContentLoaded", async () => {
  const onboarding = document.getElementById("onboarding");
  if (!onboarding) return; // niet op dashboard.html

  user = await requireAuth();
  if (!user) return;

  const emailEl = document.getElementById("user-email");
  if (emailEl) emailEl.textContent = user.email;

  wireOnboardingForm();
  wireKindForm();
  wireVolwassenVinkjes();
  document.getElementById("new-kind-btn").addEventListener("click", () => openKindForm());

  await refreshKinderen();
});

// Het geboortejaar is voor een volwassene niet relevant; het veld verdwijnt
// dan in plaats van een verplicht vak te blijven dat niemand wil invullen.
function wireVolwassenVinkjes() {
  koppelVinkje("ob-volwassen", "ob-geboortejaar-groep", "ob-geboortejaar");
  koppelVinkje("kind-volwassen", "kind-geboortejaar-groep", "kind-geboortejaar");
}

function koppelVinkje(vinkjeId, groepId, veldId) {
  const vinkje = document.getElementById(vinkjeId);
  vinkje.addEventListener("change", () => pasVolwassenToe(vinkjeId, groepId, veldId));
  pasVolwassenToe(vinkjeId, groepId, veldId);
}

function pasVolwassenToe(vinkjeId, groepId, veldId) {
  const volwassen = document.getElementById(vinkjeId).checked;
  document.getElementById(groepId).classList.toggle("hidden", volwassen);
  if (volwassen) document.getElementById(veldId).value = "";
}

async function refreshKinderen() {
  const loading = document.getElementById("loading");
  const onboarding = document.getElementById("onboarding");
  const mainDashboard = document.getElementById("main-dashboard");
  const kinderenUl = document.getElementById("kinderen-ul");

  loading.classList.remove("hidden");
  onboarding.classList.add("hidden");
  mainDashboard.classList.add("hidden");
  kinderenUl.innerHTML = "";

  let kinderen;
  try {
    kinderen = await loadKinderen(user.id);
  } catch (err) {
    loading.textContent = "Fout bij laden: " + err.message;
    return;
  }

  await laadStatistieken();
  loading.classList.add("hidden");

  if (kinderen.length === 0) {
    onboarding.classList.remove("hidden");
    return;
  }

  mainDashboard.classList.remove("hidden");
  // Volwassenen onderaan: de kinderen zijn de hoofdmoot van de beurs.
  kinderen
    .slice()
    .sort((a, b) => Number(a.is_volwassen) - Number(b.is_volwassen))
    .forEach((kind) => kinderenUl.appendChild(bouwKindRij(kind)));
}

function bouwKindRij(kind) {
  const li = document.createElement("li");
  li.className = "kind-item";

  const info = document.createElement("div");
  info.className = "kind-item__info";

  const link = document.createElement("a");
  link.href = `/kind.html?id=${encodeURIComponent(kind.id)}`;
  link.textContent = `${kind.voornaam} ${kind.familienaam}`;
  link.className = "kind-item__name";
  info.appendChild(link);

  if (kind.is_volwassen) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "volwassene";
    info.appendChild(chip);
  }

  info.appendChild(bouwCijfers(kind.id));

  const actions = document.createElement("div");
  actions.className = "kind-item__actions";

  // Twee wegen naar dezelfde pagina: de naam blijft klikbaar, maar een knop
  // die eruitziet als een knop is op een telefoon een pak duidelijker.
  const stickerBtn = document.createElement("a");
  stickerBtn.className = "btn btn--primary btn--sm";
  stickerBtn.href = `/kind.html?id=${encodeURIComponent(kind.id)}`;
  stickerBtn.textContent = "Stickers →";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn btn--outline btn--sm";
  editBtn.textContent = "Bewerken";
  editBtn.addEventListener("click", () => openKindForm(kind));

  actions.appendChild(stickerBtn);
  actions.appendChild(editBtn);
  li.appendChild(info);
  li.appendChild(actions);
  return li;
}

function bouwCijfers(kindId) {
  const rij = document.createElement("div");
  rij.className = "kind-item__cijfers";
  const cijfers = statistieken.get(kindId);

  const velden = [
    { label: "zoekt", waarde: cijfers ? cijfers.zoekt : null },
    { label: "dubbel", waarde: cijfers ? cijfers.dubbel : null },
    { label: "matches", waarde: cijfers ? cijfers.matches : null, klasse: "kind-item__cijfer--match" },
  ];

  velden.forEach((veld) => {
    const span = document.createElement("span");
    span.className = "kind-item__cijfer" + (veld.klasse ? " " + veld.klasse : "");
    span.textContent = `${veld.waarde === null ? "–" : veld.waarde} ${veld.label}`;
    rij.appendChild(span);
  });
  return rij;
}

// Eén RPC levert de tellers voor alle verzamelaars van deze ouder. Draait de
// migratie sql/006_kindproof.sql nog niet, dan bestaat de functie niet: dat
// mag het dashboard niet slopen, dus tonen we streepjes plus een hint.
async function laadStatistieken() {
  statistieken = new Map();
  const hint = document.getElementById("stats-hint");
  try {
    const { data, error } = await supabase.rpc("kind_statistieken");
    if (error) throw error;
    (data || []).forEach((rij) =>
      statistieken.set(rij.kind_id, {
        zoekt: rij.zoekt,
        dubbel: rij.dubbel,
        matches: rij.matches,
      })
    );
    hint.classList.add("hidden");
  } catch (err) {
    hint.textContent =
      "De cijfers per verzamelaar zijn nog niet beschikbaar — draai sql/006_kindproof.sql in Supabase.";
    hint.classList.remove("hidden");
  }
}

function wireOnboardingForm() {
  const form = document.getElementById("onboarding-form");
  const messageEl = document.getElementById("onboarding-message");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const voornaam = document.getElementById("ob-voornaam").value.trim();
    const familienaam = document.getElementById("ob-familienaam").value.trim();
    const geboortejaar = document.getElementById("ob-geboortejaar").value.trim();
    const isVolwassen = document.getElementById("ob-volwassen").checked;
    const validationError = validateKindInput(voornaam, familienaam, geboortejaar, isVolwassen);
    if (validationError) {
      showMessage(messageEl, validationError, "error");
      return;
    }
    const btn = document.getElementById("ob-submit-btn");
    btn.disabled = true;
    btn.textContent = "Opslaan…";
    try {
      await addKind(user.id, bouwPayload(voornaam, familienaam, geboortejaar, isVolwassen));
      form.reset();
      pasVolwassenToe("ob-volwassen", "ob-geboortejaar-groep", "ob-geboortejaar");
      await refreshKinderen();
    } catch (err) {
      showMessage(messageEl, "Fout bij opslaan: " + err.message, "error");
    }
    btn.disabled = false;
    btn.textContent = "Verzamelaar toevoegen";
  });
}

function wireKindForm() {
  const form = document.getElementById("kind-form");
  document.getElementById("kind-cancel-btn").addEventListener("click", closeKindForm);
  document.getElementById("kind-delete-btn").addEventListener("click", () => {
    const id = document.getElementById("kind-id").value;
    if (id) handleDeleteKind(id);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("kind-id").value;
    const voornaam = document.getElementById("kind-voornaam").value.trim();
    const familienaam = document.getElementById("kind-familienaam").value.trim();
    const geboortejaar = document.getElementById("kind-geboortejaar").value.trim();
    const isVolwassen = document.getElementById("kind-volwassen").checked;
    const messageEl = document.getElementById("kind-form-message");
    const validationError = validateKindInput(voornaam, familienaam, geboortejaar, isVolwassen);
    if (validationError) {
      showMessage(messageEl, validationError, "error");
      return;
    }
    const btn = document.getElementById("kind-save-btn");
    btn.disabled = true;
    btn.textContent = "Opslaan…";
    try {
      const payload = bouwPayload(voornaam, familienaam, geboortejaar, isVolwassen);
      if (id) {
        await updateKind(id, user.id, payload);
      } else {
        await addKind(user.id, payload);
      }
      closeKindForm();
      await refreshKinderen();
    } catch (err) {
      showMessage(messageEl, "Fout bij opslaan: " + err.message, "error");
    }
    btn.disabled = false;
    btn.textContent = "Opslaan";
  });
}

function bouwPayload(voornaam, familienaam, geboortejaar, isVolwassen) {
  return {
    voornaam,
    familienaam,
    geboortejaar: isVolwassen ? null : Number(geboortejaar),
    is_volwassen: isVolwassen,
  };
}

function openKindForm(kind) {
  const container = document.getElementById("kind-form-container");
  document.getElementById("kind-form-title").textContent = kind
    ? "Verzamelaar bewerken"
    : "Nieuwe verzamelaar";
  document.getElementById("kind-id").value = kind ? kind.id : "";
  document.getElementById("kind-voornaam").value = kind ? kind.voornaam : "";
  document.getElementById("kind-familienaam").value = kind ? kind.familienaam : "";
  document.getElementById("kind-geboortejaar").value = kind && kind.geboortejaar ? kind.geboortejaar : "";
  document.getElementById("kind-volwassen").checked = Boolean(kind && kind.is_volwassen);
  pasVolwassenToe("kind-volwassen", "kind-geboortejaar-groep", "kind-geboortejaar");

  // Verwijderen hoort niet tussen de dagelijkse knoppen; het staat hier,
  // achter één extra stap, en enkel wanneer je een bestaande rij bewerkt.
  document.getElementById("kind-delete-btn").classList.toggle("hidden", !kind);
  document.getElementById("kind-form-message").className = "message";

  container.classList.remove("hidden");
  container.scrollIntoView({ behavior: "smooth" });
}

function closeKindForm() {
  document.getElementById("kind-form-container").classList.add("hidden");
  document.getElementById("kind-form").reset();
  document.getElementById("kind-id").value = "";
  document.getElementById("kind-delete-btn").classList.add("hidden");
  pasVolwassenToe("kind-volwassen", "kind-geboortejaar-groep", "kind-geboortejaar");
}

async function handleDeleteKind(id) {
  const naam = document.getElementById("kind-voornaam").value.trim();
  if (!confirm(`${naam || "Deze verzamelaar"} en al zijn stickers verwijderen?`)) return;
  try {
    await deleteKind(id, user.id);
    closeKindForm();
    await refreshKinderen();
  } catch (err) {
    showMessage(document.getElementById("kind-form-message"), "Fout bij verwijderen: " + err.message, "error");
  }
}

function validateKindInput(voornaam, familienaam, geboortejaar, isVolwassen) {
  if (!voornaam || !familienaam) return "Voornaam en familienaam zijn verplicht.";
  if (isVolwassen) return null;
  if (!isValidGeboortejaar(geboortejaar)) return "Voer een geldig geboortejaar in.";
  return null;
}

function showMessage(el, text, type) {
  el.textContent = text;
  el.className = "message message--show message--" + type;
}
