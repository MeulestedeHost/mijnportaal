-- Panini Ruilportaal — FIFA Wereldreis, fase 3: landfoto's
-- Voer dit uit na sql/010_wereldreis.sql.
--
-- Niet destructief: er komt één tabel bij, met leesrechten voor iedereen die
-- ingelogd is. Geen kolom of policy elders verandert.
--
-- WAAROM EEN TABEL EN GEEN JS-BESTAND. land-data.js en voetbal-data.js zijn
-- bewust statische code: identiek voor iedereen, zelden gewijzigd, geschreven
-- door wie aan de app werkt. Foto's liggen anders — de opdracht vraagt dat er
-- later, zonder een nieuwe deploy, foto's bij kunnen. Een rij toevoegen in
-- Supabase kan dat; een nieuw bestand in de git-repository niet zonder een
-- codewijziging.
--
-- WAAR DE ECHTE BESTANDEN STAAN. Niet hier: deze tabel bewaart enkel metadata
-- en een verwijzing (foto_url). De afbeeldingen zelf horen in een Cloudflare
-- R2-bucket met publieke toegang (of een custom domain erop), in een
-- structuur zoals:
--
--   countries/
--     belgium/atomium.jpg
--     france/eiffeltoren.jpg
--     japan/fuji.jpg
--     brazil/christusbeeld.jpg
--
-- foto_url bevat de VOLLEDIGE publieke URL naar zo'n bestand (bijvoorbeeld
-- https://media.<jouwdomein>.be/countries/belgium/atomium.jpg), niet enkel het
-- pad in de bucket — zo hoeft de app zelf geen aannames te doen over welk
-- domein de bucket gebruikt. Wissel je ooit van opslag, dan volstaat het de
-- rijen te updaten.
--
-- BELANGRIJK bij het opzetten van R2: zodra er een echt domein is, moet dat
-- domein in de img-src van _headers staan — anders blokkeert de
-- Content-Security-Policy de afbeeldingen zelf, ook al staat de URL correct
-- in de databank.

create table if not exists public.land_fotos (
  id         bigint generated always as identity primary key,
  land_code  text not null,
  foto_url   text not null,
  titel      text not null,
  alt_tekst  text not null,
  volgorde   integer not null default 0
);

comment on table public.land_fotos is
  'Metadata en verwijzingen naar landfoto''s in Cloudflare R2. Geen binaire data.';

alter table public.land_fotos enable row level security;

-- Zelfde soort inhoud als public.sticker_catalogus: redactionele info,
-- identiek voor elk gezin, dus gewoon leesbaar voor elke ingelogde gebruiker.
-- Wijzigen doe je via de SQL-editor of het Supabase-dashboard, niet vanuit de
-- app — er is dan ook bewust geen insert/update/delete-policy.
create policy "land_fotos_select" on public.land_fotos
  for select
  to authenticated
  using (true);

create index if not exists land_fotos_land_code_idx
  on public.land_fotos (land_code, volgorde);

-- ============================================================
-- Rij toevoegen (voorbeeld — pas land_code, foto_url, titel en alt_tekst aan)
-- ============================================================
-- insert into public.land_fotos (land_code, foto_url, titel, alt_tekst, volgorde) values
--   ('BEL', 'https://media.jouwdomein.be/countries/belgium/atomium.jpg', 'Atomium', 'Het Atomium in Brussel', 1);
--
-- Zolang er geen rijen staan voor een land, toont het fotopaneel gewoon
-- "Nog geen foto's voor dit land" — dat is geen foutmelding, enkel een lege
-- tabel.
