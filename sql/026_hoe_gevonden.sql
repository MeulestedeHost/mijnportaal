-- Panini Ruilportaal — Hoe heb je ons gevonden?
-- Voer dit uit na sql/025_events_en_aanwezigheid.sql.
--
-- WAAROM. De organisatie wil weten waar de deelnemers vandaan komen: loont een
-- affiche, of komt iedereen via school? Eén keuzelijst op gezin.html, en de
-- cijfers erachter op de aanwezighedenpagina.
--
-- PER GEZIN, NIET PER VERZAMELAAR. Een gezin vindt de beurs één keer; drie
-- kinderen van hetzelfde gezin drie keer laten antwoorden geeft drie keer
-- dezelfde stem en vertekent de telling.
--
-- OPTIONEEL. Niets invullen is een geldig antwoord — niemand wordt tegen-
-- gehouden om te ruilen omdat hij deze vraag oversloeg.
--
-- Niet destructief: twee kolommen bij, meer niet.

-- ============================================================
-- 1. De twee kolommen
-- ============================================================
-- Een check en geen aparte tabel: de lijst verandert hooguit één keer per jaar,
-- en een lookup-tabel voor negen vaste woorden is meer onderhoud dan winst.
-- De sleutels zijn Nederlands, zoals de rest van de code; de pagina zet ze om
-- naar het opschrift.
alter table public.gezinnen
  add column if not exists hoe_gevonden text;

alter table public.gezinnen
  add column if not exists hoe_gevonden_ander text;

alter table public.gezinnen
  drop constraint if exists gezin_hoe_gevonden_geldig;
alter table public.gezinnen
  add constraint gezin_hoe_gevonden_geldig
  check (hoe_gevonden is null or hoe_gevonden in (
    'facebook',
    'instagram',
    'website_vzw',
    'mond_tot_mond',
    'vrienden_familie',
    'affiche',
    'school',
    'vorige_ruilbeurs',
    'andere'
  ));

comment on column public.gezinnen.hoe_gevonden is
  'Hoe dit gezin de ruilbeurs leerde kennen. Leeg mag. Enkel de organisatie
   leest dit over gezinnen heen, via public.hoe_gevonden_statistiek().';

comment on column public.gezinnen.hoe_gevonden_ander is
  'Vrije toelichting, enkel zinvol bij hoe_gevonden = ''andere''.';

-- De bestaande policies op public.gezinnen (sql/009) dekken deze kolommen al:
-- een gezin leest en schrijft enkel zijn eigen rij. Er verandert niets aan wie
-- wat mag.

-- ============================================================
-- 2. De telling voor de organisatie
-- ============================================================
-- Enkel de aantallen, nooit welk gezin wat antwoordde — daar is de vraag niet
-- voor bedoeld. De vrije toelichtingen komen apart, als lijst zonder naam.
create or replace function public.hoe_gevonden_statistiek()
returns table (
  hoe_gevonden text,
  aantal       integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(g.hoe_gevonden, 'onbekend'), count(*)::integer
  from public.gezinnen g
  where public.is_beheerder()
  group by 1
  order by 2 desc, 1;
$fn$;

revoke all on function public.hoe_gevonden_statistiek() from public;
revoke all on function public.hoe_gevonden_statistiek() from anon;
grant execute on function public.hoe_gevonden_statistiek() to authenticated;

create or replace function public.hoe_gevonden_toelichtingen()
returns table (toelichting text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select btrim(g.hoe_gevonden_ander)
  from public.gezinnen g
  where public.is_beheerder()
    and g.hoe_gevonden = 'andere'
    and btrim(coalesce(g.hoe_gevonden_ander, '')) <> ''
  order by 1;
$fn$;

revoke all on function public.hoe_gevonden_toelichtingen() from public;
revoke all on function public.hoe_gevonden_toelichtingen() from anon;
grant execute on function public.hoe_gevonden_toelichtingen() to authenticated;

-- Snelle controle:
--   select * from public.hoe_gevonden_statistiek();
