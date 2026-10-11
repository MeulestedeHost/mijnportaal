-- Panini Ruilportaal — gasten per kind, en over beurzen heen
-- Bouwt voort op 20261011100000_029_gasten.sql.
--
-- WAAROM. In 029 was een gast één regel op de lijst van één beurs, met de
-- kinderen als tekstlijst. Twee dingen passen daar niet in:
--   * de inschrijvingen via de Wix-site (06/09 en 11/10): hetzelfde gezin staat
--     op beide lijsten, en aan de inkom wordt per KIND afgevinkt — net als bij
--     de verzamelaars, om dezelfde reden (sql/025: soms blijft er één thuis);
--   * leeftijd, inschrijvingsdatum en "hoe gevonden" uit die formulieren.
-- Dus: een gast is voortaan een gezin zonder account (public.gasten), met zijn
-- kinderen in public.gast_kinderen en per kind en beurs een rij in
-- public.gast_aanwezigheden — dezelfde twee stappen als public.aanwezigheden:
-- 'komt' (ingeschreven) en 'aangemeld_op' (aan de inkom afgevinkt).
--
-- WAAROM NIET GEWOON IN public.aanwezigheden. Daar betekent kind_id null "een
-- verwijderde verzamelaar" (geanonimiseerd, sql/025), en get_matches() leest
-- die tabel. Een gast hoort in geen van beide: hij staat niet in de
-- ruilplanner en is geen anonieme telling.
--
-- Niet destructief. gasten.kinderen blijft bestaan maar wordt niet meer
-- gelezen; de inhoud wordt hieronder overgenomen in gast_kinderen. Wegdoen
-- kan later, als niets er nog naar schrijft.

-- ============================================================
-- 1. Gasten: los van één beurs, met de gegevens uit de inschrijving
-- ============================================================
alter table public.gasten alter column event_id drop not null;
alter table public.gasten alter column kinderen drop not null;
alter table public.gasten drop constraint if exists gasten_kinderen_check;

alter table public.gasten add column if not exists hoe_gevonden       text;
alter table public.gasten add column if not exists hoe_gevonden_ander text;
alter table public.gasten add column if not exists ingeschreven_op    timestamptz;
-- 'wix' = overgenomen uit de inschrijvingen op de website, 'manueel' = aan de
-- inkom ingetikt. Enkel om achteraf te weten waar een regel vandaan komt.
alter table public.gasten add column if not exists bron text not null default 'manueel';

alter table public.gasten drop constraint if exists gasten_bron_geldig;
alter table public.gasten add constraint gasten_bron_geldig
  check (bron in ('manueel', 'wix'));

-- Dezelfde sleutels als gezinnen.hoe_gevonden (sql/026 + 027), zodat de
-- telling beide samen kan nemen.
alter table public.gasten drop constraint if exists gasten_hoe_gevonden_geldig;
alter table public.gasten add constraint gasten_hoe_gevonden_geldig
  check (hoe_gevonden is null or hoe_gevonden in (
    'facebook', 'instagram', 'whatsapp', 'website_vzw', 'mond_tot_mond',
    'vrienden_familie', 'affiche', 'school', 'vorige_ruilbeurs', 'andere'
  ));

create index if not exists idx_gasten_email on public.gasten (lower(email));

-- ============================================================
-- 2. De kinderen van een gast
-- ============================================================
-- Leeftijd en geen geboortejaar: dat is wat het formulier vroeg, en een
-- omrekening zou een jaar kunnen afwijken.
create table if not exists public.gast_kinderen (
  id         uuid primary key default gen_random_uuid(),
  gast_id    uuid not null references public.gasten(id) on delete cascade,
  naam       text not null check (btrim(naam) <> ''),
  leeftijd   smallint check (leeftijd is null or leeftijd between 1 and 25),
  created_at timestamptz not null default now()
);

create index if not exists idx_gast_kinderen_gast on public.gast_kinderen (gast_id);

create table if not exists public.gast_aanwezigheden (
  gast_kind_id   uuid not null references public.gast_kinderen(id) on delete cascade,
  event_id       uuid not null references public.events(id) on delete cascade,
  komt           boolean not null default true,
  komt_op        timestamptz default now(),  -- wanneer ingeschreven voor déze beurs
  aangemeld_op   timestamptz,
  aangemeld_door uuid references auth.users(id) on delete set null,
  primary key (gast_kind_id, event_id)
);

create index if not exists idx_gast_aanwezig_event on public.gast_aanwezigheden (event_id);

alter table public.gast_kinderen      enable row level security;
alter table public.gast_aanwezigheden enable row level security;

-- Net als public.gasten: enkel de organisatie, voor alles.
drop policy if exists gast_kinderen_beheer on public.gast_kinderen;
create policy gast_kinderen_beheer on public.gast_kinderen for all to authenticated
  using (public.is_beheerder()) with check (public.is_beheerder());
drop policy if exists gast_aanwezigheden_beheer on public.gast_aanwezigheden;
create policy gast_aanwezigheden_beheer on public.gast_aanwezigheden for all to authenticated
  using (public.is_beheerder()) with check (public.is_beheerder());

-- De gasten die al via 029 ingetikt zijn, overnemen: elk kind 'komt' naar de
-- beurs waarvoor het toegevoegd werd. Twee keer draaien doet niets extra.
insert into public.gast_kinderen (gast_id, naam, created_at)
select g.id, btrim(k.naam), g.created_at
from public.gasten g
cross join lateral unnest(g.kinderen) as k(naam)
where btrim(k.naam) <> ''
  and not exists (select 1 from public.gast_kinderen gk where gk.gast_id = g.id);

insert into public.gast_aanwezigheden (gast_kind_id, event_id, komt, komt_op)
select gk.id, g.event_id, true, g.created_at
from public.gast_kinderen gk
join public.gasten g on g.id = gk.gast_id
where g.event_id is not null
on conflict do nothing;

-- ============================================================
-- 3. Een gast toevoegen aan de inkom — in één transactie
-- ============================================================
-- Gezin, kinderen en "komt" horen samen: een gast zonder kinderen of een kind
-- dat nergens staat ingeschreven, is een halve regel die niemand nog vindt.
-- Security invoker: de policies hierboven doen het werk.
create or replace function public.gast_toevoegen(
  p_event_id uuid,
  p_ouder    text,
  p_email    text,
  p_gemeente text,
  p_kinderen text[]
)
returns uuid
language plpgsql
set search_path = ''
as $fn$
declare
  v_gast uuid;
  v_naam text;
  v_kind uuid;
begin
  if not public.is_beheerder() then
    raise exception 'Enkel de organisatie kan gasten toevoegen.';
  end if;
  if coalesce(btrim(p_ouder), '') = '' then
    raise exception 'Vul de naam van de ouder in.';
  end if;
  if not exists (select 1 from unnest(p_kinderen) n where btrim(n) <> '') then
    raise exception 'Vul minstens één verzamelaar in.';
  end if;

  insert into public.gasten (event_id, ouder, email, gemeente, created_by, bron)
  values (p_event_id, btrim(p_ouder), nullif(lower(btrim(p_email)), ''),
          nullif(btrim(p_gemeente), ''), auth.uid(), 'manueel')
  returning id into v_gast;

  foreach v_naam in array p_kinderen loop
    continue when coalesce(btrim(v_naam), '') = '';
    insert into public.gast_kinderen (gast_id, naam)
    values (v_gast, btrim(v_naam))
    returning id into v_kind;
    insert into public.gast_aanwezigheden (gast_kind_id, event_id, komt)
    values (v_kind, p_event_id, true);
  end loop;

  return v_gast;
end;
$fn$;

revoke all on function public.gast_toevoegen(uuid, text, text, text, text[]) from public;
revoke all on function public.gast_toevoegen(uuid, text, text, text, text[]) from anon;
grant execute on function public.gast_toevoegen(uuid, text, text, text, text[]) to authenticated;

-- ============================================================
-- 4. Een gast-kind aan de inkom afvinken
-- ============================================================
-- Zelfde regels als aanmelden_zetten() voor verzamelaars: wie aangemeld is,
-- komt ook; uitvinken laat 'komt' staan.
create or replace function public.gast_aanmelden_zetten(
  p_gast_kind_id uuid,
  p_event_id     uuid,
  p_aangemeld    boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_beheerder() then
    raise exception 'Enkel de organisatie kan gasten aanmelden.';
  end if;

  insert into public.gast_aanwezigheden (gast_kind_id, event_id, komt, aangemeld_op, aangemeld_door)
  values (p_gast_kind_id, p_event_id, p_aangemeld,
          case when p_aangemeld then now() end,
          case when p_aangemeld then auth.uid() end)
  on conflict (gast_kind_id, event_id) do update
    set aangemeld_op   = case when p_aangemeld
                              then coalesce(public.gast_aanwezigheden.aangemeld_op, now()) end,
        aangemeld_door = case when p_aangemeld then auth.uid() end,
        komt           = public.gast_aanwezigheden.komt or p_aangemeld;
end;
$fn$;

revoke all on function public.gast_aanmelden_zetten(uuid, uuid, boolean) from public;
revoke all on function public.gast_aanmelden_zetten(uuid, uuid, boolean) from anon;
grant execute on function public.gast_aanmelden_zetten(uuid, uuid, boolean) to authenticated;

-- ============================================================
-- 5. Overzichten voor de aanwezighedenpagina
-- ============================================================
-- Per gast-kind, in dezelfde jsonb-vorm als aanwezigheden_overzicht(), zodat
-- de pagina beide in één tabel kan zetten. security definer voor auth.users.
create or replace function public.gast_kinderen_overzicht()
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
  aanwezigheid  jsonb
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
                  where a.gast_kind_id = gk.id), '{}'::jsonb)
  from public.gast_kinderen gk
  join public.gasten g on g.id = gk.gast_id
  where public.is_beheerder()
  order by gk.naam;
$fn$;

revoke all on function public.gast_kinderen_overzicht() from public;
revoke all on function public.gast_kinderen_overzicht() from anon;
grant execute on function public.gast_kinderen_overzicht() to authenticated;

-- Zelfde kolommen als in 029; de kinderen komen nu uit gast_kinderen, en een
-- gast hoort bij een beurs zodra één van zijn kinderen ervoor ingeschreven is.
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
  select g.id, g.ouder, g.gemeente, g.email,
         array(select gk.naam from public.gast_kinderen gk
                where gk.gast_id = g.id order by gk.created_at, gk.naam),
         g.uitgenodigd,
         g.email is not null and exists (
           select 1 from auth.users u where lower(u.email) = lower(g.email)
         ),
         g.created_at
  from public.gasten g
  where public.is_beheerder()
    and exists (select 1 from public.gast_kinderen gk
                join public.gast_aanwezigheden a on a.gast_kind_id = gk.id
                where gk.gast_id = g.id and a.event_id = p_event_id)
  order by g.ouder;
$fn$;

-- ============================================================
-- 6. Tellingen: gasten tellen mee
-- ============================================================
-- Een kolom erbij verandert het terugkeertype, dus eerst weg.
drop function if exists public.aanwezigheid_statistiek();
create function public.aanwezigheid_statistiek()
returns table (
  event_id  uuid,
  naam      text,
  start     timestamptz,
  gepland   integer,
  aangemeld integer,
  anoniem   integer,
  gasten    integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select e.id, e.naam, e.start,
         (select count(*) from public.aanwezigheden a where a.event_id = e.id and a.komt)::integer
           + (select count(*) from public.gast_aanwezigheden ga where ga.event_id = e.id and ga.komt)::integer,
         (select count(*) from public.aanwezigheden a where a.event_id = e.id and a.aangemeld_op is not null)::integer
           + (select count(*) from public.gast_aanwezigheden ga where ga.event_id = e.id and ga.aangemeld_op is not null)::integer,
         (select count(*) from public.aanwezigheden a where a.event_id = e.id and a.kind_id is null)::integer,
         (select count(*) from public.gast_aanwezigheden ga where ga.event_id = e.id and ga.komt)::integer
  from public.events e
  where public.is_beheerder()
  order by e.start desc;
$fn$;

revoke all on function public.aanwezigheid_statistiek() from public;
revoke all on function public.aanwezigheid_statistiek() from anon;
grant execute on function public.aanwezigheid_statistiek() to authenticated;

-- "Hoe gevonden": een gast telt mee als gezin, maar enkel met een antwoord —
-- de september-inschrijving stelde de vraag niet, en wie aan de inkom
-- ingetikt wordt evenmin; die als 'onbekend' tellen zou de telling vertekenen.
-- Een gast met een account op hetzelfde adres telt niet: dat gezin telt al
-- via public.gezinnen.
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
  select antwoord, count(*)::integer
  from (
    select coalesce(g.hoe_gevonden, 'onbekend') as antwoord
    from public.gezinnen g
    union all
    select ga.hoe_gevonden
    from public.gasten ga
    where ga.hoe_gevonden is not null
      and not exists (select 1 from auth.users u
                      where ga.email is not null and lower(u.email) = lower(ga.email))
  ) alles
  where public.is_beheerder()
  group by 1
  order by 2 desc, 1;
$fn$;

create or replace function public.hoe_gevonden_toelichtingen()
returns table (toelichting text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select t from (
    select btrim(g.hoe_gevonden_ander) as t
    from public.gezinnen g
    where g.hoe_gevonden = 'andere'
    union all
    select btrim(ga.hoe_gevonden_ander)
    from public.gasten ga
    where ga.hoe_gevonden = 'andere'
      and not exists (select 1 from auth.users u
                      where ga.email is not null and lower(u.email) = lower(ga.email))
  ) alles
  where public.is_beheerder() and coalesce(t, '') <> ''
  order by 1;
$fn$;

-- ============================================================
-- 7. Deelnemers voor de statistiekenpagina (enkel de organisatie)
-- ============================================================
-- Eén rij per kind — verzamelaar of gast — met wat de organisatie over de
-- beurzen wil weten: waar ze vandaan komen, hoe oud ze zijn, langs welk kanaal
-- ze ons vonden en wanneer ze inschreven. De pagina telt en sorteert zelf:
-- het gaat om enkele honderden rijen die de organisatie op
-- aanwezigheden.html toch al met naam ziet, niet om stickerlijsten.
--
-- Leeftijd van een verzamelaar: huidig jaar min geboortejaar — op een jaar
-- na juist, en leeg als de ouder geen geboortejaar invulde.
create or replace function public.deelnemers_overzicht()
returns table (
  soort        text,
  id           uuid,
  naam         text,
  ouder        text,
  gemeente     text,
  leeftijd     integer,
  hoe_gevonden text,
  aanwezigheid jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select 'verzamelaar', k.id, btrim(k.voornaam || ' ' || k.familienaam),
         coalesce(
           nullif((select string_agg(nullif(btrim(l.voornaam || ' ' || l.familienaam), ''), ', '
                                     order by l.created_at)
                     from public.gezin_leden l
                    where l.gezin_id = public.gezin_sleutel(k.user_id)), ''),
           (select u.email from auth.users u where u.id = k.user_id),
           ''),
         gz.wijk,
         case when k.geboortejaar is not null
              then extract(year from now())::integer - k.geboortejaar end,
         gz.hoe_gevonden,
         coalesce((select jsonb_object_agg(a.event_id::text, jsonb_build_object(
                     'komt', a.komt, 'aangemeld', a.aangemeld_op is not null, 'komt_op', a.komt_op))
                   from public.aanwezigheden a where a.kind_id = k.id), '{}'::jsonb)
  from public.kinderen k
  left join public.gezinnen gz on gz.id = public.gezin_sleutel(k.user_id)
  where public.is_beheerder()
  union all
  select 'gast', gk.id, gk.naam, g.ouder, g.gemeente, gk.leeftijd::integer, g.hoe_gevonden,
         coalesce((select jsonb_object_agg(a.event_id::text, jsonb_build_object(
                     'komt', a.komt, 'aangemeld', a.aangemeld_op is not null,
                     'komt_op', coalesce(a.komt_op, g.ingeschreven_op)))
                   from public.gast_aanwezigheden a where a.gast_kind_id = gk.id), '{}'::jsonb)
  from public.gast_kinderen gk
  join public.gasten g on g.id = gk.gast_id
  where public.is_beheerder();
$fn$;

revoke all on function public.deelnemers_overzicht() from public;
revoke all on function public.deelnemers_overzicht() from anon;
grant execute on function public.deelnemers_overzicht() to authenticated;

-- Snelle controle:
--   select * from public.deelnemers_overzicht();
--   select * from public.gast_kinderen_overzicht();
--   select * from public.aanwezigheid_statistiek();
