-- Panini Ruilportaal — Matches ook binnen het eigen gezin
-- Voer dit uit na sql/007_instellingen.sql.
--
-- Wat verandert er en waarom:
--
-- 006/007 sloten matches binnen hetzelfde account uit (ak.user_id <>
-- ek.user_id), met het idee dat broer en zus geen ruilbeurs nodig hebben om
-- te ruilen. Dat klopt als redenering, maar het maakt het portaal onbruikbaar
-- voor het gezin zelf: twee kinderen van dezelfde ouder zagen elkaars dubbels
-- niet, en met één login viel er niets te testen. Dát een ruil mogelijk is,
-- hoort altijd gemeld te worden.
--
-- Wat WEL beschermd blijft: bij wie de sticker ligt.
--   * Eigen gezin        -> voornaam altijd zichtbaar. Die ouder ziet beide
--                           lijsten toch al; verbergen zou schijnveiligheid
--                           zijn en enkel verwarring geven.
--   * Een ander gezin    -> voornaam enkel tijdens het beursvenster; daarbuiten
--                           staat er null en toont de pagina "bij iemand".
-- Er wordt nergens een e-mailadres, familienaam, user_id of kind_id van een
-- ander gezin teruggegeven — die kolommen zitten simpelweg niet in de functie.
--
-- Niet destructief: enkel twee functies worden vervangen.

-- ============================================================
-- 1. get_matches(): nu met de kolom eigen_gezin
-- ============================================================
-- De returnkolommen veranderen, dus eerst droppen: create or replace kan het
-- returntype van een bestaande functie niet wijzigen.
drop function if exists public.get_matches(uuid);

create function public.get_matches(p_kind_id uuid)
returns table (
  richting     text,
  code         text,
  nummer       integer,
  land_naam    text,
  sticker_naam text,
  ander_kind   text,
  eigen_gezin  boolean
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
  ),
  glans_ok as (
    select coalesce((select i.toon_glans from public.instellingen i where i.id = 1), false) as aan
  )
  -- Jij zoekt deze sticker, iemand anders heeft ze dubbel
  select
    'jij_zoekt'::text,
    c.code,
    c.nummer,
    c.land_naam,
    c.naam,
    case
      when ak.user_id = ek.user_id then ak.voornaam
      when public.beurs_actief()   then ak.voornaam
    end,
    ak.user_id = ek.user_id
  from eigen_kind ek
  cross join glans_ok g
  join public.stickers mij   on mij.kind_id = ek.id and mij.status = 'ZOEKT'
  join public.stickers ander on ander.nummer = mij.nummer and ander.status = 'RUILT'
  join public.kinderen ak    on ak.id = ander.kind_id and ak.id <> ek.id
  join public.sticker_catalogus c on c.code = mij.nummer
  where g.aan or not c.glans

  union   -- union, niet union all: buiten het beursvenster vallen de
          -- naamloze rijen van meerdere kinderen samen tot één regel

  -- Jij hebt deze sticker dubbel, iemand anders zoekt ze
  select
    'jij_hebt_dubbel'::text,
    c.code,
    c.nummer,
    c.land_naam,
    c.naam,
    case
      when ak.user_id = ek.user_id then ak.voornaam
      when public.beurs_actief()   then ak.voornaam
    end,
    ak.user_id = ek.user_id
  from eigen_kind ek
  cross join glans_ok g
  join public.stickers mij   on mij.kind_id = ek.id and mij.status = 'RUILT'
  join public.stickers ander on ander.nummer = mij.nummer and ander.status = 'ZOEKT'
  join public.kinderen ak    on ak.id = ander.kind_id and ak.id <> ek.id
  join public.sticker_catalogus c on c.code = mij.nummer
  where g.aan or not c.glans

  order by 1, 4, 3, 2;
$fn$;

revoke all on function public.get_matches(uuid) from public;
revoke all on function public.get_matches(uuid) from anon;
grant execute on function public.get_matches(uuid) to authenticated;

-- ============================================================
-- 2. kind_statistieken(): zelfde regel voor de teller
-- ============================================================
-- 'matches' telt hetzelfde als het venster "Iemand heeft het dubbel" op de
-- kindpagina: stickers die dit kind zoekt en die een ánder kind dubbel heeft,
-- eigen broers en zussen inbegrepen.

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
  with glans_ok as (
    select coalesce((select i.toon_glans from public.instellingen i where i.id = 1), false) as aan
  )
  select
    k.id,
    (select count(*)::int from public.stickers s
       join public.sticker_catalogus c on c.code = s.nummer
      where s.kind_id = k.id and s.status = 'ZOEKT' and (g.aan or not c.glans)),
    (select count(*)::int from public.stickers s
       join public.sticker_catalogus c on c.code = s.nummer
      where s.kind_id = k.id and s.status = 'RUILT' and (g.aan or not c.glans)),
    (select count(distinct s.nummer)::int
       from public.stickers s
       join public.sticker_catalogus c on c.code = s.nummer
       join public.stickers a on a.nummer = s.nummer and a.status = 'RUILT'
                             and a.kind_id <> k.id
      where s.kind_id = k.id and s.status = 'ZOEKT' and (g.aan or not c.glans))
  from public.kinderen k
  cross join glans_ok g
  where auth.uid() is not null
    and k.user_id = auth.uid();
$fn$;

revoke all on function public.kind_statistieken() from public;
revoke all on function public.kind_statistieken() from anon;
grant execute on function public.kind_statistieken() to authenticated;

-- ============================================================
-- 3. Snelle controle
-- ============================================================
-- Vervang het uuid door dat van het kind dat BEL1 zoekt (te vinden met
-- 'select id, voornaam from public.kinderen;'). Verwacht: minstens één rij
-- met richting 'jij_zoekt' en code 'BEL1'.
--
--   select * from public.get_matches('PLAK-HIER-HET-KIND-UUID');
