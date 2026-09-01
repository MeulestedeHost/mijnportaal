// dashboard.js — Overzichtspagina: laden, tonen, bewerken
import { supabase, requireAuth } from "./supabase.js";
import { openEditForm, deleteForm } from "./form.js";

const TABLE = "formulieren";

document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("forms-tbody");
  if (!tbody) return;
  const user = await requireAuth();
  if (!user) return;
  await loadForms();
  window.addEventListener("forms:reload", loadForms);
});

async function loadForms() {
  const loading = document.getElementById("loading");
  const emptyState = document.getElementById("empty-state");
  const tableWrapper = document.getElementById("table-wrapper");
  const tbody = document.getElementById("forms-tbody");
  loading.classList.remove("hidden");
  emptyState.classList.add("hidden");
  tableWrapper.classList.add("hidden");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  try {
    const { data, error } = await supabase.from(TABLE).select("*").eq("user_id", user.id).order("datum_laatste_wijziging", { ascending: false });
    if (error) throw error;
    loading.classList.add("hidden");
    if (!data || data.length === 0) { emptyState.classList.remove("hidden"); return; }
    tbody.innerHTML = "";
    data.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(row.voornaam));
      tr.appendChild(createCell(row.naam));
      tr.appendChild(createCell(row.email));
      tr.appendChild(createCell(row.telefoon || "—"));
      tr.appendChild(createCell(formatDate(row.datum_laatste_wijziging)));
      const actionsTd = document.createElement("td");
      actionsTd.className = "actions-cell";
      const editBtn = document.createElement("button");
      editBtn.className = "btn btn--outline btn--sm";
      editBtn.textContent = "Bewerk";
      editBtn.addEventListener("click", () => openEditForm(row));
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn--danger btn--sm";
      delBtn.textContent = "Verwijder";
      delBtn.addEventListener("click", () => deleteForm(row.id));
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(delBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
    tableWrapper.classList.remove("hidden");
  } catch (err) { loading.textContent = "Fout bij laden: " + err.message; }
}

function createCell(text) { const td = document.createElement("td"); td.textContent = text || "—"; return td; }
function formatDate(isoString) { if (!isoString) return "—"; const d = new Date(isoString); return d.toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }