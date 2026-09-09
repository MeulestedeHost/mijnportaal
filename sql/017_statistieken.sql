-- Panini Ruilportaal — Statistieken
-- Voer dit uit na sql/016_ruilen_registreren.sql.
--
-- Alles wat statistieken.html toont, wordt hier berekend. Bewust in SQL en
-- niet in de browser: anders zou de pagina de stickerrijen van álle
-- deelnemers moeten downloaden om er zelf sommen op te maken — traag, en
-- precies de gegevens die niemand hoort te zien. Wat hieronder teruggegeven
-- wordt zijn optellingen, geen rijen.
--
-- GEEN NAMEN. Nergens op deze pagina komt de naam van een kind voor, ook niet
-- in de ranglijst: die toont enkel de volgorde (1, 2, 3 …) met de bijhorende
-- aantallen. Een statistiekenpagina hoort te gaan over hoeveel, niet over wie.
-- Daarom is er ook geen enkele functie hieronder die een voornaam teruggeeft.
--
-- WAT "GEPLAKT" HIER BETEKENT — LEES DIT EERST. De databank houdt niet bij
-- wat een kind al in zijn album heeft: er zijn maar twee statussen, ZOEKT en
-- RUILT (zie sql/002 en js/stickers.js). "Geplakt" is dus een AFLEIDING, en
-- wel dezelfde die de FIFA Wereldreis al gebruikt (wereldreis_landen in
-- sql/012): alles wat niet als gezocht is aangeduid, geldt als aanwezig.
--
-- Die afleiding klopt enkel voor wie zijn ontbrekende stickers ook effectief
-- invulde. Twee filters houden ze eerlijk (zie stat_verzamelaars hieronder):
--   1. wie nog geen enkele sticker registreerde, telt niet mee;
--   2. wie duidelijk halverwege gestopt is — de laatste landen van het album
--      staan volledig leeg — telt ook niet mee.
--
-- Niet destructief voor gebruikersgegevens: er wordt geen kind, sticker of ruil
-- aangeraakt. Wat het script wél doet is twee kolommen bijzetten op
-- public.instellingen en acht functies (her)aanmaken.
--
-- HERDRAAIBAAR. Elke functie wordt eerst gedropt en dan opnieuw aangemaakt.
-- Dat moet: create or replace weigert zodra de kolomlijst van een functie
-- verandert ("cannot change return type of existing function"), en dat is
-- precies wat er gebeurt wanneer een eerdere versie van dit script al liep.
-- Het script mag dus zo vaak uitgevoerd worden als nodig.

-- ============================================================
-- 1. Twee instelbare getallen
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

-- Opruiming. Een eerdere versie van dít script zette hier een schakelaar
-- toon_topverzamelaars neer: de ranglijst toonde toen voornamen en die moesten
-- afgeschermd kunnen worden. De ranglijst is intussen volledig anoniem — enkel
-- de volgorde met de aantallen — dus de schakelaar heeft geen betekenis meer
-- en wordt nergens nog gelezen. Bevatte niets dan die ene ja/nee-instelling;
-- er gaan dus geen gebruikersgegevens verloren. Liep dit script nooit eerder,
-- dan doet deze regel niets.
alter table public.instellingen
  drop column if exists toon_topverzamelaars;

-- ============================================================
-- 2. Twee interne hulpfuncties
-- ============================================================
-- Elke statistiek vertrekt van dezelfde twee vragen: welke stickers tellen mee
-- (glansvarianten wel of niet), en wie telt als verzamelaar. Die staan hier
-- één keer in plaats van zes keer overgeschreven.
--
-- BEWUST NIET AANROEPBAAR VAN BUITENAF: stat_verzamelaars() geeft de kind-uuid's
-- van álle deelnemers terug. De functies hieronder mogen ze gebruiken (security
-- definer draait als de eigenaar), een aangemelde gebruiker niet — vandaar de
-- revoke zonder grant.

drop function if exists public.stat_catalogus();
create function public.stat_catalogus()
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

-- WIE TELT ALS VERZAMELAAR — EN WAAROM SOMMIGEN NIET.
--
-- Omdat "geplakt" berekend wordt als "album min gezocht", ziet een kind dat
-- niets invulde eruit als iemand met een volledig album. Dat trekt élk
-- gemiddelde op deze pagina scheef. Twee filters:
--
--   1. Geen enkele sticker geregistreerd → niet meegeteld. Simpel.
--
--   2. Duidelijk halverwege gestopt → niet meegeteld. Wie zijn ontbrekende
--      stickers invult, werkt de landenlijst af in de volgorde die op de
--      stickerpagina gekozen kan worden: alfabetisch op landcode, of de
--      volgorde van het boek. Stopt iemand halverwege, dan blijft er in díe
--      volgorde een aaneengesloten staart landen over waar hij niets bij
--      registreerde — niet gezocht én niet dubbel.
--
--      Per verzamelaar wordt daarom in beide volgordes gekeken hoe ver hij
--      geraakte, en de gunstigste van de twee genomen (least(...) op het
--      bereik = de kortste staart). Blijft er dan nog altijd een staart over
--      van minstens een vijfde van alle landen, dan is de lijst duidelijk
--      onafgewerkt en blijft de verzamelaar buiten de cijfers.
--
-- KANTTEKENING. Wie écht alles van de laatste landen heeft en er niets van
-- zoekt of dubbel heeft, valt hier ten onrechte buiten. Dat weegt niet op
-- tegen het alternatief: één leeg profiel dat als een vol album meetelt,
-- vertekent de gemiddelden veel harder. De pagina vermeldt hoeveel
-- verzamelaars er om deze reden buiten bleven.
drop function if exists public.stat_verzamelaars();
create function public.stat_verzamelaars()
returns table (kind_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  with cat as (select * from public.stat_catalogus()),
  landen as (
    select c.land_code, min(c.pagina) as pagina
    from cat c
    group by c.land_code
  ),
  volgorde as (
    select
      l.land_code,
      row_number() over (order by l.pagina nulls last, l.land_code) as boek,
      row_number() over (order by l.land_code)                      as alfabet
    from landen l
  ),
  aantal as (select count(*)::int as landen from landen),
  drempel as (
    -- Minstens een vijfde van de landen, en nooit minder dan vijf: bij een
    -- korte landenlijst zou 20 % anders één of twee landen worden.
    select greatest(5, ceil(0.20 * (select landen from aantal)))::int as staart
  ),
  ingevuld as (
    select distinct s.kind_id, c.land_code
    from public.stickers s
    join cat c on c.code = s.nummer
  ),
  bereik as (
    select
      i.kind_id,
      max(v.boek)    as tot_boek,
      max(v.alfabet) as tot_alfabet
    from ingevuld i
    join volgorde v on v.land_code = i.land_code
    group by i.kind_id
  )
  select b.kind_id
  from bereik b
  where (select landen from aantal) - least(b.tot_boek, b.tot_alfabet)
        < (select staart from drempel);
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
drop function if exists public.statistieken();
create function public.statistieken()
returns table (
  verzamelaars           integer,
  verzamelaars_onvolledig integer,
  landen_totaal          integer,
  staart_drempel         integer,
  album_totaal           integer,
  geplakt                bigint,
  gezocht                bigint,
  dubbels                bigint,
  stickerwaarde          numeric,
  stickers_per_pakje     integer,
  landen_gemiddeld       numeric,
  albumvulling           numeric,
  dubbels_gemiddeld      numeric,
  gezocht_gemiddeld      numeric,
  ruilen_totaal          integer,
  ruilen_voltooid        integer,
  ruilen_open            integer,
  vermeden_pakjes        numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with inst as (
    select
      coalesce(i.stickerwaarde, 0.25)   as waarde,
      coalesce(i.stickers_per_pakje, 5) as pakje
    from public.instellingen i
    where i.id = 1
  ),
  cat as (select * from public.stat_catalogus()),
  n as (select count(*)::int as totaal from cat),
  vz as (select * from public.stat_verzamelaars()),
  -- Iedereen met minstens één sticker, dus inclusief wie op de staarttoets
  -- afviel: het verschil met vz is precies het aantal dat buiten de cijfers
  -- bleef.
  met_stickers as (
    select count(distinct s.kind_id)::int as n
    from public.stickers s
    join cat c on c.code = s.nummer
  ),
  land_totalen as (
    select c.land_code, count(*)::int as totaal from cat c group by c.land_code
  ),
  drempel as (
    select greatest(5, ceil(0.20 * (select count(*) from land_totalen)))::int as staart
  ),
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
    (select n from met_stickers) - (select count(*)::int from vz),
    (select count(*)::int from land_totalen),
    (select staart from drempel),
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
    (select round((select stickers from pakjes) / (select pakje from inst), 1))
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
drop function if exists public.statistieken_landen();
create function public.statistieken_landen()
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
drop function if exists public.top_gezochte_stickers(integer);
create function public.top_gezochte_stickers(p_limiet integer default 10)
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

drop function if exists public.top_verzamelde_stickers(integer);
create function public.top_verzamelde_stickers(p_limiet integer default 10)
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
drop function if exists public.statistieken_activiteit(timestamptz, text);
create function public.statistieken_activiteit(
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
-- 7. Ranglijst van verzamelaars — zonder namen
-- ============================================================
-- Enkel de volgorde en de aantallen: plaats 1 heeft er zoveel, plaats 2
-- zoveel. Wie dat is, staat er niet bij en komt hier ook niet uit de databank.
-- Zo laat de lijst zien hoe ver de verzamelaars uit elkaar liggen zonder dat
-- er een kind mee aangewezen wordt.
--
-- De rijen komen ongesorteerd terug: de pagina zet ze zelf op stickers of op
-- ruilen, en dat is dezelfde lijst, twee keer anders geordend.
drop function if exists public.top_verzamelaars(integer);
create function public.top_verzamelaars(p_limiet integer default 10)
returns table (
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
  with cat as (select * from public.stat_catalogus()),
  n as (select count(*)::int as totaal from cat),
  vz as (select * from public.stat_verzamelaars())
  select
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
  where auth.uid() is not null
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
--    -- verzamelaars telt enkel wie een bruikbare lijst heeft;
--    -- verzamelaars_onvolledig zegt hoeveel er om die reden buiten bleven.
--
-- 2) Wie valt er buiten, en klopt dat? Deze query toont per kind hoe ver het
--    in beide volgordes geraakte en hoe lang de lege staart is:
--      with cat as (select * from public.stat_catalogus()),
--           landen as (select land_code, min(pagina) p from cat group by land_code),
--           v as (select land_code,
--                        row_number() over (order by p nulls last, land_code) boek,
--                        row_number() over (order by land_code) alfabet from landen),
--           i as (select distinct s.kind_id, c.land_code
--                   from public.stickers s join cat c on c.code = s.nummer)
--      select i.kind_id,
--             (select count(*) from landen) - least(max(v.boek), max(v.alfabet)) as staart
--        from i join v on v.land_code = i.land_code
--       group by i.kind_id order by staart desc;
--
-- 3) Klopt de albumvulling met de hand?
--      select album_totaal, geplakt, verzamelaars,
--             round(100.0 * geplakt / (verzamelaars * album_totaal), 1) as vulling
--        from public.statistieken();
--
-- 4) Activiteit per dag over de laatste week:
--      select * from public.statistieken_activiteit(now() - interval '7 days', 'day');
--    -- verwacht: 8 rijen (vandaag meegerekend), ook de dagen met nul.
