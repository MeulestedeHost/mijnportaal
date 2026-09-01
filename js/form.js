// form.js — Formulier logica (opslaan, bewerken, verwijderen)
import { supabase, requireAuth } from "./supabase.js";

const TABLE = "formulieren";
let formContainer, dataForm, formTitle, formMessageEl, lastModifiedEl;

document.addEventListener("DOMContentLoaded", async () => {
  formContainer = document.getElementById("form-container");
  if (!formContainer) return;
  dataForm = document.getElementById("data-form");
  formTitle = document.getElementById("form-title");
  formMessageEl = document.getElementById("form-message");
  lastModifiedEl = document.getElementById("last-modified");
  dataForm.addEventListener("submit", handleSave);
  document.getElementById("cancel-btn").addEventListener("click", closeForm);
  document.getElementById("new-form-btn").addEventListener("click", () => openNewForm());
  const emptyNewBtn = document.getElementById("empty-new-btn");
  if (emptyNewBtn) emptyNewBtn.addEventListener("click", () => openNewForm());
});

export function openNewForm() {
  formTitle.textContent = "Nieuw formulier";
  dataForm.reset();
  document.getElementById("form-id").value = "";
  lastModifiedEl.textContent = "";
  formContainer.classList.remove("hidden");
  formContainer.scrollIntoView({ behavior: "smooth" });
}

export function openEditForm(record) {
  formTitle.textContent = "Formulier bewerken";
  document.getElementById("form-id").value = record.id;
  document.getElementById("voornaam").value = record.voornaam || "";
  document.getElementById("naam").value = record.naam || "";
  document.getElementById("form-email").value = record.email || "";
  document.getElementById("telefoon").value = record.telefoon || "";
  document.getElementById("opmerkingen").value = record.opmerkingen || "";
  if (record.datum_laatste_wijziging) lastModifiedEl.textContent = "Laatst gewijzigd: " + formatDate(record.datum_laatste_wijziging);
  formContainer.classList.remove("hidden");
  formContainer.scrollIntoView({ behavior: "smooth" });
}

export function closeForm() {
  formContainer.classList.add("hidden");
  dataForm.reset();
  document.getElementById("form-id").value = "";
  lastModifiedEl.textContent = "";
}

async function handleSave(e) {
  e.preventDefault();
  const saveBtn = document.getElementById("save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Opslaan…";
  formMessageEl.className = "message";
  const user = await requireAuth();
  if (!user) return;
  const id = document.getElementById("form-id").value;
  const voornaam = document.getElementById("voornaam").value.trim();
  const naam = document.getElementById("naam").value.trim();
  const email = document.getElementById("form-email").value.trim().toLowerCase();
  const telefoon = document.getElementById("telefoon").value.trim();
  const opmerkingen = document.getElementById("opmerkingen").value.trim();
  if (!voornaam || !naam) { showFormMessage("Voornaam en naam zijn verplicht.", "error"); saveBtn.disabled = false; saveBtn.textContent = "Opslaan"; return; }
  if (!isValidEmail(email)) { showFormMessage("Voer een geldig e-mailadres in.", "error"); saveBtn.disabled = false; saveBtn.textContent = "Opslaan"; return; }
  if (telefoon && !isValidPhone(telefoon)) { showFormMessage("Voer een geldig telefoonnummer in.", "error"); saveBtn.disabled = false; saveBtn.textContent = "Opslaan"; return; }
  const payload = { voornaam: sanitize(voornaam), naam: sanitize(naam), email, telefoon: sanitize(telefoon), opmerkingen: sanitize(opmerkingen), datum_laatste_wijziging: new Date().toISOString() };
  try {
    if (id) {
      const { error } = await supabase.from(TABLE).update(payload).eq("id", id).eq("user_id", user.id);
      if (error) throw error;
      showFormMessage("Formulier bijgewerkt!", "success");
    } else {
      payload.user_id = user.id;
      const { error } = await supabase.from(TABLE).insert(payload);
      if (error) throw error;
      showFormMessage("Formulier opgeslagen!", "success");
    }
    setTimeout(() => { closeForm(); window.dispatchEvent(new CustomEvent("forms:reload")); }, 800);
  } catch (err) { showFormMessage("Fout bij opslaan: " + err.message, "error"); }
  saveBtn.disabled = false;
  saveBtn.textContent = "Opslaan";
}

export async function deleteForm(id) {
  const user = await requireAuth();
  if (!user) return;
  if (!confirm("Weet je zeker dat je dit formulier wilt verwijderen?")) return;
  try {
    const { error } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    window.dispatchEvent(new CustomEvent("forms:reload"));
  } catch (err) { alert("Fout bij verwijderen: " + err.message); }
}

function showFormMessage(text, type) { formMessageEl.textContent = text; formMessageEl.className = "message message--show message--" + type; }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function isValidPhone(phone) { return /^[+]?[\d\s\-()]{6,20}$/.test(phone); }
function sanitize(str) { if (!str) return ""; const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }
function formatDate(isoString) { const d = new Date(isoString); return d.toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }