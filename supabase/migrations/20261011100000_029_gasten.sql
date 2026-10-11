-- Panini Ruilportaal — gasten: snel een gezin op de aanwezigenlijst zetten
-- Bouwt voort op sql/025_events_en_aanwezigheid.sql.
--
-- WAAROM EEN EIGEN TABEL EN GEEN RIJEN IN public.kinderen. Een verzamelaar
-- hangt vast aan een ouder-account (kinderen.user_id is verplicht en alles —
-- gezin_sleutel(), get_matches(), RLS — leest daaruit). Wie aan de inkom nog
-- geen account heeft, kan daar niet in zonder dat model open te breken. Een
-- gast is dus enkel iets op de presentielijst van één beurs: geen stickerlijst,
-- niet in de ruilplanner.
--
-- Het e-mailadres dient om de ouder daarna een magic link te sturen (de gewone
-- inlogmail; de pagina doet dat zelf). Na het inloggen maakt de ouder zijn
-- gezin en verzamelaars aan in de inschrijfwizard — gasten_overzicht() meldt
-- of er al een account op dat adres bestaat, zodat de organisatie ziet wie er
-- nog geen heeft.
--
-- Niet destructief: enkel een nieuwe tabel en functie.
create table if not exists public.gasten (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  ouder       text not null check (btrim(ouder) <> ''),
  gemeente    text,
  email       text,
  kinderen    text[] not null check (cardinality(kinderen) between 1 and 3),
  uitgenodigd boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

create index if not exists idx_gasten_event on public.gasten (event_id);

alter table public.gasten enable row level security;

drop policy if exists gasten_select on public.gasten;
create policy gasten_select on public.gasten for select to authenticated
  using (public.is_beheerder());
drop policy if exists gasten_insert on public.gasten;
create policy gasten_insert on public.gasten for insert to authenticated
  with check (public.is_beheerder());
drop policy if exists gasten_update on public.gasten;
create policy gasten_update on public.gasten for update to authenticated
  using (public.is_beheerder()) with check (public.is_beheerder());
drop policy if exists gasten_delete on public.gasten;
create policy gasten_delete on public.gasten for delete to authenticated
  using (public.is_beheerder());

-- De gasten van één beurs, met of er al een account op hun e-mailadres bestaat.
-- security definer, want auth.users is niet leesbaar voor de pagina.
create or replace function public.gasten_overzicht(p_event_id uuid)
returns table (
  id            uuid,
  ouder         text,
  gemeente      text,
  email         text,
  kinderen      text[],
  uitgenodigd   boolean,
  heeft_account boolean,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select g.id, g.ouder, g.gemeente, g.email, g.kinderen, g.uitgenodigd,
         g.email is not null and exists (
           select 1 from auth.users u where lower(u.email) = lower(g.email)
         ),
         g.created_at
  from public.gasten g
  where public.is_beheerder() and g.event_id = p_event_id
  order by g.created_at;
$fn$;

revoke all on function public.gasten_overzicht(uuid) from public;
revoke all on function public.gasten_overzicht(uuid) from anon;
grant execute on function public.gasten_overzicht(uuid) to authenticated;
