-- Panini Ruilportaal — aanmaak en laatste wijziging op aanwezigheden.html
-- Bouwt voort op sql/025 en 20261011120000_030_gast_kinderen.sql.
--
-- WAAROM. De organisatie wil in de tabel zien wanneer een verzamelaar (of
-- gast-kind) erbij kwam en wanneer er voor het laatst iets aan veranderde —
-- om nieuwe inschrijvingen terug te vinden en om te zien wie al afgevinkt is.
--
-- "Laatste wijziging" = het laatste van: de rij zelf aangemaakt, of iets aan
-- zijn aanwezigheid (ingeschreven, aangemeld, uitgevinkt). Bewust NIET de
-- stickerlijst: die verandert dagelijks en zegt niets over de beurs.
--
-- Uitvinken wist aangemeld_op, en zou dus geen spoor nalaten. Daarom krijgen
-- beide aanwezigheidstabellen een updated_at. Zonder default bij het toevoegen,
-- anders zou elke bestaande rij "gewijzigd op de dag van deze migratie" tonen;
-- de default komt er pas daarna, voor nieuwe rijen.
--
-- Niet destructief: enkel kolommen en een trigger erbij. De twee functies
-- krijgen een kolom meer en moeten daarom eerst weg (Postgres laat het
-- terugkeertype niet wijzigen met create or replace).

-- ============================================================
-- 1. updated_at op de aanwezigheden
-- ============================================================
alter table public.aanwezigheden      add column if not exists updated_at timestamptz;
alter table public.aanwezigheden      alter column updated_at set default now();
alter table public.gast_aanwezigheden add column if not exists updated_at timestamptz;
alter table public.gast_aanwezigheden alter column updated_at set default now();

drop trigger if exists trg_touch_aanwezigheden on public.aanwezigheden;
create trigger trg_touch_aanwezigheden
  before update on public.aanwezigheden
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_gast_aanwezigheden on public.gast_aanwezigheden;
create trigger trg_touch_gast_aanwezigheden
  before update on public.gast_aanwezigheden
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 2. aanwezigheden_overzicht(): zelfde als in sql/025, plus twee tijdstippen
-- ============================================================
drop function if exists public.aanwezigheden_overzicht();
create function public.aanwezigheden_overzicht()
returns table (
  kind_id       uuid,
  voornaam      text,
  familienaam   text,
  ouders        text,
  wijk          text,
  aanwezigheid  jsonb,
  aangemaakt_op timestamptz,
  gewijzigd_op  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    k.id,
    k.voornaam,
    k.familienaam,
    coalesce(
      nullif((select string_agg(nullif(btrim(l.voornaam || ' ' || l.familienaam), ''), ', '
                                order by l.created_at)
                from public.gezin_leden l
               where l.gezin_id = public.gezin_sleutel(k.user_id)), ''),
      (select u.email from auth.users u where u.id = k.user_id),
      ''
    ),
    coalesce((select g.wijk from public.gezinnen g
               where g.id = public.gezin_sleutel(k.user_id)), ''),
    coalesce((select jsonb_object_agg(
                a.event_id::text,
                jsonb_build_object(
                  'komt', a.komt,
                  'aangemeld', a.aangemeld_op is not null,
                  'aangemeld_op', a.aangemeld_op
                ))
              from public.aanwezigheden a
             where a.kind_id = k.id), '{}'::jsonb),
    k.created_at,
    -- greatest() slaat nulls over: een kind zonder aanwezigheden geeft zijn
    -- aanmaakdatum terug.
    greatest(k.created_at,
             (select max(greatest(a.created_at, a.komt_op, a.aangemeld_op, a.updated_at))
                from public.aanwezigheden a where a.kind_id = k.id))
  from public.kinderen k
  where public.is_beheerder()
  order by k.voornaam, k.familienaam;
$fn$;

revoke all on function public.aanwezigheden_overzicht() from public;
revoke all on function public.aanwezigheden_overzicht() from anon;
grant execute on function public.aanwezigheden_overzicht() to authenticated;

-- ============================================================
-- 3. gast_kinderen_overzicht(): zelfde als in 030, plus twee tijdstippen
-- ============================================================
-- Aanmaak = wanneer het kind in het portaal kwam (created_at), niet de
-- inschrijvingsdatum op de website: die staat op statistieken.html.
drop function if exists public.gast_kinderen_overzicht();
create function public.gast_kinderen_overzicht()
returns table (
  gast_kind_id  uuid,
  naam          text,
  leeftijd      smallint,
  gast_id       uuid,
  ouder         text,
  gemeente      text,
  email         text,
  heeft_account boolean,
  bron          text,
  aanwezigheid  jsonb,
  aangemaakt_op timestamptz,
  gewijzigd_op  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select gk.id, gk.naam, gk.leeftijd, g.id, g.ouder, g.gemeente, g.email,
         g.email is not null and exists (
           select 1 from auth.users u where lower(u.email) = lower(g.email)
         ),
         g.bron,
         coalesce((select jsonb_object_agg(
                     a.event_id::text,
                     jsonb_build_object('komt', a.komt, 'aangemeld', a.aangemeld_op is not null))
                   from public.gast_aanwezigheden a
                  where a.gast_kind_id = gk.id), '{}'::jsonb),
         gk.created_at,
         greatest(gk.created_at,
                  (select max(greatest(a.komt_op, a.aangemeld_op, a.updated_at))
                     from public.gast_aanwezigheden a where a.gast_kind_id = gk.id))
  from public.gast_kinderen gk
  join public.gasten g on g.id = gk.gast_id
  where public.is_beheerder()
  order by gk.naam;
$fn$;

revoke all on function public.gast_kinderen_overzicht() from public;
revoke all on function public.gast_kinderen_overzicht() from anon;
grant execute on function public.gast_kinderen_overzicht() to authenticated;

-- Snelle controle:
--   select voornaam, aangemaakt_op, gewijzigd_op from public.aanwezigheden_overzicht();
--   select naam, aangemaakt_op, gewijzigd_op from public.gast_kinderen_overzicht();
