// dashboard.js — Dashboard: welkomstbericht, onboarding wizard, kinderenlijst
import { requireAuth } from "./supabase.js";
import { loadKinderen, addKind, updateKind, deleteKind, isValidGeboortejaar } from "./kinderen.js";

let user;

document.addEventListener("DOMContentLoaded", async () => {
  const onboarding = document.getElementById("onboarding");
  if (!onboarding) return; // niet op dashboard.html

  user = await requireAuth();
  if (!user) return;

  const emailEl = document.getElementById("user-email");
  if (emailEl) emailEl.textContent = user.email;

  wireOnboardingForm();
  wireKindForm();
  document.getElementById("new-kind-btn").addEventListener("click", () => openKindForm());

  await refreshKinderen();
});

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

  loading.classList.add("hidden");

  if (kinderen.length === 0) {
    onboarding.classList.remove("hidden");
    return;
  }

  mainDashboard.classList.remove("hidden");
  kinderen.forEach((kind) => {
    const li = document.createElement("li");
    li.className = "kind-item";

    const link = document.createElement("a");
    link.href = `/kind.html?id=${encodeURIComponent(kind.id)}`;
    link.textContent = `${kind.voornaam} ${kind.familienaam}`;
    link.className = "kind-item__name";

    const actions = document.createElement("div");
    actions.className = "kind-item__actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn btn--outline btn--sm";
    editBtn.textContent = "Kind bewerken";
    editBtn.addEventListener("click", () => openKindForm(kind));

    const delBtn = document.createElement("button");
    delBtn.className = "btn btn--danger btn--sm";
    delBtn.textContent = "Kind verwijderen";
    delBtn.addEventListener("click", () => handleDeleteKind(kind.id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    li.appendChild(link);
    li.appendChild(actions);
    kinderenUl.appendChild(li);
  });
}

function wireOnboardingForm() {
  const form = document.getElementById("onboarding-form");
  const messageEl = document.getElementById("onboarding-message");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const voornaam = document.getElementById("ob-voornaam").value.trim();
    const familienaam = document.getElementById("ob-familienaam").value.trim();
    const geboortejaar = document.getElementById("ob-geboortejaar").value.trim();
    const validationError = validateKindInput(voornaam, familienaam, geboortejaar);
    if (validationError) {
      showMessage(messageEl, validationError, "error");
      return;
    }
    const btn = document.getElementById("ob-submit-btn");
    btn.disabled = true;
    btn.textContent = "Opslaan…";
    try {
      await addKind(user.id, { voornaam, familienaam, geboortejaar: Number(geboortejaar) });
      form.reset();
      await refreshKinderen();
    } catch (err) {
      showMessage(messageEl, "Fout bij opslaan: " + err.message, "error");
    }
    btn.disabled = false;
    btn.textContent = "Kind toevoegen";
  });
}

function wireKindForm() {
  const form = document.getElementById("kind-form");
  document.getElementById("kind-cancel-btn").addEventListener("click", closeKindForm);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("kind-id").value;
    const voornaam = document.getElementById("kind-voornaam").value.trim();
    const familienaam = document.getElementById("kind-familienaam").value.trim();
    const geboortejaar = document.getElementById("kind-geboortejaar").value.trim();
    const messageEl = document.getElementById("kind-form-message");
    const validationError = validateKindInput(voornaam, familienaam, geboortejaar);
    if (validationError) {
      showMessage(messageEl, validationError, "error");
      return;
    }
    const btn = document.getElementById("kind-save-btn");
    btn.disabled = true;
    btn.textContent = "Opslaan…";
    try {
      const payload = { voornaam, familienaam, geboortejaar: Number(geboortejaar) };
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

function openKindForm(kind) {
  const container = document.getElementById("kind-form-container");
  document.getElementById("kind-form-title").textContent = kind ? "Kind bewerken" : "Nieuw kind";
  document.getElementById("kind-id").value = kind ? kind.id : "";
  document.getElementById("kind-voornaam").value = kind ? kind.voornaam : "";
  document.getElementById("kind-familienaam").value = kind ? kind.familienaam : "";
  document.getElementById("kind-geboortejaar").value = kind ? kind.geboortejaar : "";
  container.classList.remove("hidden");
  container.scrollIntoView({ behavior: "smooth" });
}

function closeKindForm() {
  document.getElementById("kind-form-container").classList.add("hidden");
  document.getElementById("kind-form").reset();
  document.getElementById("kind-id").value = "";
}

async function handleDeleteKind(id) {
  if (!confirm("Weet je zeker dat je dit kind (en alle bijhorende stickers) wilt verwijderen?")) return;
  try {
    await deleteKind(id, user.id);
    await refreshKinderen();
  } catch (err) {
    alert("Fout bij verwijderen: " + err.message);
  }
}

function validateKindInput(voornaam, familienaam, geboortejaar) {
  if (!voornaam || !familienaam) return "Voornaam en familienaam zijn verplicht.";
  if (!isValidGeboortejaar(geboortejaar)) return "Voer een geldig geboortejaar in.";
  return null;
}

function showMessage(el, text, type) {
  el.textContent = text;
  el.className = "message message--show message--" + type;
}
