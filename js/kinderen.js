// kinderen.js — CRUD voor kinderen (verzamelaars) van het ingelogde gezin
//
// Sinds sql/009 hoort een verzamelaar niet meer bij één login maar bij een
// gezin: twee ouders kunnen dezelfde lijst zien en bewerken. Daarom filtert
// dit bestand niet langer zelf op user_id. Dat filter zou nu te streng zijn —
// het zou de verzamelaars van je partner wegfilteren — én het gaf schijn-
// veiligheid: wat je mag zien en wijzigen, beslist RLS in de database.
import { supabase } from "./supabase.js";

const TABLE = "kinderen";

export async function loadKinderen() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getKind(id) {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

// Toevoegen gebeurt wél onder je eigen login: kinderen.user_id blijft wijzen
// naar wie de verzamelaar aanmaakte. Bij het verbreken van een koppeling gaat
// die verzamelaar met die persoon mee.
export async function addKind(userId, payload) {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...payload, user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateKind(id, payload) {
  const { error } = await supabase.from(TABLE).update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteKind(id) {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}

export function isValidGeboortejaar(jaar) {
  const n = Number(jaar);
  const huidigJaar = new Date().getFullYear();
  return Number.isInteger(n) && n >= 1900 && n <= huidigJaar;
}

// Drie formulieren vragen dezelfde vier velden: de wizard (js/onboarding.js),
// "Nieuwe verzamelaar" en "Verzamelaar bewerken" op het dashboard. De controle
// en de omzetting naar een databankrij horen daarom hier en niet drie keer.
// Geeft de foutmelding terug, of null als alles in orde is.
export function valideerKind(voornaam, familienaam, geboortejaar, isVolwassen) {
  if (!voornaam || !familienaam) return "Voornaam en familienaam zijn verplicht.";
  if (isVolwassen) return null;
  if (!isValidGeboortejaar(geboortejaar)) return "Voer een geldig geboortejaar in.";
  return null;
}

// Een volwassene heeft geen geboortejaar: dat veld verdwijnt in het formulier
// en wordt hier expliciet op null gezet, zodat een eerder ingevuld jaar niet
// blijft hangen bij wie het vinkje aanzet.
export function kindPayload(voornaam, familienaam, geboortejaar, isVolwassen) {
  return {
    voornaam,
    familienaam,
    geboortejaar: isVolwassen ? null : Number(geboortejaar),
    is_volwassen: isVolwassen,
  };
}
