# supabase/migrations — wat daarin staat, draait vanzelf op productie

Elke push naar `main` die een nieuw bestand in `supabase/migrations/` bevat, laat Supabase
dat bestand uitvoeren op de productiedatabank (GitHubkoppeling, zie
`README.md` §1). Wat er al liep, houdt Supabase bij in
`supabase_migrations.schema_migrations` en draait het niet opnieuw.

**Waarom de oude migraties hier niet staan.** `sql/002…026` zijn met de hand
uitgevoerd, vóór de koppeling bestond, en `002` dropt `kinderen` en
`stickers`. Stonden ze hier, dan zou de eerste deploy ze opnieuw proberen.
Ze blijven in `sql/` als geschiedenis; deze map begint bij `027`.

**Naamgeving.** `JJJJMMDDUUMMSS_0NN_korte_naam.sql`, bv.
`20260920103000_027_iets_nieuws.sql`. De tijdstempel bepaalt voor Supabase de
volgorde; het volgnummer houdt de nummering van `sql/` doorlopend, zodat
verwijzingen als "zie `027`" blijven werken.

**Regels die hier zwaarder wegen dan in `sql/`:**
- Een bestand dat al op `main` staat, pas je nooit meer aan: het is al
  uitgevoerd en wordt niet opnieuw gedraaid. Een fout herstel je met een nieuw
  bestand.
- Niets destructiefs zonder dat het er in hoofdletters bovenaan staat — er
  kijkt niemand meer mee op het moment dat het loopt.
- Cloudflare Pages deployt dezelfde push. De frontend moet dus even werken
  zonder én met de nieuwe migratie, zoals nu al de gewoonte is.

## Mailmeldingen (`functions/berichten-mail`, migratie `033`)

Ouders krijgen een mail als er in een ruilgesprek van hun gezin ongelezen
berichten staan: hoogstens om de 3 uur, pas na 10 minuten, en zonder de inhoud.
Wie mag mailen en naar wie, beslist `mail_meldingen_klaar()` in de databank.
De functie verstuurt enkel. Zonder de stappen hieronder gaat er niets uit, en
de bel 🔔 op de site werkt gewoon.

Dit gebeurt **eenmalig met de hand**, want de geheimen horen niet in git:

1. **Resend**: maak een account en verifieer `meulestede.gent`. Zet de
   SPF/DKIM-records die Resend geeft in de DNS bij Cloudflare. Maak een API-sleutel.
2. **Uitrollen**, zonder JWT-controle: de functie controleert zelf een gedeeld
   geheim. `verify_jwt` zou elke ingelogde ouder doorlaten, en de nieuwe
   publishable key is geen JWT.
   ```
   supabase functions deploy berichten-mail --no-verify-jwt --project-ref iriqsfxcrfdnkfvqmirw
   supabase secrets set --project-ref iriqsfxcrfdnkfvqmirw RESEND_API_KEY=re_… BERICHTEN_MAIL_GEHEIM=<lange willekeurige tekst>
   ```
   Optioneel: `MAIL_AFZENDER` (standaard `Panini Ruilportaal <ruilportaal@meulestede.gent>`)
   en `SITE_URL` (standaard `https://panini.meulestede.gent`).
3. **Elke 15 minuten aanroepen**, in de SQL-editor. Dit is bewust geen migratie,
   want het geheim staat erin:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.schedule('berichten-mail', '*/15 * * * *', $$
     select net.http_post(
       url := 'https://iriqsfxcrfdnkfvqmirw.supabase.co/functions/v1/berichten-mail',
       headers := jsonb_build_object('x-cron-geheim', '<zelfde geheim als hierboven>')
     );
   $$);
   ```
   Stoppen: `select cron.unschedule('berichten-mail');`

Controle: roep de functie eens met de hand aan met dezelfde header. Ze geeft
`{"verstuurd": n, "fouten": []}` terug. Zonder sleutel zegt ze dat de
meldingen uit staan.
