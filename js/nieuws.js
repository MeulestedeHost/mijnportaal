// nieuws.js — de deelknoppen onder elk nieuwsbericht op de startpagina.
//
// De berichten zelf staan gewoon in index.html: dit bestand voegt er enkel de
// rij "Delen op Facebook / WhatsApp / X / mail / link kopiëren" aan toe. Zo
// blijft een nieuw bericht toevoegen één blok HTML kopiëren — de deelknoppen
// komen vanzelf mee, en er valt geen enkele lange, met de hand ge-encodeerde
// deel-URL fout te typen.
//
// Staat JavaScript uit, dan blijft de balk leeg (.nieuws-item__delen:empty is
// verborgen in de CSS) en mist er niets wezenlijks aan het bericht.

// Bewust de echte domeinnaam en niet location.origin: wie de pagina lokaal of
// via een Cloudflare-previewlink bekijkt en op "delen" klikt, moet nog altijd
// een werkende link naar de live site doorsturen.
const SITE = "https://panini.meulestede.gent";

// De iconen staan hier als kale SVG-paden in plaats van als losse bestanden:
// het zijn er vijf, ze veranderen nooit, en zo hoeft de browser er geen vijf
// extra requests voor te doen.
const ICONEN = {
  facebook:
    "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  whatsapp:
    "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z",
  x: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  mail:
    "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
  link:
    "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
};

function maakIcoon(naam) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const pad = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pad.setAttribute("d", ICONEN[naam]);
  svg.appendChild(pad);
  return svg;
}

// Het zichtbare label ("Facebook") en het label voor een schermlezer verschillen
// bewust: op een smal scherm verbergt de CSS het zichtbare woord, en dan blijft
// er zonder aria-label enkel een naamloze knop over.
function maakKnop(tag, { klasse, icoon, label, toegankelijkLabel, href }) {
  const el = document.createElement(tag);
  el.className = `deelknop deelknop--${klasse}`;
  el.setAttribute("aria-label", toegankelijkLabel);
  if (tag === "a") {
    el.href = href;
    el.target = "_blank";
    el.rel = "noopener noreferrer";
  } else {
    el.type = "button";
  }
  el.appendChild(maakIcoon(icoon));
  const tekst = document.createElement("span");
  tekst.className = "deelknop__label";
  tekst.textContent = label;
  el.appendChild(tekst);
  return el;
}

function vulDeelbalk(artikel) {
  const balk = artikel.querySelector(".nieuws-item__delen");
  if (!balk) return;

  // Elk bericht heeft een eigen id, zodat een gedeelde link niet zomaar op de
  // startpagina uitkomt maar op dít bericht.
  const link = `${SITE}/#${artikel.id}`;
  const titel = artikel.dataset.deelTitel || document.title;
  const l = encodeURIComponent(link);
  const t = encodeURIComponent(titel);
  const beide = encodeURIComponent(`${titel} — ${link}`);

  const label = document.createElement("span");
  label.className = "nieuws-item__delen-label";
  label.textContent = "Delen:";
  balk.appendChild(label);

  balk.appendChild(maakKnop("a", {
    klasse: "facebook", icoon: "facebook", label: "Facebook",
    toegankelijkLabel: `Deel "${titel}" op Facebook`,
    href: `https://www.facebook.com/sharer/sharer.php?u=${l}`,
  }));
  balk.appendChild(maakKnop("a", {
    klasse: "whatsapp", icoon: "whatsapp", label: "WhatsApp",
    toegankelijkLabel: `Deel "${titel}" via WhatsApp`,
    href: `https://wa.me/?text=${beide}`,
  }));
  balk.appendChild(maakKnop("a", {
    klasse: "x", icoon: "x", label: "X",
    toegankelijkLabel: `Deel "${titel}" op X`,
    href: `https://twitter.com/intent/tweet?text=${t}&url=${l}`,
  }));
  balk.appendChild(maakKnop("a", {
    klasse: "mail", icoon: "mail", label: "E-mail",
    toegankelijkLabel: `Deel "${titel}" via e-mail`,
    href: `mailto:?subject=${t}&body=${beide}`,
  }));

  const kopieer = maakKnop("button", {
    klasse: "kopieer", icoon: "link", label: "Kopieer link",
    toegankelijkLabel: `Kopieer de link naar "${titel}"`,
  });
  kopieer.addEventListener("click", () => kopieerLink(kopieer, link));
  balk.appendChild(kopieer);
}

async function kopieerLink(knop, link) {
  const labelEl = knop.querySelector(".deelknop__label");
  const origineel = labelEl.textContent;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    // navigator.clipboard bestaat niet op http:// en in oudere browsers. Dan de
    // link selecteren in een tijdelijk veld, zodat de ouder hem alsnog met
    // Ctrl+C mee heeft in plaats van een knop die niets doet.
    const veld = document.createElement("input");
    veld.value = link;
    veld.setAttribute("readonly", "");
    veld.style.position = "fixed";
    veld.style.opacity = "0";
    document.body.appendChild(veld);
    veld.select();
    try {
      document.execCommand("copy");
    } catch {
      /* Niets meer aan te doen; de knop meldt hieronder gewoon niets. */
    }
    veld.remove();
  }
  labelEl.textContent = "Gekopieerd!";
  knop.classList.add("deelknop--gekopieerd");
  setTimeout(() => {
    labelEl.textContent = origineel;
    knop.classList.remove("deelknop--gekopieerd");
  }, 2000);
}

document.querySelectorAll(".nieuws-item").forEach(vulDeelbalk);
