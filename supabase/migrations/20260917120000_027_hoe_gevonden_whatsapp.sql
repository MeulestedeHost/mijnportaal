-- Panini Ruilportaal — WhatsApp bij "Hoe heb je ons gevonden?"
-- Bouwt voort op sql/026_hoe_gevonden.sql.
--
-- WAAROM. De aankondiging gaat ook rond in WhatsApp-groepen van de wijk en de
-- klas. Tot nu viel dat onder 'andere', waar het tussen de vrije toelichtingen
-- verdwijnt — net het kanaal waarvan de organisatie wil weten of het werkt.
-- Een eigen sleutel is één regel; het uit de toelichtingen moeten lezen is elk
-- jaar handwerk.
--
-- Niet destructief: enkel één sleutel bij in de check. Bestaande antwoorden
-- blijven geldig, en 'whatsapp' kon tot nu nergens bewaard zijn.
--
-- De opschriften staan in js/hoe-gevonden.js; die lijst hoort gelijk te lopen
-- met deze check, anders weigert de databank een antwoord dat de pagina aanbiedt.
alter table public.gezinnen
  drop constraint if exists gezin_hoe_gevonden_geldig;
alter table public.gezinnen
  add constraint gezin_hoe_gevonden_geldig
  check (hoe_gevonden is null or hoe_gevonden in (
    'facebook',
    'instagram',
    'whatsapp',
    'website_vzw',
    'mond_tot_mond',
    'vrienden_familie',
    'affiche',
    'school',
    'vorige_ruilbeurs',
    'andere'
  ));

-- Snelle controle:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'gezin_hoe_gevonden_geldig';
