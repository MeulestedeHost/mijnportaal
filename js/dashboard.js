// dashboard.js — Dashboard: welkomstbericht, onboarding wizard, verzamelaarslijst
//
// Een "verzamelaar" is een rij in public.kinderen. Volwassenen staan in
// dezelfde tabel met is_volwassen = true en zonder geboortejaar: ze ruilen
// op precies dezelfde manier mee.
//
// De lijst is van het GEZIN, niet van één login: sinds sql/009 kunnen twee
// ouders op dezelfde verzamelaars werken. Wie wat ziet, beslist RLS.
import { requireAuth, supabase } from "./supabase.js";
import { loadKinderen, addKind, updateKind, deleteKind, isValidGeboortejaar } from "./kinderen.js";
import { toonOrganisatorKnop } from "./whatsapp.js";
import { haalKomendeEvents, datumVoluit, uur } from "./beurs.js";

let user;
let statistieken = new Map(); // kind_id -> { zoekt, dubbel, matches }
let aanwezigheid = new Map(); // "event_id|kind_id" -> true zolang "wij komen"

document.addEventListener("DOMContentLoaded", async () => {
  const onboarding = document.getElementById("onboarding");
  if (!onboarding) return; // niet op dashboard.html

  user = await requireAuth();
  if (!user) return;

  const emailEl = document.getElementById("user-email");
  if (emailEl) emailEl.textContent = user.email;

  await koppelAanGezin();

  wireOnboardingForm();
  wireKindForm();
  wireVolwassenVinkjes();
  document.getElementById("new-kind-btn").addEventListener("click", () => openKindForm());

  toonBeheerLink();
  toonOrganisatorKnop("organisator-knop", "💬 WhatsApp de organisator");
  await refreshKinderen();
});

// De tweede ouder wordt aan het gezin gekoppeld bij zijn eerste login: staat er
// een uitnodiging klaar op zijn adres, dan hangt deze RPC hem eraan. Ze draait
// bij elke lading van het dashboard, want daar kom je hoe dan ook langs — of je
// nu met een magic link of met Google inlogde. Bestaat de functie nog niet
// (sql/009 niet gedraaid), dan gebeurt er eenvoudigweg niets.
async function koppelAanGezin() {
  try {
    const { data, error } = await supabase.rpc("gezin_koppel_mij");
    if (error) throw error;
    const rij = Array.isArray(data) ? data[0] : data;
    if (rij && rij.melding) {
      const hint = document.getElementById("gezin-hint");
      hint.textContent = rij.gekoppeld
        ? rij.melding + " Je ziet nu de verzamelaars van het hele gezin."
        : rij.melding;
      hint.className = "message message--show message--" + (rij.gekoppeld ? "success" : "error");
    }
  } catch (err) {
    /* sql/009 nog niet gedraaid — het dashboard werkt gewoon zoals vroeger */
  }
}

// De link verbergen is gemak, geen beveiliging: instellingen.html controleert
// het recht opnieuw en RLS weigert hoe dan ook elke schrijfpoging.
async function toonBeheerLink() {
  try {
    const { data, error } = await supabase.rpc("is_beheerder");
    if (error) throw error;
    if (data) {
      document.getElementById("beheer-link").classList.remove("hidden");
      document.getElementById("aanwezig-link").classList.remove("hidden");
    }
  } catch (err) {
    /* functie bestaat nog niet (sql/007) — link blijft gewoon verborgen */
  }
}

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
  if (vinkjeId === "ob-volwassen") {
    document.getElementById("ob-submit-btn").textContent = onboardingKnopTekst();
  }
}

// Het onboardingformulier gaat over een kind: dat is het normale geval, en de
// knop zegt dat ook. Vinkt iemand toch "volwassene" aan — een ouder die zelf
// meespaart, of een kind dat zich zonder ouder aanmeldde — dan verandert het
// opschrift mee, zodat de knop nooit iets anders belooft dan hij doet.
function onboardingKnopTekst() {
  return document.getElementById("ob-volwassen").checked
    ? "Volwassene toevoegen"
    : "Kind toevoegen";
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
    kinderen = await loadKinderen();
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
  const gesorteerd = kinderen
    .slice()
    .sort((a, b) => Number(a.is_volwassen) - Number(b.is_volwassen));
  gesorteerd.forEach((kind) => kinderenUl.appendChild(bouwKindRij(kind)));

  // Los van de rest: staat sql/025 er nog niet, dan blijft het blok verborgen
  // en merkt het dashboard er niets van.
  void toonAanwezigheid(gesorteerd);
}

// ---------- komt je verzamelaar mee? ----------

// WAAROM DIT HIER STAAT EN NIET OP DE RUILPAGINA. Het is een gegeven van de
// verzamelaar, geen ruilhandeling — en dit is de enige pagina waar je al je
// verzamelaars naast elkaar ziet. Eén vinkje per kind per beurs.
//
// De keuze telt pas echt vanaf filter_dagen_vooraf dagen voor de beurs
// (sql/025); daarvoor verandert er voor niemand iets. Dat staat er ook bij:
// een vinkje waarvan je niet weet wat het doet, zet je niet.
async function toonAanwezigheid(kinderen) {
  const blok = document.getElementById("aanwezig-blok");
  if (!blok) return;

  const events = await haalKomendeEvents();
  if (!events.length) return;

  await laadAanwezigheid(events);

  const uitleg = document.getElementById("aanwezig-uitleg");
  uitleg.textContent =
    "Duid aan wie er meegaat. In de aanloop naar de beurs zien andere " +
    "verzamelaars enkel wie aangeduid heeft dat hij komt — en zie jij enkel hen.";

  const houder = document.getElementById("aanwezig-events");
  houder.textContent = "";
  events.forEach((ev) => houder.appendChild(bouwEventBlok(ev, kinderen)));
  blok.classList.remove("hidden");
}

async function laadAanwezigheid(events) {
  aanwezigheid = new Map();
  try {
    const { data, error } = await supabase
      .from("aanwezigheden")
      .select("event_id,kind_id,komt")
      .in("event_id", events.map((e) => e.id));
    if (error) throw error;
    (data || []).forEach((rij) => {
      if (rij.komt) aanwezigheid.set(`${rij.event_id}|${rij.kind_id}`, true);
    });
  } catch (err) {
    /* nog geen tabel (sql/025) of niets aangeduid — alles staat gewoon uit */
  }
}

function bouwEventBlok(ev, kinderen) {
  const groep = document.createElement("div");
  groep.className = "aanwezig-event";

  const titel = document.createElement("h3");
  titel.className = "aanwezig-event__titel";
  titel.textContent = `${ev.naam} — ${datumVoluit(ev.start)}, ${uur(ev.start)}–${uur(ev.einde)}`;
  groep.appendChild(titel);

  const lijst = document.createElement("ul");
  lijst.className = "aanwezig-lijst";
  kinderen.forEach((kind) => lijst.appendChild(bouwAanwezigRij(ev, kind)));
  groep.appendChild(lijst);
  return groep;
}

function bouwAanwezigRij(ev, kind) {
  const li = document.createElement("li");
  const label = document.createElement("label");
  label.className = "checkbox-rij";

  const vinkje = document.createElement("input");
  vinkje.type = "checkbox";
  vinkje.checked = aanwezigheid.has(`${ev.id}|${kind.id}`);
  vinkje.addEventListener("change", () => zetAanwezigheid(ev, kind, vinkje));

  const tekst = document.createElement("span");
  tekst.textContent = `${kind.voornaam} ${kind.familienaam} komt mee`;

  label.append(vinkje, tekst);
  li.appendChild(label);
  return li;
}

// Het vinkje gaat meteen naar de databank: een aparte opslaan-knop op een
// lijstje vinkjes is precies het soort knop dat niemand indrukt.
async function zetAanwezigheid(ev, kind, vinkje) {
  const melding = document.getElementById("aanwezig-message");
  const aan = vinkje.checked;
  vinkje.disabled = true;
  try {
    const { error } = await supabase.rpc("aanwezigheid_zetten", {
      p_kind_id: kind.id,
      p_event_id: ev.id,
      p_komt: aan,
    });
    if (error) throw error;
    if (aan) aanwezigheid.set(`${ev.id}|${kind.id}`, true);
    else aanwezigheid.delete(`${ev.id}|${kind.id}`);
    melding.textContent = aan
      ? `${kind.voornaam} staat genoteerd voor ${ev.naam}.`
      : `${kind.voornaam} staat niet meer genoteerd voor ${ev.naam}.`;
    melding.className = "message message--show message--success";
  } catch (err) {
    vinkje.checked = !aan; // terug naar wat de databank effectief weet
    melding.textContent = "Kon dit niet bewaren: " + err.message;
    melding.className = "message message--show message--error";
  } finally {
    vinkje.disabled = false;
  }
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
    btn.textContent = onboardingKnopTekst();
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
        await updateKind(id, payload);
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
    await deleteKind(id);
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
