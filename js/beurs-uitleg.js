// beurs-uitleg.js — het aantal dagen in de uitleg op de startpagina.
//
// De startpagina draait zonder login. public.events en public.instellingen zijn
// afgeschermd voor de anon-sleutel, dus haalt dit bestand zijn gegevens uit
// public.beurs_info() (sql/025): naam, datum, fase en het aantal dagen dat de
// aanwezigheidsfilter vooraf aangaat. Geen enkel gegeven over een deelnemer.
//
// WAAROM DIT DYNAMISCH IS. Het getal staat op de beheerpagina en kan naar 7, 21
// of 30 gaan. Stond het hier als tekst, dan belooft de startpagina vroeg of laat
// iets anders dan het portaal doet — en dat is precies het soort verschil dat
// een ouder pas op de beursdag ontdekt.
//
// De HTML bevat al de standaardwaarde (14). Lukt de oproep niet — sql/025 nog
// niet gedraaid, of geen netwerk — dan blijft die staan en klopt de zin nog
// steeds.
import { supabase } from "./supabase.js";

document.addEventListener("DOMContentLoaded", async () => {
  const dagenEl = document.getElementById("beurs-filter-dagen");
  if (!dagenEl) return; // niet op de startpagina

  try {
    const { data, error } = await supabase.rpc("beurs_info");
    if (error) throw error;
    const rij = Array.isArray(data) ? data[0] : data;
    if (rij && rij.filter_dagen_vooraf) dagenEl.textContent = String(rij.filter_dagen_vooraf);
  } catch (err) {
    /* standaardwaarde uit de HTML blijft staan */
  }
});
