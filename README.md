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
   `011_wereldreis_fotos.sql` → `012_stickers_aantal.sql`. Enkel `002` en de
   blokken die het zelf aankondigen zijn destructief; `009` en later zijn
   dat niet.
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

## 7. WhatsApp

Twee losstaande dingen:

- **Tussen gezinnen.** Een gezin kan op `gezin.html` één gsm-nummer bewaren en
  aanvinken of het gedeeld mag worden. `get_matches()` geeft dat nummer enkel
  terug tijdens het beursvenster, aan een ánder gezin dat een match heeft. In
  de kolom *Contacteren* op `ruilen.html` verschijnt dan een wa.me-knop met een
  vooraf ingevuld bericht. Staat het vinkje uit of is de beurs voorbij, dan
  komt het nummer niet eens uit de database.
- **De organisator.** Eén nummer voor de hele beurs, in te vullen op
  `instellingen.html` (kolommen `whatsapp_nummer` / `whatsapp_bericht` op
  `public.instellingen`, enkel schrijfbaar voor beheerders). Staat het leeg,
  dan toont de site nergens een knop. Het nummer is enkel leesbaar voor wie
  ingelogd is en staat dus niet in de publieke bronbestanden.

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

`WITH CHECK` staat op alle `INSERT`/`UPDATE`-policies, zodat een gebruiker
via de API ook geen rij kan aanmaken of ombuigen naar een kind dat niet van
hem is.

## Eerste login

Na het klikken op de magic link controleert het dashboard of de gebruiker
al kinderen heeft. Zo niet: een onboardingscherm vraagt het eerste kind toe
te voegen. Daarna toont het dashboard de lijst met verzamelaars.

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

Het aantal dubbels is ook zichtbaar bij een ruilkans (`js/ruilen.js`, het
"Iemand heeft het dubbel"-paneel in `js/stickers.js`, en het WhatsApp-bericht):
`get_matches()` geeft sinds `012` een `aantal`-kolom mee, getoond als `×N`
zodra dat er meer dan één is.

## Frontend

- `js/supabase.js` — Supabase-client + `getCurrentUser()`/`requireAuth()`.
- `js/auth.js` — login (magic link + Google) en logout.
- `js/kinderen.js` — CRUD voor kinderen; filtert niet zelf op `user_id`, want
  wat je ziet en mag wijzigen beslist RLS (gezinsbreed sinds `009`).
- `js/stickers.js` — kinddetailpagina: kindgegevens + checklist per land
  (bulksgewijs gezocht/dubbel aanvinken) + de samenvattingslijsten.
- `js/dashboard.js` — dashboard: onboarding-wizard en kinderenlijst.
- `js/ruilen.js` — ruilkansen van het hele gezin, met de kolom *Contacteren*.
- `js/gezin.js` — tweede volwassene toevoegen, gsm-nummer van het gezin.
- `js/whatsapp.js` — nummers normaliseren naar E.164 en wa.me-links bouwen.
- `js/instellingen.js` — beheerpagina: beursvenster, glans, organisatornummer.
- `js/wereldreis.js` — FIFA Wereldreis: coördinaten, kleuren, lagen, kaart.
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
- Van een ánder gezin komt er niets terug behalve een voornaam, en enkel
  tijdens het beursvenster — geen e-mailadres, familienaam, user_id of
  kind_id. Een gsm-nummer enkel wanneer dat gezin het expliciet deelt.
- Inputvalidatie op voornaam, familienaam, geboortejaar, stickernummer en
  status.
- Veilige rendering via `textContent` (nooit `innerHTML` met gebruikersdata)
  → geen XSS.
- `service_role`-key nooit in clientcode.
