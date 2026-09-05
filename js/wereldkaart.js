// wereldkaart.js — wereldreis.html: de grote kaart
//
// Eén verzamelaar tegelijk. Wie dat is, staat in de keuzelijst rechtsboven en
// wordt onthouden (localStorage), zodat de widget op het dashboard en deze
// pagina naar hetzelfde kind kijken. Wisselen van verzamelaar hertekent enkel
// de stippenlaag — de kaart zelf, de tegels en het zoomniveau blijven staan,
// zodat je niet telkens opnieuw naar Europa moet scrollen.
import { requireAuth } from "./supabase.js";
import { loadKinderen } from "./kinderen.js";
import {
  laadLanden,
  samenvatting,
  maakKaart,
  tekenLanden,
  balk,
  trapVoor,
  LEGENDE,
  LAGEN,
  bewaarKeuze,
  leesKeuze,
} from "./wereldreis.js";

let kaart;
let stippenLaag;
let kinderen = [];

document.addEventListener("DOMContentLoaded", async () => {
  const paneel = document.getElementById("wr-paneel");
  if (!paneel) return; // niet op wereldreis.html

  const user = await requireAuth();
  if (!user) return;

  try {
    kinderen = await loadKinderen();
  } catch (err) {
    toonFout("De verzamelaars konden niet geladen worden: " + err.message);
    return;
  }

  if (kinderen.length === 0) {
    toonFout(
      "Je hebt nog geen verzamelaars. Voeg er eerst een toe op het dashboard, dan begint de wereldreis."
    );
    return;
  }

  vulKiezer();
  tekenLegende();

  // De kaart pas aanmaken wanneer het paneel zichtbaar is: Leaflet meet de
  // hoogte van zijn container bij het opstarten, en een verborgen div is nul
  // pixels hoog.
  document.getElementById("wr-loading").classList.add("hidden");
  paneel.classList.remove("hidden");
  kaart = maakKaart(document.getElementById("wr-kaart"));

  const kiezer = document.getElementById("wr-kind");
  kiezer.addEventListener("change", () => {
    bewaarKeuze(kiezer.value);
    toon(kiezer.value);
  });

  await toon(kiezer.value);
});

// De keuzelijst verdwijnt niet bij één verzamelaar — hij toont dan gewoon die
// ene naam. Een lijst die soms wel en soms niet bestaat, maakt de pagina
// onvoorspelbaar voor wie er een tweede kind bij krijgt.
function vulKiezer() {
  const kiezer = document.getElementById("wr-kind");
  kiezer.innerHTML = "";
  kinderen
    .slice()
    .sort((a, b) => Number(a.is_volwassen) - Number(b.is_volwassen))
    .forEach((kind) => {
      const optie = document.createElement("option");
      optie.value = kind.id;
      optie.textContent = `${kind.voornaam} ${kind.familienaam}`;
      kiezer.appendChild(optie);
    });

  // ?kind=… wint van wat er onthouden was: zo kan je een rechtstreekse link
  // naar de kaart van één verzamelaar delen.
  const uitUrl = new URLSearchParams(window.location.search).get("kind");
  const gekozen = kinderen.some((k) => k.id === uitUrl) ? uitUrl : leesKeuze(kinderen);
  kiezer.value = gekozen;
  bewaarKeuze(gekozen);
}

async function toon(kindId) {
  let landen;
  try {
    landen = await laadLanden(kindId);
  } catch (err) {
    toonFout(
      "De wereldreis kon niet geladen worden — draai sql/010_wereldreis.sql in Supabase. (" +
        err.message +
        ")"
    );
    return;
  }
  verbergFout();

  const s = samenvatting(landen);
  toonCijfers(s);
  toonVoortgang(s);
  toonBuitenKaart(landen);

  if (stippenLaag) stippenLaag.remove();
  stippenLaag = tekenLanden(kaart, landen);
}

function toonCijfers(s) {
  zet("wr-ontdekt", `${s.ontdekt} / ${s.landen}`);
  zet("wr-stickers", `${s.stickersHeeft} / ${s.stickersTotaal}`);
  zet("wr-gezocht", String(s.gezocht));
  zet("wr-dubbel", String(s.dubbel));
}

function toonVoortgang(s) {
  const vak = document.getElementById("wr-voortgang");
  vak.innerHTML = "";
  vak.appendChild(balk(s.procent));

  const regel = document.createElement("p");
  regel.className = "form-meta wr-voortgang__tekst";

  // Wie nog niets aanduidde, staat overal op 100 %. Dat is geen fout maar het
  // gevolg van "we registreren enkel wat je zoekt en wat je dubbel hebt" — en
  // zonder deze zin leest het scherm als een leugen.
  if (s.gezocht === 0 && s.dubbel === 0) {
    regel.textContent =
      "Je hebt nog niets aangeduid, dus staat alles op 100 %. Zet op de stickerpagina van deze verzamelaar aan wat hij nog zoekt — de kaart kleurt dan meteen mee.";
  } else {
    regel.textContent = `${s.procent} % van het album verzameld — ${s.ontdekt} van de ${s.landen} landen is compleet.`;
  }
  vak.appendChild(regel);
}

// PANINI en FWC horen bij geen land en staan dus niet op de kaart. Ze weglaten
// zou de tellers laten kloppen noch de verzamelaar; hier krijgen ze een eigen
// regeltje met dezelfde kleurcode als de stippen.
function toonBuitenKaart(landen) {
  const ul = document.getElementById("wr-buiten-kaart");
  ul.innerHTML = "";
  const buiten = landen.filter((l) => !l.opKaart);

  if (buiten.length === 0) {
    const leeg = document.createElement("li");
    leeg.className = "sticker-item sticker-item--empty";
    leeg.textContent = "Niets — elke sticker hoort bij een land.";
    ul.appendChild(leeg);
    return;
  }

  buiten.forEach((rij) => {
    const li = document.createElement("li");
    li.className = "sticker-item";

    const naam = document.createElement("span");
    naam.className = "sticker-item__nummer";
    naam.textContent = rij.land_naam;

    const cijfer = document.createElement("span");
    cijfer.className = "kind-item__cijfer " + trapVoor(rij.procent).klasse + " wr-tegel";
    cijfer.textContent = `${rij.heeft} van ${rij.totaal} · ${rij.procent} %`;

    li.appendChild(naam);
    li.appendChild(cijfer);
    ul.appendChild(li);
  });
}

function tekenLegende() {
  const vak = document.getElementById("wr-legende");
  vak.innerHTML = "";
  LEGENDE.forEach((trap) => {
    const item = document.createElement("span");
    item.className = "wr-legende__item";

    const stip = document.createElement("span");
    stip.className = "wr-stip wr-stip--stickers " + trap.klasse;

    const tekst = document.createElement("span");
    tekst.textContent = `${trap.bereik} — ${trap.label}`;

    item.appendChild(stip);
    item.appendChild(tekst);
    vak.appendChild(item);
  });

  // De uitleg bij de drie stippen per land. Ze komt uit dezelfde lijst als de
  // stippen zelf, zodat fase 2 en 3 hier niets moeten bijschrijven.
  const uitleg = document.getElementById("wr-stiplegende");
  uitleg.textContent =
    "Elk land heeft drie stippen: " +
    LAGEN.map((l) => (l.actief ? l.label : `${l.label} (fase ${l.fase})`)).join(", ") +
    ". Op een telefoon blijft enkel de stickerstip staan — anders liggen ze op elkaar.";
}

function zet(id, tekst) {
  document.getElementById(id).textContent = tekst;
}

function toonFout(tekst) {
  document.getElementById("wr-loading").classList.add("hidden");
  const el = document.getElementById("wr-fout");
  el.textContent = tekst;
  el.className = "message message--show message--error";
}

function verbergFout() {
  document.getElementById("wr-fout").className = "message";
}
