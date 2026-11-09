// versie.js — het versienummer van de site, onderaan elke pagina.
//
// WAAROM HIER EN NIET UIT version.json. Dat bestand (commit, bouwtijd) bestaat
// enkel na een Cloudflare-build en staat alleen op Instellingen, voor
// beheerders. Dit nummer staat voor iedereen in de voettekst en wordt met de
// hand opgehoogd bij elke wijziging aan de site: wie "het werkt niet" meldt,
// kan zo zeggen welke versie hij ziet — en wij zien meteen of een browser nog
// een oude pagina uit zijn cache haalt.
//
// De regels om het op te hogen staan in CLAUDE.md ("Versienummer").
export const VERSIE = "1.5.1";
export const VERSIE_DATUM = "2026-11-09";

document.addEventListener("DOMContentLoaded", () => {
  const regel = document.querySelector("footer.footer p");
  if (!regel) return;
  const span = document.createElement("span");
  span.className = "versie";
  const datum = new Intl.DateTimeFormat("nl-BE").format(new Date(VERSIE_DATUM));
  span.textContent = ` — versie ${VERSIE} (${datum})`;
  regel.appendChild(span);
});
