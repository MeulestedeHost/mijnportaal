// ruilen.js — Ruilpagina: alle ruilkansen van alle verzamelaars van deze
// ouder op één rij, met de kolom "Contacteren".
//
// Wat je van een ánder gezin te zien krijgt, en wanneer — de database bepaalt
// dat, niet dit bestand:
//   ALTIJD             — de voornaam, en de wijk of gemeente als dat gezin ze
//                        invulde. Ook al vóór de beurs, zodat buren elkaar
//                        meteen vinden en niet tot de beursdag hoeven te
//                        wachten (sql/015).
//   NA het beursvenster — daarbovenop het e-mailadres (van iedereen) en het
//                        WhatsApp-nummer als dat gezin koos om het te delen
//                        (vinkje op gezin.html) — sql/014.
// get_matches geeft ander_email/ander_whatsapp buiten hun fase gewoon niet
// terug; wat hier gebeurt is dus presentatie, geen beveiliging.
import { supabase, requireAuth } from "./supabase.js";
import { loadKinderen } from "./kinderen.js";
import { whatsappKnop, toonOrganisatorKnop } from "./whatsapp.js";
import { landLabel, accentVoor } from "./landen-data.js";

const RICHTING = {
  jij_zoekt: { tekst: "zoekt deze", klasse: "richting--zoekt" },
  jij_hebt_dubbel: { tekst: "heeft deze dubbel", klasse: "richting--dubbel" },
};

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
    el.className = "ruil-venster ruil-venster--open";
    el.textContent = `De ruilbeurs begint op ${opmaak.format(start)} en sluit om ${uur.format(
      einde
    )}. Je ziet nu al de voornaam — en de wijk, als die is ingevuld — van wie elke sticker heeft: woon je in dezelfde buurt, dan kan je nu al onderling ruilen. E-mail en WhatsApp komen erbij zodra de beurs voorbij is.`;
  } else if (nu < einde) {
    el.className = "ruil-venster ruil-venster--open";
    el.textContent = `De ruilbeurs is bezig — nog tot ${uur.format(
      einde
    )}. Je ziet de voornaam en de wijk van wie elke sticker heeft; e-mail en WhatsApp komen erbij zodra de beurs voorbij is.`;
  } else {
    el.className = "ruil-venster ruil-venster--open";
    el.textContent = `De ruilbeurs van ${opmaak.format(
      start
    )} is voorbij, maar ruilen kan gewoon verder: je ziet nu ook het e-mailadres (en eventueel WhatsApp) van wie je nog kan ruilen.`;
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
  // ×N enkel tonen als het er meer dan één is: "×1" leert niemand iets bij.
  const suffix = rij.aantal > 1 ? ` ×${rij.aantal}` : "";
  sticker.textContent = (rij.sticker_naam ? `${rij.code} — ${rij.sticker_naam}` : rij.code) + suffix;
  tr.appendChild(sticker);

  // De vaste notatie, met een streepje in de landkleur ervoor: in een lange
  // tabel is dat sneller te scannen dan de tekst alleen.
  const land = document.createElement("td");
  land.className = "land-cel";
  const streep = document.createElement("span");
  streep.className = "land-streep";
  streep.style.backgroundColor = accentVoor(rij.land_code);
  land.appendChild(streep);
  land.appendChild(document.createTextNode(landLabel(rij)));
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

  td.className = "contact contact--open";
  const naam = document.createElement("span");
  // De wijk staat tussen haakjes achter de naam: zo zie je in één oogopslag of
  // dit een buur is (samen af te spreken, nu al) of iemand van verder (dan is
  // de beurs zelf het moment). Niet elk gezin vult ze in — dan enkel de naam.
  naam.textContent = rij.ander_wijk ? `${rij.ander_kind} (${rij.ander_wijk})` : rij.ander_kind;
  td.appendChild(naam);

  if (rij.ander_email) {
    const mail = document.createElement("a");
    mail.className = "btn btn--outline btn--sm";
    mail.href = mailtoLink(rij.ander_email, kind, rij);
    mail.textContent = "✉️ E-mail";
    td.appendChild(mail);
  }

  // Deelt dat gezin zijn nummer, dan hoeft niemand te zoeken. Het bericht is
  // vooraf ingevuld: wie er schrijft, over welke sticker het gaat en welke
  // kant de ruil op moet. Zo begint het gesprek niet bij "hallo, wie ben jij?".
  const knop = whatsappKnop(rij.ander_whatsapp, ruilBericht(kind, rij), "💬 WhatsApp");
  if (knop) td.appendChild(knop);
  return td;
}

function mailtoLink(email, kind, rij) {
  const onderwerp = encodeURIComponent("Panini-ruil via het Ruilportaal Meulestede");
  const body = encodeURIComponent(ruilBericht(kind, rij));
  return `mailto:${email}?subject=${onderwerp}&body=${body}`;
}

function ruilBericht(kind, rij) {
  const sticker = rij.sticker_naam ? `${rij.code} — ${rij.sticker_naam}` : rij.code;
  const aantal = rij.aantal > 1 ? ` (${rij.aantal} exemplaren)` : "";
  const zin =
    rij.richting === "jij_zoekt"
      ? `${kind.voornaam} zoekt ${sticker}, en ${rij.ander_kind} heeft die dubbel${aantal}`
      : `${kind.voornaam} heeft ${sticker} dubbel${aantal}, en ${rij.ander_kind} zoekt die`;
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
