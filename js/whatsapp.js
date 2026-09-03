// whatsapp.js — telefoonnummers normaliseren en wa.me-links bouwen.
//
// WhatsApp wil in een click-to-chat-link een nummer in internationaal formaat
// zonder plusteken, spaties of nullen vooraan: https://wa.me/32470123456.
// Ouders typen zo'n nummer nooit zo in. Alles wat hieronder gebeurt is dat
// vertaalwerk — één keer, op één plaats, want zowel de gezinspagina als de
// ruilpagina als de instellingenpagina hebben het nodig.
import { supabase } from "./supabase.js";

// Wie '0470…' intypt, bedoelt een Belgisch nummer. Deelnemers van buiten
// België typen hun landcode zelf ('+31…'), en dat blijft gewoon werken.
const STANDAARD_LANDCODE = "32";

// Hetzelfde patroon als de CHECK-constraints in sql/009: E.164, dus een
// plusteken, een landcode die niet met 0 begint, en 8 tot 15 cijfers totaal.
const E164 = /^\+[1-9][0-9]{7,14}$/;

export function normaliseerTelefoon(invoer) {
  if (!invoer) return null;
  let nummer = String(invoer).trim().replace(/[\s().–—-]/g, "");
  if (nummer.startsWith("00")) nummer = "+" + nummer.slice(2);
  else if (nummer.startsWith("0")) nummer = "+" + STANDAARD_LANDCODE + nummer.slice(1);
  else if (!nummer.startsWith("+")) nummer = "+" + nummer;
  return E164.test(nummer) ? nummer : null;
}

// Leesbaar terug: +32 470 12 34 56. Enkel cosmetica voor de weergave; wat we
// bewaren en naar wa.me sturen blijft het genormaliseerde nummer.
export function toonTelefoon(nummer) {
  if (!nummer) return "";
  if (!nummer.startsWith("+32") || nummer.length !== 12) return nummer;
  return `+32 ${nummer.slice(3, 6)} ${nummer.slice(6, 8)} ${nummer.slice(8, 10)} ${nummer.slice(10)}`;
}

export function whatsappLink(nummer, bericht) {
  const genormaliseerd = normaliseerTelefoon(nummer);
  if (!genormaliseerd) return null;
  const basis = "https://wa.me/" + genormaliseerd.slice(1);
  return bericht ? `${basis}?text=${encodeURIComponent(bericht)}` : basis;
}

export function whatsappKnop(nummer, bericht, tekst) {
  const href = whatsappLink(nummer, bericht);
  if (!href) return null;
  const a = document.createElement("a");
  a.className = "btn btn--wa btn--sm";
  a.href = href;
  // Op een telefoon opent dit de WhatsApp-app zelf; op een laptop web.whatsapp.
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = tekst;
  return a;
}

const STANDAARD_ORGANISATORBERICHT =
  "Dag! Ik heb een vraag over het Panini Ruilportaal Meulestede.";

// Het nummer van de organisator staat in public.instellingen en is dus enkel
// leesbaar voor wie ingelogd is — het staat niet in de publieke bronbestanden.
// Is de kolom er nog niet (sql/009 nog niet gedraaid) of is het nummer leeg,
// dan geeft dit null terug en toont de pagina simpelweg geen knop.
export async function haalOrganisator() {
  try {
    const { data, error } = await supabase
      .from("instellingen")
      .select("whatsapp_nummer,whatsapp_bericht")
      .eq("id", 1)
      .single();
    if (error) throw error;
    if (!data || !data.whatsapp_nummer) return null;
    return {
      nummer: data.whatsapp_nummer,
      bericht: data.whatsapp_bericht || STANDAARD_ORGANISATORBERICHT,
    };
  } catch (err) {
    return null;
  }
}

export async function toonOrganisatorKnop(containerId, tekst = "💬 Vraag via WhatsApp") {
  const container = document.getElementById(containerId);
  if (!container) return;
  const organisator = await haalOrganisator();
  if (!organisator) return; // geen nummer ingesteld: dan ook geen knop
  const knop = whatsappKnop(organisator.nummer, organisator.bericht, tekst);
  if (!knop) return;
  container.appendChild(knop);
  container.classList.remove("hidden");
}
