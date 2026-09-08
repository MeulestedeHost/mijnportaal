-- Panini Ruilportaal — Statistieken
-- Voer dit uit na sql/016_ruilen_registreren.sql.
--
-- Alles wat statistieken.html toont, wordt hier berekend. Bewust in SQL en
-- niet in de browser: anders zou de pagina de stickerrijen van álle
-- deelnemers moeten downloaden om er zelf sommen op te maken — traag, en
-- precies de gegevens die niemand hoort te zien. Wat hieronder teruggegeven
-- wordt zijn optellingen, geen rijen.
--
-- WAT "GEPLAKT" HIER BETEKENT — LEES DIT EERST. De databank houdt niet bij
-- wat een kind al in zijn album heeft: er zijn maar twee statussen, ZOEKT en
-- RUILT (zie sql/002 en js/stickers.js). "Geplakt" is dus een AFLEIDING, en
-- wel dezelfde die de FIFA Wereldreis al gebruikt (wereldreis_landen in
-- sql/012): alles wat niet als gezocht is aangeduid, geldt als aanwezig.
--
-- Dat klopt enkel voor wie zijn ontbrekende stickers ook effectief invulde.
-- Daarom telt elke berekening hieronder uitsluitend VERZAMELAARS MET MINSTENS
-- ÉÉN GEREGISTREERDE STICKER mee: een kind dat nog niets invulde zou anders
-- als een vol album meetellen en elk gemiddelde omhoog trekken. Die afbakening
-- is meteen ook de definitie die kaart 1 ("actieve verzamelaars") gebruikt.
-- De tooltips op de pagina zeggen dit er telkens bij.
--
-- WIE ZIET WAT. Optellingen zijn er voor elke aangemelde deelnemer: hoeveel
-- verzamelaars, hoeveel stickers, welke landen. NAMEN liggen anders — een
-- ranglijst van andermans kinderen is iets anders dan een totaal. De toplijst
-- van verzamelaars komt daarom enkel terug voor beheerders, of wanneer de
-- organisatie ze bewust openzet met de schakelaar toon_topverzamelaars op de
-- instellingenpagina. Standaard staat die uit.
--
-- Niet destructief: drie kolommen bij op public.instellingen en zeven
-- functies bij. Er verdwijnt niets.

-- ============================================================
-- 1. Drie instelbare getallen
-- ============================================================
-- De stickerwaarde is nominaal: wat een sticker in een pakje kost, niet wat
-- hij "waard" is. Ze staat in de databank en niet als constante in de code,
-- zodat de organisatie ze kan bijstellen zonder dat er iets opnieuw uitgerold
-- moet worden.
alter table public.instellingen
  add column if not exists stickerwaarde numeric(6,2) not null default 0.25
    check (stickerwaarde >= 0);

comment on column public.instellingen.stickerwaarde is
  'Nominale prijs van één sticker in euro. Basis voor alle waardeberekeningen op statistieken.html.';

-- Aantal stickers in één pakje. Enkel gebruikt voor de schatting van vermeden
-- pakjes; verander dit als het album met een andere pakjesgrootte werkt.
alter table public.instellingen
  add column if not exists stickers_per_pakje integer not null default 5
    check (stickers_per_pakje >= 1);

comment on column public.instellingen.stickers_per_pakje is
  'Aantal stickers per pakje. Enkel gebruikt voor de schatting van vermeden pakjes.';

-- Staat dit uit (standaard), dan ziet enkel een beheerder de ranglijst met
-- voornamen. Aan = iedereen die aangemeld is ziet ze.
alter table public.instellingen
  add column if not exists toon_topverzamelaars boolean not null default false;

comment on column public.instellingen.toon_topverzamelaars is
  'Mag de ranglijst met voornamen van verzamelaars aan alle deelnemers getoond worden? Standaard nee; beheerders zien ze altijd.';

-- ============================================================
-- 2. Twee interne hulpfuncties
-- ============================================================
-- Elke statistiek vertrekt van dezelfde twee vragen: welke stickers tellen mee
-- (glansvarianten wel of niet), en wie telt als verzamelaar. Die staan hier
-- één keer in plaats van vijf keer overgeschreven.
--
-- BEWUST NIET AANROEPBAAR VAN BUITENAF: stat_verzamelaars() geeft kind-uuid's
-- en voornamen terug van álle deelnemers. De functies hieronder mogen ze
-- gebruiken (security definer draait als de eigenaar), een aangemelde
-- gebruiker niet — vandaar de revoke zonder grant.

create or replace function public.stat_catalogus()
returns table (
  code         text,
  land_code    text,
  land_naam    text,
  land_naam_en text,
  pagina       integer,
  naam         text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select c.code, c.land_code, c.land_naam, c.land_naam_en, c.pagina, c.naam
  from public.sticker_catalogus c
  where (select coalesce(i.toon_glans, false) from public.instellingen i where i.id = 1)
     or not c.glans;
$fn$;

revoke all on function public.stat_catalogus() from public;
revoke all on function public.stat_catalogus() from anon;
revoke all on function public.stat_catalogus() from authenticated;

create or replace function public.stat_verzamelaars()
returns table (kind_id uuid, voornaam text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select k.id, k.voornaam
  from public.kinderen k
  where exists (
    select 1
    from public.stickers s
    join public.stat_catalogus() c on c.code = s.nummer
    where s.kind_id = k.id
  );
$fn$;

revoke all on function public.stat_verzamelaars() from public;
revoke all on function public.stat_verzamelaars() from anon;
revoke all on function public.stat_verzamelaars() from authenticated;

-- ============================================================
-- 3. De cijfers in één rij
-- ============================================================
-- Eén aanroep voor de hele bovenkant van de pagina: verzamelaars, stickers,
-- waarde, landen, ruilen en de schatting van vermeden pakjes. Dat is één
-- rondgang naar de databank in plaats van tien.
--
-- DE SCHATTING VAN VERMEDEN PAKJES. Dit is het enige cijfer op de pagina dat
-- geen telling is maar een model, en het verdient uitleg.
--
-- Stickers uit pakjes komen willekeurig. Hoe voller je album, hoe vaker je een
-- dubbele trekt — het klassieke "coupon collector"-probleem. Om van j naar j+1
-- verschillende stickers te gaan (op een album van N) heb je gemiddeld
-- N/(N-j) stickers nodig. Voor de laatste g stickers die je verzamelde is dat
-- dus in totaal:
--
--     N * (1/(N-bezit+1) + 1/(N-bezit+2) + ... + 1/(N-bezit+g))
--
-- Precies die g stickers zijn wat een verzamelaar via voltooide ruilen binnen
-- kreeg (één sticker per voltooide ruil, per kant). Die had hij anders uit
-- pakjes moeten halen. De som daarvan, gedeeld door het aantal stickers per
-- pakje, is de schatting.
--
-- WAAROM DIT EEN SCHATTING BLIJFT. Het model gaat ervan uit dat alle stickers
-- even vaak voorkomen en dat een pakje geen dubbels van zichzelf bevat —
-- allebei niet helemaal waar. En ruilen kost je zelf ook een sticker, die ook
-- ergens vandaan moest komen. Het cijfer zegt "zoveel pakjes had je nodig
-- gehad om dit langs de winkel te doen", niet "zoveel geld is er bespaard".
-- De pagina zegt dat er met zoveel woorden bij.
create or replace function public.statistieken()
returns table (
  verzamelaars        integer,
  album_totaal        integer,
  geplakt             bigint,
  gezocht             bigint,
  dubbels             bigint,
  stickerwaarde       numeric,
  stickers_per_pakje  integer,
  landen_gemiddeld    numeric,
  albumvulling        numeric,
  dubbels_gemiddeld   numeric,
  gezocht_gemiddeld   numeric,
  ruilen_totaal       integer,
  ruilen_voltooid     integer,
  ruilen_open         integer,
  vermeden_pakjes     numeric,
  mag_topverzamelaars boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with inst as (
    select
      coalesce(i.stickerwaarde, 0.25)        as waarde,
      coalesce(i.stickers_per_pakje, 5)      as pakje,
      coalesce(i.toon_topverzamelaars, false) as toptonen
    from public.instellingen i
    where i.id = 1
  ),
  cat as (select * from public.stat_catalogus()),
  n as (select count(*)::int as totaal from cat),
  vz as (select * from public.stat_verzamelaars()),
  per_kind as (
    select
      v.kind_id,
      (select count(*)
         from public.stickers s join cat c on c.code = s.nummer
        where s.kind_id = v.kind_id and s.status = 'ZOEKT')::int as gezocht,
      (select coalesce(sum(s.aantal), 0)
         from public.stickers s join cat c on c.code = s.nummer
        where s.kind_id = v.kind_id and s.status = 'RUILT')::int as dubbels,
      -- Eén voltooide ruil levert deze verzamelaar één sticker op: zijn kant
      -- van de afspraak.
      (select count(*)
         from public.ruilen r
        where r.bevestigd_a is not null and r.bevestigd_b is not null
          and (r.kind_a = v.kind_id or r.kind_b = v.kind_id))::int as geruild
    from vz v
  ),
  met_bezit as (
    select p.*, (select totaal from n) - p.gezocht as bezit
    from per_kind p
  ),
  land_totalen as (
    select c.land_code, count(*)::int as totaal from cat c group by c.land_code
  ),
  gezocht_per_land as (
    select s.kind_id, c.land_code, count(*)::int as gezocht
    from public.stickers s
    join cat c on c.code = s.nummer
    where s.status = 'ZOEKT'
    group by s.kind_id, c.land_code
  ),
  landen_per_kind as (
    -- Een land telt mee zodra er van dat land minstens één sticker aanwezig
    -- is: het aantal in de catalogus is groter dan het aantal dat dit kind
    -- ervan zoekt.
    select
      v.kind_id,
      (select count(*)
         from land_totalen lt
        where lt.totaal > coalesce(
          (select g.gezocht from gezocht_per_land g
            where g.kind_id = v.kind_id and g.land_code = lt.land_code), 0
        ))::int as landen
    from vz v
  ),
  pakjes as (
    select coalesce(sum(
      (select coalesce(sum((select totaal from n)::numeric / m), 0)
         from generate_series(
           (select totaal from n) - b.bezit + 1,
           (select totaal from n) - b.bezit + least(b.geruild, b.bezit)
         ) as m)
    ), 0) as stickers
    from met_bezit b
    where b.bezit > 0
  ),
  ruil as (
    select
      count(*)::int as totaal,
      (count(*) filter (
        where r.bevestigd_a is not null and r.bevestigd_b is not null
      ))::int as voltooid
    from public.ruilen r
  )
  select
    (select count(*)::int from vz),
    (select totaal from n),
    (select coalesce(sum(b.bezit), 0)::bigint from met_bezit b),
    (select coalesce(sum(p.gezocht), 0)::bigint from per_kind p),
    (select coalesce(sum(p.dubbels), 0)::bigint from per_kind p),
    (select waarde from inst),
    (select pakje from inst),
    (select round(avg(l.landen), 1) from landen_per_kind l),
    (select round(100.0 * avg(b.bezit) / nullif((select totaal from n), 0), 1) from met_bezit b),
    (select round(avg(p.dubbels), 1) from per_kind p),
    (select round(avg(p.gezocht), 1) from per_kind p),
    (select totaal from ruil),
    (select voltooid from ruil),
    (select totaal - voltooid from ruil),
    (select round((select stickers from pakjes) / (select pakje from inst), 1)),
    (select toptonen from inst) or public.is_beheerder()
  where auth.uid() is not null;
$fn$;

revoke all on function public.statistieken() from public;
revoke all on function public.statistieken() from anon;
grant execute on function public.statistieken() to authenticated;

-- ============================================================
-- 4. Per land
-- ============================================================
-- Voedt de drie staafdiagrammen (meest verzameld, meest gezocht, meeste
-- dubbels) en de inzichten onderaan. Eén aanroep, alle landen; sorteren doet
-- de pagina zelf, want ze toont dezelfde rijen drie keer anders geordend.
create or replace function public.statistieken_landen()
returns table (
  land_code    text,
  land_naam    text,
  land_naam_en text,
  pagina       integer,
  totaal       integer,
  geplakt      bigint,
  gezocht      bigint,
  dubbels      bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with cat as (select * from public.stat_catalogus()),
  vz as (select * from public.stat_verzamelaars()),
  aantal as (select count(*)::int as n from vz),
  per_land as (
    select
      c.land_code,
      min(c.land_naam)    as nl,
      min(c.land_naam_en) as en,
      min(c.pagina)       as pagina,
      count(*)::int       as totaal
    from cat c
    group by c.land_code
  ),
  stand as (
    select
      c.land_code,
      (count(*) filter (where s.status = 'ZOEKT'))::bigint as gezocht,
      coalesce(sum(s.aantal) filter (where s.status = 'RUILT'), 0)::bigint as dubbels
    from public.stickers s
    join cat c on c.code = s.nummer
    join vz v on v.kind_id = s.kind_id
    group by c.land_code
  )
  select
    p.land_code,
    p.nl,
    p.en,
    p.pagina,
    p.totaal,
    -- Geplakt = wat iedereen samen van dit land zou hebben als niets gezocht
    -- werd, min wat er effectief gezocht wordt.
    (select n from aantal)::bigint * p.totaal - coalesce(st.gezocht, 0),
    coalesce(st.gezocht, 0),
    coalesce(st.dubbels, 0)
  from per_land p
  left join stand st on st.land_code = p.land_code
  where auth.uid() is not null;
$fn$;

revoke all on function public.statistieken_landen() from public;
revoke all on function public.statistieken_landen() from anon;
grant execute on function public.statistieken_landen() to authenticated;

-- ============================================================
-- 5. Toplijsten per sticker
-- ============================================================
-- LET OP HOE DEZE TWEE ZICH TOT ELKAAR VERHOUDEN. Omdat "geplakt" een
-- afleiding is van "niet gezocht", is het aantal verzamelaars van een sticker
-- per definitie het aantal verzamelaars min het aantal zoekers. De twee
-- lijsten zijn dus elkaars spiegelbeeld: de meest gezochte sticker is exact
-- de minst verzamelde. De pagina zegt dat in de tooltip, zodat niemand ze
-- leest als twee onafhankelijke metingen.
create or replace function public.top_gezochte_stickers(p_limiet integer default 10)
returns table (
  code      text,
  land_code text,
  naam      text,
  zoekers   integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select c.code, c.land_code, c.naam, count(*)::int
  from public.stickers s
  join public.stat_catalogus() c on c.code = s.nummer
  join public.stat_verzamelaars() v on v.kind_id = s.kind_id
  where s.status = 'ZOEKT'
    and auth.uid() is not null
  group by c.code, c.land_code, c.naam
  order by count(*) desc, c.code
  limit greatest(coalesce(p_limiet, 10), 1);
$fn$;

revoke all on function public.top_gezochte_stickers(integer) from public;
revoke all on function public.top_gezochte_stickers(integer) from anon;
grant execute on function public.top_gezochte_stickers(integer) to authenticated;

create or replace function public.top_verzamelde_stickers(p_limiet integer default 10)
returns table (
  code         text,
  land_code    text,
  naam         text,
  verzamelaars integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with cat as (select * from public.stat_catalogus()),
  aantal as (select count(*)::int as n from public.stat_verzamelaars()),
  zoekers as (
    select s.nummer, count(*)::int as z
    from public.stickers s
    join public.stat_verzamelaars() v on v.kind_id = s.kind_id
    where s.status = 'ZOEKT'
    group by s.nummer
  )
  select
    c.code,
    c.land_code,
    c.naam,
    ((select n from aantal) - coalesce(z.z, 0))::int
  from cat c
  left join zoekers z on z.nummer = c.code
  where auth.uid() is not null
  order by ((select n from aantal) - coalesce(z.z, 0)) desc, c.code
  limit greatest(coalesce(p_limiet, 10), 1);
$fn$;

revoke all on function public.top_verzamelde_stickers(integer) from public;
revoke all on function public.top_verzamelde_stickers(integer) from anon;
grant execute on function public.top_verzamelde_stickers(integer) to authenticated;

-- ============================================================
-- 6. Activiteit doorheen de tijd
-- ============================================================
-- Drie lijnen in één aanroep, met een rij per tijdvak — ook voor tijdvakken
-- waarin niets gebeurde, want een lijngrafiek met gaten liegt over het tempo.
--
-- p_stap is 'hour', 'day' of 'week'. Iets anders wordt stilzwijgend 'day':
-- deze waarde komt in date_trunc terecht en wordt daarom afgedwongen in
-- plaats van vertrouwd.
--
-- Voor een ruil geldt als "voltooid op" het moment van de LAATSTE van de twee
-- bevestigingen — dat is wanneer hij effectief rond was.
create or replace function public.statistieken_activiteit(
  p_vanaf timestamptz default null,
  p_stap  text default 'day'
)
returns table (
  moment              timestamptz,
  nieuwe_verzamelaars integer,
  nieuwe_ruilen       integer,
  voltooide_ruilen    integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with stap as (
    select case when p_stap in ('hour', 'day', 'week') then p_stap else 'day' end as s
  ),
  grens as (
    -- Zonder begindatum: vanaf de allereerste verzamelaar of ruil.
    select coalesce(
      p_vanaf,
      least(
        (select min(k.created_at) from public.kinderen k),
        (select min(r.created_at) from public.ruilen r),
        now()
      )
    ) as vanaf
  ),
  punten as (
    select generate_series(
      date_trunc((select s from stap), (select vanaf from grens)),
      date_trunc((select s from stap), now()),
      ('1 ' || (select s from stap))::interval
    ) as moment
  ),
  voltooid as (
    select greatest(r.bevestigd_a, r.bevestigd_b) as moment
    from public.ruilen r
    where r.bevestigd_a is not null and r.bevestigd_b is not null
  )
  select
    p.moment,
    (select count(*)::int from public.kinderen k
      where date_trunc((select s from stap), k.created_at) = p.moment),
    (select count(*)::int from public.ruilen r
      where date_trunc((select s from stap), r.created_at) = p.moment),
    (select count(*)::int from voltooid v
      where date_trunc((select s from stap), v.moment) = p.moment)
  from punten p
  where auth.uid() is not null
  order by p.moment;
$fn$;

revoke all on function public.statistieken_activiteit(timestamptz, text) from public;
revoke all on function public.statistieken_activiteit(timestamptz, text) from anon;
grant execute on function public.statistieken_activiteit(timestamptz, text) to authenticated;

-- ============================================================
-- 7. Ranglijst van verzamelaars — met namen, dus afgeschermd
-- ============================================================
-- Optellingen mag iedereen zien; een ranglijst van andermans kinderen is iets
-- anders. Deze functie geeft daarom niets terug tenzij je beheerder bent, of
-- de organisatie de schakelaar toon_topverzamelaars aanzette. Enkel de
-- voornaam, nooit de familienaam: meer is er niet nodig om een lijstje te
-- lezen.
create or replace function public.top_verzamelaars(p_limiet integer default 10)
returns table (
  voornaam         text,
  geplakt          integer,
  gezocht          integer,
  dubbels          integer,
  voltooide_ruilen integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with toegestaan as (
    select
      auth.uid() is not null
      and (
        public.is_beheerder()
        or coalesce(
          (select i.toon_topverzamelaars from public.instellingen i where i.id = 1),
          false
        )
      ) as ok
  ),
  cat as (select * from public.stat_catalogus()),
  n as (select count(*)::int as totaal from cat),
  vz as (select * from public.stat_verzamelaars())
  select
    v.voornaam,
    ((select totaal from n) - (
      select count(*) from public.stickers s join cat c on c.code = s.nummer
       where s.kind_id = v.kind_id and s.status = 'ZOEKT'
    ))::int,
    (select count(*) from public.stickers s join cat c on c.code = s.nummer
      where s.kind_id = v.kind_id and s.status = 'ZOEKT')::int,
    (select coalesce(sum(s.aantal), 0) from public.stickers s join cat c on c.code = s.nummer
      where s.kind_id = v.kind_id and s.status = 'RUILT')::int,
    (select count(*) from public.ruilen r
      where r.bevestigd_a is not null and r.bevestigd_b is not null
        and (r.kind_a = v.kind_id or r.kind_b = v.kind_id))::int
  from vz v
  where (select ok from toegestaan)
  limit greatest(coalesce(p_limiet, 10), 1);
$fn$;

revoke all on function public.top_verzamelaars(integer) from public;
revoke all on function public.top_verzamelaars(integer) from anon;
grant execute on function public.top_verzamelaars(integer) to authenticated;

-- ============================================================
-- Snelle controle
-- ============================================================
-- 1) De hoofdcijfers in één rij:
--      select * from public.statistieken();
--    -- verzamelaars telt enkel kinderen met minstens één sticker;
--    -- geplakt = verzamelaars * album_totaal - gezocht.
--
-- 2) Klopt de albumvulling met de hand?
--      select album_totaal, geplakt, verzamelaars,
--             round(100.0 * geplakt / (verzamelaars * album_totaal), 1) as vulling
--        from public.statistieken();
--
-- 3) De ranglijst hoort leeg te zijn voor een gewone deelnemer zolang
--    toon_topverzamelaars uit staat:
--      select count(*) from public.top_verzamelaars(10);
--    -- als beheerder: het aantal verzamelaars; als deelnemer: 0.
--
-- 4) Activiteit per dag over de laatste week:
--      select * from public.statistieken_activiteit(now() - interval '7 days', 'day');
--    -- verwacht: 8 rijen (vandaag meegerekend), ook de dagen met nul.
