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
   `019_stickers_updated_at.sql` → `020_favorieten_algemeen.sql` →
   `021_ruiler_letter.sql` → `022_ruildossiers.sql` →
   `023_ruil_auto_toepassen.sql` → `024_kaart_zoomdrempel.sql` →
   `025_events_en_aanwezigheid.sql` → `026_hoe_gevonden.sql`. Enkel `002`
   en de blokken die het zelf aankondigen zijn destructief; `009` en later
   zijn dat niet.
4b. Sinds de Supabase-GitHubkoppeling (Project Settings → Integrations)
   draaien migraties ná `026` niet meer hier: die staan in
   `supabase/migrations/` en Supabase voert ze automatisch uit bij een merge
   naar `main`. Zie `supabase/README.md`.
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
3. Framework preset: `None`. Build command: zie hieronder. Output directory: `/`
   (repo-root — er is geen `public`-submap).
4. Deploy. Live URL: `https://panini-4mf.pages.dev`.

Statische HTML/CSS/JS zonder build-stap; Supabase JS wordt via een ESM-CDN
(jsdelivr) geladen — volledig compatibel met Cloudflare Pages.

### Build command: welke versie staat er live?

`ruilbeurs.meulestede.gent` is een vaste naam die intern naar de laatste
Cloudflare Pages-deployment wijst. Dat adres zelf verandert nooit, maar wat
erachter zit wel, bij elke push — en dat is dan weer een eigen, unieke
`https://<hash>.panini-4mf.pages.dev`-URL. Om op **Instellingen** te kunnen
tonen welke commit en welke deployment-URL er op dit moment achter die naam
zitten, staat er een build command:

```
printf '{"commit":"%s","branch":"%s","deployUrl":"%s","gebouwdOp":"%s"}' "$CF_PAGES_COMMIT_SHA" "$CF_PAGES_BRANCH" "$CF_PAGES_URL" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > version.json
```

Zet dat bij **Settings → Builds & deployments → Build command** in het
Cloudflare Pages-project. `CF_PAGES_COMMIT_SHA`, `CF_PAGES_BRANCH` en
`CF_PAGES_URL` zijn omgevingsvariabelen die Cloudflare zelf tijdens elke build
meegeeft (dus niets om zelf in te stellen) — ze bestaan enkel op dat moment,
niet meer zodra de site draait, vandaar dat het commando ze wegschrijft naar
een gewoon statisch bestand. Output directory blijft `/`: Cloudflare kopieert
de hele checkout, `version.json` erbij, dus is er geen aparte publicatiemap
nodig. Het bestand komt nooit in git terecht (`.gitignore`) — elke build
overschrijft het met de eigen, actuele gegevens.

`instellingen.html` haalt dit bestand op en toont commit (met link naar
GitHub), branch, deployment-URL en bouwtijdstip. Zolang het buildcommando nog
niet ingesteld staat — of lokaal, waar er geen Cloudflare-build is — meldt de
pagina gewoon dat er nog geen deploymentgegevens zijn; niets breekt erdoor.

Let op: `version.json` is een gewoon statisch bestand, dus **publiek
leesbaar** voor wie het adres kent, los van de beheerder-only weergave op
Instellingen. Dat is geen probleem voor een commit-sha en een deployment-URL
— beide zijn sowieso op te vragen via het Cloudflare-dashboard of de
GitHub-geschiedenis — maar zet er nooit iets gevoeligers in.

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

**Bevestigen = je eigen lijst verwerken** (sinds `023_ruil_auto_toepassen.sql`).
Wie een ruil registreert of bevestigt, ziet zijn eigen "zoek ik" en "heb ik
dubbel" meteen bijgewerkt: de boekhouding van een verzamelaar wacht niet op
iemand anders. De lijst van de andere kant blijft ongemoeid tot die zelf
bevestigt — wat daar echt in de map zit, weet enkel die eigenaar — maar de
betrokken exemplaren zijn tot dan gereserveerd. Zie "Verwerken, reserveren en
terugzetten" verderop. Ruilen van vóór `023` blijven zoals ze waren: niets
verwerkt, de lijst pas je zelf aan.

- **Registreren** — `ruil_registreren(eigen_kind, ander_kind, ik_krijg,
  ander_krijgt)`. Controleert opnieuw of de match nog bestaat en in beide
  richtingen klopt; is een van beide lijsten intussen aangepast, dan volgt een
  duidelijke fout in plaats van een zinloze rij. Sinds `023` tellen exemplaren
  die al in een andere openstaande ruil beloofd zijn niet meer mee, aan beide
  kanten. Het paar wordt altijd in dezelfde volgorde weggeschreven
  (`kind_a < kind_b`), zodat dezelfde afspraak van beide kanten dezelfde rij
  oplevert. Twee keer registreren geeft de bestaande ruil terug — vóór de
  controle, want wie al registreerde, heeft zijn lijst al bijgewerkt.
- **Bevestigen per kant** — `ruil_bevestigen(ruil_id, kind_id, ja/nee)`. Elke
  ruiler bevestigt voor zichzelf dat de sticker effectief van hand wisselde,
  en daarmee wordt zijn eigen lijst verwerkt. Een verwerkte bevestiging
  intrekken is de ruil annuleren: de lijst gaat terug. Pas als beide kanten
  bevestigd hebben, is de status `VOLTOOID`; intrekken kan dan niet meer. De
  ruil blijft daarna in de historiek staan.
- **Lichtrode markering** — `doorMijBevestigd()` in `js/ruilen.js` kleurt enkel
  nog stickers uit ruilen van vóór `023` die jij bevestigde: bij nieuwe ruilen
  is je lijst al bijgewerkt, dus valt er niets meer na te kijken.
- **Opvolging** — `ruil_overzicht()` geeft alle ruilen van alle deelnemers
  terug, maar enkel aan wie in `public.beheerders` staat (`007`); voor alle
  anderen komt er geen enkele rij terug. De sectie "Opvolging voor de
  organisatie" onderaan `ruilen.html` toont daarop de tellers en de lijst, met
  "half bevestigd" als het geval dat opvolging vraagt, en sinds `023` ook
  "vervallen".

RLS op `public.ruilen` laat enkel lezen aan wie aan één van beide kanten zit.
Schrijven kan alleen via de functies hierboven: die controleren méér dan een
policy kan (bestaat de match, klopt de richting, is dit wel jouw kind).

`get_matches()` kreeg in `016` twee kolommen bij: `ander_kind_id` — nodig om
per ruiler te groeperen en een ruil aan een tegenpartij te hangen, en verder
niets prijsgevend — en `pagina`, zodat de ruilpagina de landen in albumvolgorde
kan zetten zonder de hele catalogus op te halen.

### Ruildossiers: meerdere ruilen als één pakket (`022`)

Aan de ruiltafel gaan er zelden één sticker tegen één over. Sinds
`022_ruildossiers.sql` registreert `ruil_dossier_registreren(eigen_kind,
ander_kind, paren)` een hele bundel in één transactie — klopt één paar niet
meer, dan staat er niets. Elk paar blijft een eigen rij in `public.ruilen`, met
dezelfde controle als hierboven; `dossier_id` houdt ze samen.

- **Wie registreert, bevestigt meteen zijn eigen kant.** Registreren gebeurt
  nadat de kaarten van hand wisselden; enkel de andere kant moet nog.
- **De andere kant antwoordt per ruil**: bevestigen, of `ruil_weigeren()`. Een
  geweigerde ruil wordt gemarkeerd, niet gewist, en telt niet meer als
  openstaand — hetzelfde paar mag daarna opnieuw geregistreerd worden. Op
  `ruilen.html` staat dat bovenaan als één blok **Te bevestigen** per dossier.
  Er gaat geen push of e-mail uit.
- **Zonder account** (`public.eenzijdige_ruilen`): een ruil met iemand die geen
  account heeft, enkel bij jou vastgelegd en meteen afgerond vanaf jouw kant.
  Er valt bij niemand iets te controleren of te bevestigen. Sinds `023` via
  `eenzijdig_registreren()`, die ook meteen je lijst bijwerkt.
- `mijn_ruilen()` kreeg `dossier_id`, `geweigerd`, `door_eigen_gezin` en de
  status `GEWEIGERD`.

Zolang `022` niet gedraaid is, registreert de pagina per paar met de functies
uit `016` (niet alles-of-niets), en geven "zonder account" en weigeren een
melding dat de migratie nog moet.

### Verwerken, reserveren en terugzetten (`023`)

Eén regel: **bevestigen = je eigen kant verwerken**, en registreren telt als
bevestigen.

- **Verwerken** (`_ruil_kant_verwerken`). Krijgen verwijdert de ZOEKT-rij —
  exact `bepaalInboeking()` in `js/inboeken.js`, geval `"uitZoek"`. Geven
  verlaagt `aantal` met één, of verwijdert de RUILT-rij bij het laatste
  exemplaar. Staat iets niet (meer) op ZOEKT of als dubbel, dan deed de
  eigenaar het al zelf en wordt het overgeslagen. Wat effectief gebeurde, staat
  in `zoekt_weg_a/b` en `dubbels_voor_a/b`: enkel zo kan het veilig terug.
- **Reserveren** (`_gereserveerd`, `_dubbels_vrij`, `_zoekt_vrij`). Zolang één
  kant verwerkt is en de andere niet, zijn de exemplaren van die andere kant
  bezet. **Geen status op `stickers`**: daar staat één rij per sticker met een
  aantal, en "1 van 3 dubbels bezet" past niet in een statuswoord — terwijl een
  tiental functies op exact `ZOEKT`/`RUILT` filtert. Het is een afleiding uit
  `public.ruilen`, dus er valt niets uit sync. `get_matches()` telt enkel vrije
  exemplaren (`aantal` = het vrije aantal), `ruil_registreren()` weigert bezette,
  en `favoriet_budget_bewaken()` telt enkel vrije dubbels. De ruilplanner, de
  ruilvoorstellen, Snelruilen en de stickerpagina rekenen op `get_matches()` en
  volgen dus vanzelf. De eigen lijst van wie nog moet bevestigen (checklist,
  ruilfiche, statistieken) blijft bewust ongewijzigd.
- **Terugzetten** (`_ruil_kant_terugzetten`). Bij weigeren (`ruil_weigeren`),
  annuleren (`ruil_bevestigen(…, false)` na verwerking) en vervallen. Enkel als
  de lijst nog exact is wat de verwerking achterliet; anders wordt er niets
  aangeraakt en staat `nazien_a/b` — `ruilen.html` zegt dan welke stickers je
  zelf moet nakijken. Een automatisch "herstel" bovenop een wijziging die het
  portaal niet kent, zou de lijst net fout maken.
- **Vervallen na 3 dagen** (`_ruil_termijn()`), zonder geplande taak. De
  reservering telt na de termijn gewoon niet meer mee, `mijn_ruilen()` toont al
  `VERVALLEN`, en `ruilen_verlopen_verwerken()` — bij elke paginalading
  aangeroepen door `js/acties.js` en `js/ruilen.js` — zet de verwerkte kant
  terug voor ruilen van het eigen gezin.
- **Dossiers** blijven alles-of-niets: klopt één paar niet, dan gaat ook de
  verwerking van de vorige paren terug. Binnen één dossier rekent elk paar al
  verder op de lijst na het vorige.
- **Zonder account** verwerkt `eenzijdig_registreren()` meteen: krijgen volledig
  volgens `bepaalInboeking()` (er is geen match die garandeert dat de sticker
  gezocht werd), geven enkel met een vrije dubbel. Rechtstreeks invoegen in
  `eenzijdige_ruilen` kan niet meer.
- **Niet retroactief.** Ruilen van vóór `023` hebben geen `verwerkt_a/b`: ze
  reserveren niets, vervallen niet, en intrekken werkt er zoals vroeger.
- `mijn_ruilen()` kreeg `eigen_/ander_verwerkt`, `eigen_/ander_nazien`,
  `geweigerd_door`, `vervalt_op` en de status `VERVALLEN`.

Zolang `023` niet gedraaid is, werkt de databank zoals na `022`: niets
verwerkt, geen reservering. De teksten op de pagina beschrijven wel al de
nieuwe werking.

## 7c. Meerdere ruilbeurzen en aanwezigheid (`025`)

Tot `025` was er één ruilbeurs: twee kolommen op de singleton-rij van
`instellingen` (`beurs_start` / `beurs_einde`). Er zijn er nu meer — 6 september
2026 is geweest, 11 oktober staat klaar — en **niet elke verzamelaar komt naar
elke beurs**. Wie thuisblijft, hoort niet in de ruilplanner van iemand die wél
gaat: dan loop je op de beursdag achter namen aan die er niet zijn.

### Drie fases, allemaal uit de kalender

Er is geen schakelaar die de organisator omzet. Er is een lijst `events` en één
getal: `instellingen.filter_dagen_vooraf` (7, 14, 21 of 30 — een vaste keuze,
want een vrij getal nodigt uit tot 1 of 365 en allebei breken ze het portaal op
een manier die pas weken later opvalt). `huidig_event()` leidt daar de fase uit
af:

| Fase | Wanneer | Wie zie je | E-mail / WhatsApp |
|---|---|---|---|
| `open` | geen beurs in aantocht | iedereen | zichtbaar, zodra er ooit een beurs afgelopen is |
| `voor` | vanaf `filter_dagen_vooraf` dagen vóór de start | wie aanduidde dat hij komt | verborgen |
| `tijdens` | van start tot einde | wie aan de inkom aangemeld is | verborgen |

Na het einde valt alles terug op `open`: iedereen doet weer mee en de
contactgegevens komen terug — tot de aanloop naar het volgende event begint.
Zichtbaarheid van personen en zichtbaarheid van contactgegevens lopen dus
gelijk. Eén begrip, geen tweede kalender.

`beurs_voorbij()` verandert daardoor van betekenis tegenover `014`. Vroeger:
"`now()` ligt na `beurs_einde`". Nu: "de fase is `open` én er is ooit een beurs
afgelopen". Zonder die herdefinitie zouden de e-mailadressen verdwijnen op het
moment dat de organisator de vólgende beurs in de kalender zet, en dat is
precies het omgekeerde van wat `014` bedoelde.

### Eén filterpunt

De ruilplanner, de ruilvoorstellen, de beste ruilkansen, de ruilerkaarten, de
algemene favorieten op de stickerpagina en de ruilerkeuze van ⚡ Snelruilen
halen hun verzamelaars **allemaal uit `get_matches()`**. Eén CTE (`zichtbaar`)
dekt dus alle zes de schermen, en de filter zit in de databank — wie de API
rechtstreeks aanspreekt, komt er niet omheen.

Wat bewust **niet** meefiltert:

- **Je eigen gezin.** Broer en zus ruilen thuis; die hebben geen beurs nodig.
- **Je eigen verzamelaar.** Enkel de tegenpartij verdwijnt. Wie zelf niets
  aanduidde, krijgt dus geen lege pagina zonder uitleg maar de gewone lijst plus
  een melding op `ruilen.html` (`#ruil-aanwezig`). Een gefilterde lijst is
  anders niet te onderscheiden van een lege lijst.
- **`mijn_ruilen()` en `ruil_overzicht()`.** Een lopende afspraak met iemand die
  niet komt, moet je nog altijd kunnen bevestigen of weigeren.
- **`ruil_registreren()`.** Die controleert de lijsten, niet de aanwezigheid.
  Wie aan tafel staat maar nog niet afgevinkt is, kan gewoon ruilen.
  Aanwezigheid stuurt *wie je voorgesteld krijgt*, niet *wat mag*.
- **Favorieten.** Die blijven staan. Een ruiler die er even niet is, verdwijnt
  uit beeld en komt na de beurs vanzelf terug.

### Wie duidt wat aan

De **ouder** zet "komt mee" op het dashboard, één vinkje per verzamelaar per
komende beurs (`aanwezigheid_zetten`). De **organisatie** vinkt aan de inkom af
op `aanwezigheden.html` (`aanmelden_zetten`, enkel voor beheerders). Aanmelden
zet `komt` mee aan — wie binnenstapt, komt — maar het vinkje uithalen betekent
"toch niet binnengekomen", niet "komt niet".

Beide lopen via `security definer`-functies en niet via een policy, net als bij
`ruilen` (`016`): een policy kan niet uit elkaar houden wie `komt` zet en wie
`aangemeld_op` zet, want dat is een kolomverschil en RLS werkt per rij.

### De startpagina

`index.html` draait zonder login en mag `events` en `instellingen` dus niet
lezen. `beurs_info()` (uitvoerbaar voor `anon`) geeft enkel wat op de affiche
staat: naam, datum, fase en het aantal dagen. `js/beurs-uitleg.js` zet dat getal
in de uitleg; de HTML bevat al de standaardwaarde 14, zodat de zin ook zonder
JavaScript of databank klopt.

### Hoe heb je ons gevonden? (`026`, uitgebreid in `027`)

Eén keuzelijst — in stap 2 van de inschrijfwizard, en achteraf te wijzigen op
`gezin.html` — **per gezin en niet per verzamelaar**: een gezin
vindt de beurs één keer, en drie kinderen drie keer laten antwoorden geeft drie
keer dezelfde stem. Overslaan mag. De organisatie ziet enkel de aantallen
(`hoe_gevonden_statistiek()`), nooit welk gezin wat antwoordde. De sleutels
staan in een `check` op `gezinnen.hoe_gevonden` en de opschriften in
`js/hoe-gevonden.js` — komt er een keuze bij, dan hoort ze op allebei de
plaatsen bij te komen. Zo is `whatsapp` erbij gekomen (migratie `027`): de
aankondiging gaat ook rond in groepen van de wijk en de klas, en onder
'andere' verdween dat tussen de vrije toelichtingen.

Cloudflare Pages en Supabase worden door dezelfde merge gedeployd, dus er is
een ogenblik waarop de pagina al een keuze aanbiedt die de databank nog niet
kent. `js/onboarding.js` vangt die ene fout op (`23514`) door opnieuw te
bewaren zónder het antwoord: wijk en naam gaan niet verloren omdat een
constraint achterloopt.

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

### Uitgezoomd één bol, ingezoomd de cluster van vijf

Op wereldniveau overlappen een stuk of twintig clusters elkaar rond Europa —
daarom toont `tekenLanden()` (`js/wereldreis.js`) onder zoomtrap
`kaart_ingezoomd_vanaf` (instellingen.html, `sql/024`; standaard 10 =
`INGEZOOMD_VANAF`, ingezoomd op één land) per land maar **één bol** in plaats
van de cluster. De grote kaart zoomt daarvoor tot `MAX_ZOOM` (12); met de
vroegere maximumtrap 6 lag elke drempel al op het Europa-zicht, waar de
clusters nog overlappen. Die bol hergebruikt bewust dezelfde percentagetrap
als het stickerenicoon voor zowel kleur als grootte — hoe minder compleet, hoe
groter de bol — in plaats van een tweede, eigen maat te verzinnen: `gezocht`
in `sql/010_wereldreis.sql` is toch al rechtstreeks het spiegelbeeld van
hetzelfde percentage.

**Tikken op een bol klapt enkel dát land open** in zijn vijf iconen, zonder te
zoomen; een ander land of een tik op de kaart klapt het weer dicht. Zo kan je
op het Europa-zicht één land bekijken zonder dat de hele kaart uiteenvalt.
`js/wereldkaart.js` luistert op `zoomend` en hertekent enkel wanneer de
drempel echt gekruist wordt — niet bij elke tik van het muiswiel, anders zou
een openstaande popup steeds sluiten voor niets.

### Vijf categorieën, allemaal actief sinds fase 3

Vanaf `INGEZOOMD_VANAF` heeft elk land een compacte cluster van vijf iconen
rond zijn middelpunt: 🃏 Stickers (links, gekleurd naar verzamelpercentage met
de glow), ⚽ Voetbal (boven), 🌍 Landinfo en 🗣️ Talen (onderaan) en 📸 Foto's
(rechts). Op een telefoon blijft de cluster staan — enkel kleiner en dichter
bijeen, niet gereduceerd tot één icoon zoals in fase 1/2. Enkel de ministip op
het dashboard toont nog steeds alleen het stickerenicoon, gecentreerd: die
kaart is toch niet klikbaar en zoomt sowieso niet.

Het stickerenicoon is bovendien het enige met de klasse `wr-icoon--belangrijk`
zolang het land niet compleet is (`land.procent < 100`): iets groter, want dat
is het enige van de vijf met echt wisselende, actiegerichte gegevens — de
andere vier zijn statische naslaginfo. De glow-animatie (hieronder) pulseert
per icoon met een eigen `animation-delay`, zodat de vijf na elkaar oplichten
in plaats van in koor.

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

**events** (sinds `025`)

| Kolom | Type | Omschrijving |
|---|---|---|
| id | uuid | primaire sleutel |
| naam | text | "Ruilbeurs oktober" — wat op het scherm komt |
| start / einde | timestamptz | het venster van die beursdag |
| updated_at / updated_by | | wie de datum verzette, is achteraf de eerste vraag |

Eén rij per beursdag, voorbije edities inbegrepen: die lijst *is* de historiek
waar de aanwezigheden aan hangen.

**aanwezigheden** (sinds `025`)

| Kolom | Type | Omschrijving |
|---|---|---|
| id | uuid | primaire sleutel |
| event_id | uuid | verwijst naar `events.id` (`on delete cascade`) |
| kind_id | uuid | verwijst naar `kinderen.id`, **`on delete set null`** |
| komt / komt_op | boolean / timestamptz | de ouder duidde aan dat hij meegaat |
| aangemeld_op / aangemeld_door | timestamptz / uuid | de organisatie vinkte af aan de inkom |

Twee tijdstempels en geen twee vinkjes: `komt` is een keuze die heen en weer
mag, `aangemeld_op` is een gebeurtenis, en dan wil je ook weten wanneer.
Afvinken zet hem terug op `null`.

`kind_id` gaat op `null` in plaats van de rij mee te nemen: verdwijnt een
verzamelaar, dan blijft het aantal aanwezigen van die beursdag kloppen zonder
dat er een naam achterblijft. De unieke index op `(event_id, kind_id)` is
daarom partieel — geanonimiseerde rijen mogen met meerdere naast elkaar staan.

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

- **events** (sinds `025`) — `SELECT` voor elke ingelogde gebruiker (wanneer de
  beurs doorgaat is geen geheim), en `INSERT`/`UPDATE`/`DELETE` enkel voor
  `is_beheerder()`. De startpagina is niet ingelogd en gaat langs
  `beurs_info()`, de enige functie die ook `anon` mag uitvoeren.

- **aanwezigheden** (sinds `025`) — enkel een `SELECT`-policy, voor je eigen
  gezin (via `gezin_van_kind()`). Schrijven loopt via `aanwezigheid_zetten()`
  (de ouder) en `aanmelden_zetten()` (de organisatie), om dezelfde reden als
  bij `ruilen`: een policy kan geen onderscheid maken tussen wie `komt` mag
  zetten en wie `aangemeld_op` mag zetten — dat is een kolomverschil, en RLS
  werkt per rij.

- **ruilen** (sinds `016`) — enkel een `SELECT`-policy: lezen mag wie via
  `gezin_van_kind()` aan één van beide kanten van de ruil zit. Er is bewust
  géén `INSERT`/`UPDATE`-policy. Schrijven loopt uitsluitend via
  `ruil_registreren()` en `ruil_bevestigen()` (security definer), omdat die
  dingen controleren die een policy niet kan: bestaat de match nog, klopt de
  richting, en bevestig je wel voor je eigen verzamelaar.

`WITH CHECK` staat op alle `INSERT`/`UPDATE`-policies, zodat een gebruiker
via de API ook geen rij kan aanmaken of ombuigen naar een kind dat niet van
hem is.

## Eerste login: de inschrijfwizard

Na het aanmelden controleert het dashboard of dit gezin al verzamelaars heeft.
Zo niet, dan is dit geen dashboard maar een **inschrijving**, en neemt
`js/onboarding.js` het hele scherm over met vier stappen:

| Stap | Wat | Waar het landt |
|---|---|---|
| 1 Welkom | wat het portaal doet, en dat het ook de inschrijving voor de beurs is | — |
| 2 Jouw gegevens | voornaam, naam, wijk, "hoe heb je ons gevonden?" | `gezin_leden` + `gezinnen` |
| 3 Verzamelaars | het bestaande formulier, meermaals te gebruiken | `kinderen` |
| 4 Controleren | samenvatting, een vinkje "komt mee" per verzamelaar, en waarom dat telt | `aanwezigheden` |

**Waarom een wizard en geen dashboard met losse acties.** Een nieuw gezin moest
vroeger zelf uitzoeken waar het begon: een kaart die naar `gezin.html` sprong,
een kaart die een formulier openklapte, en de aanwezigheid ergens onderaan in
een uitlegblok — precies de drie dingen die een ouder in die volgorde moet doen,
maar alle drie tegelijk in beeld. Nu staat er per scherm één taak en één
hoofdknop, en verdwijnen nieuws, statistieken, snelruilen en de openstaande
acties tijdens de wizard (`[data-naast-wizard]`): voor een gezin zonder
verzamelaars zijn die toch leeg.

**Waarom de aanwezigheid in stap 4 staat en niet in stap 1.** Het vinkje hoort
bij een verzamelaar, dus het kan pas bestaan ná stap 3. En de uitleg waarom het
telt (drie fases, §7c) leest niemand vóór hij weet wat ruilen hier betekent —
in stap 4 staat ze bij de vraag zelf. De vinkjes staan standaard **aan**: wie
hier aanmeldt, komt zich inschrijven; wie toch niet komt, haalt er één uit.

**Elke stap bewaart meteen.** "Volgende" in stap 2 schrijft je gegevens weg, en
een verzamelaar staat in de databank zodra je hem toevoegt — anders kan stap 4
geen vinkje per verzamelaar tonen en verlies je alles bij een wegvallende
verbinding. "Vorige" is dus navigeren, geen ongedaan maken. Enkel de
aanwezigheid wacht op "Opslaan".

**Na "Opslaan" gaat de knop rechtstreeks naar de stickers, niet naar
`gezin.html`.** Inschrijven is het middel, niet het doel — de gebruiker wil
zoeken en dubbels registreren, en dat gebeurt op `kind.html`. De knop opent
daarom de verzameling van het **eerste** kind dat in stap 3 werd toegevoegd
(`kind.html?id=<id>`), met zijn naam in de knoptekst zodat bij meerdere
verzamelaars duidelijk is welke er opent — de rest vind je op het dashboard.
Dat id komt uit de rij die `addKind()` net teruggaf, dus geen extra opzoeking
nodig. Zonder een aanwijsbaar eerste kind (kan hier niet gebeuren: stap 3 laat
"Volgende" pas toe vanaf één verzamelaar) blijft de terugval naar
`/dashboard.html` staan — nooit een blanco scherm.

**Wanneer hij verschijnt.** Zolang `kinderen` leeg is — geen apart vinkje
"onboarding gedaan". Een tweede ouder die via een uitnodiging in een bestaand
gezin komt, ziet de wizard dus nooit: die lijst is al gevuld. Wie halverwege
wegklikt en terugkomt, begint weer bij stap 1 met zijn antwoorden al ingevuld;
wie na stap 3 wegklikt, heeft verzamelaars en krijgt het gewone dashboard, waar
"🎫 Komt je verzamelaar mee?" bovenaan hetzelfde vinkje toont.

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

**Geen vlagemoji, wél een vlag.** Een vlagemoji is bewust nooit gebruikt:
Windows toont er geen vlag maar twee letters ("BE"), en op de vlaggen van
Engeland en Schotland struikelt nog meer software. Een weergave die op de helft
van de toestellen iets anders laat zien dan bedoeld, is geen herkenningspunt.

Een gewone afbeelding heeft dat probleem niet, en voor een kind is de vlag
veruit het snelste herkenningspunt — sneller dan de code en sneller dan de
naam. Daarom staat naast de notatie hierboven overal ook de echte vlag:
`vlagVoor(landCode)` in [js/landen-data.js](js/landen-data.js) geeft een
`<img>` terug, `vlagUrl()` enkel het pad. De vlaggen liggen als SVG in
[img/vlaggen/](img/vlaggen/) — dezelfde 48 bestanden die
[print/landkaarten.html](print/landkaarten.html) gebruikt, dus één set voor
scherm en papier. `PANINI` en `FWC` horen bij geen land en krijgen er geen:
`vlagVoor()` geeft dan `null` en elke oproeper laat het element weg.

Het pad wordt gerekend vanaf `import.meta.url` en niet als kale relatieve
tekst: dezelfde module wordt ingeladen door de pagina's in de hoofdmap én door
`print/ruilfiche.html`, een map dieper. Dat is dezelfde reden waarom de rest
van het portaal `window.location.origin` gebruikt in plaats van een vaste host.

Waar de vlaggen staan: de landkeuze op `kind.html`, beide
landkoppen op de ruilpagina, de landenkeuze van Snelruilen, de staafgrafieken,
toplijsten en inzichten van de statistiek, de lijst naast de wereldkaart, en op
de kaart zelf. Uitgezoomd draagt elke bol de vlag van zijn land; de
percentagekleur die eerst de vulling was, is dan de ring eromheen geworden, dus
grootte én kleur zeggen nog exact hetzelfde als vroeger. Ingezoomd blijft de
cluster van vijf iconen ongewijzigd — daar zit de vlag in de kop van de popup
en groot in de landinfo-popup.

De ruilfiche blijft bewust zonder vlag: dat blad is zwart-wit ontworpen
(zie [css/print-ruilfiche.css](css/print-ruilfiche.css)) en wordt thuis
afgedrukt.

Twee dingen om te weten bij het onderhoud. Ten eerste het **gewicht**: samen
zijn de 48 vlaggen ongeveer 860 kB, waarvan ruim 700 kB in vijf bestanden met
een gedetailleerd wapenschild (`ECU`, `ESP`, `MEX`, `HAI`, `CRO`). Ze worden lui
geladen (`loading="lazy"`), maar op de uitgezoomde wereldkaart staan alle 48
tegelijk in beeld en komen ze dus allemaal binnen. Wordt dat ooit een probleem,
dan is het vereenvoudigen van die vijf wapenschilden de enige knop die echt
iets doet. Ten tweede **Leaflet**: `css/leaflet.css` zet
`.leaflet-container .leaflet-marker-pane img { width: auto }` op élke afbeelding
in een marker. Die selector weegt zwaarder dan een enkele klasse, en zonder
tegengewicht valt de vlag in de bol terug op haar eigen verhouding — breder dan
de cirkel, dus een ei. Daarom is de selector voor de vlag in de bol met opzet
zwaar (`.wr-icoon.wr-bol--vlag img.landvlag--bol`).

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

Sinds `019_stickers_updated_at.sql` houdt `public.stickers` ook bij **wanneer** een
regel laatst geschreven werd. Niets gebruikt die kolom nog — ze staat er alvast omdat
je zulke geschiedenis niet met terugwerkende kracht kan verzamelen, en omdat de
rangschikking later kan gaan wegen hoe *vers* iemands lijst is (niet hoe "goed" die
persoon is; zie [../Todo.md](../Todo.md) voor dat onderscheid).

## De ruilplanner: met wie ga je eerst praten?

Bovenaan de ruilpagina staat **🎯 Beste ruilkansen**, een top tien van ruilers in de
volgorde waarin je ze het best afgaat. Dezelfde volgorde als de kaarten eronder — het
is een inhoudsopgave van het advies, geen tweede mening. De redenen staan enkel hier;
de (dichtgevouwen) kaarten zeggen zelf hoeveel ruilen er kunnen.

### Geen puntentotaal, wel echte cijfers

De voor de hand liggende aanpak is een score (favoriet +100, zeldzaam +50, …). Die is
bewust **niet** gebouwd, om vier redenen:

- **Optellen kantelt alles naar bundelgrootte.** Twaalf gewone stickers verslaan dan
  één favoriet. Middelen of het maximum nemen draait dat om en is even willekeurig; er
  is geen aggregatie die klopt.
- **Een getal als "96" leest als een percentage** terwijl het een som van verzonnen
  gewichten is zonder bovengrens.
- **Tweerichting is geen bonuspunt maar een poort.** `sql/016` laat een ruil niet
  registreren als het maar langs één kant klopt, dus mag "+50" nooit iemand bovenaan
  brengen met wie je niets kan afspreken.
- **Een som valt niet uit te leggen.** Een keten van vergelijkingen wél: elke stap ís
  één zin in de redenregel, in dezelfde volgorde.

De volgorde is dus: **favorieten → tweerichting → wat je nergens anders krijgt →
bundelgrootte → naam**. De uitleg is compact en volgt die keten tot en met
zeldzaamheid — hoogstens drie stukjes, cijfers die je kan natellen: "★ 2 favorieten ·
4 ruilen mogelijk · 1 zeldzame sticker". "Zeldzaam" vat "krijg je enkel hier" en
"raak je enkel hier kwijt" samen; die uitgebreide versie staat in de tooltip.
Bundelgrootte en naam beslissen enkel nog bij gelijke stand en halen de uitleg niet.

### Schaarste is persoonlijk, niet globaal

Niet "hoeveel kinderen in het hele portaal bieden FRA12 aan", maar **hoeveel exemplaren
liggen er bij de ruilers waar jíj effectief mee kan ruilen**. Dat getal komt gratis uit
`get_matches()` — geen extra RPC — en het lost meteen de valkuil op: bij een globale
telling krijgt iedereen dezelfde nummer één en stormt de hele wijk op dezelfde sticker
af, waardoor het advies zichzelf onderuit haalt. Persoonlijk verschilt het per kind.

Eén getal vat twee dingen samen die los geteld tegengesteld wezen: zeldzaamheid
("hoeveel mensen hebben hem") en zekerheid ("hoeveel hebben ze er"). Bij je dubbels is
het spiegelbeeld van toepassing: hoeveel ruilers willen hem? Jouw dubbel loopt niet
weg, maar de enige persoon die hem wil, kan dat wel. Het staat in de tooltip van elke
ster: "Er ligt er maar één van bij al je ruilers."

### 🔥 Eerst langsgaan / ⭐ Kan wachten

Twee etiketten, en ze zijn **vergelijkend**: alleen wie er van alle ruilers het meeste
heeft dat nergens anders ligt, krijgt het vuurtje, en niemand zodra iedereen gelijk
staat. Dat is geen randgeval — met 1034 stickers en enkele tientallen deelnemers ligt
bijna élke sticker bij maar één of twee mensen, dus een absolute drempel zou zowat
iedereen "dringend" maken. "Eerst langsgaan" verschijnt bovendien enkel bij wie je
effectief kan ruilen, om dezelfde reden als hierboven.

### De genummerde ruilronde

Elke gereserveerde sticker krijgt een cijfer naast zijn ster: de volgorde van je ronde,
van 1 tot N. **Genummerd per ruiler** (je gaat naar een pérsoon, dus blijft alles van
dezelfde ruiler bij elkaar) en **binnen een ruiler op albumpagina**, over beide kolommen
heen — dan blader je je boek bij elke persoon één keer van voor naar achter door in
plaats van heen en weer. Altijd albumvolgorde, ook als je de landen alfabetisch
sorteert: die keuze gaat over de weergave, deze over het doorbladeren van een papieren
album.

Het plan wordt berekend op **alle** ruilkansen, niet op de gefilterde: typen in het
zoekveld filtert de lijst eronder maar hernummert je ronde niet en herrangschikt je
advies niet. Klik je in de planner op iemand die net weggefilterd is, dan wist de
pagina de zoekterm (en schakelt zo nodig terug naar "Per ruiler") in plaats van niets
te doen.

### Ook favorieten op de stickerpagina (algemene favorieten)

Sinds `020_favorieten_algemeen.sql` staat er ook een sterretje naast elke sticker op
`kind.html` — in de checklist én in de samenvattingslijsten "Zoek ik"/"Heb ik dubbel".
Daar is nog geen ruiler in beeld, dus stelt de ster hier een eenvoudigere vraag dan op
de ruilpagina: **staat er, in welke vorm dan ook, een reservering op deze sticker?**
Niet "bestaat er specifiek nog een niet-toegewezen rij" — gewoon aan of uit. Zet je 'm
aan zonder dat er al een ruiler gekozen is, dan wordt het een **algemene** favoriet:
dezelfde rij in `public.favorieten`, maar met `ander_kind_id = null` — "dit is mijn
prioriteit, wijs zelf de beste ruiler toe". Geen "elders"-stand hier; die gaat over
BIJ WIE je reserveert, en die vraag hoort pas op de ruilpagina thuis.

`js/ruilen.js` lost zo'n algemene favoriet bij elke tekenbeurt op (niet één keer,
vastgeklikt in de databank): van alle ruilers die de sticker hebben of willen krijgt er
één de volle gouden ster, en de rest de gele contour — zowel in "Per ruiler" als in
"Per land". Ruilt iemand de sticker intussen weg, of biedt een nieuwe verzamelaar hem
aan, dan verschuift de ster gewoon mee de volgende keer dat de pagina tekent; er ligt
geen verouderde toewijzing vast.

**Bij wie hij terechtkomt is een strategische keuze.** Stel: je zoekt FRA12, BEL3 en
GER7. Ivo heeft enkel FRA12. Emma heeft alle drie, maar wil maar één van jouw dubbels —
Emma kan je dus maar één sticker geven. Haal je FRA12 bij haar, dan zijn BEL3 en GER7
verloren. Haal je FRA12 bij Ivo, die niets anders heeft, dan hou je Emma over voor iets
wat alleen zij heeft. Twee stickers in plaats van één, zonder dat er iets zeldzaams aan
te pas komt.

Dat zit in één verhouding: **druk** = wat die ruiler in deze richting voor je heeft,
gedeeld door hoeveel ruilen er met hem in passen (het kleinste van zijn twee kolommen,
want `sql/016` registreert per paar). Ivo 1/1 = 1, Emma 3/1 = 3; de laagste druk wint.
Tweerichting staat ervóór — een ruiler waar de ruil niet kan doorgaan is geen kandidaat
maar een doodlopend spoor — en de gewone rangorde beslist bij gelijke druk, zodat de
uitkomst niet verspringt.

Let op het verschil met het etiket **🔥 Eerst langsgaan** hierboven: dat antwoordt op
"bij wie ligt iets onvervangbaars" (Emma), de toewijzing op "waar haal ik déze sticker"
(Ivo). Die twee spreken elkaar niet tegen — samen zeggen ze: ga bij Emma langs voor wat
alleen zij heeft, en verspil haar niet aan iets wat Ivo ook kan geven.

**Kies je op de ruilpagina zelf expliciet een ándere ruiler** dan waar de algemene
favoriet naartoe wees, dan verhuist diezelfde reservering daarheen en wordt hij
concreet — het budget staat geen tweede rij toe. De ster op `kind.html` blijft dan
gewoon AAN staan: die vraagt niet meer of er nog een algemene rij is, maar of er
überhaupt een reservering op deze sticker staat, en dat klopt nog steeds — nu gewoon
bij een specifieke ruiler. (Een eerdere versie liet de ster hier uitgaan zodra de
keuze concreet werd; dat bleek verwarrend, want je had de favoriet niet opgeheven,
je had 'm net bevestigd.) Uitzetten op `kind.html` verwijdert wél alles wat op die
sticker gereserveerd staat, ook een intussen concrete reservering bij een specifieke
ruiler — de ster hier is een simpele schakelaar, geen teller per ruiler. Wie
fijnmaziger controle wil (juist déze reservering weg, een andere laten staan), regelt
dat op de ruilpagina zelf.

Waarom dit zonder de trigger uit `018` te wijzigen kan: het budget wordt bewaakt per
`(kind_id, code, richting)` — geen enkele check kijkt naar `ander_kind_id`. Een
algemene rij telt dus precies even zwaar mee als een concrete. `020` voegt enkel een
eigen unieke index toe die *twee* algemene favorieten voor dezelfde sticker tegenhoudt
(dat ving de bestaande index voor "zoek ik" toevallig al af, maar voor dubbels nog
niet).

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

**Geen lijst als er niets te kiezen valt.** Een lijst met één regel is een klik
te veel. Twee gevallen weet het systeem al exact (`eenduidigDoel()` in
`js/stickers.js`):

- **Een volledige stickercode** — dezelfde regel als bij Snelruilen hieronder:
  `GER15` en `BEL03` meteen, `BEL3` ook (er is geen `BEL30`), maar `ALG1` niet,
  want dat kan nog `ALG12` worden. Het land gaat open, de pagina scrollt naar de
  sticker, die licht op en krijgt de focus.
- **Een land** — alle treffers horen bij één land én dat land matcht zelf op
  code of naam: `ALG`, `Algeria`, `Algerije`, maar ook `belg` (Belgium en
  België zijn hetzelfde land). Het land gaat open; de focus blijft in het
  zoekveld en er komt geen blauwe rand op elke chip — die zou niets aanwijzen.

Een spelersnaam als `Bentaleb` levert ook maar één land op, maar matcht dat
land niet zelf: daar blijft de lijst staan, want er is een sticker bedoeld en
de naam kan nog een andere speler worden. Hetzelfde doel springt maar één keer:
wie daarna zelf een ander land kiest, wordt niet teruggetrokken.

## Snelruilen aan de ruiltafel

Voor wie op de beurs staat met een stapel stickers in de hand en geen tijd
heeft om een land te openen. De ⚡-knop in de navigatiebalk opent een venster
(een echte `<dialog>`, dus Escape en focus regelt de browser) met **één**
invoerveld. Eén code beantwoordt allebei de vragen tegelijk: *zoek ik hem?* en
*heb ik hem dubbel?*

**Waarom één veld en geen twee kolommen.** Een sticker heeft in de databank
precies één status, dus één opzoeking geeft beide antwoorden. Twee velden
betekenen kiezen, Tab drukken, en in het verkeerde veld kunnen typen — en op
een gsm zakt het tweede veld onder het toetsenbord.

**Wanneer er gecontroleerd wordt.** Zodra er geen langere code meer kan bedoeld
zijn. `BEL12` en `BEL03` meteen; `BEL3` ook, want er bestaat geen `BEL30`.
`BEL1` wacht op Enter, want het kan nog `BEL12` worden. Dat leest de catalogus,
niet een vast getal. Een onbekend land met één cijfer (`BLE1`) wacht ook, zodat
een tikfout geen melding geeft terwijl je nog typt. Hoofdletters, spaties en
koppeltekens maken niet uit; de weergave is die van de rest van het portaal
(`BEL3`, niet `BEL03`). Glansstickers (`BEL2s`) vallen erbuiten: `BEL12` zou al
gecontroleerd zijn vóór de `s` getypt is.

**"Bestaat niet" is geen "nee".** Een onbekende code toont niet "zoek ik niet"
— een tikfout zou dan een ruil doen mislopen. Ze komt niet in de historiek en
blijft geselecteerd staan, zodat je ze meteen overtypt.

**Kleur is nooit het enige signaal.** Groen/rood, maar met ✓/✗ en tekst: een
op twaalf jongens ziet rood en groen niet uit elkaar.

**Gegevens.** De catalogus wordt één keer per pagina opgehaald, de lijst van de
verzamelaar bij elke opening (wie net iets aanvinkte, ziet het meteen). Daarna
gaat er per controle niets meer over het netwerk. De historiek (laatste 20)
leeft enkel in het geheugen van de pagina en verdwijnt bij wisselen van
verzamelaar. Welke verzamelaar gekozen is, onthoudt het toestel
(`localStorage`); op `kind.html` is dat kind de standaard.

### Twee modi: Controleren en Inboeken

Bovenaan het venster staat een schakelaar. **Controleren** is wat hierboven
staat en wijzigt niets. **Inboeken** is voor na het openen van pakjes of na een
ruil: elke code wordt meteen verwerkt, met dezelfde regels voor wanneer een code
"klaar" is.

| Stond de sticker… | Dan |
|---|---|
| in Zoek ik | rij verwijderd — je hebt hem nu |
| nergens (dus "heb ik") | dubbel 0 → 1 |
| als dubbel ×n | dubbel n → n+1 |

**Eén venster, geen tweede knop.** Invoer, verzamelaarskeuze en historiek zijn
dezelfde, en de navbalk is op een gsm al te breed. Het echte risico is de
verkeerde modus: wie op de beurs "zoek jij FRA05?" typt terwijl het venster nog
op Inboeken staat, haalt FRA05 uit zijn Zoek ik. Daarom:

- **Inboeken wordt niet per toestel onthouden**, enkel zolang je op dezelfde
  pagina blijft. Venster sluiten en openen tijdens een stapel pakjes blijft
  Inboeken; een nieuwe pagina begint altijd bij Controleren.
- Inboeken ziet er **anders uit**: oranje rand en schakelaar, ander label en
  andere tekst op de Enter-toets. Groen en rood blijven voor het resultaat.

**"Heb ik" is een afleiding.** De databank kent enkel Zoek ik en dubbel; alles
wat niet gezocht is, geldt als al in het album (zie "Geplakt is een
afleiding"). Wie zijn Zoek ik-lijst niet invulde, maakt zo van elke nieuwe
sticker een valse dubbel — die dan op de ruilpagina van andere kinderen staat.
Is de Zoek ik-lijst leeg, dan staat daar een rode waarschuwing, en bij 0 → 1
zegt het resultaat letterlijk "stond niet in Zoek ik, dus je had hem al".

**Ongedaan maken is een stapel.** Elke druk op de knop — of **Ctrl+Z in een
leeg veld** — draait de vorige inboeking terug, tot twintig ver (zoveel als de
historiek toont). Een tikfout merk je bij een stapel stickers vaak pas later.

**Schrijven.** De nieuwe stand wordt lokaal berekend en meteen getoond; de
schrijfopdrachten gaan daarna één voor één, in volgorde, met de volledige stand
(upsert op `(kind_id, nummer)` of delete) en nooit "+1". Twee keer snel `ARG10`
geeft zo 1 en dan 2, geen verloren update. Eén aanvraag per inboeking, niets per
toetsaanslag. Mislukt er een, dan wordt die regel rood en wordt de lijst opnieuw
opgehaald. Na het sluiten stuurt het venster `snelruilen:gewijzigd`, waarop
`kind.html` zijn lijsten ververst.

Een verwijderde Zoek ik-rij laat een eventuele favoriet staan — dezelfde keuze
als in `sql/018`: nooit stil iets van de gebruiker weggooien. Een geregistreerde
ruil blijft ook ongemoeid; inboeken doet de eigenaar zelf.

`ontleedCode()`, `bepaalInboeking()` en de geordende schrijfrij staan in
`js/inboeken.js`, los van elk venster: 📷 Scan stickers boekt een hele foto in
met exact dezelfde regel (zie hieronder).

### Ruilen aan tafel: de bundel

Ruilpagina en Snelruilen delen één **bundel** (`js/ruilbundel.js`): met wie je
ruilt en welke ruilen er klaarliggen.

**Geen werk verliezen.** De bundel staat in `localStorage`, per tabblad
(`ruilbundel:<id>`, het id in `sessionStorage`). Een refresh laat hem gewoon
staan. Na een crash of een gesloten tabblad komt hij niet ongevraagd terug — dan
sta je de volgende dag nog op "Sol" — maar vraagt de ruilpagina (en Snelruilen):
"Je had nog een niet-geregistreerde ruil klaarstaan … [Herstellen]
[Verwijderen]". Een bundel zonder ruilen komt nooit terug, en na 7 dagen vervalt
er een stil. Twee tabbladen tegelijk: het tweede ziet de bundel van het eerste
als te herstellen; dubbel registreren kan niet, want de databank geeft een
openstaand paar gewoon terug.

- **Ruilerkaarten staan dicht.** Enkel de naam, hoeveel ruilen er kunnen en
  hoeveel stickers die ruiler daarna nog voor je heeft. De uitgeschreven
  redenen staan enkel nog in Beste ruilkansen. De hele kop (＋/−, naam en
  samenvatting) opent en sluit de kaart — een groot tikvlak, geen klein knopje.
  Eén kaart tegelijk open; een naam in Beste ruilkansen aanklikken opent die
  kaart. Een kaart openen onthoudt ook de ruiler. De kolomtitels noemen de
  ruiler bij naam: "Olivier heeft wat jij zoekt", "Olivier wil jouw dubbels".
- **Meerdere ruilen tegelijk.** Tik om beurt een sticker links (wat jij krijgt,
  lichtgroen) en rechts (wat je geeft, lichtgeel): ze krijgen samen "Ruil 1",
  daarna "Ruil 2". Nog eens tikken haalt een sticker eruit; de volgende tik
  vult het gat. "Mogelijke ruil" wordt dan "Meerdere ruilen", met één knop die
  alle volledige ruilen als één dossier registreert.
- **Snelruilen weet met wie.** Bovenaan staat "Ruil met: Sol". Een getypte code
  die bij Sol past, komt vanzelf in de bundel; twee keer dezelfde code typen
  haalt niets weg. Een halve ruil krijgt een keuzelijst met wat er nog past.
  Zonder gekozen ruiler blokkeert niets: "kies ruiler" is een link en geen
  verplichte popup, want Snelruilen dient ook gewoon om je eigen lijst na te
  kijken.
- **Een ruiler zoeken** gaat op voornaam en de eerste letter van de familienaam
  (`021`): meer van een ander gezin tonen we bewust niet. Wie geen account
  heeft, voeg je toe als nieuwe ruiler; bij hem beslis je per code zelf met
  een knop, want het portaal weet niet wat hij heeft.

### 🔔 Openstaande acties

Een bel in de navigatiebalk (op elke ingelogde pagina met Snelruilen) en een blok
op het dashboard tonen dezelfde lijst (`js/acties.js`). Bewust geen aparte pagina
"Mijn acties": dezelfde lijst op een derde plek voegt niets toe.

- **De teller telt enkel wat jij moet doen:** een ruildossier dat een ander
  registreerde en op jouw bevestiging wacht, en een bundel uit een gesloten
  tabblad die je nog moet herstellen of verwijderen. Een teller die altijd iets
  toont, leer je negeren.
- **Daaronder, zonder teller:** je eigen bundel die klaar is om te registreren,
  en dossiers die op de andere ruiler wachten.
- Elke regel is een link naar `ruilen.html?kind=…#…`, zodat een gezin met twee
  kinderen meteen bij de juiste verzamelaar en het juiste blok uitkomt.
- Geen e-mail, geen push, geen realtime-verbinding: de lijst ververst bij elke
  paginalading en na elke registratie of bevestiging op de ruilpagina.

## 📷 Stickers scannen via foto

Na het openen van pakjes: één foto van de nieuwe stickers in plaats van elke
code te typen. De knop staat bij **Stickers beheren** op `kind.html` en in
⚡ Snelruilen in de modus **Inboeken**. Enkel stickercodes — geen ruilbladen,
tabellen, vinkjes of handschrift.

**De gebruiker bevestigt altijd.** Na de foto volgt een controlevenster; pas na
een klik op Inboeken verandert er iets:

| De scan vond | Controlevenster |
|---|---|
| exact een bestaande code, met genoeg zekerheid | ☑ aangevinkt |
| een bestaande code na rechtzetten (`8EL3` → `BEL3`), of met lage zekerheid | ⚠ **niet** aangevinkt: "klopt dit?" |
| iets dat op een code lijkt maar niet bestaat (`BLE3`, `QQQ99`) | ❌ bewerkbaar, niet aan te vinken |
| dezelfde code op twee plaatsen | één regel ×2 |

Elke code is te verbeteren (een verbeterde, bestaande code staat meteen
aangevinkt), het aantal aan te passen en te verwijderen; wat gemist werd, voeg
je toe. Op de foto staat een kader rond elke gevonden code, zodat je ziet wat
er gelezen werd — en wat niet.

**Inboeken** gebruikt `js/inboeken.js`, dezelfde regel als Snelruilen: stond hij
in Zoek ik, dan gaat hij eruit; anders dubbel +1, één exemplaar per keer en in
volgorde. Daarna een samenvatting ("4 stickers verwerkt · ✅ 2 verwijderd uit
Zoek ik · ✅ 2 dubbels toegevoegd"), en `kind.html` ververst. De waarschuwing
bij een lege Zoek ik geldt ook hier.

**Tijdelijke lijst.** "Toevoegen aan tijdelijke lijst" wijzigt nog niets: de
codes gaan per verzamelaar naar `localStorage` (`scanlijst:<kind>`, overleeft
een refresh), en je scant verder. Het startscherm toont de lijst met "Alles
inboeken" en "Wissen" (twee keer tikken). Wat niet bewaard kon worden, blijft
erop staan.

### Herkenning op het toestel

Tesseract.js (WebAssembly, in een worker): geen foto verlaat het toestel, geen
kosten, en na de eerste keer werkt het offline. Drie lagen, elk vervangbaar:

- `js/ocr-lokaal.js` — foto klaarmaken (juiste stand, verkleind tot 2400 px,
  grijs, contrast opgerekt) en woorden lezen. Alleen hoofdletters en cijfers,
  paginasegmentatie "verspreide tekst". **Elke foto wordt twee keer gelezen:**
  zoals ze is, en zonder dunne donkere lijnen (een grijze "sluiting" met een
  venster van 3 px). Gemeten op gegenereerde stapels: een schuine kaderlijn van
  2 px rond de stickers deed Tesseract níets meer lezen zodra de stapel 1,5° of
  meer gedraaid lag; zonder die lijnen alle codes, ook bij ±3° en 4°. Een venster
  van 5 px tastte al tekens aan. De tweede leesbeurt kost ongeveer evenveel tijd
  als de eerste.
- `js/herkenning.js` — woorden → codes, los van de foto (en dus te testen). Op
  een letterplaats wordt `0` een O, op een cijferplaats `S` een 5; wat dan in de
  catalogus staat, is een kandidaat. `GER07` wordt `GER7`, zoals overal. Een
  code die OCR in twee woorden splitst (`FRA 12`) wordt samengevoegd.
- `js/scanner.js` — het venster.

Later kan AI het eerste deel vervangen zonder dat de andere twee veranderen.

**Bestanden in `vendor/tesseract/`**, niet van een CDN: Tesseract.js 7.0.0
(`tesseract.min.js`, `worker.min.js`), de LSTM-kernen van tesseract.js-core
7.0.0 (drie varianten; de worker kiest wat het toestel aankan) en het Engelse
LSTM-model `4.0.0_best_int`, **onverpakt** (een `.gz` dat een CDN onderweg
uitpakt, breekt het inlezen). Licenties ernaast (Apache-2.0). Samen ~17 MB in
de repo, maar een toestel laadt er ~9 MB van, en pas bij de eerste scan.
Bijwerken: `npm pack tesseract.js tesseract.js-core @tesseract.js-data/eng` en
dezelfde bestanden vervangen.

**CSP.** `script-src` kreeg `'wasm-unsafe-eval'`: zonder mag de browser geen
WebAssembly compileren. Verder niets: de worker komt van `'self'` (geen
blob-URL), het model ook, en de foto wordt op een canvas getekend (geen
`blob:`-afbeelding). De proefopstelling stuurt geen CSP mee — na een deploy dus
één echte scan doen.

**Wat het niet (goed) kan.** Glansstickers, codes ondersteboven, sterke schuine
hoeken, schittering over de code en een code die voor de helft bedekt is. De
betrouwbaarheid op echte gsm-foto's meet `test/scanfotos.mjs` — gegenereerde
foto's zeggen daar weinig over.

## Frontend

- `js/supabase.js` — Supabase-client + `getCurrentUser()`/`requireAuth()`.
- `js/auth.js` — login (magic link + Google) en logout.
- `js/kinderen.js` — CRUD voor kinderen; filtert niet zelf op `user_id`, want
  wat je ziet en mag wijzigen beslist RLS (gezinsbreed sinds `009`).
- `js/stickers.js` — kinddetailpagina: kindgegevens + checklist per land
  (bulksgewijs gezocht/dubbel aanvinken) + het zoeken naar een sticker of
  speler over alle landen heen + de samenvattingslijsten. Sterretje per
  sticker voor een algemene favoriet (sql/020) — js/ruilen.js wijst die toe
  aan een concrete ruiler.
- `js/landcombo.js` — de landkeuzelijst waarin je kan typen: knop met
  `role="combobox"` en een eigen `listbox` eronder, omdat een `<select>` zich
  niet laat filteren terwijl hij openstaat.
- `js/dashboard.js` — dashboard: kinderenlijst, cijfers per verzamelaar en het
  vinkje "komt mee" per beurs. Heeft het gezin nog geen enkele verzamelaar, dan
  geeft het het scherm door aan `js/onboarding.js`.
- `js/onboarding.js` — de inschrijfwizard voor wie voor het eerst aanmeldt:
  welkom → jouw gegevens → verzamelaars → controleren, en daarna het
  klaar-scherm. Zie "Eerste login: de inschrijfwizard".
- `js/ruilen.js` — ruilkansen per verzamelaar, te bekijken *per ruiler* (twee
  kolommen: wat hij voor jou heeft, wat hij van jou wil) of *per land* (wie
  heeft en wie zoekt deze sticker), met live zoeken op ruiler, land en
  stickercode. Sterretjes om favorieten te reserveren, ruilers gerangschikt op
  favoriet → tweerichting → bundelgrootte. Registreert ruilen, toont de
  bevestiging per kant en — voor beheerders — het opvolgingsoverzicht.
- `js/snelruilen.js` — ⚡ Snelruilen: een venster vanuit de navigatiebalk
  om een code te typen en meteen te zien of de verzamelaar hem zoekt en/of
  dubbel heeft (Controleren), of hem meteen in te boeken (Inboeken). Zie
  "Snelruilen aan de ruiltafel".
- `js/gezin.js` — tweede volwassene toevoegen, gsm-nummer van het gezin, en
  "Hoe heb je ons gevonden?" (`026`).
- `js/whatsapp.js` — nummers normaliseren naar E.164 en wa.me-links bouwen.
- `js/beurs.js` — welk event staat centraal en in welke fase zitten we
  (`huidig_event()`). Eén bron voor dashboard, ruilpagina en beheerpagina, met
  terugval op het oude venster zolang `025` niet gedraaid is.
- `js/beurs-uitleg.js` — het aantal dagen in de uitleg op de startpagina, via
  `beurs_info()` (de enige RPC die `anon` mag uitvoeren).
- `js/hoe-gevonden.js` — de negen keuzes achter "Hoe heb je ons gevonden?",
  gedeeld door `gezin.js` en `aanwezigheden.js` zodat ze het nooit oneens zijn.
- `js/aanwezigheden.js` — organisatiepagina: een kolom per ruilbeurs, afvinken
  aan de inkom, tellingen per editie.
- `js/instellingen.js` — beheerpagina: de lijst ruilbeurzen, het aantal dagen
  dat de aanwezigheidsfilter vooraf aangaat, glans, organisatornummer,
  stickerwaarde en pakjesgrootte.
- `js/statistieken.js` — statistiekenpagina: cijferkaarten met tooltips,
  staafdiagrammen (gewone elementen op procentbreedte) en lijngrafieken (met de
  hand getekende SVG). Geen grafiekbibliotheek: een pakket van 200 kB voor zes
  grafiekjes weegt niet op tegen de laadtijd.
- `js/wereldreis.js` — FIFA Wereldreis: coördinaten, kleuren, lagen, kaart.
- `js/landen-data.js` — de notatie `BEL - BELGIUM - België` (met `{ pagina:
  true }` als `BEL - BELGIUM - België (p.56)`), de vlag bij die notatie
  (`vlagVoor()` / `vlagUrl()`, bestanden in `img/vlaggen/`), de accentkleur per land, de drie
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
