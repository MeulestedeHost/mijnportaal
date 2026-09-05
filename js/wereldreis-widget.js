// wereldreis-widget.js — het blokje onderaan het dashboard
//
// Een mini-wereldkaart, het aantal voltooide landen, een voortgangsbalk en een
// knop naar de grote kaart. Meer niet: het dashboard gaat over je verzamelaars,
// de wereldreis heeft een eigen pagina.
//
// De widget staat los van js/dashboard.js en hangt zichzelf aan het dashboard
// vast. Zo blijft dashboard.js over onboarding en verzamelaars gaan, en kan de
// wereldreis in fase 2 en 3 groeien zonder dat bestand te raken. Gaat er iets
// mis — de migratie sql/010 nog niet gedraaid, Leaflet niet geladen — dan
// verdwijnt de widget geruisloos in plaats van het dashboard mee te slepen.
import { loadKinderen } from "./kinderen.js";
import {
  laadLanden,
  samenvatting,
  maakKaart,
  tekenLanden,
  balk,
  bewaarKeuze,
  leesKeuze,
} from "./wereldreis.js";

let kaart;
let stippenLaag;
let kinderen = [];

document.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("wr-widget");
  if (!widget) return; // niet op dashboard.html
  start(widget);
});

async function start(widget) {
  // Het dashboard toont eerst het onboardingscherm en pas daarna de lijst; de
  // widget hoort bij de lijst. Wachten tot #main-dashboard zichtbaar is, is
  // eenvoudiger dan js/dashboard.js een signaal te laten sturen.
  const dashboard = document.getElementById("main-dashboard");
  if (!(await wachtOpDashboard(dashboard))) return;

  if (typeof L === "undefined") return; // Leaflet niet geladen: geen widget

  try {
    kinderen = await loadKinderen();
  } catch (err) {
    return;
  }
  if (kinderen.length === 0) return;

  vulKiezer();
  widget.classList.remove("hidden");
  kaart = maakKaart(document.getElementById("wr-widget-kaart"), { mini: true });

  const kiezer = document.getElementById("wr-widget-kind");
  kiezer.addEventListener("change", () => {
    bewaarKeuze(kiezer.value);
    ververs(kiezer.value);
  });

  await ververs(kiezer.value);
}

// #main-dashboard begint verborgen en krijgt zijn klasse pas weg als de
// verzamelaars geladen zijn. Twintig seconden is ruim; daarna is er toch iets
// anders mis en hoort de widget niet te blijven wachten.
function wachtOpDashboard(dashboard) {
  return new Promise((klaar) => {
    if (!dashboard) return klaar(false);
    if (!dashboard.classList.contains("hidden")) return klaar(true);

    const kijker = new MutationObserver(() => {
      if (!dashboard.classList.contains("hidden")) {
        kijker.disconnect();
        clearTimeout(afbreken);
        klaar(true);
      }
    });
    kijker.observe(dashboard, { attributes: true, attributeFilter: ["class"] });

    const afbreken = setTimeout(() => {
      kijker.disconnect();
      klaar(false);
    }, 20000);
  });
}

function vulKiezer() {
  const kiezer = document.getElementById("wr-widget-kind");
  kiezer.innerHTML = "";
  kinderen
    .slice()
    .sort((a, b) => Number(a.is_volwassen) - Number(b.is_volwassen))
    .forEach((kind) => {
      const optie = document.createElement("option");
      optie.value = kind.id;
      optie.textContent = kind.voornaam;
      kiezer.appendChild(optie);
    });

  const gekozen = leesKeuze(kinderen);
  kiezer.value = gekozen;
  bewaarKeuze(gekozen);
  // Bij één verzamelaar valt er niets te kiezen; de naam staat dan al in de
  // knop eronder.
  kiezer.classList.toggle("hidden", kinderen.length < 2);
}

async function ververs(kindId) {
  let landen;
  try {
    landen = await laadLanden(kindId);
  } catch (err) {
    // sql/010_wereldreis.sql nog niet gedraaid: het dashboard hoort daar niet
    // op te blokkeren, dus de widget verdwijnt gewoon weer.
    document.getElementById("wr-widget").classList.add("hidden");
    return;
  }

  const s = samenvatting(landen);
  document.getElementById("wr-widget-voltooid").textContent = `${s.voltooid} / ${s.landen}`;
  document.getElementById("wr-widget-stickers").textContent =
    `${s.stickersHeeft} van de ${s.stickersTotaal} stickers · ${s.procent} %`;

  const balkvak = document.getElementById("wr-widget-balk");
  balkvak.innerHTML = "";
  balkvak.appendChild(balk(s.procent));

  const knop = document.getElementById("wr-widget-knop");
  knop.href = `/wereldreis.html?kind=${encodeURIComponent(kindId)}`;

  if (stippenLaag) stippenLaag.remove();
  stippenLaag = tekenLanden(kaart, landen, { mini: true });
  // De kaart is aangemaakt terwijl het dashboard nog aan het schuiven was;
  // invalidateSize laat Leaflet zijn container opnieuw opmeten.
  kaart.invalidateSize();
}
