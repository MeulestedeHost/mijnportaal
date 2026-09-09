// landcombo.js — de landkeuze waarin je kan typen.
//
// WAAROM GEEN <select> MEER. De keuzelijst op de stickerpagina telt vijftig
// landen. Een gewone <select> heeft daar wel een ingebouwde type-ahead voor,
// maar die kan enkel op de eerste letters van het zichtbare label — dus op de
// landcode, want die staat vooraan ("BEL - BELGIUM - België"). Wie "Duitsland"
// of "Germany" typt, komt bij een <select> nergens uit, en filteren terwijl de
// lijst openstaat kan een browser niet: opties toevoegen of weghalen klapt het
// venster dicht. Daarom een eigen keuzelijst volgens het ARIA-patroon
// "select only combobox": een knop met role="combobox" en een <ul>
// role="listbox" eronder. Zonder muis werkt ze identiek — pijltjes, Enter,
// Escape, Tab.
//
// TYPEN. Zodra de lijst openstaat (of zelfs zodra de knop focus heeft) begint
// typen te zoeken. Losse letters worden aan elkaar geplakt zolang ze binnen
// TYPEPAUZE_MS na elkaar komen; een langere pauze start een nieuwe zoekterm.
// Dat is hoe een <select> zich altijd al gedroeg — enkel zoekt deze op de
// code, de Engelse naam, de Nederlandse naam én het paginanummer tegelijk.
// De term staat zichtbaar boven de lijst, want een filter die je niet ziet
// staan, voelt als een lijst die dingen kwijt is.
//
// SORTEREN DOET DE OPROEPER. zetLanden() krijgt de lijst in de volgorde waarin
// ze getoond moet worden en filteren behoudt die volgorde altijd — zoeken mag
// de door de gebruiker ingestelde sorteervolgorde nooit omgooien.
import { landLabel, normaliseer, landMatchtMetPagina } from "./landen-data.js";

// Hoe lang losse aanslagen bij dezelfde zoekterm horen. Duizend milliseconden
// is de klassieke waarde uit de type-ahead van een keuzelijst: lang genoeg om
// "duits" uit te typen zonder haast, kort genoeg om na een denkpauze opnieuw
// te beginnen in plaats van door te bouwen op iets wat je vergeten was.
const TYPEPAUZE_MS = 1000;

// Bouwt de keuzelijst op bestaande markup: een .landcombo met daarin de knop,
// het paneel, de <ul> en de twee tekstregels. Geeft een handvat terug waarmee
// de pagina de landen aanlevert en de keuze uitleest of zet.
//
// opKies wordt enkel aangeroepen bij een keuze van de GEBRUIKER. zetWaarde()
// blijft stil: die is er voor de pagina zelf (een zoekresultaat aanklikken,
// een wijziging ongedaan maken) en die weet zelf al wat er daarna moet volgen.
export function maakLandcombo({ wortel, opKies, leegLabel = "Kies een land…" }) {
  const knop = wortel.querySelector(".landcombo__knop");
  const waardeEl = wortel.querySelector(".landcombo__waarde");
  const paneel = wortel.querySelector(".landcombo__paneel");
  const lijst = wortel.querySelector(".landcombo__lijst");
  const leegEl = wortel.querySelector(".landcombo__leeg");
  const statusEl = wortel.querySelector(".landcombo__status");

  let landen = []; // in de volgorde die de oproeper aanleverde
  let zichtbaar = []; // wat er na het filteren van overblijft
  let gekozen = "";
  let actief = -1; // index in zichtbaar; -1 = niets aangeduid
  let term = "";
  let laatsteAanslag = 0;
  let staatOpen = false;

  function optieId(code) {
    return `${wortel.id}-optie-${code}`;
  }

  function landVoorCode(code) {
    return landen.find((l) => l.land_code === code) || null;
  }

  // ---------- tekenen ----------

  function toonWaarde() {
    const land = landVoorCode(gekozen);
    waardeEl.textContent = land ? landLabel(land, { pagina: true }) : leegLabel;
    waardeEl.classList.toggle("landcombo__waarde--leeg", !land);
  }

  function tekenLijst() {
    lijst.innerHTML = "";
    zichtbaar.forEach((land) => {
      const optie = document.createElement("li");
      optie.className = "landcombo__optie";
      optie.id = optieId(land.land_code);
      optie.setAttribute("role", "option");
      optie.setAttribute("aria-selected", String(land.land_code === gekozen));
      optie.dataset.code = land.land_code;
      // Met paginanummer, want dat is precies waar deze lijst voor dient:
      // het land terugvinden in het album dat naast de computer openligt.
      optie.textContent = landLabel(land, { pagina: true });
      lijst.appendChild(optie);
    });

    leegEl.classList.toggle("hidden", zichtbaar.length > 0);
    statusEl.textContent = term
      ? `“${term}” — ${zichtbaar.length} van ${landen.length} landen`
      : `${landen.length} landen — typ om te zoeken op code, naam of paginanummer`;
  }

  // Verplaatst de aanduiding. Buiten de lijst wijzen kan niet: we klemmen af
  // in plaats van rond te lopen, zodat pijltje-omlaag onderaan niet stilletjes
  // weer bovenaan begint.
  function zetActief(index) {
    if (zichtbaar.length === 0) {
      actief = -1;
      knop.removeAttribute("aria-activedescendant");
      return;
    }
    actief = Math.min(Math.max(index, 0), zichtbaar.length - 1);
    [...lijst.children].forEach((el, i) =>
      el.classList.toggle("landcombo__optie--actief", i === actief)
    );
    const el = lijst.children[actief];
    if (!el) return;
    knop.setAttribute("aria-activedescendant", el.id);
    el.scrollIntoView({ block: "nearest" });
  }

  // Filteren behoudt de aangeleverde volgorde: we gooien er enkel uit, we
  // sorteren nooit opnieuw.
  function filter() {
    const gezocht = normaliseer(term.trim());
    zichtbaar = gezocht ? landen.filter((land) => landMatchtMetPagina(land, gezocht)) : landen.slice();
    tekenLijst();
    if (gezocht) {
      // De eerste treffer staat meteen klaar. Blijft er maar één land over,
      // dan is dat dus het aangeduide en volstaat Enter.
      zetActief(0);
    } else {
      const bij = zichtbaar.findIndex((land) => land.land_code === gekozen);
      zetActief(bij === -1 ? 0 : bij);
    }
  }

  // ---------- openen, sluiten, kiezen ----------

  function openen() {
    if (staatOpen) return;
    staatOpen = true;
    paneel.classList.remove("hidden");
    knop.setAttribute("aria-expanded", "true");
    term = "";
    filter();
  }

  function sluiten({ focusKnop = true } = {}) {
    if (!staatOpen) return;
    staatOpen = false;
    paneel.classList.add("hidden");
    knop.setAttribute("aria-expanded", "false");
    knop.removeAttribute("aria-activedescendant");
    term = "";
    if (focusKnop) knop.focus();
  }

  function kies(code, { focusKnop = true } = {}) {
    const veranderd = code !== gekozen;
    gekozen = code;
    toonWaarde();
    sluiten({ focusKnop });
    if (veranderd && opKies) opKies(code);
  }

  function kiesActief(opties) {
    if (actief < 0 || !zichtbaar[actief]) return;
    kies(zichtbaar[actief].land_code, opties);
  }

  // ---------- typen ----------

  // Aanslagen binnen TYPEPAUZE_MS horen bij dezelfde zoekterm; daarna begint
  // er een nieuwe. De klok loopt vanaf de vorige aanslag, niet vanaf het
  // openen: wie traag typt maar doorgaat, bouwt gewoon verder.
  function typLetter(letter) {
    const nu = Date.now();
    if (nu - laatsteAanslag > TYPEPAUZE_MS) term = "";
    laatsteAanslag = nu;
    term += letter;
    filter();
  }

  function isTekenToets(e) {
    return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  }

  // ---------- gebeurtenissen ----------

  knop.addEventListener("click", () => {
    if (staatOpen) sluiten();
    else openen();
  });

  knop.addEventListener("keydown", (e) => {
    if (!staatOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openen();
        return;
      }
      // Meteen beginnen typen zonder eerst te openen: de lijst springt open
      // met de eerste letter er al in verwerkt.
      if (isTekenToets(e)) {
        e.preventDefault();
        openen();
        typLetter(e.key);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        zetActief(actief + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        zetActief(actief - 1);
        break;
      case "Home":
        e.preventDefault();
        zetActief(0);
        break;
      case "End":
        e.preventDefault();
        zetActief(zichtbaar.length - 1);
        break;
      case "PageDown":
        e.preventDefault();
        zetActief(actief + 10);
        break;
      case "PageUp":
        e.preventDefault();
        zetActief(actief - 10);
        break;
      case "Enter":
        e.preventDefault();
        kiesActief();
        break;
      case "Escape":
        e.preventDefault();
        sluiten();
        break;
      case "Tab":
        // Niet tegenhouden: Tab neemt het aangeduide land mee en laat de focus
        // gewoon doorlopen naar het volgende veld, zoals bij een <select>.
        kiesActief({ focusKnop: false });
        break;
      case "Backspace":
        e.preventDefault();
        term = term.slice(0, -1);
        laatsteAanslag = Date.now();
        filter();
        break;
      case " ":
        e.preventDefault();
        // Een spatie hoort bij de zoekterm zodra er al iets staat ("new z"),
        // en kiest pas als er niets getypt is.
        if (term) typLetter(" ");
        else kiesActief();
        break;
      default:
        if (isTekenToets(e)) {
          e.preventDefault();
          typLetter(e.key);
        }
    }
  });

  // De <li>'s zijn niet focusbaar, maar een muisklik erop haalt de focus wel
  // van de knop af — en dan zou focusout hieronder het paneel sluiten vóór de
  // klik aankomt. preventDefault op mousedown houdt de focus waar hij hoort.
  lijst.addEventListener("mousedown", (e) => e.preventDefault());

  lijst.addEventListener("click", (e) => {
    const optie = e.target.closest(".landcombo__optie");
    if (optie) kies(optie.dataset.code);
  });

  // Wegklikken of wegtabben sluit. relatedTarget is het element dat de focus
  // krijgt; blijft dat binnen de combo, dan is er niets aan de hand.
  wortel.addEventListener("focusout", (e) => {
    if (!wortel.contains(e.relatedTarget)) sluiten({ focusKnop: false });
  });
  document.addEventListener("pointerdown", (e) => {
    if (!wortel.contains(e.target)) sluiten({ focusKnop: false });
  });

  toonWaarde();

  return {
    // De landen in de volgorde waarin ze getoond moeten worden. Opnieuw
    // aanleveren (na een andere sortering) laat de keuze ongemoeid.
    zetLanden(nieuwe) {
      landen = nieuwe;
      toonWaarde();
      if (staatOpen) filter();
      else zichtbaar = landen.slice();
    },
    waarde() {
      return gekozen;
    },
    // Stil: geen opKies. Voor de pagina zelf, die zelf weet wat er volgt.
    zetWaarde(code) {
      gekozen = code || "";
      toonWaarde();
    },
    focus() {
      knop.focus();
    },
  };
}
