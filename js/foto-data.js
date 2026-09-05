// foto-data.js — FIFA Wereldreis, fase 3: fotogegevens per land
//
// GEEN STATISCH BESTAND, WEL EEN TABEL. In tegenstelling tot voetbal-data.js,
// land-data.js en talen-data.js staat de inhoud hier niet in code, maar in de
// Supabase-tabel public.land_fotos (zie sql/011_wereldreis_fotos.sql). Reden:
// de opdracht vraagt uitdrukkelijk dat er later foto's bij kunnen zonder
// codewijziging. Een JS-bestand zou telkens een nieuwe deploy vragen; een
// tabelrij niet. De echte bestanden staan niet in de databank maar in
// Cloudflare R2 — de tabel bewaart enkel metadata en de volledige publieke URL
// naar dat bestand.
//
// LAZY. Deze functie wordt pas aangeroepen op het moment dat een kind het
// fotopaneel van een land ook echt opent (zie vulFotoPopup() in
// js/wereldreis.js) — niet wanneer de kaart laadt. Een cache per land_code
// voorkomt dat een tweede keer openen van hetzelfde land opnieuw een
// netwerkaanvraag doet; er wordt de belofte zelf gecachet (niet enkel het
// resultaat), zodat twee snel na elkaar geopende popups voor hetzelfde land
// niet allebei hun eigen aanvraag sturen.
import { supabase } from "./supabase.js";

const cache = new Map();

export async function laadFotos(landCode) {
  if (cache.has(landCode)) return cache.get(landCode);

  const belofte = supabase
    .from("land_fotos")
    .select("foto_url, titel, alt_tekst, volgorde")
    .eq("land_code", landCode)
    .order("volgorde")
    .then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    });

  cache.set(landCode, belofte);
  try {
    return await belofte;
  } catch (err) {
    cache.delete(landCode); // een mislukte poging mag opnieuw geprobeerd worden
    throw err;
  }
}
