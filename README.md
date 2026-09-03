# Panini Ruilportaal

Een portaal waar ouders/verzamelaars aanmelden via e-mail (Supabase Magic
Link), meerdere kinderen kunnen beheren, en per kind een Panini-
stickerverzameling bijhouden (heeft / zoekt / ruilt). Gehost op Cloudflare
Pages; data en authenticatie via Supabase.

## Datamodel

```
auth.users
    └── kinderen (voornaam, familienaam, geboortejaar)
             └── stickers (nummer, status: HEEFT | ZOEKT | RUILT)
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
   `008` → `009_gezin_en_whatsapp.sql`. Enkel `002` en de blokken die het
   zelf aankondigen zijn destructief; `009` is dat niet.
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
| nummer | text | stickernummer |
| status | text | `HEEFT`, `ZOEKT` of `RUILT` |
| created_at | timestamptz | |

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

## Frontend

- `js/supabase.js` — Supabase-client + `getCurrentUser()`/`requireAuth()`.
- `js/auth.js` — login (magic link + Google) en logout.
- `js/kinderen.js` — CRUD voor kinderen; filtert niet zelf op `user_id`, want
  wat je ziet en mag wijzigen beslist RLS (gezinsbreed sinds `009`).
- `js/stickers.js` — kinddetailpagina: kindgegevens + CRUD voor stickers.
- `js/dashboard.js` — dashboard: onboarding-wizard en kinderenlijst.
- `js/ruilen.js` — ruilkansen van het hele gezin, met de kolom *Contacteren*.
- `js/gezin.js` — tweede volwassene toevoegen, gsm-nummer van het gezin.
- `js/whatsapp.js` — nummers normaliseren naar E.164 en wa.me-links bouwen.
- `js/instellingen.js` — beheerpagina: beursvenster, glans, organisatornummer.

ES Modules, geen build-stap, geen framework.

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
