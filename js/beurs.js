// beurs.js — welk event staat er nu centraal, en in welke fase zitten we?
//
// Eén bron voor het dashboard, de ruilpagina, de startpagina en de
// beheerpagina. De fase komt uit de databank (public.huidig_event), niet uit
// een berekening hier: de filter in get_matches() rekent met dezelfde klok, en
// twee klokken lopen vroeg of laat uiteen.
//
// DRIE FASES (zie sql/025):
//   open    — geen event in zicht; iedereen doet mee
//   voor    — de aanloop; enkel wie aanduidde dat hij komt
//   tijdens — de beursdag; enkel wie aan de deur aangemeld is
//
// ZOLANG sql/025 NIET GEDRAAID IS valt alles terug op het oude venster
// (instellingen.beurs_start/beurs_einde) met fase 'open' of 'tijdens'. Dan
// filtert get_matches() ook nog niet, dus pagina en databank blijven het eens.
import { supabase } from "./supabase.js";

let ophaling = null;

// Eén aanvraag per paginabezoek: de fase verschuift op de minuut, niet op de
// seconde, en elke pagina die het nodig heeft vraagt het bij het laden.
export function haalEvent() {
  if (!ophaling) {
    ophaling = (async () => {
      try {
        const { data, error } = await supabase.rpc("huidig_event");
        if (error) throw error;
        const rij = Array.isArray(data) ? data[0] : data;
        if (!rij) return leegEvent();
        return {
          id: rij.id || null,
          naam: rij.naam || "",
          start: rij.start ? new Date(rij.start) : null,
          einde: rij.einde ? new Date(rij.einde) : null,
          filterVanaf: rij.filter_vanaf ? new Date(rij.filter_vanaf) : null,
          fase: rij.fase || "open",
          migratie: true,
        };
      } catch (err) {
        return await oudVenster();
      }
    })();
  }
  return ophaling;
}

// Enkel de beheerpagina heeft dit nodig: wie een event toevoegt of verwijdert,
// verandert de fase, en dan mag de pagina niet het antwoord van daarnet blijven
// tonen.
export function vergeetEvent() {
  ophaling = null;
}

function leegEvent() {
  return { id: null, naam: "", start: null, einde: null, filterVanaf: null, fase: "open", migratie: true };
}

// De terugval. Geen events-tabel betekent ook: geen aanwezigheidsfilter, dus
// 'voor' bestaat hier niet — enkel 'tijdens' of 'open'.
async function oudVenster() {
  try {
    const { data, error } = await supabase
      .from("instellingen")
      .select("beurs_start,beurs_einde")
      .eq("id", 1)
      .single();
    if (error) throw error;
    const start = new Date(data.beurs_start);
    const einde = new Date(data.beurs_einde);
    const nu = new Date();
    return {
      id: null,
      naam: "",
      start,
      einde,
      filterVanaf: null,
      fase: nu >= start && nu < einde ? "tijdens" : "open",
      migratie: false,
    };
  } catch (err) {
    return { ...leegEvent(), migratie: false };
  }
}

// De komende events, nieuwste eerst nog bezig of nog te gaan. Voor het
// dashboard: daar duidt een ouder aan wie er meegaat.
export async function haalKomendeEvents() {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("id,naam,start,einde")
      .gt("einde", new Date().toISOString())
      .order("start", { ascending: true });
    if (error) throw error;
    return (data || []).map((e) => ({
      id: e.id,
      naam: e.naam,
      start: new Date(e.start),
      einde: new Date(e.einde),
    }));
  } catch (err) {
    return [];
  }
}

const DATUM = new Intl.DateTimeFormat("nl-BE", { dateStyle: "full" });
const DATUM_KORT = new Intl.DateTimeFormat("nl-BE", { day: "2-digit", month: "2-digit" });
const UUR = new Intl.DateTimeFormat("nl-BE", { timeStyle: "short" });

export function datumVoluit(d) {
  return d ? DATUM.format(d) : "";
}

export function datumKort(d) {
  return d ? DATUM_KORT.format(d) : "";
}

export function uur(d) {
  return d ? UUR.format(d) : "";
}

// "zaterdag 11 oktober 2026 van 14:00 tot 17:00"
export function wanneer(ev) {
  if (!ev || !ev.start || !ev.einde) return "";
  return `${DATUM.format(ev.start)} van ${UUR.format(ev.start)} tot ${UUR.format(ev.einde)}`;
}
