-- Panini Ruilportaal — Kindvriendelijke ruillijst + dashboardcijfers
-- Voer dit uit na sql/003_ruillijst.sql en sql/005_seed_stickers.sql.
--
-- Dit script werkt op de tabel public.stickers die de site ECHT gebruikt
-- (kind_id + nummer = catalogus-code + status). De tabel sticker_status uit
-- 003 en de functie get_matches uit 004 gingen uit van een ander model dat
-- de front-end nooit heeft gevuld; die functie wordt hier vervangen.
--
-- LET OP — één destructieve stap: blok 1 verwijdert alle rijen met status
-- 'HEEFT'. Dat is de bedoeling ("we registreren niet meer wat we hebben"),
-- maar het is onomkeerbaar. Commentarieer blok 1 weg als je die rijen wil
-- bewaren; de rest van het script werkt dan nog steeds.

-- ============================================================
-- 1. HEEFT verdwijnt  (DESTRUCTIEF)
-- ============================================================
delete from public.stickers where status = 'HEEFT';

-- Dubbele rijen (zelfde kind, zelfde code) opruimen vóór de unieke index.
delete from public.stickers s
using public.stickers t
where s.kind_id = t.kind_id
  and s.nummer  = t.nummer
  and s.id      > t.id;

alter table public.stickers drop constraint if exists stickers_status_check;
alter table public.stickers add  constraint stickers_status_check
  check (status in ('ZOEKT', 'RUILT'));

-- Eén rij per kind per sticker: het formulier controleert dit al, maar de
-- database hoort de laatste horde te zijn.
create unique index if not exists idx_stickers_kind_nummer
  on public.stickers (kind_id, nummer);

-- ============================================================
-- 2. Volwassen verzamelaars
-- ============================================================
-- Een volwassene staat in dezelfde tabel als de kinderen: hij verzamelt op
-- dezelfde manier, telt mee in dezelfde matches, en heeft geen geboortejaar
-- (die kolom is al nullable).
alter table public.kinderen
  add column if not exists is_volwassen boolean not null default false;

-- ============================================================
-- 3. Beursvenster
-- ============================================================
-- Zelfde tabel als in 004; hier nog eens idempotent zodat dit script ook
-- werkt wanneer 004 nooit gedraaid is.
create table if not exists public.instellingen (
  id          smallint primary key default 1 check (id = 1),
  beurs_start timestamptz not null,
  beurs_einde timestamptz not null,
  updated_at  timestamptz not null default now(),
  constraint beurs_venster_geldig check (beurs_einde > beurs_start)
);

insert into public.instellingen (id, beurs_start, beurs_einde)
values (
  1,
  timestamp '2026-09-06 14:00' at time zone 'Europe/Brussels',
  timestamp '2026-09-06 17:00' at time zone 'Europe/Brussels'
)
on conflict (id) do nothing;

alter table public.instellingen enable row level security;

drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select
  on public.instellingen for select
  to authenticated
  using (true);

-- Bewust geen insert/update/delete-policy: het venster verzet je enkel in de
-- SQL-editor:
--   update public.instellingen
--      set beurs_start = timestamp '2026-09-06 13:30' at time zone 'Europe/Brussels',
--          beurs_einde = timestamp '2026-09-06 18:00' at time zone 'Europe/Brussels',
--          updated_at  = now()
--    where id = 1;

create or replace function public.beurs_actief()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.instellingen i
    where i.id = 1 and now() >= i.beurs_start and now() < i.beurs_einde
  );
$fn$;

revoke all on function public.beurs_actief() from public;
revoke all on function public.beurs_actief() from anon;
grant execute on function public.beurs_actief() to authenticated;

-- ============================================================
-- 4. get_matches(): wie kan met wie ruilen
-- ============================================================
-- security definer, want ze moet de stickers van ANDERE gezinnen lezen —
-- iets wat RLS terecht verbiedt. Daarom staat de volledige toegangscontrole
-- expliciet in de CTE 'eigen_kind':
--   a) auth.uid() moet ingevuld zijn         -> anonieme call levert niets op
--   b) p_kind_id moet van auth.uid() zijn    -> geen andermans kind
-- Valt één van beide weg, dan is eigen_kind leeg en levert de hele query
-- nul rijen.
--
-- Het beursvenster bepaalt hier NIET of je rijen ziet, maar of je de
-- VOORNAAM van de tegenpartij ziet. Buiten het venster is ander_kind null:
-- je weet dat de sticker te ruilen valt, niet bij wie. Zo blijft het
-- dashboard het hele jaar bruikbaar zonder vooraf te verklappen wie waar zit.
--
-- Matches binnen hetzelfde gezin tellen niet mee (ak.user_id <> ek.user_id):
-- broer en zus hebben geen ruilbeurs nodig om te ruilen. Testen doe je dus
-- met twee verschillende accounts.

drop function if exists public.get_matches(uuid);

create function public.get_matches(p_kind_id uuid)
returns table (
  richting     text,
  code         text,
  nummer       integer,
  land_naam    text,
  sticker_naam text,
  ander_kind   text
)
language sql
security definer
stable
set search_path = ''
as $fn$
  with eigen_kind as (
    select k.id, k.user_id
    from public.kinderen k
    where k.id = p_kind_id
      and auth.uid() is not null
      and k.user_id = auth.uid()
  )
  -- Jij zoekt deze sticker, iemand anders heeft ze dubbel
  select
    'jij_zoekt'::text,
    c.code,
    c.nummer,
    c.land_naam,
    c.naam,
    case when public.beurs_actief() then ak.voornaam end
  from eigen_kind ek
  join public.stickers mij   on mij.kind_id = ek.id and mij.status = 'ZOEKT'
  join public.stickers ander on ander.nummer = mij.nummer and ander.status = 'RUILT'
  join public.kinderen ak    on ak.id = ander.kind_id and ak.user_id <> ek.user_id
  join public.sticker_catalogus c on c.code = mij.nummer

  union   -- union, niet union all: buiten het beursvenster vallen de
          -- naamloze rijen van meerdere kinderen samen tot één regel

  -- Jij hebt deze sticker dubbel, iemand anders zoekt ze
  select
    'jij_hebt_dubbel'::text,
    c.code,
    c.nummer,
    c.land_naam,
    c.naam,
    case when public.beurs_actief() then ak.voornaam end
  from eigen_kind ek
  join public.stickers mij   on mij.kind_id = ek.id and mij.status = 'RUILT'
  join public.stickers ander on ander.nummer = mij.nummer and ander.status = 'ZOEKT'
  join public.kinderen ak    on ak.id = ander.kind_id and ak.user_id <> ek.user_id
  join public.sticker_catalogus c on c.code = mij.nummer

  order by 1, 4, 3, 2;
$fn$;

revoke all on function public.get_matches(uuid) from public;
revoke all on function public.get_matches(uuid) from anon;
grant execute on function public.get_matches(uuid) to authenticated;

-- ============================================================
-- 5. kind_statistieken(): de cijfers op het dashboard
-- ============================================================
-- Eén aanroep levert de tellers voor alle verzamelaars van de ingelogde
-- ouder, kinderen én volwassenen. 'matches' telt dezelfde richting als het
-- venster "Iemand heeft het dubbel" op de kindpagina, zodat het getal op het
-- dashboard en de lijst op de detailpagina niet uit elkaar lopen.

create or replace function public.kind_statistieken()
returns table (
  kind_id uuid,
  zoekt   integer,
  dubbel  integer,
  matches integer
)
language sql
security definer
stable
set search_path = ''
as $fn$
  select
    k.id,
    (select count(*)::int from public.stickers s
      where s.kind_id = k.id and s.status = 'ZOEKT'),
    (select count(*)::int from public.stickers s
      where s.kind_id = k.id and s.status = 'RUILT'),
    (select count(distinct s.nummer)::int
       from public.stickers s
       join public.stickers a  on a.nummer = s.nummer and a.status = 'RUILT'
       join public.kinderen ak on ak.id = a.kind_id and ak.user_id <> k.user_id
      where s.kind_id = k.id and s.status = 'ZOEKT')
  from public.kinderen k
  where auth.uid() is not null
    and k.user_id = auth.uid();
$fn$;

revoke all on function public.kind_statistieken() from public;
revoke all on function public.kind_statistieken() from anon;
grant execute on function public.kind_statistieken() to authenticated;
