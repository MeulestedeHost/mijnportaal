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
4. Authentication → Providers → zorg dat "Email" ingeschakeld staat.
   Wachtwoord-authenticatie is niet nodig: deze app gebruikt uitsluitend
   Magic Links.
5. Settings → API: kopieer de Project URL + anon/publishable key.

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
- `js/auth.js` — login (magic link) en logout.
- `js/kinderen.js` — CRUD voor kinderen.
- `js/stickers.js` — kinddetailpagina: kindgegevens + CRUD voor stickers.
- `js/dashboard.js` — dashboard: onboarding-wizard en kinderenlijst.

ES Modules, geen build-stap, geen framework.

## Beveiliging

- Uitsluitend de anon/publishable key in clientcode (publiek, veilig).
- Authenticatie enkel via Supabase Magic Link — geen wachtwoorden.
- Row Level Security: gebruikers zien/bewerken enkel eigen kinderen en
  stickers van eigen kinderen.
- Inputvalidatie op voornaam, familienaam, geboortejaar, stickernummer en
  status.
- Veilige rendering via `textContent` (nooit `innerHTML` met gebruikersdata)
  → geen XSS.
- `service_role`-key nooit in clientcode.
