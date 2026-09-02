-- Panini Ruilportaal — Instellingen: beursvenster + glansstickers
-- Voer dit uit na sql/006_kindproof.sql.
--
-- Twee nieuwe dingen:
--   1. Een schakelaar 'toon_glans'. De Europese albums bevatten de
--      glansvarianten (BEL2s naast BEL2) niet, dus staan ze standaard uit.
--   2. Een beheerderslijst, zodat de instellingenpagina bestaat zonder dat
--      elke ingelogde ouder het beursvenster kan verzetten.
--
-- Niet destructief: er wordt niets verwijderd. Glansstickers blijven in
-- sticker_catalogus staan, ze worden enkel niet meer getoond of geteld.

-- ============================================================
-- 1. Schakelaar voor de glansstickers
-- ============================================================
alter table public.instellingen
  add column if not exists toon_glans boolean not null default false;

-- Bijhouden wie wat wanneer verzet: bij één gedeelde instelling voor de hele
-- beurs wil je achteraf kunnen zien wie ze aanpaste.
alter table public.instellingen
  add column if not exists updated_by uuid references auth.users(id);

-- ============================================================
-- 2. Beheerders
-- ============================================================
-- Bewust een aparte tabel en geen kolom op auth.users: die tabel is van
-- Supabase en hoort niet aangepast te worden.
create table if not exists public.beheerders (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.beheerders enable row level security;

-- Je mag enkel zien of JIJ beheerder bent, niet wie de anderen zijn.
drop policy if exists beheerders_select on public.beheerders;
create policy beheerders_select
  on public.beheerders for select
  to authenticated
  using (user_id = auth.uid());

-- BEWUST geen insert/update/delete-policy: beheerder word je enkel via de
-- SQL-editor hieronder. Een beheerpagina die zichzelf beheerders kan geven,
-- is geen beheerpagina meer.

-- >>> AANPASSEN EN UITVOEREN: zet hier het e-mailadres waarmee JIJ inlogt.
--     Het moet een adres zijn dat al een keer heeft ingelogd, anders staat
--     het nog niet in auth.users en voegt deze query niets toe.
insert into public.beheerders (user_id)
select u.id from auth.users u
where u.email = 'valentijn@rmbt.be'
on conflict (user_id) do nothing;

-- Controle — geeft dit 0 rijen terug, dan klopt het adres hierboven niet:
--   select u.email from public.beheerders b join auth.users u on u.id = b.user_id;

create or replace function public.is_beheerder()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.beheerders b where b.user_id = auth.uid()
  );
$fn$;

revoke all on function public.is_beheerder() from public;
revoke all on function public.is_beheerder() from anon;
grant execute on function public.is_beheerder() to authenticated;

-- ============================================================
-- 3. Instellingen mogen nu bijgewerkt worden — door beheerders
-- ============================================================
-- 006 liet bewust elke schrijfpolicy weg, waardoor RLS alles weigerde. Nu er
-- een instellingenpagina is, komt er één update-policy bij. Insert en delete
-- blijven dicht: de tabel hoort precies één rij te bevatten.
drop policy if exists instellingen_update on public.instellingen;
create policy instellingen_update
  on public.instellingen for update
  to authenticated
  using (public.is_beheerder())
  with check (public.is_beheerder());

-- updated_at automatisch bijwerken (functie komt uit 003; hier nog eens,
-- zodat dit script ook op zichzelf werkt).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists trg_touch_instellingen on public.instellingen;
create trigger trg_touch_instellingen
  before update on public.instellingen
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 4. Glansstickers uit matches en tellers houden
-- ============================================================
-- Staat toon_glans uit, dan bestaan die stickers voor de app niet: ze duiken
-- ook niet op als ruilkans of in een teller. Anders zou een kind een match
-- zien voor een sticker die het nergens kan vinden.

create or replace function public.get_matches(p_kind_id uuid)
returns table (
  richting     text,
  code         text,
  nummer       integer,
  land_naam    text,
  sticker_naam text,
  ander_kind   text
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
    case when public.beurs_actief() then ak.voornaam end
  from eigen_kind ek
  cross join glans_ok g
  join public.stickers mij   on mij.kind_id = ek.id and mij.status = 'ZOEKT'
  join public.stickers ander on ander.nummer = mij.nummer and ander.status = 'RUILT'
  join public.kinderen ak    on ak.id = ander.kind_id and ak.user_id <> ek.user_id
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
    case when public.beurs_actief() then ak.voornaam end
  from eigen_kind ek
  cross join glans_ok g
  join public.stickers mij   on mij.kind_id = ek.id and mij.status = 'RUILT'
  join public.stickers ander on ander.nummer = mij.nummer and ander.status = 'ZOEKT'
  join public.kinderen ak    on ak.id = ander.kind_id and ak.user_id <> ek.user_id
  join public.sticker_catalogus c on c.code = mij.nummer
  where g.aan or not c.glans

  order by 1, 4, 3, 2;
$fn$;

revoke all on function public.get_matches(uuid) from public;
revoke all on function public.get_matches(uuid) from anon;
grant execute on function public.get_matches(uuid) to authenticated;

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
       join public.stickers a  on a.nummer = s.nummer and a.status = 'RUILT'
       join public.kinderen ak on ak.id = a.kind_id and ak.user_id <> k.user_id
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
-- 5. Optioneel: al ingevoerde glansstickers opruimen  (DESTRUCTIEF)
-- ============================================================
-- Verbergen laat bestaande rijen staan: wie ooit BEL2s invoerde, ziet die nog
-- in zijn lijst. Dat is opzet — er verdwijnt niets buiten je medeweten. Wil je
-- ze echt weg, voer dan deze regel apart uit:
--
--   delete from public.stickers s
--   using public.sticker_catalogus c
--   where c.code = s.nummer and c.glans;
