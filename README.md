# Panini Ruilportaal

Een portaal waar ouders/verzamelaars aanmelden via e-mail (Supabase Magic
Link), meerdere kinderen kunnen beheren, en per kind een Panini-
stickerverzameling bijhouden (heeft / zoekt / ruilt). Gehost op Cloudflare
Pages; data en authenticatie via Supabase.

## Datamodel

```
auth.users
    └── kinderen (voornaam, familienaam, geboortejaar)
             └── stickers (nummer, status: ZOEKT | RUILT, aantal)
```

Elke rij in `kinderen` hoort bij precies één gebruiker (`user_id`). Elke rij
in `stickers` hoort bij precies één kind (`kind_id`) en dus indirect bij de
gebruiker die dat kind beheert.

## 1. Supabase instellen

1. Maak een project op supabase.com (of hergebruik een bestaand project).
2. Voer `sql/schema.sql` uit in de SQL Editor.
3. Voer `sql/002_kinderen_en_stickers.sql` uit — maakt de tabellen
   `kinderen` en `stickers` aan, met Row Level Security. **Let op:** dit
   script dropt eerst een eventueel bestaande `kinderen`/`stickers`-tabel
   (met alle rijen) voordat het ze herbouwt.
4. Voer daarna de migraties in volgorde uit: `003` → `005` → `006` → `007` →
   `008` → `009_gezin_en_whatsapp.sql` → `010_wereldreis.sql` →
   `011_wereldreis_fotos.sql` → `012_stickers_aantal.sql` →
   `013_landen_engels_en_pagina.sql` → `014_na_beurs_contact.sql` →
   `015_wijk_en_altijd_naam.sql` → `016_ruilen_registreren.sql` →
   `017_statistieken.sql` → `018_favorieten.sql` →
   `019_stickers_updated_at.sql`. Enkel `002` en de blokken die het zelf
   aankondigen zijn destructief; `009` en later zijn dat niet.
5. Authentication → Providers → zorg dat "Email" ingeschakeld staat.
   Wachtwoord-authenticatie is niet nodig: deze app gebruikt Magic Links en
   (optioneel) Google — zie §5.
6. Settings → API: kopieer de Project URL + anon/publishable key.

## 2. App configureren

Vul `SUPABASE_URL` en `SUPABASE_ANON_KEY` in [js/supabase.js](js/supabase.js).

## 3. Magic Link configuratie

Supabase → Authentication → URL Configuration:

| Instelling | Waarde |
|---|---|
| Site URL | `https://panini-4mf.pages.dev` |
| Redirect URLs | `https://panini-4mf.pages.dev`, `https://panini-4mf.pages.dev/`, `https://panini-4mf.pages.dev/dashboard.html` |

Zonder deze instellingen stuurt Supabase gebruikers na het klikken op de
magic link naar de standaardwaarde (`http://localhost:3000`) in plaats van
naar de live site.

De app verstuurt de magic link met
`emailRedirectTo: \`${window.location.origin}/dashboard.html\`` (zie
[js/auth.js](js/auth.js)), zodat een gebruiker na het klikken op de link
automatisch op het dashboard belandt en meteen ingelogd is —
`detectSessionInUrl: true` in [js/supabase.js](js/supabase.js) verwerkt de
sessie uit de URL, en `persistSession`/`autoRefreshToken` zorgen voor
automatisch sessieherstel bij een volgend bezoek.

### E-mailtemplate

De opgemaakte template staat in
[email-templates/magic-link.html](email-templates/magic-link.html). Plak de
inhoud in Supabase → Authentication → Emails → **Magic Link**, met als
onderwerp bijvoorbeeld "Je inloglink voor het Panini Ruilportaal". Supabase
vult `{{ .ConfirmationURL }}` zelf in.

**Afzender.** Standaard verstuurt Supabase via `noreply@mail.app.supabase.io`
met de naam "Supabase Auth". Om als **Meulestede vzw** te versturen is een
eigen SMTP-server nodig: Authentication → Settings → SMTP Settings. Daar stel
je sender name ("Meulestede vzw") en sender e-mail in. Zonder eigen SMTP geldt
bovendien een strenge limiet van enkele mails per uur — voldoende om te testen,
niet om in productie te draaien.

### Aanmelden lukt niet: `otp_expired`

Landt de link op `...#error=access_denied&error_code=otp_expired`, dan is de
link verlopen of al gebruikt. Meest voorkomende oorzaken:

- De link werd al eerder aangeklikt (of de pagina werd herladen) — een magic
  link is eenmalig.
- Een virusscanner of mailfilter opende de link automatisch vóór jou, waardoor
  hij al opgebruikt was.
- Er werd een oudere mail gebruikt terwijl er intussen een nieuwe link
  aangevraagd was; enkel de laatste link werkt.
- De geldigheidsduur staat te kort: Authentication → Providers → Email →
  *Email OTP Expiration*.

De app toont deze fout nu zelf op de inlogpagina met een leesbare uitleg (zie
`leesAuthFoutUitUrl()` in [js/auth.js](js/auth.js)) in plaats van een lege
pagina met enkel een foutcode in de URL.

## 4. Cloudflare Pages

1. Push code naar GitHub (`MeulestedeHost/mijnportaal`).
2. Cloudflare → Workers & Pages → Create → Pages → Connect to Git.
3. Framework preset: `None`. Build command: leeg. Output directory: `/`
   (repo-root — er is geen `public`-submap).
4. Deploy. Live URL: `https://panini-4mf.pages.dev`.

Statische HTML/CSS/JS zonder build-stap; Supabase JS wordt via een ESM-CDN
(jsdelivr) geladen — volledig compatibel met Cloudflare Pages.

## 5. Aanmelden met Google

De aanmeldpagina heeft naast de magic link een Google-knop
(`meldAanMetGoogle()` in [js/auth.js](js/auth.js)). Twee instellingen in
Supabase moeten kloppen, anders eindigt de gebruiker op een foutpagina van
Google:

1. **Authentication → Providers → Google**: aan, met de client-id en secret
   uit de Google Cloud Console. De redirect-URI die Google nodig heeft, staat
   op diezelfde Supabase-pagina (`https://<project>.supabase.co/auth/v1/callback`).
2. **Authentication → URL Configuration → Redirect URLs**: `.../dashboard.html`
   moet erin staan — dezelfde lijst als voor de magic link.

Google en de magic link leiden naar hetzelfde account zolang het om hetzelfde
e-mailadres gaat: Supabase koppelt beide identiteiten aan één rij in
`auth.users`. Voor het portaal maakt de manier van aanmelden dus niet uit — de
database kijkt naar het e-mailadres in het token (`public.jwt_email()`).

## 6. Twee volwassenen op één gezin

Sinds `sql/009_gezin_en_whatsapp.sql` hoort een verzamelaar bij een **gezin**
in plaats van bij één login. Op `gezin.html` zet een ouder de naam en het
e-mailadres van de tweede volwassene klaar; die persoon meldt zich gewoon aan
op dat adres (magic link óf Google) en wordt bij zijn eerste login automatisch
gekoppeld door `public.gezin_koppel_mij()`, die het dashboard bij elke lading
aanroept. Er vertrekt geen uitnodigingsmail vanuit het portaal — dat zou een
Edge Function met de service-role key vragen.

Voorwaarde: het adres in de uitnodiging moet gelijk zijn aan het adres waarmee
die persoon aanmeldt. Bij Google is dat het adres van het Google-account; wie
zich met een ander adres aanmeldt, blijft ongekoppeld en ziet de uitnodiging
gewoon openstaan.

Beide volwassenen hebben gelijke rechten: elk ziet en bewerkt alle
verzamelaars van het gezin, en elk kan de ander loskoppelen. Wie loskoppelt,
neemt de verzamelaars mee die hij zelf aanmaakte (`kinderen.user_id` wijst nog
altijd naar de maker).

## 7. Contact tussen gezinnen: voornaam, wijk, e-mail, WhatsApp

`get_matches()` geeft van een ánder gezin twee dingen **altijd** terug, en twee
dingen **pas na het beursvenster** (`public.instellingen`, functie
`beurs_voorbij()`):

- **Altijd** — de voornaam van het andere kind, en de wijk of gemeente als dat
  gezin die invulde op `gezin.html` (kolom `wijk` op `public.gezinnen`, leeg
  laten = niet delen). Sinds `015`, en bewust ook al vóór de beurs: wie in
  dezelfde buurt woont, kan meteen onderling ruilen en hoeft daar de beursdag
  niet voor af te wachten — die blijft dan vooral nodig voor wie van verder
  komt.
- **Na** het venster — daarbovenop het e-mailadres waarmee dat gezin is
  aangemeld (voor élk gezin, zonder vinkje, want dat adres is toch al nodig om
  in te loggen) en een gsm-nummer wanneer dat gezin het expliciet deelt
  (kolommen `telefoon` / `telefoon_delen`). In de kolom *Contacteren* op
  `ruilen.html` verschijnen dan een `mailto:`-knop en een wa.me-knop, elk met
  een vooraf ingevuld bericht. Zie `014`.

Los daarvan: **de organisator** heeft één eigen WhatsApp-nummer, in te vullen
op `instellingen.html` (kolommen `whatsapp_nummer` / `whatsapp_bericht` op
`public.instellingen`, enkel schrijfbaar voor beheerders). Staat het leeg, dan
toont de site nergens een knop. Het nummer is enkel leesbaar voor wie ingelogd
is en staat dus niet in de publieke bronbestanden.

## 7b. Ruilen registreren en bevestigen

`ruilen.html` toont niet alleen wie wat heeft, maar laat een afspraak ook
**registreren** (`016_ruilen_registreren.sql`, tabel `public.ruilen`).

**Het systeem verplaatst nooit een sticker.** Een geregistreerde en zelfs een
voltooide ruil laat `public.stickers` volledig ongemoeid: "zoek ik" en "heb ik
dubbel" blijven staan zoals het kind ze zelf zette. Dat is een uitdrukkelijke
keuze — een lijst die automatisch wordt bijgewerkt maar niet klopt met de map
thuis is erger dan geen lijst, en op een beurs loopt het altijd net anders dan
afgesproken. Het portaal onthoudt de afspraak; de collectie beheert de
verzamelaar zelf.

- **Registreren** — `ruil_registreren(eigen_kind, ander_kind, ik_krijg,
  ander_krijgt)`. Controleert opnieuw of de match nog bestaat en in beide
  richtingen klopt; is een van beide lijsten intussen aangepast, dan volgt een
  duidelijke fout in plaats van een zinloze rij. Het paar wordt altijd in
  dezelfde volgorde weggeschreven (`kind_a < kind_b`), zodat dezelfde afspraak
  van beide kanten dezelfde rij oplevert. Twee keer registreren geeft de
  bestaande ruil terug.
- **Bevestigen per kant** — `ruil_bevestigen(ruil_id, kind_id, ja/nee)`. Elke
  ruiler bevestigt voor zichzelf dat de sticker effectief van hand wisselde;
  intrekken mag. Pas als beide kanten bevestigd hebben, is de status
  `VOLTOOID`. De ruil blijft daarna in de historiek staan.
- **Markering is per gebruiker** — bevestig jij, dan kleuren enkel *jouw*
  betrokken stickers lichtrood, als herinnering om je eigen lijst na te kijken.
  Bij de andere ruiler verandert er niets tot die zelf bevestigt.
- **Opvolging** — `ruil_overzicht()` geeft alle ruilen van alle deelnemers
  terug, maar enkel aan wie in `public.beheerders` staat (`007`); voor alle
  anderen komt er geen enkele rij terug. De sectie "Opvolging voor de
  organisatie" onderaan `ruilen.html` toont daarop de tellers en de lijst, met
  "half bevestigd" als het geval dat opvolging vraagt.

RLS op `public.ruilen` laat enkel lezen aan wie aan één van beide kanten zit.
Schrijven kan alleen via de twee functies hierboven: die controleren méér dan
een policy kan (bestaat de match, klopt de richting, is dit wel jouw kind).

`get_matches()` kreeg in `016` twee kolommen bij: `ander_kind_id` — nodig om
per ruiler te groeperen en een ruil aan een tegenpartij te hangen, en verder
niets prijsgevend — en `pagina`, zodat de ruilpagina de landen in albumvolgorde
kan zetten zonder de hele catalogus op te halen.

## 8. FIFA Wereldreis

Een wereldkaart bovenop dezelfde stickerlijst: elk land van het album staat op
de kaart. Te bereiken via **🌍 FIFA Wereldreis** op het dashboard, met een
samenvattende widget onderaan datzelfde dashboard. `wereldreis.html` is een
volwaardige kaartpagina — de kaart vult vrijwel het hele scherm (`.wr-hero` in
`css/style.css`, 100vh min de navbalk), met de tellers, de legende en de
uitleg pas eronder voor wie doorscrolt. Nodig: `sql/010_wereldreis.sql` en
`sql/011_wereldreis_fotos.sql`.

De doelgroep is een kind van een jaar of acht: grote, klikbare iconen met een
zachte glow, speelse iconen (🏆🧩🔍🔁) in plaats van een kale tellerrij, en een
korte ondertitel ("Tik op een icoon voor meer info") in plaats van een
instructieblok.

### Vijf categorieën, allemaal actief sinds fase 3

Elk land heeft een compacte cluster van vijf iconen rond zijn middelpunt:
🃏 Stickers (links, gekleurd naar verzamelpercentage met de glow), ⚽ Voetbal
(boven), 🌍 Landinfo en 🗣️ Talen (onderaan) en 📸 Foto's (rechts). Op een
telefoon blijft de cluster staan — enkel kleiner en dichter bijeen, niet
gereduceerd tot één icoon zoals in fase 1/2. Enkel de ministip op het
dashboard toont nog steeds alleen het stickerenicoon, gecentreerd: die kaart
is toch niet klikbaar.

`CATEGORIEEN` in `js/wereldreis.js` beschrijft alle vijf: label, icoon,
eventuele extra CSS-klasse (`klasseVoor`) en een `popup(land)`-functie. Een
zesde categorie in een latere fase volgt hetzelfde stramien: `zichtbaar` en
`actief` op `true`, een `popup`-functie schrijven — het icoon, de legende en de
popup volgen dan vanzelf overal waar `ZICHTBARE_CATEGORIEEN` gebruikt wordt.
Een categorie die nog niet `actief` is, krijgt automatisch de dimmende klasse
`wr-icoon--wacht` en een placeholderzin in zijn popup.

### Eén klein, los popup per icoon (sinds fase 3)

Tot en met fase 2 deelden alle categorieën één popup met tabbladen. Sinds
fase 3 heeft **elk icoon zijn eigen popup**: tikken (of Enter/Spatie op een
icoon met toetsenbordfocus) opent enkel de info van dat ene icoon via
`openIconPopup()` in `js/wereldreis.js`. Dat is voor een kind van acht
eenvoudiger dan eerst een tabblad kiezen, en de popup blijft daardoor altijd
klein — de vaste-hoogte-truc die de fase 2-tabbladen nodig hadden (om te
voorkomen dat een langer tabblad de popup over de bovenrand van de kaart
duwt) is niet meer nodig, want een los popup toont maar één categorie
tegelijk.

`tekenLanden()` registreert per land één klikhandler die leest welk icoon
(`data-categorie`) precies werd aangeklikt, en opent daarvoor een nieuwe
`L.popup()` op het landpunt. `openOn(kaart)` sluit een eventueel nog open
popup van een ander land of icoon vanzelf.

### Voetbalgegevens (fase 2)

Per land: bijnaam, naam van de nationale ploeg, shirtkleuren (als echte gekleurde
bolletjes), confederatie met werelddeel erbij, FIFA-ranking, een bekende speler,
de speelstijl en een weetje — in taal die een kind van acht kan lezen.

Alles staat in **`js/voetbal-data.js`**, een bestand met enkel gegevens: geen
DOM, geen Leaflet, geen opmaak. Bewust geen Supabase-tabel: dit is statische
redactionele informatie, voor elke gebruiker identiek, nooit geschreven vanuit
de app en zonder afscherming. Een tabel zou een migratie, een RLS-policy en een
netwerkronde bij elke popup kosten zonder dat er iets tegenover staat. Moet het
later tóch een tabel worden (bijvoorbeeld om de teksten te laten bewerken zonder
toegang tot de code), dan is `voetbalVoor()` het enige wat verandert — de kaart
en de popup kennen enkel die functie.

Elk record is uitbreidbaar: `spelers` is een lijst, en de renderer toont de
optionele velden `trainer`, `stadion` en `prestatie` zodra ze ingevuld zijn en
slaat ze stil over zolang ze ontbreken.

> **De FIFA-ranking is een momentopname.** De cijfers horen bij `RANKING_STAND`
> bovenaan het databestand, en de popup zet die datum er zichtbaar bij. Bijwerken
> doe je op die ene plek. Kijk bij een nieuw seizoen ook de spelersnamen even na:
> die verouderen even snel.

### Landinfo en talen (fase 3)

Zelfde opzet als de voetbalgegevens: **`js/land-data.js`** (hoofdstad,
continent, geschat inwonertal, "bekend om" en een leuk weetje) en
**`js/talen-data.js`** (Engelse naam, lokale naam, officiële ta(a)l(en)) zijn
allebei pure databestanden — geen tabel, om dezelfde reden als bij
`voetbal-data.js`. Bij een land met meerdere officiële talen (België, Canada,
Zwitserland, …) toont het talenpaneel enkel een opsomming ("Engels en Frans");
een "lokale naam" of "Engelse naam" bestaat dan niet voor één taal apart.

### Foto's (fase 3): een tabel, geen databestand

Foto's zijn de uitzondering: de opdracht vraagt uitdrukkelijk dat er later
foto's bij kunnen **zonder codewijziging**. Daarom staat de metadata in de
Supabase-tabel `public.land_fotos` (`sql/011_wereldreis_fotos.sql`) in plaats
van in een JS-bestand — een rij toevoegen in Supabase vraagt geen nieuwe
deploy, een nieuw bestand in de git-repository wel. De tabel bewaart enkel
metadata en de volledige publieke URL naar het bestand; de afbeeldingen zelf
horen in een Cloudflare R2-bucket met publieke toegang, in een structuur zoals
`countries/belgium/atomium.jpg`. Zodra er een echt R2-domein is, moet dat
domein in de `img-src` van `_headers` staan.

`js/foto-data.js` haalt de rijen op via `laadFotos(landCode)` en cachet per
land (ook de lopende belofte, niet enkel het resultaat — twee snel na elkaar
geopende foto-iconen voor hetzelfde land sturen zo maar één aanvraag). Dat
gebeurt **lazy**: `fotoPopup()` bouwt meteen een laadskelet zonder
netwerkaanvraag; pas wanneer een kind het foto-icoon ook echt aantikt, haalt
`vulFotoPopup()` de rijen op en vervangt het skelet — 48 landen sturen dus
geen 48 aanvragen bij het laden van de kaart. Native `loading="lazy"` op elke
`<img>` is een extra vangnet. Staan er nog geen rijen voor een land, dan toont
het paneel gewoon "Nog geen foto's voor dit land" — geen foutmelding.

### Vaste clusterplaatsing, geen toeval

Elk icoon krijgt in `css/style.css` een **vaste pixel-offset** op basis van
zijn CSS-klasse (`.wr-icoon--stickers`, `.wr-icoon--voetbal`, `.wr-icoon--land`,
`.wr-icoon--talen`, `.wr-icoon--fotos`) — geen JavaScript-geometrie, geen
`Math.random()`. Hetzelfde icoon staat dus bij elke herlading op exact dezelfde
plek ten opzichte van het land, op elk zoomniveau: Leaflet herberekent enkel
het ankerpunt van de marker, niet de afmetingen of offsets van het icoon. De
glow hergebruikt gewoon de eigen achtergrondkleur van het icoon
(`background: inherit` op de `::after`), dus geen aparte glow-kleur per
categorie nodig.

### Het rekenmodel

Sinds `sql/006_kindproof.sql` registreert een kind enkel wat het **zoekt** en
wat het **dubbel** heeft; al de rest geldt als aanwezig. De wereldreis rekent
daar recht op door:

```
heeft = totaal aantal stickers van het land − gezochte stickers
```

Eén gevolg om te kennen voor je het scherm voor het eerst ziet: **een
verzamelaar die nog niets aanduidde, staat overal op 100 %.** De reis begint dus
vol en loopt leeg naarmate een kind invult wat het mist. De pagina zet daar een
zin bij zolang er niets is aangeduid, zodat het niet als een bug leest.

Een land heet hier **voltooid**, niet "ontdekt": dit datamodel kan niet
betrouwbaar bepalen wanneer een land voor het eerst iets kreeg, enkel hoe ver
het nu staat. "Voltooid" (100 %) is de enige uitspraak die het rekenmodel wél
hard kan maken.

Glansvarianten tellen enkel mee wanneer `toon_glans` aanstaat — dezelfde regel
als `kind_statistieken()` en `get_matches()`.

### Wat waar staat

| Bestand | Rol |
|---|---|
| `sql/010_wereldreis.sql` | `wereldreis_landen(kind_id)`: één rij per land met totaal, gezocht, dubbel, heeft en procent |
| `sql/011_wereldreis_fotos.sql` | tabel `land_fotos`: metadata en R2-verwijzingen voor het fotopaneel (fase 3) |
| `js/wereldreis.js` | coördinaten, kleurenschaal, `CATEGORIEEN`, kaart tekenen, één los popup per icoon — gedeeld door de pagina en de widget |
| `js/voetbal-data.js` | de voetbalgegevens per land (fase 2) — enkel gegevens, geen opmaak |
| `js/land-data.js` | hoofdstad, continent, inwoners, "bekend om" en een weetje per land (fase 3) |
| `js/talen-data.js` | Engelse naam, lokale naam en officiële ta(a)l(en) per land (fase 3) |
| `js/foto-data.js` | ophalen (met cache) van de rijen uit `land_fotos`, lazy — enkel bij het openen van het fotopaneel |
| `js/wereldkaart.js` | `wereldreis.html`: hero, verzamelaarskiezer, tellers, legende |
| `js/wereldreis-widget.js` | het blok onderaan `dashboard.html` |
| `css/leaflet.css` | Leaflet 1.9.4, lokaal — zie hieronder |

De 48 landen staan als punt in `LAND_PUNTEN` (`js/wereldreis.js`), niet als
grens uit een landenbestand. Reden: Engeland en Schotland zijn in het album twee
aparte reeksen, en elk landenbestand met grenzen laat ze allebei op "Verenigd
Koninkrijk" vallen. Met punten houdt elk zijn eigen plek — en Curaçao ook.

### De hero en de navbalk

`.wr-hero` rekent zijn hoogte uit als `100vh` (met een `100dvh`-verbetering
voor mobiel) min de hoogte van de navbalk. Die navbalk is normaal een vaste
`60px` (`--wr-navbar-hoogte`), maar de merknaam "Panini Ruilportaal Meulestede"
kan op een smal scherm over twee of drie regels breken — en op deze pagina, met
de extra "← Dashboard"-knop naast de merknaam, eerder dan elders. De navbalk
zelf blijft dan keurig 60px hoog, maar de tekst overschrijdt die doos zichtbaar.
`pasNavbarHoogteAan()` in `js/wereldkaart.js` meet dat overschot op (normaal 0)
en zet het in `--wr-navbar-overschot`, dat de hero zowel een stukje naar beneden
duwt (`margin-top`) als van zijn hoogte aftrekt. Dit raakt bewust geen bestaande
navbar- of brand-CSS — de correctie zit volledig aan de kant van de wereldreis.

### Leaflet en de Content-Security-Policy

De CSP in `_headers` is streng, en de kaart raakt drie regels ervan:

- **`script-src`** — Leaflet komt als `<script>` van `cdn.jsdelivr.net`, dat al
  toegelaten was voor supabase-js. De versie staat in `dashboard.html` en
  `wereldreis.html`; hou ze gelijk aan `css/leaflet.css`.
- **`style-src 'self'`** — daarom staat Leaflets stylesheet lokaal in
  `css/leaflet.css` in plaats van op een CDN. Om dezelfde reden krijgen de
  iconen hun kleur uit CSS-klassen: een `style="…"`-attribuut in de HTML zou
  geblokkeerd worden. Een breedte via `element.style.width` in JavaScript mag
  wél — CSSOM valt niet onder de CSP.
- **`img-src`** — kaarttegels zijn gewone afbeeldingen. Daarvoor staat
  `https://tile.openstreetmap.org` erbij. Zonder die host blokkeert de browser
  elke tegel en blijft de kaart leeg. Zodra er een Cloudflare R2-domein is voor
  de landfoto's (fase 3, zie hieronder), moet dat domein hier ook bij komen —
  anders blokkeert dezelfde regel de foto's zelf.

De tegels komen van OpenStreetMap zelf: gratis en zonder API-sleutel. De meeste
rustigere alternatieven (CARTO Positron, Stadia, Mapbox) vragen intussen wél een
account — CARTO zet zonder sleutel "API KEY REQUIRED" dwars over elke tegel.
Wordt het portaal ooit druk bezocht, dan is een aanbieder met een sleutel
netter tegenover OpenStreetMap: vervang de URL in `maakKaart()`
(`js/wereldreis.js`), zet de nieuwe host in `_headers` en pas de attributie aan.

## 9. Statistieken

`statistieken.html` toont het hele portaal in cijfers: verzamelaars, stickers,
waarde, landen, ruilen, activiteit doorheen de tijd en toplijsten. Alles wordt
op het moment van opvragen berekend — er wordt niets bijgehouden of
gecachet — door zes RPC's in `017_statistieken.sql`. De pagina telt zelf niets
op: dat zou betekenen dat de browser de stickerrijen van álle deelnemers moet
downloaden, en dat zijn precies de gegevens die niemand hoort te zien.

**Geen namen.** Nergens op de pagina staat de naam van een kind, ook niet in de
ranglijst: die toont enkel de volgorde met de bijhorende aantallen. Geen enkele
functie in `017` geeft een voornaam terug, dus er valt ook niets te lekken.

### "Geplakt" is een afleiding, geen telling

De databank houdt niet bij wat een kind al in zijn album heeft — er zijn maar
twee statussen, `ZOEKT` en `RUILT`. Net als de FIFA Wereldreis rekent deze
pagina daarom: **alles wat niet als gezocht is aangeduid, geldt als aanwezig**.

Die afleiding klopt enkel voor wie zijn lijst effectief invulde, en dat is niet
vanzelfsprekend: een leeg profiel ziet er zo uit als een volledig album en
trekt élk gemiddelde omhoog. `stat_verzamelaars()` laat daarom twee groepen
buiten alle cijfers:

1. wie nog geen enkele sticker registreerde;
2. wie **duidelijk halverwege gestopt** is. Wie zijn ontbrekende stickers
   invult, werkt de landenlijst af in een van de twee volgordes die de
   stickerpagina aanbiedt: alfabetisch op landcode, of de volgorde van het
   boek. Stopt iemand halverwege, dan blijft er in díe volgorde een
   aaneengesloten staart landen over waar niets bij geregistreerd staat — niet
   gezocht én niet dubbel. Per verzamelaar wordt in beide volgordes gekeken hoe
   ver hij geraakte en de gunstigste van de twee genomen; blijft er dan nog
   altijd een staart over van minstens een vijfde van alle landen (en minstens
   vijf), dan telt hij niet mee.

De pagina vermeldt onder blok 1 hoeveel verzamelaars er om die tweede reden
buiten bleven, met de drempel erbij. Wie écht alles van de laatste landen heeft
en er niets van zoekt of dubbel heeft, valt zo ten onrechte buiten — dat weegt
niet op tegen één leeg profiel dat als een vol album meetelt.

### Wat er ingesteld kan worden

Op `instellingen.html` (beheerders): de **prijs van één sticker**
(`instellingen.stickerwaarde`, standaard € 0,25) en het **aantal stickers per
pakje** (`stickers_per_pakje`, standaard 5). Alle bedragen op de pagina zijn
een vermenigvuldiging van het eerste; het tweede wordt enkel gebruikt voor de
schatting van vermeden pakjes.

### De schatting van vermeden pakjes

Het enige cijfer op de pagina dat een model is en geen telling. Stickers uit
pakjes komen willekeurig, en hoe voller je album, hoe vaker je een dubbele
trekt — het coupon collector-probleem. Om van *j* naar *j+1* verschillende
stickers te gaan op een album van *N* heb je gemiddeld `N/(N-j)` stickers
nodig. Voor de laatste *g* stickers die iemand verzamelde is dat samen:

```
N * (1/(N-bezit+1) + 1/(N-bezit+2) + ... + 1/(N-bezit+g))
```

waarbij *g* het aantal stickers is dat via voltooide ruilen binnenkwam (één per
voltooide ruil, per kant). Gedeeld door de pakjesgrootte geeft dat de
schatting. Het model neemt aan dat alle stickers even vaak voorkomen en dat een
pakje geen dubbels van zichzelf bevat — allebei niet helemaal waar — en houdt
er geen rekening mee dat je bij een ruil zelf ook een sticker weggeeft. De
pagina zegt daarom met zoveel woorden dat dit **een schatting is en geen
besparing**.

### Een kanttekening bij twee toplijsten

Omdat "geplakt" gedefinieerd is als "niet gezocht", is het aantal verzamelaars
van een sticker per definitie het totaal min het aantal zoekers. *Meest
gezochte stickers* en *meest verzamelde stickers* zijn dus elkaars spiegelbeeld
en geen twee onafhankelijke metingen. De tooltip bij de tweede lijst zegt dat.

## Database structuur

**kinderen**

| Kolom | Type | Omschrijving |
|---|---|---|
| id | uuid | primaire sleutel |
| user_id | uuid | verwijst naar `auth.users.id`, de ouder/verzamelaar |
| voornaam | text | |
| familienaam | text | |
| geboortejaar | integer | 1900–2100 |
| created_at | timestamptz | |

**stickers**

| Kolom | Type | Omschrijving |
|---|---|---|
| id | uuid | primaire sleutel |
| kind_id | uuid | verwijst naar `kinderen.id` |
| nummer | text | catalogus-code (bv. `BEL7`) |
| status | text | `ZOEKT` of `RUILT` |
| aantal | integer | sinds `012`: aantal dubbels bij `RUILT` (≥ 1, standaard 1). Bij `ZOEKT` genegeerd. |
| created_at | timestamptz | |

Uniek per `(kind_id, nummer)`: hooguit één rij per sticker per kind (sinds
`006_kindproof.sql`).

**ruilen** (sinds `016`)

| Kolom | Type | Omschrijving |
|---|---|---|
| id | uuid | primaire sleutel |
| kind_a / kind_b | uuid | de twee verzamelaars; altijd `kind_a < kind_b`, zodat dezelfde afspraak van beide kanten dezelfde rij is |
| sticker_a / sticker_b | text | wat elke kant **ontvangt** (`sticker_a` gaat naar `kind_a`) |
| bevestigd_a / bevestigd_b | timestamptz | leeg tot die kant zelf bevestigt; beide gevuld = voltooid |
| aangemaakt_door | uuid | wie registreerde — herkomst, geen kant |
| created_at | timestamptz | |

Een partiële unieke index op `(kind_a, kind_b, sticker_a, sticker_b)` voorkomt
dat dezelfde **openstaande** afspraak twee keer bestaat. Voltooide ruilen
vallen erbuiten: dezelfde twee stickers later opnieuw ruilen is een nieuwe
afspraak.

## Row Level Security

RLS staat aan op zowel `kinderen` als `stickers`, met een policy per
operatie (`SELECT` / `INSERT` / `UPDATE` / `DELETE`):

- **kinderen** — toegestaan enkel wanneer `auth.uid() = kinderen.user_id`.
- **stickers** — heeft zelf geen `user_id`-kolom. Toegang loopt via een
  `EXISTS`-subquery die controleert of het gekoppelde kind
  (`stickers.kind_id`) toebehoort aan de ingelogde gebruiker
  (`kinderen.user_id = auth.uid()`). Zo kan een gebruiker nooit stickers
  van andermans kinderen zien of bewerken, ook al kent hij het uuid van de
  sticker.

- **ruilen** (sinds `016`) — enkel een `SELECT`-policy: lezen mag wie via
  `gezin_van_kind()` aan één van beide kanten van de ruil zit. Er is bewust
  géén `INSERT`/`UPDATE`-policy. Schrijven loopt uitsluitend via
  `ruil_registreren()` en `ruil_bevestigen()` (security definer), omdat die
  dingen controleren die een policy niet kan: bestaat de match nog, klopt de
  richting, en bevestig je wel voor je eigen verzamelaar.

`WITH CHECK` staat op alle `INSERT`/`UPDATE`-policies, zodat een gebruiker
via de API ook geen rij kan aanmaken of ombuigen naar een kind dat niet van
hem is.

## Eerste login

Na het klikken op de magic link controleert het dashboard of de gebruiker
al kinderen heeft. Zo niet: een onboardingscherm vraagt het eerste kind toe
te voegen. Daarna toont het dashboard de lijst met verzamelaars.

## Hoe een land geschreven wordt

Overal in het portaal — keuzelijst, checklist, ruiltabel, wereldreis-popup —
staat een land in dezelfde notatie:

```
BEL - BELGIUM - België
```

Eerst de FIFA/Panini-code (die staat op de sticker en op het ruilblad, en is
dus de primaire identificatie), dan de Engelse albumnaam, dan de Nederlandse.
`landLabel()` in [js/landen-data.js](js/landen-data.js) is de enige plek waar
die volgorde vastligt.

**Geen vlagemoji.** Bewust niet: Windows toont een vlagemoji niet als vlag maar
als twee letters ("BE"), en op de vlaggen van Engeland en Schotland struikelt
nog meer software. Een weergave die op de helft van de toestellen iets anders
laat zien dan bedoeld, is geen herkenningspunt.

**Het paginanummer hoort bij het land, niet bij de sticker.** Waar landen in
een lijst staan — de landkeuze op `kind.html` — staat de albumpagina erachter:

```
BEL - BELGIUM - België (p.56)
```

Dat is `landLabel(land, { pagina: true })`; zonder die optie blijft het label
zoals het overal elders staat. Bij een individuele sticker komt de pagina er
**nooit** bij ("BEL3 — Kevin De Bruyne", niet "BEL3 — Kevin De Bruyne (p.56)"):
ze wijst de weg naar het land in het fysieke album, en een land beslaat
meerdere bladzijden.

**Twee sorteervolgordes.** Standaard "Albumvolgorde", die de albumpagina's
volgt (MEX op 8, RSA op 10, … PAN op 104) — dat is de volgorde waarin een kind
door zijn boek bladert, en dus de volgorde waarin het zijn stickers doorneemt.
Daarnaast alfabetisch op de 3-lettercode. Die paginanummers staan sinds `013`
in `sticker_catalogus.pagina` — een kolom die al sinds `003` bestond maar leeg
bleef. Zoeken en filteren laten de ingestelde volgorde altijd met rust: er
verdwijnen enkel rijen uit, er wordt nooit herschikt.

**Waar wat staat.** De Nederlandse en Engelse naam en het paginanummer zijn
catalogusgegevens en staan in de databank (`sticker_catalogus.land_naam`,
`land_naam_en`, `pagina`); de RPC's `wereldreis_landen()` en `get_matches()`
geven ze mee terug. [js/landen-data.js](js/landen-data.js) vult enkel aan wat
daar niet thuishoort: de accentkleur per land (opmaak) en de lokale
schrijfwijze (Deutschland, España — enkel voor de wereldreis-popup).

**De accentkleuren.** Eén per land, afgeleid van de nationale kleur of het
shirt, en stuk voor stuk nagerekend op minstens 3:1 contrast tegen wit — de
WCAG-eis (1.4.11) voor randen die betekenis dragen. Op de checklist zit die
kleur in de *rand* van elke stickerknop en de status in de *achtergrond*
(wit = heb ik, lichtrood = gezocht, lichtgroen = dubbel), zodat het land
herkenbaar blijft terwijl de status verandert.

## Stickers bulksgewijs beheren en dubbel-aantal

Sinds `012_stickers_aantal.sql` kies je op `kind.html` één land, en toont een
**checklist** meteen alle stickers van dat land: een ☑-vinkje per sticker voor
"gezocht" en een +/− stappenteller voor "hoeveel dubbel". Eén klik op
**Bewaar wijzigingen** schrijft de hele lijst in twee databankaanroepen weg
(één `upsert`, één `delete`) in plaats van één aanroep per sticker — dat was
de vorige, één-voor-één werkwijze.

"Gezocht" en "dubbel" sluiten elkaar per sticker uit: dat is geen UI-regel maar
de databank zelf (één status per rij, met de unieke index op
`(kind_id, nummer)`). Vinkt de checklist "gezocht" aan terwijl er nog een
dubbel-aantal ingesteld stond, dan gaat dat aantal terug naar 0, en omgekeerd.

De samenvattingslijst "Heb ik dubbel" op diezelfde pagina heeft een eigen
±-stappenteller per rij, voor een snelle correctie zonder terug naar de
checklist van dat land te moeten gaan; elke klik daar is meteen een eigen
databankaanroep.

## Favorieten op de ruilpagina

Sinds `018_favorieten.sql` kan je per ruilkans een **sterretje** zetten. Eén regel
verklaart het hele systeem:

> Een favoriet is een **reservering van één exemplaar**.

Daaruit volgt hoeveel je er mag zetten, en dat verschilt per kolom:

| Kolom | Budget | Waarom |
|---|---|---|
| Deze ruiler heeft wat jij zoekt | **1** per sticker | je hebt er maar één nodig |
| Deze ruiler wil jouw dubbels | **`aantal`** per sticker | je kan er zoveel weggeven als je er hebt |

En de drie sterstanden zijn gewoon de drie toestanden van dat budget:

| Ster | Betekenis | Klikken doet |
|---|---|---|
| ☆ grijze contour | niet gereserveerd, er is nog budget | hier reserveren |
| ★ goud gevuld | hier gereserveerd | vrijgeven |
| ☆ gele contour | budget op — je reserveerde deze sticker elders | hierheen verplaatsen |

Zoek je FRA12 en hebben Jules én Sara hem dubbel, dan reserveer je er één; bij de
andere staat een gele contour die zegt: kan hier ook, maar dan verhuist je keuze.
Heb je GER15 driemaal dubbel, dan mag je hem bij drie ruilers tegelijk reserveren.

**De databank bewaakt dat budget, niet de pagina** — een partiële unieke index voor
"zoek ik" en een trigger voor de dubbels. Twee tabbladen open of dubbelklikken op een
trage lijn levert dus geen vierde reservering op drie exemplaren op.

Een favoriet is **jouw eigen kladblad**: de tegenpartij ziet er niets van, en er
verandert niets aan `public.stickers`. De echte afspraak blijft `public.ruilen`, met
bevestiging langs twee kanten.

**De volgorde van de ruilers** volgt daaruit: favorieten eerst, dan wie langs twee
kanten kan ruilen (want alleen dan is een ruil registreerbaar), dan wie de grootste
bundel heeft (zes stickers bij één iemand verslaat zes keer één), en bij gelijke stand
de naam. Elke kaart toont in één regel wáárom hij daar staat — "★ 2 favorieten · ruil
kan meteen rond · 3 stickers samen". Een lijst die zichzelf rangschikt zonder reden is
een orakel; zie [../Todo.md](../Todo.md) voor de verdere stappen en de afwegingen.

Sinds `019_stickers_updated_at.sql` houdt `public.stickers` ook bij **wanneer** een
regel laatst geschreven werd. Niets gebruikt die kolom nog — ze staat er alvast omdat
je zulke geschiedenis niet met terugwerkende kracht kan verzamelen, en omdat de
rangschikking later gaat wegen hoe *vers* iemands lijst is (niet hoe "goed" die
persoon is; zie Todo.md voor dat onderscheid).

Het aantal dubbels is ook zichtbaar bij een ruilkans (`js/ruilen.js`, het
"Iemand heeft het dubbel"-paneel in `js/stickers.js`, en het WhatsApp-bericht):
`get_matches()` geeft sinds `012` een `aantal`-kolom mee, getoond als `×N`
zodra dat er meer dan één is.

## Twee wegen naar een sticker

Op `kind.html` kan je op twee manieren werken, en de bedoeling is dat allebei
sneller zijn dan scrollen.

**1. Eerst het land.** De landkeuzelijst is geen `<select>` meer maar een eigen
keuzelijst (`js/landcombo.js`), want een browser laat zijn keuzelijst niet
filteren zolang ze openstaat en zijn ingebouwde type-ahead kijkt enkel naar de
eerste letters van het label — dus naar de landcode. Wie "Duitsland" of
"Germany" typte, kwam nergens uit. Nu staat de lijst open en typ je gewoon: de
letters worden aan elkaar geplakt zolang ze binnen **1000 ms** na elkaar komen
(daarna begint er een nieuwe zoekterm, net als bij een `<select>`), en er wordt
tegelijk gezocht op landcode, Engelse naam, Nederlandse naam en paginanummer —
`GER`, `Germany`, `Duitsland` en `40` leiden alle vier naar hetzelfde land. De
eerste treffer staat meteen aangeduid, dus blijft er één land over, dan volstaat
Enter. Levert het niets op, dan staat er "Geen landen gevonden". Pijltjes, Home,
End, Enter, Escape en Tab doen wat je verwacht; het aparte veldje "Land zoeken"
dat hier vroeger naast stond, is daarmee overbodig geworden.

**2. Meteen de sticker.** Het veld "Of zoek een sticker of speler" eronder zoekt
over álle landen heen, op stickernummer, stickercode, spelersnaam en team (bij
dit album is het team het land, dus "GER", "Germany" en "Duitsland" werken hier
ook). Er gaat geen aanvraag uit — de catalogus staat al in het geheugen — dus
150 ms uitstel volstaat om niet bij elke aanslag te hertekenen.

De checklist eronder toont altijd **alle** stickers van het geopende land,
ongefilterd — er is geen apart "Zoeken binnen dit land"-veldje meer dat daar
rijen uit haalt, want dat deed in het klein precies hetzelfde als dit ene
zoekveld. In plaats daarvan splitst de zoekopdracht zich in twee:

- Hoort de treffer bij het land dat al open staat, dan staat hij al gewoon
  in de lijst — en die chip krijgt meteen een blauwe rand terwijl je typt.
  Geen klik nodig, geen lijst eronder: `pasZoekMarkeringToe()` in
  `js/stickers.js` zet en haalt die rand telkens weer bij elke aanslag.
- Hoort de treffer bij een ánder land, dan kan hij niet zomaar verschijnen —
  het land moet eerst wisselen. Die treffers staan (tot maximaal twintig, de
  rest geteld: "+ 34 extra resultaten") in de vertrouwde resultatenlijst
  onder het veld. Zo'n resultaat aanklikken (of ernaartoe pijlen en Enter)
  doet in één beweging wat je anders met de hand deed: het land in de
  keuzelijst zetten, de checklist van dat land laden, naar die ene sticker
  scrollen, hem een paar tellen laten oplichten en hem de focus geven.

Blijkt de treffer al in de geopende checklist te staan (dus geen lijst om uit
te kiezen) en druk je toch Enter, dan krijgt die chip gewoon de focus — handig
voor wie met het toetsenbord werkt.

## Frontend

- `js/supabase.js` — Supabase-client + `getCurrentUser()`/`requireAuth()`.
- `js/auth.js` — login (magic link + Google) en logout.
- `js/kinderen.js` — CRUD voor kinderen; filtert niet zelf op `user_id`, want
  wat je ziet en mag wijzigen beslist RLS (gezinsbreed sinds `009`).
- `js/stickers.js` — kinddetailpagina: kindgegevens + checklist per land
  (bulksgewijs gezocht/dubbel aanvinken) + het zoeken naar een sticker of
  speler over alle landen heen + de samenvattingslijsten.
- `js/landcombo.js` — de landkeuzelijst waarin je kan typen: knop met
  `role="combobox"` en een eigen `listbox` eronder, omdat een `<select>` zich
  niet laat filteren terwijl hij openstaat.
- `js/dashboard.js` — dashboard: onboarding-wizard en kinderenlijst.
- `js/ruilen.js` — ruilkansen per verzamelaar, te bekijken *per ruiler* (twee
  kolommen: wat hij voor jou heeft, wat hij van jou wil) of *per land* (wie
  heeft en wie zoekt deze sticker), met live zoeken op ruiler, land en
  stickercode. Sterretjes om favorieten te reserveren, ruilers gerangschikt op
  favoriet → tweerichting → bundelgrootte. Registreert ruilen, toont de
  bevestiging per kant en — voor beheerders — het opvolgingsoverzicht.
- `js/gezin.js` — tweede volwassene toevoegen, gsm-nummer van het gezin.
- `js/whatsapp.js` — nummers normaliseren naar E.164 en wa.me-links bouwen.
- `js/instellingen.js` — beheerpagina: beursvenster, glans, organisatornummer,
  stickerwaarde en pakjesgrootte.
- `js/statistieken.js` — statistiekenpagina: cijferkaarten met tooltips,
  staafdiagrammen (gewone elementen op procentbreedte) en lijngrafieken (met de
  hand getekende SVG). Geen grafiekbibliotheek: een pakket van 200 kB voor zes
  grafiekjes weegt niet op tegen de laadtijd.
- `js/wereldreis.js` — FIFA Wereldreis: coördinaten, kleuren, lagen, kaart.
- `js/landen-data.js` — de notatie `BEL - BELGIUM - België` (met `{ pagina:
  true }` als `BEL - BELGIUM - België (p.56)`), de accentkleur per land, de drie
  sorteervolgordes (code, albumvolgorde, alfabetisch Engels) en het zoeken op
  landen (`normaliseer()` / `landMatcht()`, accent- en hoofdletterongevoelig;
  `landMatchtMetPagina()` neemt ook het paginanummer mee, voor de landkeuze).
  De stickerpagina en de ruilpagina delen die functies, zodat "CIV", "cote" en
  "IVOOR" overal hetzelfde land vinden.
- `js/voetbal-data.js` / `js/land-data.js` / `js/talen-data.js` — statische
  redactionele gegevens per land (voetbal, landinfo, talen).
- `js/foto-data.js` — lazy ophalen van landfoto's uit Supabase (`land_fotos`).
- `js/wereldkaart.js` — de grote kaart op `wereldreis.html`.
- `js/wereldreis-widget.js` — het wereldreisblok onderaan het dashboard.

ES Modules, geen build-stap, geen framework. Enige uitzondering: Leaflet wordt
als klassiek `<script>` geladen en staat als globale `L` klaar vóór de modules
draaien.

## Beveiliging

- Uitsluitend de anon/publishable key in clientcode (publiek, veilig).
- Authenticatie via Supabase Magic Link of Google — geen wachtwoorden.
- Row Level Security: gebruikers zien/bewerken enkel de kinderen van hun eigen
  gezin en de stickers van die kinderen. De vergelijking loopt sinds `009` via
  `public.gezin_sleutel()`: je gezin_id, of je eigen user_id als je alleen
  werkt. Wie nooit een tweede volwassene toevoegt, houdt dus exact de oude
  afscherming.
- Van een ánder gezin komt er nooit familienaam, user_id of kind_id terug.
  Voornaam komt altijd mee, en de wijk/gemeente enkel wanneer dat gezin ze zelf
  invulde (`sql/015_wijk_en_altijd_naam.sql`). Het e-mailadres komt er pas bij
  ná het beursvenster, voor élk gezin (het adres waarmee dat gezin al is
  aangemeld); een gsm-nummer enkel wanneer dat gezin het expliciet deelt, en
  ook dan pas ná het beursvenster (`sql/014_na_beurs_contact.sql`).
- Inputvalidatie op voornaam, familienaam, geboortejaar, stickernummer en
  status.
- Veilige rendering via `textContent` (nooit `innerHTML` met gebruikersdata)
  → geen XSS.
- `service_role`-key nooit in clientcode.
