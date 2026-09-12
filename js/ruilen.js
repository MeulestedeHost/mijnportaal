// ruilen.js — Ruilpagina: met wie kan je wat ruilen, en wat is er afgesproken.
//
// DRIE LAGEN OP ÉÉN PAGINA.
//   1. RUILKANSEN — wat er tussen jouw verzamelaar en de anderen ligt. Te
//      bekijken per ruiler (met wie kan ik iets doen?) of per land (wie heeft
//      of zoekt deze sticker?).
//   2. AFSPRAKEN  — wat er geregistreerd is, met een bevestiging per kant.
//   3. OPVOLGING  — hetzelfde, maar dan voor de hele beurs. Enkel voor de
//      organisatie; de databank beslist dat, niet deze pagina.
//
// HET SYSTEEM VERPLAATST GEEN STICKERS. Een geregistreerde of zelfs voltooide
// ruil laat "zoek ik" en "heb ik dubbel" ongemoeid. Elke verzamelaar houdt
// zijn eigen lijst bij, want alleen hij weet wat er echt in de map zit. Wat
// het portaal wél doet, is de afspraak onthouden en tonen wie ze al bevestigd
// heeft. Bevestig je zelf, dan kleuren enkel JOUW betrokken stickers lichtrood
// — bij de andere ruiler verandert er niets tot die zelf bevestigt.
//
// WAT JE VAN EEN ÁNDER GEZIN TE ZIEN KRIJGT, EN WANNEER — de databank bepaalt
// dat, niet dit bestand:
//   ALTIJD              — de voornaam, en de wijk of gemeente als dat gezin ze
//                         invulde (sql/015), zodat buren elkaar meteen vinden.
//   NA het beursvenster — daarbovenop het e-mailadres en het WhatsApp-nummer
//                         als dat gezin koos om het te delen (sql/014).
// get_matches geeft ander_email/ander_whatsapp buiten hun fase gewoon niet
// terug; wat hier gebeurt is dus presentatie, geen beveiliging.
//
// ZOEKEN WERKT ZOALS OP DE STICKERPAGINA. Live, zonder knop, ongevoelig voor
// hoofdletters en accenten — dezelfde normaliseer() en landMatcht() uit
// landen-data.js. Wie daar leert dat "IVOOR" en "cote" hetzelfde land vinden,
// verwacht dat hier ook.
import { supabase, requireAuth } from "./supabase.js";
import { loadKinderen } from "./kinderen.js";
import { whatsappKnop, toonOrganisatorKnop } from "./whatsapp.js";
import {
  landLabel,
  accentVoor,
  vergelijkLanden,
  normaliseer,
  landMatcht,
} from "./landen-data.js";

let kinderen = [];
let actiefKindId = "";
const matchesPerKind = new Map(); // kind_id -> rijen uit get_matches
let afspraken = []; // rijen uit mijn_ruilen()

// FAVORIETEN (sql/018). Eén regel, en al de rest volgt eruit: een favoriet is
// een RESERVERING van één exemplaar — "deze sticker wil ik bij DEZE ruiler
// halen of aan DEZE ruiler geven". Daarmee ligt het budget meteen vast:
//   jij_zoekt        — 1 per sticker, want je hebt er maar één nodig.
//   jij_hebt_dubbel  — zoveel als je er dubbel hebt.
// Is het budget op, dan tonen de andere ruilers met diezelfde sticker een lege
// ster met gele contour: daar kán het ook, maar dan verhuist je reservering.
//
// De databank bewaakt dat budget (partiële unieke index + trigger), niet deze
// pagina. Wat hier staat is de weergave ervan.
let favorieten = []; // rijen uit public.favorieten voor de actieve verzamelaar
// Staat op false zolang sql/018 niet gedraaid is. Dan verdwijnen enkel de
// sterretjes; de rest van de ruilpagina werkt onveranderd door.
let favorietenBeschikbaar = true;
// favorieten, maar met elke ALGEMENE favoriet (ander_kind_id = null, sinds
// sql/020 — gezet vanaf kind.html) toegewezen aan een concrete ruiler. Dit is
// waar alle weergave-code naar kijkt; enkel wisselFavoriet() schrijft naar de
// echte tabel. Herberekend bij elke teken(), zie berekenFavorietenWeergave().
let favorietenWeergave = [];

// De genummerde ruilronde (stap 3): "code|richting|ruiler" -> volgnummer.
// Herberekend bij elke teken(), zie berekenRuilroute().
let ruilroute = new Map();

let zoekterm = "";
let weergave = "ruiler";
let landsortering = "pagina";

// Welke sticker staat er links en welke rechts geselecteerd, per ruilerkaart.
// Sleutel: "<eigen kind>|<ander kind>". Blijft bewaard over een hertekening
// heen, zodat filteren of bevestigen je keuze niet wegneemt.
const keuzePerRuiler = new Map();

// Wat het bevestigingsvenster op dit moment wil registreren.
let openVoorstel = null;

// null = nog niet nagevraagd. Het antwoord verandert niet tijdens een sessie,
// dus het wordt één keer opgehaald; de lijst eronder wél elke keer opnieuw.
let isBeheerder = null;

document.addEventListener("DOMContentLoaded", async () => {
  const inhoud = document.getElementById("ruil-inhoud");
  if (!inhoud) return; // niet op ruilen.html

  const user = await requireAuth();
  if (!user) return;

  await toonVenster();
  toonOrganisatorKnop("organisator-knop", "💬 WhatsApp de organisator");

  const loading = document.getElementById("ruil-loading");
  try {
    kinderen = await loadKinderen();
  } catch (err) {
    loading.textContent = "Fout bij laden: " + err.message;
    return;
  }

  if (kinderen.length === 0) {
    loading.classList.add("hidden");
    inhoud.appendChild(
      melding("Je hebt nog geen verzamelaars. Voeg er eerst een toe op het dashboard.")
    );
    return;
  }

  actiefKindId = kinderen[0].id;
  vulKindKeuze();
  koppelFilters();
  koppelDialoog();

  try {
    await laadGegevens();
  } catch (err) {
    loading.textContent =
      "Ruilkansen konden niet geladen worden — draai sql/016_ruilen_registreren.sql in Supabase. (" +
      err.message +
      ")";
    return;
  }

  loading.classList.add("hidden");
  teken();
  void toonBeheer();
});

// ---------- gegevens ----------

async function laadGegevens() {
  await Promise.all([haalMatches(actiefKindId), haalAfspraken(), haalFavorieten(actiefKindId)]);
}

// Per verzamelaar één aanroep, en het resultaat blijft bewaard: van
// verzamelaar wisselen en weer terug hoeft de databank niet nog eens lastig
// te vallen. Na een registratie of bevestiging halen we gericht opnieuw op.
async function haalMatches(kindId) {
  if (matchesPerKind.has(kindId)) return matchesPerKind.get(kindId);
  const { data, error } = await supabase.rpc("get_matches", { p_kind_id: kindId });
  if (error) throw error;
  matchesPerKind.set(kindId, data || []);
  return data || [];
}

async function haalAfspraken() {
  const { data, error } = await supabase.rpc("mijn_ruilen");
  if (error) throw error;
  afspraken = data || [];
  return afspraken;
}

// Anders dan de matches worden favorieten NIET per verzamelaar bewaard: ze
// veranderen terwijl je op de pagina staat, en een verouderde lijst zou een
// ster tonen die er niet meer is. Het is één kleine tabel met een index op
// kind_id, dus opnieuw ophalen kost niets.
//
// Een fout blijft hier bewust binnen: draaide sql/018 nog niet, dan hoort de
// ruilpagina gewoon te blijven werken zoals ze was — alleen zonder sterretjes.
// Een nieuwe functie mag geen bestaande pagina platleggen.
async function haalFavorieten(kindId) {
  const { data, error } = await supabase
    .from("favorieten")
    .select("id,ander_kind_id,code,richting")
    .eq("kind_id", kindId);
  favorietenBeschikbaar = !error;
  favorieten = error ? [] : data || [];
  return favorieten;
}

// Na een registratie of een bevestiging: de afspraken opnieuw ophalen, de
// pagina hertekenen en — voor wie het ziet — ook het opvolgingsoverzicht
// bijwerken. Anders zou dat overzicht de ruil tonen zoals hij bij het laden
// van de pagina was.
async function verversNaWijziging() {
  await haalAfspraken();
  teken();
  await toonBeheer();
}

function actieveMatches() {
  return matchesPerKind.get(actiefKindId) || [];
}

function actiefKind() {
  return kinderen.find((k) => k.id === actiefKindId) || kinderen[0];
}

// ---------- kansen: hoe kwetsbaar is een ruilkans? ----------

// PERSOONLIJKE schaarste, niet globale (Todo.md, stap 4). De vraag is niet
// "hoeveel kinderen in het hele portaal bieden FRA12 aan", maar "hoeveel
// exemplaren liggen er bij de mensen waar ÍK effectief mee kan ruilen" — en
// dat is precies wat get_matches() teruggeeft, dus er is geen extra RPC nodig.
//
// Waarom persoonlijk: bij een globale telling krijgt iedereen dezelfde nummer
// één en stormt de hele wijk op dezelfde sticker af, waardoor het advies
// zichzelf onderuit haalt. Bieden twintig kinderen FRA12 aan maar willen er
// maar twee iets wat jij hebt, dan is jouw echte aanbod twee. Dat getal
// verschilt per kind, dus verdwijnt de stormloop grotendeels vanzelf.
//
// Eén getal voor twee dingen die in de oorspronkelijke opzet apart stonden —
// zeldzaamheid ("hoeveel mensen hebben hem") en zekerheid ("hoeveel hebben ze
// er"). Die twee los tellen ging mis: meer exemplaren is tegelijk een reden om
// je géén zorgen te maken en, in de oorspronkelijke puntentelling, een reden
// om punten te geven. Samengeteld tot "hoeveel exemplaren kan ik bereiken" is
// het ondubbelzinnig, en in één zin uit te leggen aan een kind: "er ligt er
// maar één van bij al je ruilers".
//
// De twee richtingen betekenen niet hetzelfde:
//   jij_zoekt       — som van rij.aantal: alle exemplaren bij alle ruilers die
//                     hem aanbieden. Jouw voorraad bestaat niet, je zoekt hem.
//   jij_hebt_dubbel — aantal ruilers dat hem wil. rij.aantal is hier JOUW
//                     voorraad (sql/016) en zegt niets over dringendheid: jouw
//                     dubbel loopt niet weg. Wat wel kan verdwijnen is de enige
//                     persoon die hem wil.
let kansen = new Map(); // "code|richting" -> bereikbare exemplaren / vragers

function kansSleutel(rij) {
  return `${rij.code}|${rij.richting}`;
}

function berekenKansen(matches) {
  const telling = new Map();
  matches.forEach((rij) => {
    const sleutel = kansSleutel(rij);
    const erbij = rij.richting === "jij_zoekt" ? Math.max(Number(rij.aantal) || 1, 1) : 1;
    telling.set(sleutel, (telling.get(sleutel) || 0) + erbij);
  });
  return telling;
}

function kansenVoor(rij) {
  return kansen.get(kansSleutel(rij)) || 0;
}

// Nergens anders te halen (of, bij een dubbel, nergens anders kwijt te raken).
// Dit is de dringendste stand die er is, en meteen degene die in het
// oorspronkelijke puntenvoorstel ontbrak: dat begon bij "2 aanbieders" en liet
// het geval "maar één" door de mazen vallen — terwijl dat in een wijk met
// enkele tientallen deelnemers net het meest voorkomende geval is.
function enigeKans(rij) {
  return kansenVoor(rij) <= 1;
}

// Ruim voorradig: er liggen er genoeg bij genoeg mensen, dus deze kans loopt
// niet weg terwijl jij eerst iets dringenders doet.
function ruimeKans(rij) {
  return kansenVoor(rij) >= 3;
}

// ---------- filters ----------

function vulKindKeuze() {
  const select = document.getElementById("ruil-kind");
  const vak = document.getElementById("ruil-kind-vak");
  select.innerHTML = "";
  kinderen.forEach((kind) => {
    const optie = document.createElement("option");
    optie.value = kind.id;
    optie.textContent = `${kind.voornaam} ${kind.familienaam}`;
    select.appendChild(optie);
  });
  select.value = actiefKindId;
  // Met één verzamelaar valt er niets te kiezen; een keuzelijst met één
  // mogelijkheid is dan enkel ruis.
  vak.classList.toggle("hidden", kinderen.length < 2);
}

function koppelFilters() {
  document.getElementById("ruil-kind").addEventListener("change", async (e) => {
    actiefKindId = e.target.value;
    const inhoud = document.getElementById("ruil-inhoud");
    inhoud.textContent = "";
    try {
      // Favorieten horen bij één verzamelaar, dus die moeten mee: anders
      // staan de sterretjes van het vorige kind op de lijst van dit kind.
      await Promise.all([haalMatches(actiefKindId), haalFavorieten(actiefKindId)]);
    } catch (err) {
      inhoud.appendChild(melding("Ruilkansen konden niet geladen worden: " + err.message));
      return;
    }
    teken();
  });

  document.getElementById("ruil-zoek").addEventListener("input", (e) => {
    zoekterm = normaliseer(e.target.value.trim());
    teken();
  });

  document.getElementById("ruil-weergave").addEventListener("change", (e) => {
    weergave = e.target.value;
    teken();
  });

  document.getElementById("ruil-landsortering").addEventListener("change", (e) => {
    landsortering = e.target.value;
    teken();
  });
}

// Eén rij is relevant als de zoekterm voorkomt in de naam van de ruiler, in
// het land (code, Engelse of Nederlandse naam) of in de sticker zelf (code of
// spelersnaam). Zonder zoekterm valt er niets te filteren.
function rijMatcht(rij) {
  if (!zoekterm) return true;
  return (
    normaliseer(rij.ander_kind).includes(zoekterm) ||
    landMatcht(rij, zoekterm) ||
    normaliseer(rij.code).includes(zoekterm) ||
    normaliseer(rij.sticker_naam).includes(zoekterm)
  );
}

// ---------- beursvenster ----------

async function toonVenster() {
  const el = document.getElementById("ruil-venster");
  let start;
  let einde;
  try {
    const { data, error } = await supabase
      .from("instellingen")
      .select("beurs_start,beurs_einde")
      .eq("id", 1)
      .single();
    if (error) throw error;
    start = new Date(data.beurs_start);
    einde = new Date(data.beurs_einde);
  } catch (err) {
    el.textContent = "Het beursvenster kon niet opgehaald worden.";
    return;
  }

  const nu = new Date();
  const opmaak = new Intl.DateTimeFormat("nl-BE", { dateStyle: "full", timeStyle: "short" });
  const uur = new Intl.DateTimeFormat("nl-BE", { timeStyle: "short" });

  el.className = "ruil-venster ruil-venster--open";
  if (nu < start) {
    el.textContent = `De ruilbeurs begint op ${opmaak.format(start)} en sluit om ${uur.format(
      einde
    )}. Je ziet nu al de voornaam — en de wijk, als die is ingevuld — van wie elke sticker heeft: woon je in dezelfde buurt, dan kan je nu al onderling ruilen. E-mail en WhatsApp komen erbij zodra de beurs voorbij is.`;
  } else if (nu < einde) {
    el.textContent = `De ruilbeurs is bezig — nog tot ${uur.format(
      einde
    )}. Je ziet de voornaam en de wijk van wie elke sticker heeft; e-mail en WhatsApp komen erbij zodra de beurs voorbij is.`;
  } else {
    el.textContent = `De ruilbeurs van ${opmaak.format(
      start
    )} is voorbij, maar ruilen kan gewoon verder: je ziet nu ook het e-mailadres (en eventueel WhatsApp) van wie je nog kan ruilen.`;
  }
}

// ---------- favorieten ----------

// Hoeveel exemplaren van deze sticker mag je reserveren? Zie de uitleg bij de
// variabele bovenaan: zoeken is er één, dubbels zijn er zoveel als je er hebt.
// rij.aantal betekent per richting iets anders (get_matches, sql/016): bij
// jij_zoekt is het wat de ÁNDER dubbel heeft, bij jij_hebt_dubbel wat JIJ er
// van hebt. Enkel dat tweede is hier een budget.
function budgetVoor(rij) {
  return rij.richting === "jij_zoekt" ? 1 : Math.max(Number(rij.aantal) || 1, 1);
}

// Alle reserveringen die je van deze sticker in deze richting al gezet hebt —
// bij deze ruiler of bij eender welke andere. Leest favorietenWeergave, dus
// een algemene favoriet (kind.html) die hier al aan een ruiler is toegewezen
// telt gewoon mee, zonder dat deze functie het verschil hoeft te kennen.
function reserveringenVoor(rij) {
  return favorietenWeergave.filter((f) => f.code === rij.code && f.richting === rij.richting);
}

function reserveringBij(rij) {
  return reserveringenVoor(rij).find((f) => f.ander_kind_id === rij.ander_kind_id) || null;
}

// De drie standen waarin een ster kan staan. Ze volgen alle drie uit het
// budget, dus er is hier niets aparts te onthouden:
//   gekozen — hier gereserveerd
//   elders  — budget op, dus je legde deze sticker ergens anders vast
//   geen    — er is nog budget vrij
function favorietStand(rij) {
  if (reserveringBij(rij)) return "gekozen";
  return reserveringenVoor(rij).length >= budgetVoor(rij) ? "elders" : "geen";
}

const STER_UITLEG = {
  gekozen: "Gereserveerd bij deze ruiler — klik om vrij te geven",
  elders: "Je reserveerde deze sticker al bij iemand anders — klik om ze hierheen te verplaatsen",
  geen: "Reserveer deze sticker bij deze ruiler",
};

// Klikken op een ster. Drie standen, maar maar twee handelingen: vrijgeven of
// reserveren. "Elders" is een reservering die verhuist — eerst de oude weg,
// dan de nieuwe erbij, want de databank laat er maar zoveel toe als je budget.
async function wisselFavoriet(rij) {
  const bestaand = reserveringBij(rij);
  try {
    if (bestaand) {
      const { error } = await supabase.from("favorieten").delete().eq("id", bestaand.id);
      if (error) throw error;
    } else {
      // Bij "elders" moet er plaats gemaakt worden. Voor zoeken is dat altijd
      // die ene; voor dubbels de oudste, zodat een pas gezette reservering
      // niet meteen weer sneuvelt.
      if (favorietStand(rij) === "elders") {
        const teVerhuizen = reserveringenVoor(rij)[0];
        const { error } = await supabase.from("favorieten").delete().eq("id", teVerhuizen.id);
        if (error) throw error;
      }
      const { error } = await supabase.from("favorieten").insert({
        kind_id: actiefKindId,
        ander_kind_id: rij.ander_kind_id,
        code: rij.code,
        richting: rij.richting,
      });
      if (error) throw error;
    }
    await haalFavorieten(actiefKindId);
    teken();
    herstelNaSterklik(rij);
  } catch (err) {
    toonFavorietFout(
      ontbrekendeTabel(err)
        ? "Draai eerst sql/018_favorieten.sql in Supabase — de favorietentabel bestaat nog niet."
        : "Favoriet kon niet bewaard worden: " + err.message
    );
  }
}

function toonFavorietFout(tekst) {
  const el = document.getElementById("ruil-afspraken-melding");
  if (!el) return;
  el.textContent = tekst;
  el.className = "message message--show message--error";
}

// Onderscheidt "de tabel bestaat nog niet" (sql/018 niet gedraaid) van een
// gewone weigering (budget op, dus een echte reservering die al bestaat).
// NIET op `err.message.includes("favorieten")` controleren: de naam van de
// unieke index die het budget bewaakt is zelf "favorieten_zoekt_een_per_
// sticker", dus die tekst bevat "favorieten" net zo goed als een ontbrekende
// tabel — dat gaf een misleidende melding bij een gewone dubbele reservering.
// PostgREST meldt een onbekende tabel/kolom altijd met één van deze twee
// zinsneden; een constraint-schending nooit.
function ontbrekendeTabel(err) {
  return err.message.includes("schema cache") || err.message.includes("does not exist");
}

// De ster staat NAAST de stickerknop en niet erin: een knop in een knop mag
// niet, en je moet een sticker kunnen kiezen voor een ruil zonder hem meteen
// te reserveren. Het zijn twee verschillende beslissingen.
// Een sterklik hertekent de hele lijst, en die lijst kan van volgorde wisselen
// — dat is de bedoeling, want favorieten wegen mee. Maar dan springt de kaart
// weg onder je muis en is de focus van wie met het toetsenbord werkt verdwenen.
// Daarom zoeken we ná het hertekenen dezelfde ster terug: focus erop, en de
// kaart zachtjes in beeld ("nearest" scrollt niet als ze al zichtbaar is).
function herstelNaSterklik(rij) {
  const ster = document.querySelector(
    `.favoriet[data-code="${rij.code}"][data-ruiler="${rij.ander_kind_id}"][data-richting="${rij.richting}"]`
  );
  if (!ster) return;
  ster.focus({ preventScroll: true });
  // .ruiler-kaart in "Per ruiler", .landkaart in "Per land" — de ster zelf
  // zit in allebei diep genest, dus de kaart erboven is wat in beeld moet
  // blijven staan.
  const kaart = ster.closest(".ruiler-kaart, .landkaart");
  if (kaart) kaart.scrollIntoView({ block: "nearest" });
}

function favorietKnop(rij) {
  const stand = favorietStand(rij);
  const knop = document.createElement("button");
  knop.type = "button";
  knop.className = "favoriet favoriet--" + stand;
  knop.dataset.code = rij.code;
  knop.dataset.ruiler = rij.ander_kind_id;
  knop.dataset.richting = rij.richting;
  knop.setAttribute("aria-pressed", String(stand === "gekozen"));

  const symbool = document.createElement("span");
  symbool.className = "favoriet__ster";
  symbool.textContent = stand === "gekozen" ? "★" : "☆";
  knop.appendChild(symbool);

  // Het volgnummer van je ruilronde (stap 3). Bewust NAAST de ster en niet
  // erin: in de ster zelf past op deze lettergrootte geen leesbaar cijfer, en
  // vanaf tien ruilen zijn het er twee. Het plaatje blijft hetzelfde — een
  // gouden ster met zijn nummer eraan.
  const nummer = ruilroute.get(routeSleutel(rij));
  let volgorde = "";
  if (stand === "gekozen" && nummer) {
    const cijfer = document.createElement("span");
    cijfer.className = "favoriet__nr";
    cijfer.textContent = String(nummer);
    knop.appendChild(cijfer);
    volgorde = ` — nummer ${nummer} in je ruilronde`;
  }

  const wat = rij.sticker_naam ? `${rij.code} — ${rij.sticker_naam}` : rij.code;
  knop.setAttribute("aria-label", `${STER_UITLEG[stand]} (${wat})${volgorde}`);
  knop.title = STER_UITLEG[stand] + volgorde + kansUitleg(rij);
  knop.addEventListener("click", () => void wisselFavoriet(rij));
  return knop;
}

// Wat de schaarste van deze ruilkans in gewone taal betekent. Staat in de
// tooltip en niet als extra pictogram in de lijst: met tientallen stickers per
// kaart zou een merkje per rij de lijst onleesbaar maken, terwijl de
// samenvatting per ruiler (ruilerRedenen) hetzelfde al vertelt.
function kansUitleg(rij) {
  const aantal = kansenVoor(rij);
  if (rij.richting === "jij_zoekt") {
    if (aantal <= 1) return "\nEr ligt er maar één van bij al je ruilers.";
    if (aantal === 2) return "\nEr liggen er maar twee van bij al je ruilers.";
    return `\nEr liggen er ${aantal} van bij je ruilers — deze loopt niet weg.`;
  }
  if (aantal <= 1) return "\nDit is de enige ruiler die deze dubbel wil.";
  return `\n${aantal} ruilers willen deze dubbel.`;
}

// ---------- tekenen ----------

// Wijst elke ALGEMENE favoriet (ander_kind_id = null, sql/020) toe aan een
// concrete ruiler, en geeft favorieten aangevuld met die toewijzingen terug —
// de rest van het bestand kijkt enkel nog naar dit resultaat, niet naar
// favorieten zelf.
//
// "Toewijzen" gebeurt hier bij elke tekenbeurt opnieuw, niet één keer in de
// databank: wélke ruiler het best past, verandert (iemand ruilt de sticker
// weg, een nieuwe verzamelaar biedt hem aan), en zonder vaste toewijzing
// verschuift de ster daar gewoon in mee in plaats van ergens verouderd te
// blijven hangen.
//
// BIJ WIE LEG JE HEM? Dit is de strategische vraag uit het ontwerpgesprek:
//
//   Ik zoek FRA12, BEL3 en GER7. Ivo heeft enkel FRA12.
//   Emma heeft FRA12, BEL3 en GER7, maar wil maar een van mijn dubbels.
//
// Emma kan me dus maar EEN sticker geven. Haal ik FRA12 bij haar, dan zijn
// BEL3 en GER7 verloren. Haal ik FRA12 bij Ivo — die niets anders heeft — dan
// houd ik Emma over voor iets wat alleen zij heeft. Twee stickers in plaats
// van een, zonder dat er iets zeldzaams aan te pas komt.
//
// Dat vat je in een verhouding: DRUK = wat hij in deze richting voor je heeft,
// gedeeld door hoeveel ruilen er met hem mogelijk zijn (groep.capaciteit).
// Ivo 1/1 = 1, Emma 3/1 = 3. De laagste druk wint: spaar de ruiler bij wie
// veel op tafel ligt maar weinig in past. In een zin aan een kind uit te
// leggen: "Emma heeft drie dingen voor jou maar je kan maar een keer met haar
// ruilen — haal deze dus bij Ivo, die enkel dit heeft."
//
// Tweerichting staat ervoor, want een ruiler waar de ruil niet kan doorgaan is
// geen kandidaat maar een doodlopend spoor (sql/016 registreert enkel paren).
// De gewone rangorde blijft als laatste scheidsrechter, zodat de uitkomst niet
// verspringt bij gelijke druk.
//
// De rangorde zelf komt uit groepeerEnRangschikRuilers() op enkel de CONCRETE
// favorieten: die rangschikking bepaalt net aan wie de algemene favorieten
// toegewezen worden, dus die mogen zelf niet meetellen — dat zou circulair
// zijn.
function berekenFavorietenWeergave(matches) {
  const concreet = favorieten.filter((f) => f.ander_kind_id);
  const algemeen = favorieten.filter((f) => !f.ander_kind_id);
  if (algemeen.length === 0) return concreet;

  const groepen = groepeerEnRangschikRuilers(matches, concreet);
  const rang = new Map(groepen.map((g, i) => [g.info.ander_kind_id, i]));

  const bezet = new Set(concreet.map((f) => `${f.code} ${f.richting} ${f.ander_kind_id}`));
  const resultaat = [...concreet];

  // Groepeer de algemene favorieten per (code, richting): meerdere ervan voor
  // dezelfde sticker (kan bij dubbels, budget > 1) gaan zo naar verschillende
  // ruilers, in dalende voorkeur — niet allemaal naar dezelfde.
  const perSleutel = new Map();
  algemeen.forEach((f) => {
    const sleutel = `${f.code} ${f.richting}`;
    if (!perSleutel.has(sleutel)) perSleutel.set(sleutel, []);
    perSleutel.get(sleutel).push(f);
  });

  perSleutel.forEach((rijenAlgemeen, sleutel) => {
    const [code, richting] = sleutel.split(" ");
    const kandidaten = groepen
      .filter((g) =>
        matches.some(
          (m) => m.ander_kind_id === g.info.ander_kind_id && m.code === code && m.richting === richting
        )
      )
      .sort((a, b) => {
        const tweeA = a.heeft.length && a.wil.length ? 1 : 0;
        const tweeB = b.heeft.length && b.wil.length ? 1 : 0;
        if (tweeA !== tweeB) return tweeB - tweeA;
        // Druk vergelijken zonder te delen: aanbodA/capA < aanbodB/capB wordt
        // aanbodA*capB < aanbodB*capA. Scheelt afrondingsgedoe en houdt de
        // vergelijking exact, wat bij een sortering telt.
        const aanbodA = (richting === "jij_zoekt" ? a.heeft : a.wil).length;
        const aanbodB = (richting === "jij_zoekt" ? b.heeft : b.wil).length;
        const capA = Math.max(a.capaciteit, 1);
        const capB = Math.max(b.capaciteit, 1);
        const drukVerschil = aanbodA * capB - aanbodB * capA;
        if (drukVerschil !== 0) return drukVerschil;
        return rang.get(a.info.ander_kind_id) - rang.get(b.info.ander_kind_id);
      })
      .map((g) => g.info.ander_kind_id);

    let i = 0;
    rijenAlgemeen.forEach((f) => {
      while (i < kandidaten.length && bezet.has(`${code} ${richting} ${kandidaten[i]}`)) i++;
      if (i < kandidaten.length) {
        resultaat.push({ ...f, ander_kind_id: kandidaten[i] });
        bezet.add(`${code} ${richting} ${kandidaten[i]}`);
        i++;
      }
      // Geen kandidaat meer over: deze algemene favoriet blijft onopgelost —
      // hij toont nergens een ster tot er een ruiler met deze sticker bijkomt.
    });
  });

  return resultaat;
}

// ---------- de genummerde ruilronde ----------

// Jouw ruilronde, van 1 tot N: in welke volgorde loop je je favorieten af?
// Het cijfer komt in de ster te staan.
//
// TWEE KEUZES, ALLEBEI OM EEN REDEN — je loopt fysiek rond met een album:
//   GENUMMERD PER RUILER, niet per sticker. Je gaat naar een persoon, dus
//   blijven alle stickers van dezelfde ruiler bij elkaar; de volgorde van de
//   ruilers is die van de rangschikking hierboven.
//   BINNEN EEN RUILER OP ALBUMPAGINA, over de twee kolommen heen. Dan blader
//   je je boek bij elke persoon een keer van voor naar achter door, in plaats
//   van heen en weer tussen "wat hij heeft" en "wat hij wil".
//
// Bewust altijd albumvolgorde, ook als de gebruiker de landen alfabetisch
// sorteert: die keuze gaat over de weergave, deze volgorde over het
// doorbladeren van een papieren album.
//
// Alleen gereserveerde stickers krijgen een nummer. De ronde is jouw plan, en
// je plan zijn je favorieten — elke sticker nummeren maakt er weer een lijst
// van waar je zelf doorheen moet.
function berekenRuilroute(groepen) {
  const route = new Map();
  let nummer = 0;
  groepen.forEach((groep) => {
    [...groep.heeft, ...groep.wil]
      .filter((rij) => favorietStand(rij) === "gekozen")
      .sort((a, b) => {
        const verschil = vergelijkLanden(a, b, "pagina");
        if (verschil !== 0) return verschil;
        return (Number(a.nummer) || 0) - (Number(b.nummer) || 0);
      })
      .forEach((rij) => route.set(routeSleutel(rij), ++nummer));
  });
  return route;
}

function routeSleutel(rij) {
  return `${rij.code}|${rij.richting}|${rij.ander_kind_id}`;
}

function teken() {
  const inhoud = document.getElementById("ruil-inhoud");
  inhoud.textContent = "";

  const alles = actieveMatches();
  // Volgorde van belang: kansen voedt de rangschikking, de rangschikking voedt
  // de toewijzing van algemene favorieten, en die weer de route.
  kansen = berekenKansen(alles);
  favorietenWeergave = berekenFavorietenWeergave(alles);
  // Op ALLE ruilkansen, niet op de gefilterde: je ruilronde is een plan, en een
  // zoekterm is om iets op te zoeken. Anders hernummert typen in het zoekveld
  // je hele ronde en herrangschikt het je advies.
  const alleGroepen = groepeerEnRangschikRuilers(alles, favorietenWeergave);
  etiketten = bepaalEtiketten(alleGroepen);
  ruilroute = berekenRuilroute(alleGroepen);

  const rijen = alles.filter(rijMatcht);
  tekenTeller(alles.length, rijen.length);

  if (alles.length === 0) {
    inhoud.appendChild(
      melding(
        "Nog geen ruilkansen voor deze verzamelaar. Die verschijnen zodra iemand anders een sticker dubbel heeft die jij zoekt, of omgekeerd."
      )
    );
    tekenAfspraken();
    return;
  }

  if (alleGroepen.length >= 2) inhoud.appendChild(ruilplanner(alleGroepen));

  if (rijen.length === 0) {
    inhoud.appendChild(melding("Geen ruilkansen die passen bij je zoekterm."));
  } else if (weergave === "land") {
    tekenPerLand(inhoud, rijen);
  } else {
    tekenPerRuiler(inhoud, rijen);
  }

  tekenAfspraken();
}

function tekenTeller(totaal, getoond) {
  const el = document.getElementById("ruil-teller");
  if (!totaal) {
    el.textContent = "";
    return;
  }
  el.textContent = zoekterm
    ? `${getoond} van ${totaal} ruilkansen`
    : `${totaal} ruilkans${totaal === 1 ? "" : "en"}`;
}

// ---------- de ruilplanner ----------

// "Beste ruilkansen": de kop van de pagina beantwoordt de vraag waarvoor je
// hier komt — met wie ga ik eerst praten? Dezelfde rangschikking en dezelfde
// redenen als de kaarten eronder (groepeerEnRangschikRuilers en
// ruilerRedenen), want twee lijstjes die elk hun eigen volgorde verzinnen zijn
// erger dan geen lijstje.
//
// BEWUST GEEN SCORE. Een getal als "96" leest als een percentage, terwijl het
// een som van verzonnen gewichten is; en hoe je die som ook aggregeert, ze
// klopt niet (zie de uitleg bij groepeerEnRangschikRuilers). Wat hier staat
// zijn wel cijfers, maar cijfers die je kan natellen: hoeveel stickers, hoeveel
// favorieten, hoeveel je nergens anders krijgt, hoeveel ruilen erin passen.
const PLANNER_MAX = 10;

function ruilplanner(groepen) {
  const sectie = document.createElement("section");
  sectie.className = "card planner";

  const titel = document.createElement("h2");
  titel.textContent = "🎯 Beste ruilkansen";
  sectie.appendChild(titel);

  const uitleg = document.createElement("p");
  uitleg.className = "form-meta";
  uitleg.textContent =
    "Met wie ga je best eerst praten? De volgorde is die van de kaarten hieronder: eerst je eigen favorieten, dan de ruilers waar het langs twee kanten klopt, dan wat je nergens anders krijgt, en pas daarna wie er het meeste heeft. Er staat geen puntentotaal bij — enkel cijfers die je kan natellen.";
  sectie.appendChild(uitleg);

  if (zoekterm) {
    const filternota = document.createElement("p");
    filternota.className = "form-meta form-meta--plat planner__filternota";
    filternota.textContent =
      "Je zoekterm filtert de lijst hieronder, niet dit advies — een ruilronde plan je op alles wat er ligt.";
    sectie.appendChild(filternota);
  }

  const lijst = document.createElement("ol");
  lijst.className = "planner__lijst";
  groepen.slice(0, PLANNER_MAX).forEach((groep, index) => {
    lijst.appendChild(plannerRij(groep, index + 1));
  });
  sectie.appendChild(lijst);

  if (groepen.length > PLANNER_MAX) {
    const rest = document.createElement("p");
    rest.className = "form-meta form-meta--plat";
    rest.textContent = `Nog ${groepen.length - PLANNER_MAX} andere ruiler${
      groepen.length - PLANNER_MAX === 1 ? "" : "s"
    } hieronder.`;
    sectie.appendChild(rest);
  }

  return sectie;
}

function plannerRij(groep, plaats) {
  const info = groep.info;
  const li = document.createElement("li");
  li.className = "planner__rij";

  const nummer = document.createElement("span");
  nummer.className = "planner__plaats";
  nummer.textContent = `#${plaats}`;
  nummer.setAttribute("aria-hidden", "true");
  li.appendChild(nummer);

  const kern = document.createElement("div");
  kern.className = "planner__kern";

  const kop = document.createElement("div");
  kop.className = "planner__kop";

  // Een knop en geen anker: het doel kan op dit moment weggefilterd zijn, en
  // dan schakelt springNaarRuiler() eerst de weergave of het zoekveld om.
  const naam = document.createElement("button");
  naam.type = "button";
  naam.className = "planner__naam";
  naam.textContent = info.ander_kind;
  naam.setAttribute("aria-label", `Plaats ${plaats}: ga naar ${info.ander_kind}`);
  naam.addEventListener("click", () => springNaarRuiler(info.ander_kind_id));
  kop.appendChild(naam);

  if (info.ander_wijk) {
    const wijk = document.createElement("span");
    wijk.className = "chip ruiler-kaart__wijk";
    wijk.textContent = info.ander_wijk;
    kop.appendChild(wijk);
  }

  const etiket = ruilerEtiket(groep);
  if (etiket) {
    const badge = document.createElement("span");
    badge.className = "planner__etiket planner__etiket--" + etiket.soort;
    badge.textContent = etiket.tekst;
    badge.title = etiket.uitleg;
    kop.appendChild(badge);
  }

  kern.appendChild(kop);

  const reden = document.createElement("p");
  reden.className = "planner__reden";
  reden.textContent = ruilerRedenen(groep).join(" · ");
  kern.appendChild(reden);

  li.appendChild(kern);
  return li;
}

// Vanuit de planner naar de kaart zelf. Drie dingen kunnen in de weg staan, en
// alle drie worden ze weggenomen in plaats van dat de klik niets doet: de
// weergave staat op "Per land" (er zijn dan geen ruilerkaarten), de zoekterm
// filtert deze ruiler weg, of de kaart staat gewoon buiten beeld.
function springNaarRuiler(anderId) {
  if (weergave !== "ruiler") {
    weergave = "ruiler";
    const keuze = document.getElementById("ruil-weergave");
    if (keuze) keuze.value = "ruiler";
    teken();
  }
  if (!kaartVanRuiler(anderId) && zoekterm) {
    zoekterm = "";
    const veld = document.getElementById("ruil-zoek");
    if (veld) veld.value = "";
    teken();
  }
  const kaart = kaartVanRuiler(anderId);
  if (!kaart) return;
  kaart.scrollIntoView({ behavior: "smooth", block: "start" });
  kaart.classList.add("ruiler-kaart--gevonden");
  setTimeout(() => kaart.classList.remove("ruiler-kaart--gevonden"), 2500);
}

function kaartVanRuiler(anderId) {
  return document.querySelector(`.ruiler-kaart[data-ruiler="${anderId}"]`);
}

// ---------- weergave: per ruiler ----------

function tekenPerRuiler(doel, rijen) {
  const gesorteerd = groepeerEnRangschikRuilers(rijen, favorietenWeergave);
  gesorteerd.forEach((groep) => doel.appendChild(ruilerKaart(groep)));
}

// Groepeert ruilkansen per ruiler en rangschikt ze — de volgorde waarin je ze
// het best afgaat. favorietenBron bepaalt welke favorieten meetellen: de
// kaarten zelf gebruiken favorietenWeergave (met algemene favorieten al
// toegewezen), berekenFavorietenWeergave() gebruikt bewust enkel de concrete
// rijen om diezelfde toewijzing zonder circulaire afhankelijkheid te maken.
//
// BEWUST EEN KETEN VAN VERGELIJKINGEN EN GEEN PUNTENTOTAAL. Een puntensom
// (favoriet +100, zeldzaam +50, …) lijkt preciezer maar is het niet:
//   - Optellen over de stickers heen laat bundelgrootte alles overheersen —
//     twaalf gewone stickers verslaan dan een favoriet. Middelen of het
//     maximum nemen draait dat om en is even willekeurig.
//   - Een totaal als "96" leest als een percentage terwijl het dat niet is.
//   - Tweerichting is geen bonuspunt maar een POORT: sql/016 laat een ruil
//     niet registreren als het maar langs één kant klopt. Optellen laat iemand
//     bovenaan komen met wie je niets kan afspreken.
//   - En een som valt niet uit te leggen. Deze keten wél: elke stap hieronder
//     is één zin in ruilerRedenen(), in dezelfde volgorde.
//
//   1. FAVORIETEN — jouw eigen keuze overheerst de rest, anders is het geen
//      keuze meer.
//   2. TWEERICHTING — wil die persoon ook iets van jou? Dit weegt zwaar, want
//      sql/016 laat een ruil pas registreren als het langs twee kanten klopt.
//      Eenrichting is geen ruil.
//   3. ENIGE KANS — ligt hier iets dat bij niemand anders van jouw ruilers
//      ligt? Dat kan morgen weg zijn; een extra sticker in de bundel niet.
//      Persoonlijke schaarste, zie berekenKansen() voor waarom niet globaal.
//   4. BUNDELGROOTTE — zes stickers bij één iemand verslaat zes keer één,
//      want je gaat fysiek naar een persoon toe.
//   5. NAAM — zodat de volgorde niet blijft verspringen bij gelijke stand.
function groepeerEnRangschikRuilers(rijen, favorietenBron) {
  const perRuiler = new Map();
  rijen.forEach((rij) => {
    if (!perRuiler.has(rij.ander_kind_id)) {
      perRuiler.set(rij.ander_kind_id, {
        info: rij,
        heeft: [],
        wil: [],
        favorieten: 0,
        enigeHeeft: 0, // krijg je enkel hier
        enigeWil: 0, // raak je enkel hier kwijt
        ruim: true, // alles wat hier ligt, ligt ook ruim elders
      });
    }
    const groep = perRuiler.get(rij.ander_kind_id);
    (rij.richting === "jij_zoekt" ? groep.heeft : groep.wil).push(rij);
    const gereserveerd = favorietenBron.some(
      (f) => f.code === rij.code && f.richting === rij.richting && f.ander_kind_id === rij.ander_kind_id
    );
    if (gereserveerd) groep.favorieten += 1;
    if (enigeKans(rij)) {
      if (rij.richting === "jij_zoekt") groep.enigeHeeft += 1;
      else groep.enigeWil += 1;
    }
    if (!ruimeKans(rij)) groep.ruim = false;
  });

  perRuiler.forEach((groep) => {
    groep.enige = groep.enigeHeeft + groep.enigeWil;
    // Hoeveel ruilen kan je met deze persoon effectief doen? Elke ruil is één
    // sticker van hem tegen één van jou (sql/016 registreert per paar), dus
    // meer dan het kleinste van de twee kolommen gaat niet. Dit is het getal
    // waarmee "hij heeft veel voor jou" een keuze wordt in plaats van een
    // buit — en het is wat berekenFavorietenWeergave() gebruikt om een
    // favoriet bij de juiste ruiler te leggen.
    groep.capaciteit = Math.min(groep.heeft.length, groep.wil.length);
  });

  return [...perRuiler.values()].sort((a, b) => {
    if (a.favorieten !== b.favorieten) return b.favorieten - a.favorieten;
    const tweeA = a.heeft.length && a.wil.length ? 1 : 0;
    const tweeB = b.heeft.length && b.wil.length ? 1 : 0;
    if (tweeA !== tweeB) return tweeB - tweeA;
    if (a.enige !== b.enige) return b.enige - a.enige;
    const somA = a.heeft.length + a.wil.length;
    const somB = b.heeft.length + b.wil.length;
    if (somA !== somB) return somB - somA;
    return String(a.info.ander_kind).localeCompare(String(b.info.ander_kind), "nl");
  });
}

// Waarom staat deze ruiler waar hij staat? In dezelfde volgorde als de
// sortering hierboven, zodat de uitleg en de rangschikking niet uit elkaar
// kunnen lopen. Een kind moet kunnen zien waarom het portaal zegt "ga eerst
// naar Jules" — een lijst zonder reden is een orakel.
//
// Alle getallen hier zijn ECHTE getallen — aantallen stickers, aantallen
// ruilen — en geen punten. "3 stickers samen · plaats voor 1 ruil" zegt iets
// dat je kan natellen; "score 96" niet.
function ruilerRedenen(groep) {
  const redenen = [];
  if (groep.favorieten) {
    redenen.push(`★ ${groep.favorieten} favoriet${groep.favorieten === 1 ? "" : "en"}`);
  }
  if (groep.heeft.length && groep.wil.length) {
    redenen.push("ruil kan meteen rond");
  }
  if (groep.enigeHeeft) {
    redenen.push(
      `${groep.enigeHeeft} sticker${groep.enigeHeeft === 1 ? "" : "s"} krijg je enkel hier`
    );
  }
  if (groep.enigeWil) {
    redenen.push(
      `${groep.enigeWil} dubbel${groep.enigeWil === 1 ? "" : "s"} raak je enkel hier kwijt`
    );
  }
  const som = groep.heeft.length + groep.wil.length;
  redenen.push(`${som} sticker${som === 1 ? "" : "s"} samen`);
  // Meer op tafel dan er ruilen in passen: dan is dit geen "alles meenemen"
  // maar een "kies goed", en dat is precies de situatie waarin het uitmaakt
  // bij wie je welke sticker haalt.
  if (groep.capaciteit && som > groep.capaciteit * 2) {
    redenen.push(`plaats voor ${groep.capaciteit} ruil${groep.capaciteit === 1 ? "" : "en"}`);
  }
  return redenen;
}

// Het strategische etiket: nu langsgaan of gerust laten liggen?
//
// De oorspronkelijke opzet redeneerde omgekeerd ("ga eerst bij Ivo, dan houdt
// Emma haar opties"), maar Emma's stickers lopen geen gevaar door JOU — wel
// door andere verzamelaars. Wat je zelf in de hand hebt is de volgorde waarin
// je onvervangbare dingen veiligstelt. Dus: waar iets ligt dat nergens anders
// ligt, ga je eerst langs. Dat "haal FRA12 bij Ivo en niet bij Emma" hoort
// niet hier maar bij de toewijzing van de favoriet zelf — zie
// berekenFavorietenWeergave(), die daar de capaciteit voor gebruikt.
//
// VERGELIJKEND EN NIET ABSOLUUT, en dat is het hele punt. "Deze ruiler heeft
// iets dat nergens anders ligt" klinkt als een zeldzame gebeurtenis, maar in
// een wijk met enkele tientallen deelnemers en 1034 stickers is het eerder
// regel dan uitzondering: de meeste stickers liggen nu eenmaal bij één of twee
// mensen. Een vlag die iedereen krijgt, zegt niets — dus krijgt alleen wie er
// het MEEST van heeft er een, en niemand zodra iedereen gelijk staat.
//
// Etiketten worden daarom één keer per tekenbeurt bepaald over ALLE ruilers en
// niet per kaart: een vergelijking heeft de anderen nodig, en zo tonen de
// planner bovenaan en de kaart eronder gegarandeerd hetzelfde.
let etiketten = new Map(); // ander_kind_id -> etiket of niets

const ETIKET_NU = {
  tekst: "🔥 Eerst langsgaan",
  soort: "nu",
  uitleg:
    "Hier ligt het meeste dat bij geen enkele andere ruiler van jou ligt. Is dit weg, dan is de kans weg.",
};
const ETIKET_LATER = {
  tekst: "⭐ Kan wachten",
  soort: "later",
  uitleg:
    "Alles wat hier ligt, ligt ook ruim bij anderen. Deze ruiler loopt niet weg — doe eerst het dringende.",
};

function bepaalEtiketten(groepen) {
  const kaart = new Map();
  // "Eerst langsgaan" alleen bij wie je effectief kan ruilen. Tweerichting is
  // overal in dit bestand een poort en niet een pluspunt (sql/016 registreert
  // enkel paren), en een vuurtje op de onderste kaart zou de rangschikking
  // tegenspreken. Ook de lat zelf ligt bij die groep: een eenrichtingscontact
  // met veel unieke stickers mag het etiket niet bij iedereen wegdrukken.
  const tweerichting = groepen.filter((g) => g.heeft.length && g.wil.length);
  const meeste = tweerichting.reduce((max, g) => Math.max(max, g.enige), 0);
  // Staat iedereen gelijk, dan onderscheidt het etiket niets en blijft het weg.
  // Dat is geen randgeval: met 1034 stickers en enkele tientallen deelnemers
  // ligt bijna élke sticker bij maar één of twee mensen, dus zonder deze
  // voorwaarde zou zowat iedereen "dringend" zijn.
  const iedereenGelijk = tweerichting.every((g) => g.enige === meeste);
  groepen.forEach((groep) => {
    const kanRuilen = groep.heeft.length && groep.wil.length;
    if (kanRuilen && meeste > 0 && !iedereenGelijk && groep.enige === meeste) {
      kaart.set(groep.info.ander_kind_id, ETIKET_NU);
    } else if (groep.enige === 0 && groep.ruim) {
      kaart.set(groep.info.ander_kind_id, ETIKET_LATER);
    }
  });
  return kaart;
}

function ruilerEtiket(groep) {
  return etiketten.get(groep.info.ander_kind_id) || null;
}

function ruilerKaart(groep) {
  const kind = actiefKind();
  const info = groep.info;
  const sectie = document.createElement("section");
  sectie.className = "card ruiler-kaart";
  // Zodat de planner bovenaan naar deze kaart kan springen. Een data-attribuut
  // en geen id: ander_kind_id is een uuid en kan met een cijfer beginnen, wat
  // in een #id-selector niet werkt.
  sectie.dataset.ruiler = info.ander_kind_id;

  // ----- kop: naam, wijk, contact -----
  const kop = document.createElement("header");
  kop.className = "ruiler-kaart__kop";

  const titel = document.createElement("h2");
  titel.textContent = info.ander_kind;
  kop.appendChild(titel);

  if (info.ander_wijk) {
    const wijk = document.createElement("span");
    wijk.className = "chip ruiler-kaart__wijk";
    wijk.textContent = info.ander_wijk;
    kop.appendChild(wijk);
  }
  if (info.eigen_gezin) {
    const eigen = document.createElement("span");
    eigen.className = "chip ruiler-kaart__eigen";
    eigen.textContent = "je eigen verzamelaar";
    kop.appendChild(eigen);
  }

  const contact = document.createElement("div");
  contact.className = "ruiler-kaart__contact";
  if (info.ander_email) {
    const mail = document.createElement("a");
    mail.className = "btn btn--outline btn--sm";
    mail.href = mailtoLink(info.ander_email, kind, info);
    mail.textContent = "✉️ E-mail";
    contact.appendChild(mail);
  }
  const wa = whatsappKnop(info.ander_whatsapp, ruilBericht(kind, info), "💬 WhatsApp");
  if (wa) contact.appendChild(wa);
  if (contact.childElementCount) kop.appendChild(contact);

  sectie.appendChild(kop);

  // Waarom deze ruiler hier staat. Enkel in de weergave per ruiler, want daar
  // is de volgorde een advies; per land is ze gewoon albumvolgorde.
  const reden = document.createElement("p");
  reden.className = "ruiler-kaart__reden";
  // "Eerst langsgaan" of "kan wachten" staat vóór de redenen: het is het
  // antwoord, de redenen erna zijn de onderbouwing. Dezelfde tekst als in de
  // planner bovenaan, want het is dezelfde beoordeling.
  const etiket = ruilerEtiket(groep);
  if (etiket) {
    const badge = document.createElement("span");
    badge.className = "planner__etiket planner__etiket--" + etiket.soort;
    badge.textContent = etiket.tekst;
    badge.title = etiket.uitleg;
    reden.appendChild(badge);
    reden.appendChild(document.createTextNode(" "));
  }
  reden.appendChild(document.createTextNode(ruilerRedenen(groep).join(" · ")));
  sectie.appendChild(reden);

  // ----- selectie: welke sticker staat er links en rechts gekozen -----
  const sleutel = `${actiefKindId}|${info.ander_kind_id}`;
  const keuze = keuzePerRuiler.get(sleutel) || {};
  // Een selectie die door filteren of door een aangepaste lijst verdwenen is,
  // laten staan zou een ruil voorstellen die niet meer op het scherm staat.
  if (!groep.heeft.some((r) => r.code === keuze.ik)) keuze.ik = groep.heeft[0]?.code;
  if (!groep.wil.some((r) => r.code === keuze.ander)) keuze.ander = groep.wil[0]?.code;
  keuzePerRuiler.set(sleutel, keuze);

  // ----- mogelijke ruil: BOVENAAN, vóór de kolommen — dat is waar je hier
  // eigenlijk voor komt, en scrollen om de knop "Ruil registreren" te vinden
  // was overbodig zodra er meer dan een paar stickers stonden. -----
  if (groep.heeft.length && groep.wil.length && keuze.ik && keuze.ander) {
    sectie.appendChild(ruilVoorstel(info, keuze.ik, keuze.ander));
  } else {
    const eenzijdig = document.createElement("p");
    eenzijdig.className = "form-meta form-meta--plat ruiler-kaart__eenzijdig";
    eenzijdig.textContent = groep.heeft.length
      ? "Deze ruiler heeft iets voor jou, maar jij hebt (nog) niets dat hij zoekt — spreek gerust af, een ruil registreren kan pas als het langs twee kanten klopt."
      : "Jij hebt iets dat deze ruiler zoekt, maar hij heeft (nog) niets dat jij zoekt.";
    sectie.appendChild(eenzijdig);
  }

  // ----- drie kolommen -----
  const kolommen = document.createElement("div");
  kolommen.className = "ruiler-kaart__kolommen";
  kolommen.appendChild(
    ruilKolom("Deze ruiler heeft wat jij zoekt", groep.heeft, keuze.ik, (code) => {
      keuze.ik = code;
      teken();
    })
  );
  kolommen.appendChild(
    ruilKolom("Deze ruiler wilt jouw dubbels", groep.wil, keuze.ander, (code) => {
      keuze.ander = code;
      teken();
    })
  );
  kolommen.appendChild(
    ruilVoorstellenKolom(groep, info, keuze, (ik, ander) => {
      keuze.ik = ik;
      keuze.ander = ander;
      teken();
    })
  );
  sectie.appendChild(kolommen);

  return sectie;
}

// Eén kolom met de stickers gegroepeerd per land, in de gekozen landvolgorde.
// Elke sticker is een knop: aanklikken kiest hem als jouw kant van de ruil.
function ruilKolom(kopTekst, rijen, gekozen, opKlik) {
  const kolom = document.createElement("section");
  kolom.className = "ruilkolom";

  const kop = document.createElement("h3");
  kop.className = "ruilkolom__kop";
  kop.textContent = kopTekst;
  kolom.appendChild(kop);

  if (rijen.length === 0) {
    const leeg = document.createElement("p");
    leeg.className = "ruilkolom__leeg";
    leeg.textContent = "Niets";
    kolom.appendChild(leeg);
    return kolom;
  }

  const gemarkeerd = doorMijBevestigd();

  groepeerPerLand(rijen).forEach((land) => {
    const blok = document.createElement("div");
    blok.className = "ruilkolom__land";

    const naam = document.createElement("h4");
    naam.className = "ruilkolom__landnaam";
    const streep = document.createElement("span");
    streep.className = "land-streep";
    streep.style.backgroundColor = accentVoor(land.land_code);
    naam.appendChild(streep);
    naam.appendChild(document.createTextNode(landLabel(land)));
    blok.appendChild(naam);

    const lijst = document.createElement("ul");
    lijst.className = "ruilkolom__stickers";
    land.rijen.forEach((rij) => {
      const li = document.createElement("li");
      li.className = "ruilkolom__rij";
      if (favorietenBeschikbaar) li.appendChild(favorietKnop(rij));
      const knop = document.createElement("button");
      knop.type = "button";
      knop.className = "ruilsticker";
      if (rij.code === gekozen) knop.classList.add("ruilsticker--gekozen");
      if (gemarkeerd.has(rij.code)) knop.classList.add("ruilsticker--geruild");
      knop.setAttribute("aria-pressed", String(rij.code === gekozen));
      knop.title = rij.sticker_naam || rij.code;

      const code = document.createElement("span");
      code.className = "ruilsticker__code";
      code.textContent = rij.code;
      knop.appendChild(code);

      if (rij.sticker_naam) {
        const spelernaam = document.createElement("span");
        spelernaam.className = "ruilsticker__naam";
        spelernaam.textContent = rij.sticker_naam;
        knop.appendChild(spelernaam);
      }
      if (rij.aantal > 1) {
        const aantal = document.createElement("span");
        aantal.className = "ruilsticker__aantal";
        aantal.textContent = `×${rij.aantal}`;
        knop.appendChild(aantal);
      }

      knop.addEventListener("click", () => opKlik(rij.code));
      li.appendChild(knop);
      lijst.appendChild(li);
    });
    blok.appendChild(lijst);
    kolom.appendChild(blok);
  });

  return kolom;
}

// Derde kolom: élke combinatie van "heeft" × "wil" als één klikbare rij, in
// plaats van eerst links en dan rechts apart een sticker te moeten kiezen.
// Eén klik hier zet allebei tegelijk. Voorstellen met een favoriet aan een van
// beide kanten staan vooraan (met een ster) — dat is precies waar de
// sterretjes van sql/018 voor dienen: laten zien welke ruil je zelf al wou.
//
// Bewust GEEN aparte kolom per land: het gaat hier om paren, en een paar
// bestaat uit twee verschillende landen (jouw land, zijn land). Ze onder een
// gedeelde landnaam zetten zou een van beide moeten weglaten.
function ruilVoorstellenKolom(groep, info, keuze, opKies) {
  const kolom = document.createElement("section");
  kolom.className = "ruilkolom ruilkolom--voorstellen";

  const kop = document.createElement("h3");
  kop.className = "ruilkolom__kop";
  kop.textContent = "Ruilvoorstellen";
  kolom.appendChild(kop);

  if (groep.heeft.length === 0 || groep.wil.length === 0) {
    const leeg = document.createElement("p");
    leeg.className = "ruilkolom__leeg";
    leeg.textContent = "Nog geen combinatie mogelijk";
    kolom.appendChild(leeg);
    return kolom;
  }

  // Alle combinaties, met favorieten als gewicht. Array.prototype.sort is
  // sinds ES2019 stabiel, dus binnen hetzelfde gewicht blijft de volgorde van
  // de twee kolommen hiernaast (en dus de albumvolgorde) behouden.
  const voorstellen = [];
  groep.heeft.forEach((h) => {
    groep.wil.forEach((w) => {
      const gewicht =
        (favorietenBeschikbaar && favorietStand(h) === "gekozen" ? 1 : 0) +
        (favorietenBeschikbaar && favorietStand(w) === "gekozen" ? 1 : 0);
      voorstellen.push({ h, w, gewicht });
    });
  });
  voorstellen.sort((a, b) => b.gewicht - a.gewicht);

  const lijst = document.createElement("ul");
  lijst.className = "ruilkolom__stickers";
  voorstellen.forEach(({ h, w, gewicht }) => {
    const li = document.createElement("li");
    const knop = document.createElement("button");
    knop.type = "button";
    knop.className = "ruilvoorstel-item";
    const gekozen = h.code === keuze.ik && w.code === keuze.ander;
    knop.classList.toggle("ruilvoorstel-item--gekozen", gekozen);
    knop.setAttribute("aria-pressed", String(gekozen));

    if (gewicht > 0) {
      const ster = document.createElement("span");
      ster.className = "ruilvoorstel-item__ster";
      ster.textContent = "★".repeat(gewicht);
      ster.setAttribute("aria-hidden", "true");
      knop.appendChild(ster);
    }

    const paar = document.createElement("span");
    paar.className = "ruilvoorstel-item__paar";
    paar.textContent = `${h.code} ⇄ ${w.code}`;
    knop.appendChild(paar);

    const spelers = [h.sticker_naam, w.sticker_naam].filter(Boolean).join(" ⇄ ");
    knop.title = spelers ? `${h.code} ⇄ ${w.code} — ${spelers}` : `${h.code} ⇄ ${w.code}`;
    if (zoekAfspraak(info.ander_kind_id, h.code, w.code)) {
      knop.title += " (al geregistreerd)";
      knop.classList.add("ruilvoorstel-item--geregistreerd");
    }

    knop.addEventListener("click", () => opKies(h.code, w.code));
    li.appendChild(knop);
    lijst.appendChild(li);
  });
  kolom.appendChild(lijst);
  return kolom;
}

function ruilVoorstel(info, ikKrijg, anderKrijgt) {
  const vak = document.createElement("div");
  vak.className = "ruilvoorstel";

  const titel = document.createElement("p");
  titel.className = "ruilvoorstel__titel";
  titel.textContent = "Mogelijke ruil";
  vak.appendChild(titel);

  const paar = document.createElement("p");
  paar.className = "ruilvoorstel__paar";
  paar.textContent = `${ikKrijg} ⇄ ${anderKrijgt}`;
  vak.appendChild(paar);

  const knop = document.createElement("button");
  knop.type = "button";
  knop.className = "btn btn--primary btn--sm";

  const bestaande = zoekAfspraak(info.ander_kind_id, ikKrijg, anderKrijgt);
  if (bestaande) {
    knop.disabled = true;
    knop.textContent =
      bestaande.status === "VOLTOOID" ? "✔ Al geruild" : "✔ Al geregistreerd";
  } else {
    knop.textContent = "Ruil registreren";
    knop.addEventListener("click", () => openDialoog(info, ikKrijg, anderKrijgt));
  }
  vak.appendChild(knop);
  return vak;
}

// ---------- weergave: per land ----------

function tekenPerLand(doel, rijen) {
  groepeerPerLand(rijen).forEach((land) => {
    const sectie = document.createElement("section");
    sectie.className = "card landkaart";

    const titel = document.createElement("h2");
    titel.className = "landkaart__titel";
    const streep = document.createElement("span");
    streep.className = "land-streep";
    streep.style.backgroundColor = accentVoor(land.land_code);
    titel.appendChild(streep);
    titel.appendChild(document.createTextNode(landLabel(land)));
    sectie.appendChild(titel);

    // Per sticker: wie heeft ze dubbel, en wie zoekt ze. Dezelfde sticker kan
    // in beide kolommen staan — dan heeft de ene ruiler ze dubbel en zoekt een
    // andere ze bij jou.
    const perCode = new Map();
    land.rijen.forEach((rij) => {
      if (!perCode.has(rij.code)) perCode.set(rij.code, { rij, heeft: [], zoekt: [] });
      const groep = perCode.get(rij.code);
      // De volledige rij, niet enkel de naam: namenLijst() heeft ander_kind_id
      // en richting nodig om er een favorietKnop() bij te zetten.
      (rij.richting === "jij_zoekt" ? groep.heeft : groep.zoekt).push(rij);
    });

    const gemarkeerd = doorMijBevestigd();
    const lijst = document.createElement("div");
    lijst.className = "landkaart__stickers";

    [...perCode.values()]
      .sort((a, b) => a.rij.nummer - b.rij.nummer)
      .forEach((groep) => {
        const blok = document.createElement("article");
        blok.className = "stickerblok";
        if (gemarkeerd.has(groep.rij.code)) blok.classList.add("stickerblok--geruild");

        const kop = document.createElement("h3");
        kop.className = "stickerblok__code";
        kop.textContent = groep.rij.code;
        if (groep.rij.sticker_naam) {
          const naam = document.createElement("span");
          naam.className = "stickerblok__naam";
          naam.textContent = groep.rij.sticker_naam;
          kop.appendChild(naam);
        }
        blok.appendChild(kop);

        blok.appendChild(namenLijst("Ruilers die deze sticker hebben", groep.heeft));
        blok.appendChild(namenLijst("Ruilers die deze sticker zoeken", groep.zoekt));
        lijst.appendChild(blok);
      });

    sectie.appendChild(lijst);
    doel.appendChild(sectie);
  });
}

// rijen: volledige get_matches()-rijen (niet enkel namen), zodat elke ruiler
// hier dezelfde favorietKnop() kan krijgen als op de kaarten in "Per ruiler"
// — dezelfde sterretjes, ongeacht welke weergave je gebruikt.
function namenLijst(kopTekst, rijen) {
  const vak = document.createElement("div");
  vak.className = "stickerblok__kolom";

  const kop = document.createElement("p");
  kop.className = "stickerblok__kolomkop";
  kop.textContent = kopTekst;
  vak.appendChild(kop);

  const ul = document.createElement("ul");
  ul.className = "stickerblok__namen";
  if (rijen.length === 0) {
    const li = document.createElement("li");
    li.className = "stickerblok__leeg";
    li.textContent = "Niemand";
    ul.appendChild(li);
  } else {
    // Dezelfde ruiler kan er meermaals in zitten (twee kinderen, of dezelfde
    // sticker langs twee kanten); één keer tonen volstaat — op ander_kind_id,
    // niet op naam, want twee verzamelaars kunnen dezelfde voornaam hebben.
    [...new Map(rijen.map((r) => [r.ander_kind_id, r])).values()]
      .sort((a, b) => String(a.ander_kind).localeCompare(String(b.ander_kind), "nl"))
      .forEach((rij) => {
        const li = document.createElement("li");
        li.className = "stickerblok__naam-rij";
        if (favorietenBeschikbaar) li.appendChild(favorietKnop(rij));
        const naam = document.createElement("span");
        naam.textContent = rij.ander_kind;
        li.appendChild(naam);
        ul.appendChild(li);
      });
  }
  vak.appendChild(ul);
  return vak;
}

// ---------- groeperen en sorteren ----------

// Landen in de door de gebruiker gekozen volgorde (albumvolgorde of
// alfabetisch op de Engelse naam), stickers daarbinnen op albumnummer.
function groepeerPerLand(rijen) {
  const perLand = new Map();
  rijen.forEach((rij) => {
    if (!perLand.has(rij.land_code)) {
      perLand.set(rij.land_code, {
        land_code: rij.land_code,
        land_naam: rij.land_naam,
        land_naam_en: rij.land_naam_en,
        pagina: rij.pagina,
        rijen: [],
      });
    }
    perLand.get(rij.land_code).rijen.push(rij);
  });

  const landen = [...perLand.values()].sort((a, b) => vergelijkLanden(a, b, landsortering));
  landen.forEach((land) => land.rijen.sort((a, b) => a.nummer - b.nummer));
  return landen;
}

// ---------- afspraken ----------

// Alle stickers waarvan JIJ zei dat ze effectief geruild zijn. Enkel jouw
// eigen bevestiging telt: wat de andere ruiler aanduidt, kleurt jouw scherm
// niet. Beide codes van de ruil horen erbij — je geeft er een en krijgt er een,
// en allebei vragen ze dat je je eigen lijst nakijkt.
function doorMijBevestigd() {
  const codes = new Set();
  afspraken.forEach((r) => {
    const mijnKant =
      (r.eigen_kind_id === actiefKindId && r.eigen_bevestigd) ||
      (r.ander_kind_id === actiefKindId && r.ander_bevestigd);
    if (mijnKant) {
      codes.add(r.eigen_krijgt);
      codes.add(r.ander_krijgt);
    }
  });
  return codes;
}

// Bestaat er al een afspraak met deze ruiler over precies deze twee stickers?
function zoekAfspraak(anderKindId, ikKrijg, anderKrijgt) {
  return afspraken.find(
    (r) =>
      r.eigen_kind_id === actiefKindId &&
      r.ander_kind_id === anderKindId &&
      r.eigen_krijgt === ikKrijg &&
      r.ander_krijgt === anderKrijgt
  );
}

function afsprakenVanKind() {
  return afspraken.filter(
    (r) => r.eigen_kind_id === actiefKindId || r.ander_kind_id === actiefKindId
  );
}

function tekenAfspraken() {
  const kaart = document.getElementById("ruil-afspraken");
  const lijst = document.getElementById("ruil-afspraken-lijst");
  const rijen = afsprakenVanKind();

  lijst.textContent = "";
  kaart.classList.toggle("hidden", rijen.length === 0);
  if (rijen.length === 0) return;

  rijen.forEach((r) => lijst.appendChild(afspraakBlok(r)));
}

function afspraakBlok(r) {
  // mijn_ruilen() draait elke rij naar het eigen gezin toe, maar bij een ruil
  // tussen twee eigen verzamelaars zit de actieve verzamelaar soms aan de
  // "andere" kant. Deze omdraaiing zet hem altijd links.
  const omgedraaid = r.ander_kind_id === actiefKindId && r.eigen_kind_id !== actiefKindId;
  const ik = omgedraaid
    ? { id: r.ander_kind_id, naam: r.ander_kind, krijgt: r.ander_krijgt, naamSticker: r.ander_krijgt_naam, bevestigd: r.ander_bevestigd }
    : { id: r.eigen_kind_id, naam: r.eigen_kind, krijgt: r.eigen_krijgt, naamSticker: r.eigen_krijgt_naam, bevestigd: r.eigen_bevestigd };
  const ander = omgedraaid
    ? { id: r.eigen_kind_id, naam: r.eigen_kind, krijgt: r.eigen_krijgt, naamSticker: r.eigen_krijgt_naam, bevestigd: r.eigen_bevestigd }
    : { id: r.ander_kind_id, naam: r.ander_kind, krijgt: r.ander_krijgt, naamSticker: r.ander_krijgt_naam, bevestigd: r.ander_bevestigd };

  const blok = document.createElement("article");
  blok.className = "afspraak";
  if (r.status === "VOLTOOID") blok.classList.add("afspraak--voltooid");

  const kop = document.createElement("header");
  kop.className = "afspraak__kop";
  const titel = document.createElement("h3");
  titel.textContent = `${ik.krijgt} ⇄ ${ander.krijgt}`;
  kop.appendChild(titel);
  const status = document.createElement("span");
  status.className =
    "chip afspraak__status-chip" + (r.status === "VOLTOOID" ? " afspraak__status-chip--klaar" : "");
  status.textContent = r.status === "VOLTOOID" ? "Voltooid" : "Geregistreerd";
  kop.appendChild(status);
  blok.appendChild(kop);

  const wie = document.createElement("p");
  wie.className = "afspraak__wie";
  wie.textContent =
    `${ik.naam} ontvangt ${stickerTekst(ik.krijgt, ik.naamSticker)} · ` +
    `${ander.naam} ontvangt ${stickerTekst(ander.krijgt, ander.naamSticker)}`;
  blok.appendChild(wie);

  const stappen = document.createElement("ul");
  stappen.className = "afspraak__stappen";
  stappen.appendChild(stap(true, "Registratie aangemaakt"));
  stappen.appendChild(stap(Boolean(ik.bevestigd), `Bevestigd door ${ik.naam}`));
  stappen.appendChild(stap(Boolean(ander.bevestigd), `Bevestigd door ${ander.naam}`));
  blok.appendChild(stappen);

  // Enkel voor je eigen kant een knop. Bij een ruil binnen het eigen gezin
  // zijn beide kanten van jou en krijg je er dus twee.
  const acties = document.createElement("div");
  acties.className = "form-actions afspraak__acties";
  acties.appendChild(bevestigKnop(r.id, ik));
  if (r.eigen_gezin) acties.appendChild(bevestigKnop(r.id, ander));
  blok.appendChild(acties);

  if (ik.bevestigd) {
    const uitleg = document.createElement("p");
    uitleg.className = "form-meta form-meta--plat afspraak__herinnering";
    uitleg.textContent =
      "Jij bevestigde deze ruil — de betrokken stickers staan hierboven lichtrood. Vergeet ze niet zelf aan te passen bij je verzamelaar.";
    blok.appendChild(uitleg);
  }

  return blok;
}

function stap(gedaan, tekst) {
  const li = document.createElement("li");
  li.className = "afspraak__stap" + (gedaan ? " afspraak__stap--gedaan" : "");
  li.textContent = `${gedaan ? "☑" : "☐"} ${tekst}`;
  return li;
}

function bevestigKnop(ruilId, kant) {
  const knop = document.createElement("button");
  knop.type = "button";
  knop.className = kant.bevestigd ? "btn btn--outline btn--sm" : "btn btn--primary btn--sm";
  knop.textContent = kant.bevestigd
    ? `↶ Bevestiging van ${kant.naam} intrekken`
    : `✔ ${kant.naam}: deze sticker werd effectief geruild`;
  knop.addEventListener("click", async () => {
    knop.disabled = true;
    toonAfspraakMelding("");
    try {
      const { error } = await supabase.rpc("ruil_bevestigen", {
        p_ruil_id: ruilId,
        p_kind_id: kant.id,
        p_bevestigd: !kant.bevestigd,
      });
      if (error) throw error;
      await verversNaWijziging();
    } catch (err) {
      knop.disabled = false;
      toonAfspraakMelding("Bevestigen lukte niet: " + err.message);
    }
  });
  return knop;
}

// De melding hangt onder de lijst met afspraken en niet in een alert-venster:
// wat er misging blijft zo staan naast de ruil waar het over gaat.
function toonAfspraakMelding(tekst) {
  const el = document.getElementById("ruil-afspraken-melding");
  if (!el) return;
  el.textContent = tekst;
  el.className = tekst ? "message message--show message--error" : "message";
}

// ---------- registreren ----------

function koppelDialoog() {
  const dialoog = document.getElementById("ruil-dialoog");
  document.getElementById("ruil-dialoog-ok").addEventListener("click", async () => {
    if (!openVoorstel) return;
    const knop = document.getElementById("ruil-dialoog-ok");
    const fout = document.getElementById("ruil-dialoog-fout");
    knop.disabled = true;
    fout.className = "message";
    try {
      const { error } = await supabase.rpc("ruil_registreren", {
        p_eigen_kind: actiefKindId,
        p_ander_kind: openVoorstel.anderKindId,
        p_ik_krijg: openVoorstel.ikKrijg,
        p_ander_krijgt: openVoorstel.anderKrijgt,
      });
      if (error) throw error;
      openVoorstel = null;
      dialoog.close();
      await verversNaWijziging();
      document.getElementById("ruil-afspraken").scrollIntoView({ block: "nearest" });
    } catch (err) {
      fout.textContent = err.message;
      fout.className = "message message--show message--error";
    } finally {
      knop.disabled = false;
    }
  });
}

function openDialoog(info, ikKrijg, anderKrijgt) {
  const kind = actiefKind();
  openVoorstel = { anderKindId: info.ander_kind_id, ikKrijg, anderKrijgt };

  const inhoud = document.getElementById("ruil-dialoog-inhoud");
  inhoud.textContent = "";
  inhoud.appendChild(ontvangtRegel(kind.voornaam, ikKrijg));
  inhoud.appendChild(ontvangtRegel(info.ander_kind, anderKrijgt));

  const fout = document.getElementById("ruil-dialoog-fout");
  fout.textContent = "";
  fout.className = "message";

  document.getElementById("ruil-dialoog").showModal();
}

function ontvangtRegel(naam, code) {
  const regel = document.createElement("div");
  regel.className = "ruil-dialoog__regel";
  const wie = document.createElement("span");
  wie.className = "ruil-dialoog__wie";
  wie.textContent = `${naam} ontvangt`;
  const wat = document.createElement("strong");
  wat.className = "ruil-dialoog__wat";
  wat.textContent = code;
  regel.appendChild(wie);
  regel.appendChild(wat);
  return regel;
}

// ---------- opvolging voor de organisatie ----------

async function toonBeheer() {
  if (isBeheerder === null) {
    try {
      const { data, error } = await supabase.rpc("is_beheerder");
      if (error) throw error;
      isBeheerder = Boolean(data);
    } catch (err) {
      isBeheerder = false; // geen recht of oude databank: gewoon niets tonen
    }
  }
  if (!isBeheerder) return;

  let rijen = [];
  try {
    const { data, error } = await supabase.rpc("ruil_overzicht");
    if (error) throw error;
    rijen = data || [];
  } catch (err) {
    return;
  }

  const kaart = document.getElementById("ruil-beheer");
  kaart.classList.remove("hidden");

  const cijfers = document.getElementById("ruil-beheer-cijfers");
  cijfers.textContent = "";
  const tel = (status) => rijen.filter((r) => r.status === status).length;
  [
    ["🤝", rijen.length, "Ruilen totaal"],
    ["🕓", tel("GEREGISTREERD"), "Nog niemand bevestigd"],
    ["⏳", tel("HALF"), "Half bevestigd"],
    ["✅", tel("VOLTOOID"), "Voltooid"],
  ].forEach(([icoon, getal, label]) => cijfers.appendChild(beheerCijfer(icoon, getal, label)));

  const tabel = document.getElementById("ruil-beheer-tabel");
  tabel.textContent = "";
  const thead = document.createElement("thead");
  const koprij = document.createElement("tr");
  ["Ruil", "Kant A", "Kant B", "Status", "Open sinds"].forEach((tekst) => {
    const th = document.createElement("th");
    th.textContent = tekst;
    koprij.appendChild(th);
  });
  thead.appendChild(koprij);
  tabel.appendChild(thead);

  const body = document.createElement("tbody");
  if (rijen.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "Er is nog geen enkele ruil geregistreerd.";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  rijen.forEach((r) => body.appendChild(beheerRij(r)));
  tabel.appendChild(body);
}

function beheerCijfer(icoon, getal, label) {
  const vak = document.createElement("div");
  vak.className = "wr-cijfer";
  const i = document.createElement("span");
  i.className = "wr-cijfer__icoon";
  i.textContent = icoon;
  const g = document.createElement("span");
  g.className = "wr-cijfer__getal";
  g.textContent = String(getal);
  const l = document.createElement("span");
  l.className = "wr-cijfer__label";
  l.textContent = label;
  vak.appendChild(i);
  vak.appendChild(g);
  vak.appendChild(l);
  return vak;
}

const BEHEER_STATUS = {
  GEREGISTREERD: { tekst: "Nog niemand bevestigd", klasse: "" },
  HALF: { tekst: "Half bevestigd", klasse: "richting--zoekt" },
  VOLTOOID: { tekst: "Voltooid", klasse: "richting--dubbel" },
};

function beheerRij(r) {
  const tr = document.createElement("tr");

  const paar = document.createElement("td");
  paar.textContent = `${r.sticker_a} ⇄ ${r.sticker_b}`;
  tr.appendChild(paar);

  [
    [r.kind_a, r.sticker_a, r.bevestigd_a],
    [r.kind_b, r.sticker_b, r.bevestigd_b],
  ].forEach(([naam, code, bevestigd]) => {
    const td = document.createElement("td");
    td.textContent = `${naam} krijgt ${code} — ${bevestigd ? "bevestigd" : "nog niet bevestigd"}`;
    tr.appendChild(td);
  });

  const status = document.createElement("td");
  const chip = document.createElement("span");
  const beschrijving = BEHEER_STATUS[r.status] || { tekst: r.status, klasse: "" };
  chip.className = "richting " + beschrijving.klasse;
  chip.textContent = beschrijving.tekst + (r.zelfde_gezin ? " (zelfde gezin)" : "");
  status.appendChild(chip);
  tr.appendChild(status);

  const dagen = document.createElement("td");
  dagen.textContent =
    r.status === "VOLTOOID" ? "—" : r.dagen_open === 0 ? "vandaag" : `${r.dagen_open} dagen`;
  tr.appendChild(dagen);

  return tr;
}

// ---------- kleine hulpjes ----------

function stickerTekst(code, naam) {
  return naam ? `${code} — ${naam}` : code;
}

function mailtoLink(email, kind, rij) {
  const onderwerp = encodeURIComponent("Panini-ruil via het Ruilportaal Meulestede");
  const body = encodeURIComponent(ruilBericht(kind, rij));
  return `mailto:${email}?subject=${onderwerp}&body=${body}`;
}

function ruilBericht(kind, rij) {
  const sticker = stickerTekst(rij.code, rij.sticker_naam);
  const aantal = rij.aantal > 1 ? ` (${rij.aantal} exemplaren)` : "";
  const zin =
    rij.richting === "jij_zoekt"
      ? `${kind.voornaam} zoekt ${sticker}, en ${rij.ander_kind} heeft die dubbel${aantal}`
      : `${kind.voornaam} heeft ${sticker} dubbel${aantal}, en ${rij.ander_kind} zoekt die`;
  return `Dag! Via het Panini Ruilportaal Meulestede: ${zin}. Zullen we ruilen?`;
}

function melding(tekst) {
  const kaart = document.createElement("div");
  kaart.className = "card";
  const p = document.createElement("p");
  p.className = "form-meta form-meta--plat";
  p.textContent = tekst;
  kaart.appendChild(p);
  return kaart;
}
