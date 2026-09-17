// hoe-gevonden.js — de keuzelijst achter "Hoe heb je ons gevonden?" (sql/026).
//
// Staat apart omdat twee pagina's ze nodig hebben en ze het nooit oneens mogen
// zijn: gezin.html stelt de vraag, aanwezigheden.html telt de antwoorden. Eén
// lijst, één spelling.
//
// De sleutels staan in de check-constraint op public.gezinnen.hoe_gevonden
// (sql/026, uitgebreid met 'whatsapp' in migratie 027). Komt er een keuze bij,
// dan hoort ze op allebei de plaatsen bij te komen — anders weigert de databank
// het antwoord.
//
// De volgorde is die van de onboarding: de kanalen waarlangs de meeste mensen
// binnenkomen eerst, 'andere' altijd laatst.
export const HOE_GEVONDEN = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["whatsapp", "WhatsApp"],
  ["mond_tot_mond", "Mond-tot-mond"],
  ["vrienden_familie", "Vrienden of familie"],
  ["affiche", "Affiche"],
  ["school", "School"],
  ["website_vzw", "Website vzw Meulestede"],
  ["vorige_ruilbeurs", "Vorige ruilbeurs"],
  ["andere", "Andere"],
];

// De sleutel waarbij een vrij tekstveld hoort.
export const ANDERE = "andere";

export function opschrift(sleutel) {
  const rij = HOE_GEVONDEN.find(([k]) => k === sleutel);
  return rij ? rij[1] : "Niet ingevuld";
}
