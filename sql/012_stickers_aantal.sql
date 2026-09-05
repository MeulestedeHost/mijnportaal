-- Panini Ruilportaal — aantal dubbels per sticker
-- Voer dit uit na sql/011_wereldreis_fotos.sql.
--
-- Niet destructief: één kolom bij op stickers, drie functies vervangen
-- (create or replace / drop+create, geen tabel verdwijnt en geen rij gaat
-- verloren). Bestaande RUILT-rijen krijgen aantal = 1 — exact het gedrag van
-- vandaag ("ik heb er minstens één dubbel"), dus dit verandert niets aan wat
-- gebruikers nu zien, tot iemand een aantal aanpast.
--
-- WAAROM OP stickers EN NIET EEN NIEUWE TABEL. sql/003_ruillijst.sql voorzag
-- ooit een tabel sticker_status met een vergelijkbare kolom dubbel_aantal,
-- maar die tabel is nooit door de front-end gevuld (zie sql/006_kindproof.sql)
-- en blijft dode code. public.stickers is de tabel die de app vandaag echt
-- gebruikt, met al een unieke index op (kind_id, nummer) — dus hooguit één
-- rij per sticker per kind. Een aantal-kolom op die ene rij is dus de
-- eenvoudigste, kleinste wijziging.

-- ============================================================
-- 1. stickers.aantal
-- ============================================================
-- Enkel betekenisvol bij status = 'RUILT' (hoeveel dubbels). Bij 'ZOEKT'
-- staat de kolom op de standaardwaarde en wordt ze genegeerd — een kind zoekt
-- een sticker, het heeft geen zin om "hoeveel" te vragen.
alter table public.stickers
  add column if not exists aantal integer not null default 1 check (aantal >= 1);

comment on column public.stickers.aantal is
  'Aantal exemplaren dat het kind van deze sticker heeft om te ruilen. Enkel betekenisvol bij status = RUILT.';

-- ============================================================
-- 2. kind_statistieken(): 'dubbel' telt voortaan exemplaren, niet rijen
-- ============================================================
-- Vroeger: count(*) van RUILT-rijen ("van hoeveel verschillende stickers heb
-- ik een dubbel"). Nu: som van aantal ("hoeveel dubbele kaarten heb ik in
-- totaal om te ruilen"). Bij elke bestaande rij is aantal = 1, dus dit cijfer
-- verandert niet door deze migratie op zich.
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
    (select coalesce(sum(s.aantal), 0)::int from public.stickers s
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
    and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid());
$fn$;

revoke all on function public.kind_statistieken() from public;
revoke all on function public.kind_statistieken() from anon;
grant execute on function public.kind_statistieken() to authenticated;

-- ============================================================
-- 3. wereldreis_landen(): 'dubbel' per land telt voortaan ook exemplaren
-- ============================================================
-- 'heeft' en 'procent' blijven ongemoeid: album-volledigheid gaat over
-- gezocht/niet-gezocht, niet over hoeveel dubbels er zijn.
create or replace function public.wereldreis_landen(p_kind_id uuid)
returns table (
  land_code text,
  land_naam text,
  categorie text,
  totaal    integer,
  gezocht   integer,
  dubbel    integer,
  heeft     integer,
  procent   integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with eigen_kind as (
    select k.id
    from public.kinderen k
    where k.id = p_kind_id
      and auth.uid() is not null
      and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())
  ),
  glans_ok as (
    select coalesce((select i.toon_glans from public.instellingen i where i.id = 1), false) as aan
  ),
  meetellend as (
    select c.land_code, c.land_naam, c.categorie, c.code
    from public.sticker_catalogus c
    cross join glans_ok g
    where g.aan or not c.glans
  )
  select
    c.land_code,
    min(c.land_naam),
    min(c.categorie),
    count(*)::int,
    count(s.id) filter (where s.status = 'ZOEKT')::int,
    coalesce(sum(s.aantal) filter (where s.status = 'RUILT'), 0)::int,
    (count(*) - count(s.id) filter (where s.status = 'ZOEKT'))::int,
    round(
      100.0 * (count(*) - count(s.id) filter (where s.status = 'ZOEKT'))
      / greatest(count(*), 1)
    )::int
  from eigen_kind ek
  cross join meetellend c
  left join public.stickers s
         on s.kind_id = ek.id
        and s.nummer  = c.code
  group by c.land_code
  order by 2;
$fn$;

revoke all on function public.wereldreis_landen(uuid) from public;
revoke all on function public.wereldreis_landen(uuid) from anon;
grant execute on function public.wereldreis_landen(uuid) to authenticated;

-- ============================================================
-- 4. get_matches(): aantal beschikbare exemplaren per match
-- ============================================================
-- Enkel de kolomlijst en de twee select-lijsten in de union zijn gewijzigd
-- tegenover sql/009_gezin_en_whatsapp.sql — de rest (beursvenster, eigen
-- gezin, telefoonnummer) is identiek. drop+create (niet create or replace)
-- omdat de kolomlijst zelf verandert; Postgres laat dat niet toe via
-- create or replace function.
--
-- Bij 'jij_zoekt' is aantal het aantal exemplaren dat de ANDER heeft
-- (ander.aantal): dat bepaalt hoeveel er voor jou beschikbaar zijn. Bij
-- 'jij_hebt_dubbel' is aantal jouw eigen aantal (mij.aantal): hoeveel jij
-- kan aanbieden.
drop function if exists public.get_matches(uuid);

create function public.get_matches(p_kind_id uuid)
returns table (
  richting       text,
  code           text,
  nummer         integer,
  land_naam      text,
  sticker_naam   text,
  aantal         integer,
  ander_kind     text,
  eigen_gezin    boolean,
  ander_whatsapp text
)
language sql
security definer
stable
set search_path = ''
as $fn$
  with eigen_kind as (
    select k.id, k.user_id, public.gezin_sleutel(k.user_id) as sleutel
    from public.kinderen k
    where k.id = p_kind_id
      and auth.uid() is not null
      and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())
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
    ander.aantal,
    case
      when public.gezin_sleutel(ak.user_id) = ek.sleutel then ak.voornaam
      when public.beurs_actief()                         then ak.voornaam
    end,
    public.gezin_sleutel(ak.user_id) = ek.sleutel,
    case
      when public.gezin_sleutel(ak.user_id) <> ek.sleutel and public.beurs_actief()
      then (select g2.telefoon from public.gezinnen g2
             where g2.id = public.gezin_sleutel(ak.user_id) and g2.telefoon_delen)
    end
  from eigen_kind ek
  cross join glans_ok g
  join public.stickers mij   on mij.kind_id = ek.id and mij.status = 'ZOEKT'
  join public.stickers ander on ander.nummer = mij.nummer and ander.status = 'RUILT'
  join public.kinderen ak    on ak.id = ander.kind_id and ak.id <> ek.id
  join public.sticker_catalogus c on c.code = mij.nummer
  where g.aan or not c.glans

  union   -- union, niet union all: buiten het beursvenster vallen de
          -- naamloze rijen van meerdere kinderen samen tot één regel (nu ook
          -- enkel wanneer hun aantal gelijk is — twee anonieme kinderen met
          -- een verschillend aantal blijven twee losse regels, en dat is
          -- prima: het aantal is dan net het verschil dat telt)

  -- Jij hebt deze sticker dubbel, iemand anders zoekt ze
  select
    'jij_hebt_dubbel'::text,
    c.code,
    c.nummer,
    c.land_naam,
    c.naam,
    mij.aantal,
    case
      when public.gezin_sleutel(ak.user_id) = ek.sleutel then ak.voornaam
      when public.beurs_actief()                         then ak.voornaam
    end,
    public.gezin_sleutel(ak.user_id) = ek.sleutel,
    case
      when public.gezin_sleutel(ak.user_id) <> ek.sleutel and public.beurs_actief()
      then (select g2.telefoon from public.gezinnen g2
             where g2.id = public.gezin_sleutel(ak.user_id) and g2.telefoon_delen)
    end
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
-- Snelle controle
-- ============================================================
-- 1) Zet een sticker op 4 dubbels en controleer dat de tellers meerekenen:
--      update public.stickers set status = 'RUILT', aantal = 4
--       where kind_id = '<kind-uuid>' and nummer = 'BEL7';
--      select dubbel from public.kind_statistieken() where kind_id = '<kind-uuid>';
--
-- 2) get_matches() moet nu een aantal-kolom teruggeven:
--      select * from public.get_matches('<kind-uuid>');
--
-- 3) Bestaande RUILT-rijen (van vóór deze migratie) horen allemaal aantal = 1
--    te hebben:
--      select count(*) from public.stickers where status = 'RUILT' and aantal <> 1;
--    -- verwacht: 0, tenzij je al handmatig een aantal bijstelde.
