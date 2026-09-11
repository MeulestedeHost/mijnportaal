-- Panini Ruilportaal — Wanneer werd deze sticker laatst aangeraakt?
-- Voer dit uit na sql/018_favorieten.sql.
--
-- Niet destructief: één kolom bij op een bestaande tabel, gevuld met een
-- waarde die er al was. Geen rij verdwijnt, geen functie verandert.
--
-- WAAROM NU, TERWIJL NIETS DIT NOG GEBRUIKT. Omdat je dit niet met
-- terugwerkende kracht kan verzamelen. De ruilpagina gaat later rangschikken
-- op hoe VERS iemands lijst is (Todo.md, stap 4) — een dubbellijst van
-- gisteren is betrouwbaarder dan een van drie maanden geleden, want die
-- stickers zijn intussen misschien allang geruild. Wachten met deze kolom tot
-- die functie er is, betekent dat je op dat moment van niemand weet hoe oud
-- zijn lijst is. Eén kolom nu kost niets en levert vanaf vandaag geschiedenis.
--
-- VERSHEID, GEEN REPUTATIE. Dit is uitdrukkelijk niet bedoeld om te meten wie
-- een "goede ruiler" is. Reputatie heeft een ingebouwd Mattheüseffect: wie
-- achterloopt, blijft achterlopen, en een nieuw kind komt er nooit tussen.
-- Versheid draait dat net om — wie vandaag zijn lijst invult, staat vooraan.
-- Zie Todo.md voor die afweging.
--
-- public.sticker_status heeft deze kolom al sinds sql/003, mét trigger.
-- public.stickers — de tabel die de pagina's echt gebruiken — had enkel
-- created_at, en dat verandert niet mee wanneer je een aantal bijstelt.

-- ============================================================
-- 1. De kolom
-- ============================================================
-- Bewust in drie stappen in plaats van "add column ... not null default now()":
-- die ene regel zou élke bestaande rij op vandaag zetten, en dus beweren dat
-- iedereen zijn lijst zonet nog bijwerkte. created_at is voor die rijen het
-- laatste moment waarvan we zeker weten dat er iets gebeurde, dus dat is het
-- eerlijke antwoord.
alter table public.stickers
  add column if not exists updated_at timestamptz;

update public.stickers
   set updated_at = created_at
 where updated_at is null;

alter table public.stickers
  alter column updated_at set default now();

alter table public.stickers
  alter column updated_at set not null;

comment on column public.stickers.updated_at is
  'Wanneer deze regel laatst geschreven werd (status of aantal). Bedoeld om te
   wegen hoe actueel iemands lijst is — niet om te oordelen over de persoon.';

-- ============================================================
-- 2. De trigger
-- ============================================================
-- public.touch_updated_at() bestaat al sinds sql/003 en doet precies dit; er
-- is geen reden voor een tweede functie die hetzelfde doet.
--
-- De stickerpagina schrijft met upsert (js/stickers.js). Een upsert die een
-- bestaande rij bijwerkt, is voor Postgres een update en vuurt deze trigger;
-- een nieuwe rij krijgt de default hierboven. Beide kanten zijn dus gedekt.
drop trigger if exists trg_touch_stickers on public.stickers;
create trigger trg_touch_stickers
  before update on public.stickers
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Wat hier NIET gebeurt
-- ============================================================
-- get_matches() geeft updated_at (nog) niet terug. Dat is een bewuste keuze:
-- die functie wordt door drie pagina's gebruikt, en haar kolomlijst uitbreiden
-- voor iets wat nog niemand toont, is wijziging zonder opbrengst. Zodra stap 4
-- gebouwd wordt, komt de kolom daar in dezelfde beweging bij — en dan is er
-- meteen echte geschiedenis om mee te rekenen.

-- ============================================================
-- Nakijken
-- ============================================================
-- 1) De kolom bestaat en is nergens leeg:
--        select count(*) filter (where updated_at is null) as leeg,
--               min(updated_at), max(updated_at)
--        from public.stickers;
--
-- 2) De trigger werkt — het tweede getal hoort nieuwer te zijn:
--        select updated_at from public.stickers limit 1;
--        update public.stickers set aantal = aantal where id = '<die-id>';
--        select updated_at from public.stickers where id = '<die-id>';
