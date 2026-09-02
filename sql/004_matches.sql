-- Panini Ruilportaal — Matches tijdens de ruilbeurs
-- Voer dit uit na sql/003_ruillijst.sql.
--
-- Ontwerpprincipe: de tijdscontrole en de toegangscontrole zitten in de
-- DATABASE, niet in de JavaScript. Een aparte pagina is geen beveiliging --
-- wie de API rechtstreeks aanspreekt moet buiten het beursvenster niets
-- kunnen zien.

-- ============================================================
-- 1. Instellingen: het beursvenster (singleton-rij)
-- ============================================================
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

-- Leesbaar voor ingelogde gebruikers: de front-end toont wanneer de beurs
-- doorgaat. Het venster zelf is geen geheim.
drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select
  on public.instellingen for select
  to authenticated
  using (true);

-- BEWUST geen insert/update/delete-policy: RLS weigert dan standaard alles
-- via de API. Het venster bijstellen kan enkel via de SQL-editor of met de
-- service_role-sleutel (die RLS omzeilt). Bijvoorbeeld:
--   update public.instellingen
--      set beurs_start = timestamp '2026-09-06 13:30' at time zone 'Europe/Brussels',
--          beurs_einde = timestamp '2026-09-06 18:00' at time zone 'Europe/Brussels',
--          updated_at  = now()
--    where id = 1;

-- ============================================================
-- 2. get_matches(): security definer, met ALLE controles expliciet
-- ============================================================
-- Deze functie omzeilt RLS (dat is de bedoeling: ze moet de status-rijen van
-- ANDERE kinderen kunnen lezen). Daarom staat de volledige toegangscontrole
-- hieronder in de CTE 'eigen_kind':
--   a) auth.uid() moet ingevuld zijn        -> anonieme call levert niets op
--   b) p_kind_id moet een kind van auth.uid() zijn -> geen andermans kind
--   c) now() moet binnen het beursvenster vallen   -> anders lege set
-- Valt één van die drie weg, dan is 'eigen_kind' leeg en produceren alle
-- joins hieronder nul rijen.
--
-- 'set search_path = '''' + volledig gekwalificeerde namen voorkomen dat een
-- caller met een eigen schema objecten kan shadowen en zo code als de
-- eigenaar van de functie laat draaien.
--
-- Teruggegeven kolommen: richting, code, land_naam, voornaam van het andere
-- kind. Bewust NIET: familienaam, e-mailadres, user_id of kind_id.

create or replace function public.get_matches(p_kind_id uuid)
returns table (
  richting   text,
  code       text,
  land_naam  text,
  ander_kind text
)
language sql
security definer
stable
set search_path = ''
as $$
  with venster as (
    select i.beurs_start, i.beurs_einde
    from public.instellingen i
    where i.id = 1
  ),
  eigen_kind as (
    select k.id, k.user_id
    from public.kinderen k
    cross join venster v
    where k.id = p_kind_id
      and auth.uid() is not null
      and k.user_id = auth.uid()
      and now() >= v.beurs_start
      and now() <  v.beurs_einde
  )
  -- Jij zoekt deze sticker, een ander kind heeft ze dubbel
  select
    'jij_zoekt'::text as richting,
    c.code,
    c.land_naam,
    ak.voornaam as ander_kind
  from eigen_kind ek
  join public.sticker_status mij
    on mij.kind_id = ek.id and mij.zoekt
  join public.sticker_status ander
    on ander.sticker_id = mij.sticker_id and ander.dubbel_aantal > 0
  join public.kinderen ak
    on ak.id = ander.kind_id and ak.user_id <> ek.user_id
  join public.sticker_catalogus c
    on c.id = mij.sticker_id

  union all

  -- Jij hebt deze sticker dubbel, een ander kind zoekt ze
  select
    'jij_hebt_dubbel'::text as richting,
    c.code,
    c.land_naam,
    ak.voornaam as ander_kind
  from eigen_kind ek
  join public.sticker_status mij
    on mij.kind_id = ek.id and mij.dubbel_aantal > 0
  join public.sticker_status ander
    on ander.sticker_id = mij.sticker_id and ander.zoekt
  join public.kinderen ak
    on ak.id = ander.kind_id and ak.user_id <> ek.user_id
  join public.sticker_catalogus c
    on c.id = mij.sticker_id

  order by 1, 3, 2;
$$;

-- Execute-rechten: in Postgres krijgt PUBLIC standaard EXECUTE op een nieuwe
-- functie. Die default moet dus expliciet ingetrokken worden.
revoke all on function public.get_matches(uuid) from public;
revoke all on function public.get_matches(uuid) from anon;
grant execute on function public.get_matches(uuid) to authenticated;
