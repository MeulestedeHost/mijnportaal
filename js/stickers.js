// stickers.js — Kinddetail-pagina: kindgegevens tonen + stickers beheren
// (HEEFT / ZOEKT / RUILT) voor één kind.
import { supabase, requireAuth } from "./supabase.js";
import { getKind } from "./kinderen.js";

const TABLE = "stickers";
const STATUSSEN = ["HEEFT", "ZOEKT", "RUILT"];

let kindId;

document.addEventListener("DOMContentLoaded", async () => {
  const stickerForm = document.getElementById("sticker-form");
  if (!stickerForm) return;

  const user = await requireAuth();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  kindId = params.get("id");
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
    stickerForm.classList.add("hidden");
    return;
  }

  stickerForm.addEventListener("submit", handleStickerSubmit);
  document.getElementById("sticker-cancel-btn").addEventListener("click", resetStickerForm);

  await refreshStickers();
});

async function refreshStickers() {
  const messageEl = document.getElementById("sticker-message");
  let stickers;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("kind_id", kindId)
      .order("nummer", { ascending: true });
    if (error) throw error;
    stickers = data || [];
  } catch (err) {
    showMessage(messageEl, "Fout bij laden: " + err.message, "error");
    return;
  }

  renderList("zoekt-list", stickers.filter((s) => s.status === "ZOEKT"));
  renderList("ruilt-list", stickers.filter((s) => s.status === "RUILT"));
  renderList("heeft-list", stickers.filter((s) => s.status === "HEEFT"));
}

function renderList(listId, stickers) {
  const ul = document.getElementById(listId);
  ul.innerHTML = "";
  if (stickers.length === 0) {
    const li = document.createElement("li");
    li.className = "sticker-item sticker-item--empty";
    li.textContent = "Geen stickers.";
    ul.appendChild(li);
    return;
  }
  stickers.forEach((sticker) => {
    const li = document.createElement("li");
    li.className = "sticker-item";

    const nummerSpan = document.createElement("span");
    nummerSpan.className = "sticker-item__nummer";
    nummerSpan.textContent = sticker.nummer;

    const actions = document.createElement("div");
    actions.className = "sticker-item__actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn btn--outline btn--sm";
    editBtn.textContent = "Wijzig";
    editBtn.addEventListener("click", () => openEditSticker(sticker));

    const delBtn = document.createElement("button");
    delBtn.className = "btn btn--danger btn--sm";
    delBtn.textContent = "Verwijder";
    delBtn.addEventListener("click", () => handleDeleteSticker(sticker.id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    li.appendChild(nummerSpan);
    li.appendChild(actions);
    ul.appendChild(li);
  });
}

function openEditSticker(sticker) {
  document.getElementById("sticker-id").value = sticker.id;
  document.getElementById("sticker-nummer").value = sticker.nummer;
  document.getElementById("sticker-status").value = sticker.status;
  document.getElementById("sticker-submit-btn").textContent = "Wijziging opslaan";
  document.getElementById("sticker-form").scrollIntoView({ behavior: "smooth" });
}

function resetStickerForm() {
  document.getElementById("sticker-form").reset();
  document.getElementById("sticker-id").value = "";
  document.getElementById("sticker-submit-btn").textContent = "Toevoegen";
}

async function handleStickerSubmit(e) {
  e.preventDefault();
  const messageEl = document.getElementById("sticker-message");
  const id = document.getElementById("sticker-id").value;
  const nummer = document.getElementById("sticker-nummer").value.trim();
  const status = document.getElementById("sticker-status").value;

  if (!isValidNummer(nummer)) {
    showMessage(messageEl, "Voer een geldig stickernummer in (letters/cijfers, max 20 tekens).", "error");
    return;
  }
  if (!STATUSSEN.includes(status)) {
    showMessage(messageEl, "Kies een geldige status.", "error");
    return;
  }

  const btn = document.getElementById("sticker-submit-btn");
  btn.disabled = true;
  try {
    if (id) {
      const { error } = await supabase.from(TABLE).update({ nummer, status }).eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from(TABLE).insert({ kind_id: kindId, nummer, status });
      if (error) throw error;
    }
    resetStickerForm();
    await refreshStickers();
  } catch (err) {
    showMessage(messageEl, "Fout bij opslaan: " + err.message, "error");
  }
  btn.disabled = false;
}

async function handleDeleteSticker(id) {
  if (!confirm("Deze sticker verwijderen?")) return;
  try {
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (error) throw error;
    await refreshStickers();
  } catch (err) {
    alert("Fout bij verwijderen: " + err.message);
  }
}

function isValidNummer(nummer) {
  return /^[A-Za-z0-9-]{1,20}$/.test(nummer);
}
function showMessage(el, text, type) {
  el.textContent = text;
  el.className = "message message--show message--" + type;
}
