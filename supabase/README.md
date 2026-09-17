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
