-- Panini Ruilportaal — Engelse landsnaam en albumpagina in de catalogus
-- Voer dit uit na sql/012_stickers_aantal.sql.
--
-- Niet destructief: één kolom bij, één bestaande kolom eindelijk gevuld, en
-- twee functies die er een kolom bij krijgen. Geen rij verdwijnt.
--
-- WAAROM IN DE DATABANK EN NIET IN EEN JS-BESTAND. De Engelse landsnaam en het
-- paginanummer zijn geen opmaak maar catalogusgegevens: ze horen bij de
-- sticker zelf, net als land_code en land_naam, en ze worden ook door de RPC's
-- teruggegeven aan pagina's die de catalogus niet zelf inladen (ruilen.html,
-- wereldreis.html). Eén bron dus, in public.sticker_catalogus — en niet
-- daarnaast nog eens in code.
--
-- DE NOTATIE. Overal in het portaal wordt een land voortaan getoond als
--     BEL - BELGIUM - België
-- dus de FIFA/Panini-code eerst (dat is de primaire identificatie, en wat op
-- de sticker staat), dan de Engelse albumnaam, dan de Nederlandse naam.
-- Vlagemoji's worden bewust NIET gebruikt: Windows toont die als een
-- twee-letterige landcode ("BE"), en dat is precies de verwarring die deze
-- notatie moet wegnemen.
--
-- DE PAGINA'S. De kolom 'pagina' bestaat al sinds sql/003_ruillijst.sql maar
-- stond tot nu toe leeg. Ze bevat het paginanummer waarop dat land in het
-- Panini-album begint, zoals aangeleverd door de organisator. Daarmee kan de
-- landenkeuzelijst behalve op code ook op albumvolgorde sorteren — de volgorde
-- waarin een kind door zijn boek bladert.

-- ============================================================
-- 1. Nieuwe kolom
-- ============================================================
alter table public.sticker_catalogus
  add column if not exists land_naam_en text;

comment on column public.sticker_catalogus.land_naam_en is
  'Engelse landsnaam zoals in het Panini-album (BELGIUM, IR IRAN, TÜRKIYE).';

comment on column public.sticker_catalogus.pagina is
  'Paginanummer waarop dit land in het album begint. Bepaalt de albumvolgorde.';

-- ============================================================
-- 2. Engelse naam en paginanummer per land
-- ============================================================
-- De 48 landen in albumvolgorde, plus PANINI en FWC. Die laatste twee staan
-- niet in de aangeleverde tabel — ze komen vóór de landen in het album (het
-- logo op de eerste pagina, daarna de WK-specials), dus krijgen ze pagina 1
-- en 2 zodat ze bij het sorteren op albumvolgorde vooraan blijven staan.
update public.sticker_catalogus c
   set land_naam_en = v.naam_en,
       pagina       = v.pagina
  from (values
    ('PANINI', 'PANINI LOGO',              1),
    ('FWC',    'WORLD CUP SPECIALS',       2),
    ('MEX',    'MEXICO',                   8),
    ('RSA',    'SOUTH AFRICA',            10),
    ('KOR',    'SOUTH KOREA',             12),
    ('CZE',    'CZECHIA',                 14),
    ('CAN',    'CANADA',                  16),
    ('BIH',    'BOSNIA AND HERZEGOVINA',  18),
    ('QAT',    'QATAR',                   20),
    ('SUI',    'SWITZERLAND',             22),
    ('BRA',    'BRAZIL',                  24),
    ('MAR',    'MOROCCO',                 26),
    ('HAI',    'HAITI',                   28),
    ('SCO',    'SCOTLAND',                30),
    ('USA',    'UNITED STATES',           32),
    ('PAR',    'PARAGUAY',                34),
    ('AUS',    'AUSTRALIA',               36),
    ('TUR',    'TÜRKIYE',                 38),
    ('GER',    'GERMANY',                 40),
    ('CUW',    'CURAÇAO',                 42),
    ('CIV',    'CÔTE D''IVOIRE',          44),
    ('ECU',    'ECUADOR',                 46),
    ('NED',    'NETHERLANDS',             48),
    ('JPN',    'JAPAN',                   50),
    ('SWE',    'SWEDEN',                  52),
    ('TUN',    'TUNISIA',                 54),
    ('BEL',    'BELGIUM',                 56),
    ('EGY',    'EGYPT',                   60),
    ('IRN',    'IR IRAN',                 62),
    ('NZL',    'NEW ZEALAND',             64),
    ('ESP',    'SPAIN',                   66),
    ('CPV',    'CABO VERDE',              68),
    ('KSA',    'SAUDI ARABIA',            70),
    ('URU',    'URUGUAY',                 72),
    ('FRA',    'FRANCE',                  74),
    ('SEN',    'SENEGAL',                 76),
    ('IRQ',    'IRAQ',                    78),
    ('NOR',    'NORWAY',                  80),
    ('ARG',    'ARGENTINA',               82),
    ('ALG',    'ALGERIA',                 84),
    ('AUT',    'AUSTRIA',                 86),
    ('JOR',    'JORDAN',                  88),
    ('POR',    'PORTUGAL',                90),
    ('COD',    'DR CONGO',                92),
    ('UZB',    'UZBEKISTAN',              94),
    ('COL',    'COLOMBIA',                96),
    ('ENG',    'ENGLAND',                 98),
    ('CRO',    'CROATIA',                100),
    ('GHA',    'GHANA',                  102),
    ('PAN',    'PANAMA',                 104)
  ) as v(land_code, naam_en, pagina)
 where c.land_code = v.land_code;

-- ============================================================
-- 3. Eén Nederlandse naam bijgesteld
-- ============================================================
-- De aangeleverde tabel schrijft Bosnië voluit met "en"; de catalogus had een
-- koppelteken. De aangeleverde schrijfwijze wint, want die staat ook op het
-- ruilblad.
update public.sticker_catalogus
   set land_naam = 'Bosnië en Herzegovina'
 where land_code = 'BIH';

-- ============================================================
-- 4. wereldreis_landen(): Engelse naam mee terug
-- ============================================================
-- drop+create in plaats van create or replace: de kolomlijst verandert, en dat
-- laat Postgres niet toe via create or replace function. De rest van de functie
-- is identiek aan sql/012_stickers_aantal.sql.
drop function if exists public.wereldreis_landen(uuid);

create function public.wereldreis_landen(p_kind_id uuid)
returns table (
  land_code    text,
  land_naam    text,
  land_naam_en text,
  pagina       integer,
  categorie    text,
  totaal       integer,
  gezocht      integer,
  dubbel       integer,
  heeft        integer,
  procent      integer
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
    select c.land_code, c.land_naam, c.land_naam_en, c.pagina, c.categorie, c.code
    from public.sticker_catalogus c
    cross join glans_ok g
    where g.aan or not c.glans
  )
  select
    c.land_code,
    min(c.land_naam),
    min(c.land_naam_en),
    min(c.pagina),
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
  order by 1;
$fn$;

revoke all on function public.wereldreis_landen(uuid) from public;
revoke all on function public.wereldreis_landen(uuid) from anon;
grant execute on function public.wereldreis_landen(uuid) to authenticated;

-- ============================================================
-- 5. get_matches(): landcode en Engelse naam mee terug
-- ============================================================
-- land_code komt er nu ook bij: de ruilpagina heeft die nodig om de notatie
-- "BEL - BELGIUM - België" te kunnen samenstellen, en kon ze tot nu toe enkel
-- uit de stickercode afleiden.
drop function if exists public.get_matches(uuid);

create function public.get_matches(p_kind_id uuid)
returns table (
  richting       text,
  code           text,
  nummer         integer,
  land_code      text,
  land_naam      text,
  land_naam_en   text,
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
    c.land_code,
    c.land_naam,
    c.land_naam_en,
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
          -- naamloze rijen van meerdere kinderen samen tot één regel

  -- Jij hebt deze sticker dubbel, iemand anders zoekt ze
  select
    'jij_hebt_dubbel'::text,
    c.code,
    c.nummer,
    c.land_code,
    c.land_naam,
    c.land_naam_en,
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
-- 1) Alle 50 groepen horen een Engelse naam en een pagina te hebben:
--      select count(*) from public.sticker_catalogus where land_naam_en is null;
--      -- verwacht: 0
--
-- 2) De albumvolgorde:
--      select distinct pagina, land_code, land_naam_en, land_naam
--        from public.sticker_catalogus order by pagina;
--      -- verwacht: PANINI, FWC, MEX (8), RSA (10), ... PAN (104)
--
-- 3) De notatie zoals ze op het scherm komt:
--      select distinct land_code || ' - ' || land_naam_en || ' - ' || land_naam
--        from public.sticker_catalogus order by 1;
