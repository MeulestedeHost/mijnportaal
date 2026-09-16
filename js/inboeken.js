// inboeken.js — een sticker krijgen: wat verandert er aan de lijst van een
// verzamelaar, en hoe wordt dat weggeschreven.
//
// Gedeeld door ⚡ Snelruilen (modus Inboeken: één getypte code per keer) en
// 📷 Scan stickers (een hele foto tegelijk). Die twee moeten exact hetzelfde
// doen — twee keer dezelfde regel op twee plekken loopt vroeg of laat uit
// elkaar — dus staat de regel één keer hier, los van elk venster.
import { supabase } from "./supabase.js";

const PAGINA = 1000; // PostgREST levert maximaal 1000 rijen per aanvraag

// Andere pagina's (js/stickers.js) luisteren hierop om hun lijst te verversen.
// De naam is historisch: Snelruilen was de eerste die inboekte.
export const GEWIJZIGD_EVENT = "snelruilen:gewijzigd";

// ---------- ontleden en rekenen ----------

// "bel 3", "BEL-03" en "Bel3" worden allemaal BEL3: aan een tafel typt niemand
// netjes, en een spatie of koppelteken verandert niets aan welke sticker bedoeld
// is. Glansstickers (BEL2s) vallen hier bewust buiten: BEL12 zou al gecontroleerd
// zijn vóór de "s" getypt is.
export function ontleedCode(invoer) {
  const schoon = String(invoer || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (schoon === "00") return { code: "00", cijfers: 2 };
  const m = /^([A-Z]{3})(\d{1,2})$/.exec(schoon);
  if (!m) return null;
  // De catalogus schrijft zonder voorloopnul (BEL3), net als de rest van het
  // portaal. BEL03 wordt dus BEL3, niet omgekeerd.
  return { code: m[1] + Number(m[2]), land: m[1], cijfers: m[2].length, eersteCijfer: m[2][0] };
}

// Wat er met de lijst gebeurt als je deze sticker krijgt. `voor` en `na` zijn
// een rij ({ status, aantal }) of null (geen rij: "heb ik, niet dubbel").
//
// De databank kent geen "heb ik" — alles wat niet gezocht is, geldt als al in
// het album (zie README, "Geplakt is een afleiding"). Een sticker die niet in
// Zoek ik staat, is dus per definitie een dubbel. Dat klopt enkel voor wie zijn
// Zoek ik-lijst invulde; daarom de waarschuwing bij een lege lijst.
export function bepaalInboeking(voor) {
  if (voor && voor.status === "ZOEKT") return { na: null, soort: "uitZoek" };
  const van = voor && voor.status === "RUILT" ? Math.max(Number(voor.aantal) || 1, 1) : 0;
  return { na: { status: "RUILT", aantal: van + 1 }, soort: "dubbel", van, naar: van + 1 };
}

// ---------- gegevens ----------

// De catalogus verandert niet terwijl je op een pagina staat: één keer per
// pagina, gedeeld door iedereen die hem nodig heeft. Mislukt het, dan mag een
// volgende poging opnieuw proberen.
let catalogusBelofte = null;

export function haalCatalogus() {
  if (!catalogusBelofte) {
    catalogusBelofte = (async () => {
      const alles = [];
      for (let van = 0; ; van += PAGINA) {
        const { data, error } = await supabase
          .from("sticker_catalogus")
          .select("code,naam,land_code,land_naam")
          .order("code", { ascending: true })
          .range(van, van + PAGINA - 1);
        if (error) throw error;
        alles.push(...data);
        if (data.length < PAGINA) return new Map(alles.map((s) => [s.code, s]));
      }
    })();
    catalogusBelofte.catch(() => {
      catalogusBelofte = null;
    });
  }
  return catalogusBelofte;
}

// Een Map code -> { nummer, status, aantal }.
export async function haalLijst(kindId) {
  const { data, error } = await supabase
    .from("stickers")
    .select("nummer,status,aantal")
    .eq("kind_id", kindId);
  if (error) throw error;
  return new Map((data || []).map((s) => [s.nummer, s]));
}

// ---------- wegschrijven ----------

// Schrijfopdrachten gaan één voor één en in volgorde, over alle vensters heen:
// wie twee keer snel ARG10 typt (of twee ARG10 op één foto heeft), moet 1 en
// dan 2 wegschrijven — niet twee keer 1 in willekeurige volgorde. Elke
// opdracht schrijft de volledige gewenste stand, geen "+1".
let schrijfrij = Promise.resolve();

// Eén aanvraag per wijziging: een rij wordt upsert op (kind_id, nummer) —
// dezelfde unieke index als js/stickers.js gebruikt — en "geen rij" wordt een
// delete.
export function schrijfStickerRij(kindId, code, rij) {
  const opdracht = schrijfrij.then(async () => {
    const { error } = rij
      ? await supabase
          .from("stickers")
          .upsert({ kind_id: kindId, nummer: code, status: rij.status, aantal: rij.aantal }, { onConflict: "kind_id,nummer" })
      : await supabase.from("stickers").delete().eq("kind_id", kindId).eq("nummer", code);
    if (error) throw error;
  });
  // De rij zelf mag nooit afgewezen blijven, anders stopt alles erna.
  schrijfrij = opdracht.catch(() => {});
  return opdracht;
}

// Wie een verse lijst wil, wacht eerst tot alles weggeschreven is — anders
// komt er een lijst terug waar de laatste inboekingen nog niet in staan.
export function wachtOpSchrijven() {
  return schrijfrij;
}

// Een reeks codes inboeken, één exemplaar per keer en in volgorde: twee keer
// FRA12 is 0 → 1 → 2, net als twee keer typen in Snelruilen. `lijst` (uit
// haalLijst) wordt meteen bijgewerkt, zodat een volgende reeks erop verder
// rekent.
//
// Geeft per code terug wat er gebeurde, en of het wegschrijven lukte.
export async function boekIn(kindId, codes, lijst) {
  const stappen = codes.map((code) => {
    const rij = lijst.get(code);
    const voor = rij ? { status: rij.status, aantal: Number(rij.aantal) || 1 } : null;
    const plan = bepaalInboeking(voor);
    if (plan.na) lijst.set(code, { nummer: code, status: plan.na.status, aantal: plan.na.aantal });
    else lijst.delete(code);
    return { code, ...plan, opdracht: schrijfStickerRij(kindId, code, plan.na) };
  });
  const uitkomsten = await Promise.allSettled(stappen.map((s) => s.opdracht));
  const regels = stappen.map(({ opdracht, ...stap }, i) => ({ ...stap, gelukt: uitkomsten[i].status === "fulfilled" }));
  return {
    regels,
    uitZoek: regels.filter((r) => r.gelukt && r.soort === "uitZoek").length,
    dubbel: regels.filter((r) => r.gelukt && r.soort === "dubbel").length,
    fouten: regels.filter((r) => !r.gelukt).map((r) => r.code),
  };
}
