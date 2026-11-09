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

// De komende ruilmomenten in het CC Meulestede (migratie 033): enkel datum,
// uur en plaats, net als beurs_info() geen enkel gegeven over een deelnemer.
// Zonder momenten (of zonder 033) blijft de lijst leeg en zegt de kaart
// gewoon wat een ruilmoment is.
const momentDatum = new Intl.DateTimeFormat("nl-BE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
const momentUur = new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });

document.addEventListener("DOMContentLoaded", async () => {
  const lijst = document.getElementById("ruilmomenten-lijst");
  if (!lijst) return;
  try {
    const { data, error } = await supabase.rpc("ruilmomenten_info");
    if (error) throw error;
    (data || []).forEach((m) => {
      const li = document.createElement("li");
      li.textContent = `📅 ${momentDatum.format(new Date(m.start))}–${momentUur.format(new Date(m.einde))}` + (m.opmerking ? ` (${m.opmerking})` : "");
      lijst.appendChild(li);
    });
  } catch {
    /* geen momenten of 033 nog niet gedraaid */
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  // Een klasse en geen id: het getal staat zowel in de uitleg over de
  // ruilbeursmodus als in een ouder nieuwsbericht, en die moeten hetzelfde zeggen.
  const dagenEls = document.querySelectorAll(".beurs-filter-dagen");
  if (!dagenEls.length) return; // niet op de startpagina

  try {
    const { data, error } = await supabase.rpc("beurs_info");
    if (error) throw error;
    const rij = Array.isArray(data) ? data[0] : data;
    if (rij && rij.filter_dagen_vooraf) {
      for (const el of dagenEls) el.textContent = String(rij.filter_dagen_vooraf);
    }
  } catch (err) {
    /* standaardwaarde uit de HTML blijft staan */
  }
});
