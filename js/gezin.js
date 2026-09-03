// gezin.js — Ons gezin: twee volwassenen op dezelfde verzamelaars, en het
// gsm-nummer waarop andere gezinnen je tijdens de beurs mogen bereiken.
//
// Hoe de koppeling werkt: je zet hier naam en e-mailadres van de tweede
// volwassene klaar (public.nodig_volwassene_uit). Die persoon logt daarna
// gewoon in op dat adres — magic link of Google, dat maakt niet uit — en
// public.gezin_koppel_mij() hangt hem bij die eerste login aan het gezin.
// Er vertrekt dus geen aparte uitnodigingsmail vanuit het portaal.
//
// Wat de pagina toont is presentatie; wie wat mag, beslist RLS in sql/009.
import { supabase, requireAuth } from "./supabase.js";
import { normaliseerTelefoon, toonTelefoon, toonOrganisatorKnop } from "./whatsapp.js";

const MIGRATIE_HINT =
  "De gezinsfuncties bestaan nog niet in de database — draai sql/009_gezin_en_whatsapp.sql in Supabase.";

let user = null;
let gezin = null; // rij uit public.gezinnen, of null zolang er geen gezin is
let leden = [];
let uitnodigingen = [];

document.addEventListener("DOMContentLoaded", async () => {
  const paneel = document.getElementById("gezin-paneel");
  if (!paneel) return; // niet op gezin.html

  user = await requireAuth();
  if (!user) return;

  const loading = document.getElementById("gezin-loading");
  try {
    await koppelMij();
    await laadAlles();
  } catch (err) {
    loading.textContent = foutTekst(err);
    return;
  }

  loading.classList.add("hidden");
  paneel.classList.remove("hidden");
  teken();

  document.getElementById("uitnodig-form").addEventListener("submit", nodigUit);
  document.getElementById("naam-form").addEventListener("submit", bewaarNaam);
  document.getElementById("contact-form").addEventListener("submit", bewaarContact);
  toonOrganisatorKnop("organisator-knop", "💬 WhatsApp de organisator");
});

// ---------- laden ----------

// Bij elke lading: staat er een uitnodiging klaar op mijn adres, dan word ik
// hier lid. Dat gebeurt ook op het dashboard, zodat de tweede ouder na zijn
// eerste login meteen de juiste lijst ziet zonder hier langs te moeten.
async function koppelMij() {
  const { data, error } = await supabase.rpc("gezin_koppel_mij");
  if (error) throw error;
  const rij = Array.isArray(data) ? data[0] : data;
  if (rij && rij.melding) {
    toonMelding(document.getElementById("gezin-message"), rij.melding, rij.gekoppeld ? "success" : "error");
  }
}

async function laadAlles() {
  // Zit je in geen enkel gezin, dan geeft RLS hier nul rijen terug. Dat is geen
  // fout: het is de normale toestand van wie alleen werkt.
  const [ledenRes, gezinRes, uitnRes] = await Promise.all([
    supabase.from("gezin_leden").select("*").order("created_at", { ascending: true }),
    supabase.from("gezinnen").select("*").limit(1),
    supabase.from("gezin_uitnodigingen").select("*").order("created_at", { ascending: true }),
  ]);
  if (ledenRes.error) throw ledenRes.error;
  if (gezinRes.error) throw gezinRes.error;
  if (uitnRes.error) throw uitnRes.error;

  leden = ledenRes.data || [];
  gezin = (gezinRes.data || [])[0] || null;
  uitnodigingen = uitnRes.data || [];
}

// ---------- tekenen ----------

function teken() {
  tekenLeden();
  tekenUitnodigingen();
  vulNaamFormulier();
  vulContactFormulier();

  // Zolang er nog plaats is, blijft het formulier staan; anders zou je een
  // knop aanbieden die de database toch weigert.
  const vol = leden.length + uitnodigingen.length >= 2;
  document.getElementById("uitnodig-kaart").classList.toggle("hidden", vol);
  document.getElementById("uitnodig-vol").classList.toggle("hidden", !vol);
}

function tekenLeden() {
  const ul = document.getElementById("gezin-leden");
  ul.innerHTML = "";

  // Voor wie nog geen gezin heeft bestaat er geen rij in gezin_leden. Toon dan
  // toch jezelf: "wij met z'n tweeën" begint nu eenmaal bij jou alleen.
  const rijen = leden.length
    ? leden
    : [{ user_id: user.id, voornaam: "", familienaam: "", email: user.email }];

  rijen.forEach((lid) => {
    const li = document.createElement("li");
    li.className = "kind-item";

    const info = document.createElement("div");
    info.className = "kind-item__info";

    const naam = document.createElement("span");
    naam.className = "kind-item__name";
    naam.textContent = `${lid.voornaam} ${lid.familienaam}`.trim() || lid.email;
    info.appendChild(naam);

    if (lid.user_id === user.id) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = "jij";
      info.appendChild(chip);
    }

    const email = document.createElement("span");
    email.className = "kind-item__bij";
    email.textContent = lid.email;
    info.appendChild(email);

    li.appendChild(info);

    // Loskoppelen kan pas als er écht een gezin is (twee logins). Jezelf uit je
    // eigen eenmansgezin gooien is een knop zonder betekenis.
    if (leden.length > 1) {
      const acties = document.createElement("div");
      acties.className = "kind-item__actions";
      const knop = document.createElement("button");
      knop.type = "button";
      knop.className = "btn btn--link btn--verwijder";
      knop.textContent = lid.user_id === user.id ? "Gezin verlaten" : "Loskoppelen";
      knop.addEventListener("click", () => koppelLos(lid));
      acties.appendChild(knop);
      li.appendChild(acties);
    }

    ul.appendChild(li);
  });
}

function tekenUitnodigingen() {
  const ul = document.getElementById("gezin-uitnodigingen");
  const kaart = document.getElementById("uitnodigingen-kaart");
  ul.innerHTML = "";
  kaart.classList.toggle("hidden", uitnodigingen.length === 0);

  uitnodigingen.forEach((uitn) => {
    const li = document.createElement("li");
    li.className = "kind-item";

    const info = document.createElement("div");
    info.className = "kind-item__info";

    const naam = document.createElement("span");
    naam.className = "kind-item__name";
    naam.textContent = `${uitn.voornaam} ${uitn.familienaam}`.trim();
    info.appendChild(naam);

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "wacht op eerste login";
    info.appendChild(chip);

    const email = document.createElement("span");
    email.className = "kind-item__bij";
    email.textContent = uitn.email;
    info.appendChild(email);

    const acties = document.createElement("div");
    acties.className = "kind-item__actions";
    const knop = document.createElement("button");
    knop.type = "button";
    knop.className = "btn btn--link btn--verwijder";
    knop.textContent = "Intrekken";
    knop.addEventListener("click", () => trekIn(uitn));
    acties.appendChild(knop);

    li.appendChild(info);
    li.appendChild(acties);
    ul.appendChild(li);
  });
}

function vulNaamFormulier() {
  const ik = leden.find((l) => l.user_id === user.id);
  document.getElementById("naam-voornaam").value = ik ? ik.voornaam : "";
  document.getElementById("naam-familienaam").value = ik ? ik.familienaam : "";
  document.getElementById("naam-email").textContent = user.email;
}

function vulContactFormulier() {
  document.getElementById("contact-telefoon").value = gezin ? toonTelefoon(gezin.telefoon) : "";
  document.getElementById("contact-delen").checked = Boolean(gezin && gezin.telefoon_delen);
}

// ---------- acties ----------

async function nodigUit(e) {
  e.preventDefault();
  const messageEl = document.getElementById("uitnodig-message");
  const voornaam = document.getElementById("uitnodig-voornaam").value.trim();
  const familienaam = document.getElementById("uitnodig-familienaam").value.trim();
  const email = document.getElementById("uitnodig-email").value.trim().toLowerCase();

  if (!voornaam || !familienaam || !email) {
    toonMelding(messageEl, "Vul voornaam, familienaam en e-mailadres in.", "error");
    return;
  }

  const knop = document.getElementById("uitnodig-btn");
  knop.disabled = true;
  knop.textContent = "Toevoegen…";
  try {
    const { error } = await supabase.rpc("nodig_volwassene_uit", {
      p_voornaam: voornaam,
      p_familienaam: familienaam,
      p_email: email,
    });
    if (error) throw error;
    document.getElementById("uitnodig-form").reset();
    await laadAlles();
    teken();
    toonMelding(
      messageEl,
      `${voornaam} staat klaar. Zodra ${email} aanmeldt — met een magic link of met Google — ` +
        "komt die persoon automatisch bij dit gezin en ziet hij dezelfde verzamelaars.",
      "success"
    );
  } catch (err) {
    toonMelding(messageEl, foutTekst(err), "error");
  }
  knop.disabled = false;
  knop.textContent = "Volwassene toevoegen";
}

async function koppelLos(lid) {
  const wieBenIk = lid.user_id === user.id;
  const naam = `${lid.voornaam} ${lid.familienaam}`.trim() || lid.email;
  const vraag = wieBenIk
    ? "Dit gezin verlaten? Je ziet daarna enkel nog de verzamelaars die je zelf aanmaakte."
    : `${naam} loskoppelen? De verzamelaars die ${lid.voornaam || naam} zelf aanmaakte, ` +
      "verdwijnen dan uit jouw lijst — die blijven bij die persoon.";
  if (!confirm(vraag)) return;

  const messageEl = document.getElementById("gezin-message");
  try {
    const { error } = await supabase.from("gezin_leden").delete().eq("user_id", lid.user_id);
    if (error) throw error;
    if (wieBenIk) {
      window.location.href = "/dashboard.html";
      return;
    }
    await laadAlles();
    teken();
    toonMelding(messageEl, `${naam} is losgekoppeld.`, "success");
  } catch (err) {
    toonMelding(messageEl, foutTekst(err), "error");
  }
}

async function trekIn(uitn) {
  const messageEl = document.getElementById("gezin-message");
  try {
    const { error } = await supabase.from("gezin_uitnodigingen").delete().eq("id", uitn.id);
    if (error) throw error;
    await laadAlles();
    teken();
    toonMelding(messageEl, `De uitnodiging voor ${uitn.email} is ingetrokken.`, "success");
  } catch (err) {
    toonMelding(messageEl, foutTekst(err), "error");
  }
}

async function bewaarNaam(e) {
  e.preventDefault();
  const messageEl = document.getElementById("naam-message");
  const voornaam = document.getElementById("naam-voornaam").value.trim();
  const familienaam = document.getElementById("naam-familienaam").value.trim();

  const knop = document.getElementById("naam-btn");
  knop.disabled = true;
  knop.textContent = "Opslaan…";
  try {
    await verzekerGezin();
    const { error } = await supabase
      .from("gezin_leden")
      .update({ voornaam, familienaam })
      .eq("user_id", user.id);
    if (error) throw error;
    await laadAlles();
    teken();
    toonMelding(messageEl, "Opgeslagen.", "success");
  } catch (err) {
    toonMelding(messageEl, foutTekst(err), "error");
  }
  knop.disabled = false;
  knop.textContent = "Naam opslaan";
}

async function bewaarContact(e) {
  e.preventDefault();
  const messageEl = document.getElementById("contact-message");
  const invoer = document.getElementById("contact-telefoon").value.trim();
  const delen = document.getElementById("contact-delen").checked;

  // Leeg mag: dan bewaar je geen nummer. Onleesbaar niet — dan zou de database
  // het toch weigeren met een foutmelding waar niemand iets aan heeft.
  let telefoon = null;
  if (invoer) {
    telefoon = normaliseerTelefoon(invoer);
    if (!telefoon) {
      toonMelding(
        messageEl,
        "Dat nummer herken ik niet. Schrijf het als 0470 12 34 56 of +32 470 12 34 56.",
        "error"
      );
      return;
    }
  }
  if (!telefoon && delen) {
    toonMelding(messageEl, "Zonder nummer valt er niets te delen — vul eerst een gsm-nummer in.", "error");
    return;
  }

  const knop = document.getElementById("contact-btn");
  knop.disabled = true;
  knop.textContent = "Opslaan…";
  try {
    const gezinId = await verzekerGezin();
    const { error } = await supabase
      .from("gezinnen")
      .update({ telefoon, telefoon_delen: delen })
      .eq("id", gezinId);
    if (error) throw error;
    await laadAlles();
    teken();
    toonMelding(messageEl, "Opgeslagen.", "success");
  } catch (err) {
    toonMelding(messageEl, foutTekst(err), "error");
  }
  knop.disabled = false;
  knop.textContent = "Opslaan";
}

// Een gezin bestaat pas zodra iemand het nodig heeft. Deze RPC maakt het aan
// als het er nog niet is, en geeft anders gewoon het bestaande id terug.
async function verzekerGezin() {
  const { data, error } = await supabase.rpc("gezin_verzeker");
  if (error) throw error;
  return data;
}

// ---------- klein ----------

function foutTekst(err) {
  const bericht = err && err.message ? err.message : String(err);
  // 42883 = function does not exist, 42P01 = relation does not exist
  if (err && (err.code === "42883" || err.code === "42P01")) return MIGRATIE_HINT;
  if (/does not exist|schema cache/i.test(bericht)) return MIGRATIE_HINT + " (" + bericht + ")";
  return bericht;
}

function toonMelding(el, tekst, type) {
  if (!el) return;
  el.textContent = tekst;
  el.className = "message message--show message--" + type;
}
