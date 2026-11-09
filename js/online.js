// online.js — wat de ruilpagina, de kettingruil en de gesprekken delen voor
// online ruilen (migratie 033): een voorstel doen, sterren tonen, en weten met
// wie je niet ruilt.
//
// Alles hier is optioneel voor de pagina's die het gebruiken: draaide 033 nog
// niet, dan geven de functies lege resultaten en werkt de ruilpagina zoals
// vroeger — een nieuwe functie mag geen bestaande pagina platleggen.
import { supabase } from "./supabase.js";

// Een online ruil voorstellen en meteen naar het gesprek. items:
// [{ van, naar, sticker }] — wie geeft welke sticker aan wie.
export async function stelOnlineVoor({ eigenKindId, soort, items, bericht = "" }) {
  const { data, error } = await supabase.rpc("afspraak_voorstellen", {
    p_eigen_kind: eigenKindId,
    p_soort: soort,
    p_items: items,
    p_bericht: bericht,
  });
  if (error) {
    if (/afspraak_voorstellen/.test(error.message || "") && /function|schema cache/i.test(error.message || "")) {
      throw new Error("Online ruilen staat nog niet aan in de databank (migratie 033).");
    }
    throw error;
  }
  location.href = `/gesprekken.html?id=${encodeURIComponent(data)}`;
  return data;
}

// Sterren per verzamelaar (van zijn gezin). Map kind_id → { gemiddelde, aantal, gerealiseerd }.
export async function haalSterren(kindIds) {
  const ids = [...new Set(kindIds.filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const { data, error } = await supabase.rpc("gezin_sterren", { p_kinderen: ids });
    if (error) throw error;
    return new Map((data || []).map((r) => [r.kind_id, { gemiddelde: r.gemiddelde === null ? null : Number(r.gemiddelde), aantal: r.aantal || 0, gerealiseerd: r.gerealiseerd || 0 }]));
  } catch {
    return new Map();
  }
}

export async function haalBlokkades() {
  try {
    const { data, error } = await supabase.rpc("mijn_blokkades");
    if (error) throw error;
    return new Set((data || []).map((r) => r.kind_id));
  } catch {
    return new Set();
  }
}

// Onder 3 beoordelingen zeggen sterren nog niets: één boze score maakt anders
// een reputatie kapot, en een nieuw gezin begint niet onderaan.
export const MIN_BEOORDELINGEN = 3;

// Drie niveaus voor de ruilplanner, bewust grof (zie regels.html, "Sterren"):
//   2 = betrouwbaar (gemiddeld 4 of meer), 1 = neutraal of nog nieuw,
//   0 = laag (onder 2,5). Een nieuw gezin staat dus naast een goed gezin
//   met 3 sterren, niet eronder — anders krijgt wie begint nooit een kans.
export function vertrouwen(s) {
  if (!s || s.aantal < MIN_BEOORDELINGEN || s.gemiddelde === null) return 1;
  if (s.gemiddelde >= 4) return 2;
  if (s.gemiddelde < 2.5) return 0;
  return 1;
}

const getal = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 1 });

// Vijf sterren, vol, half of leeg, op een halve ster afgerond. Een span met
// een leesbare tekst voor schermlezers; de sterren zelf zijn decoratie.
export function sterrenElement(s, { klein = false } = {}) {
  const span = document.createElement("span");
  span.className = "sterren" + (klein ? " sterren--klein" : "");
  if (!s || s.aantal < MIN_BEOORDELINGEN || s.gemiddelde === null) {
    span.classList.add("sterren--nieuw");
    span.textContent = s && s.gerealiseerd ? `nieuw · ${s.gerealiseerd} ${s.gerealiseerd === 1 ? "ruil" : "ruilen"}` : "nieuw";
    span.title = `Nog geen ${MIN_BEOORDELINGEN} beoordelingen: dit gezin begint pas online te ruilen.`;
    return span;
  }
  const afgerond = Math.round(s.gemiddelde * 2) / 2;
  const iconen = document.createElement("span");
  iconen.setAttribute("aria-hidden", "true");
  for (let i = 1; i <= 5; i++) {
    const ster = document.createElement("span");
    ster.className = "ster " + (afgerond >= i ? "ster--vol" : afgerond >= i - 0.5 ? "ster--half" : "ster--leeg");
    ster.textContent = "★";
    iconen.appendChild(ster);
  }
  const tekst = document.createElement("span");
  tekst.className = "sterren__tekst";
  tekst.textContent = ` ${getal.format(s.gemiddelde)} (${s.aantal})`;
  span.append(iconen, tekst);
  const label = `${getal.format(s.gemiddelde)} op 5 sterren, ${s.aantal} beoordelingen`;
  span.title = label;
  span.setAttribute("aria-label", label);
  span.setAttribute("role", "img");
  return span;
}
