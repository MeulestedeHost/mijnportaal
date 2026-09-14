-- Panini Ruilportaal — Ruildossiers: meerdere ruilen als één pakket, weigeren,
-- en ruilen met iemand zonder account.
-- Voer dit uit na sql/021_ruiler_letter.sql.
--
-- WAAROM. Aan de ruiltafel gaan er zelden één sticker tegen één over. Tot nu
-- was elke ruil een losse rij (sql/016) die elk apart geregistreerd en elk
-- apart bevestigd moest worden: vier ruilen met Sol waren vier knoppen voor
-- Guus en vier losse afspraken voor Sol. Een DOSSIER bundelt ze.
--
-- WAT NIET VERANDERT.
--   - Elk paar blijft een eigen rij in public.ruilen, met dezelfde controle
--     (klopt de match nog?) en dezelfde unieke index. Een dossier is enkel een
--     label dat die rijen samenhoudt; bestaande ruilen zonder dossier werken
--     gewoon verder (de pagina toont ze als een dossier van één).
--   - Het systeem verplaatst nog steeds GEEN stickers (zie sql/016).
--
-- WAT WEL VERANDERT.
--   1. Wie registreert, bevestigt meteen zijn eigen kant. Registreren gebeurt
--      aan tafel nadat de kaarten van hand wisselden ("Heb je beide kaarten
--      aan elkaar gegeven? Dan is je ruil enkel nog te registreren.") — enkel
--      de andere kant moet nog bevestigen.
--   2. De andere kant kan per ruil bevestigen of WEIGEREN. Een geweigerde ruil
--      wordt niet verwijderd maar gemarkeerd (geen gegevens verliezen) en telt
--      niet meer als openstaand, zodat hetzelfde paar opnieuw geregistreerd kan
--      worden.
--   3. Een EENZIJDIGE ruil: met iemand zonder account. Enkel bij jou vastgelegd
--      en meteen afgerond vanaf jouw kant — er is niemand die kan bevestigen.
--      Een aparte tabel, want public.ruilen verwijst met kind_b naar een
--      bestaand kind en controleert diens lijst; een deelnemer zonder account
--      heeft geen van beide.
--
-- Niet destructief: één kolom-paar en één tabel bij, een index opnieuw
-- aangemaakt met een extra voorwaarde, mijn_ruilen() uitgebreid.

-- ============================================================
-- 1. Dossier en weigering op public.ruilen
-- ============================================================
alter table public.ruilen add column if not exists dossier_id uuid;
alter table public.ruilen add column if not exists geweigerd  timestamptz;

create index if not exists idx_ruilen_dossier on public.ruilen (dossier_id);

-- De index uit sql/016 hield een openstaand paar uniek. Een geweigerd paar is
-- niet meer openstaand: zonder deze extra voorwaarde kon Guus na een weigering
-- datzelfde paar nooit meer registreren.
drop index if exists public.ruilen_uniek_openstaand;
create unique index ruilen_uniek_openstaand
  on public.ruilen (kind_a, kind_b, sticker_a, sticker_b)
  where (bevestigd_a is null or bevestigd_b is null) and geweigerd is null;

-- ============================================================
-- 1b. ruil_registreren(): een geweigerd paar is geen bestaande afspraak
-- ============================================================
-- Zelfde handtekening en controle als in sql/016. Enkel het opzoeken van een
-- bestaande openstaande rij sluit nu geweigerde rijen uit — anders gaf opnieuw
-- registreren na een weigering stil de geweigerde rij terug.
create or replace function public.ruil_registreren(
  p_eigen_kind   uuid,
  p_ander_kind   uuid,
  p_ik_krijg     text,
  p_ander_krijgt text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sleutel   uuid;
  v_a         uuid;
  v_b         uuid;
  v_sticker_a text;
  v_sticker_b text;
  v_id        uuid;
begin
  if auth.uid() is null then
    raise exception 'Niet aangemeld.';
  end if;
  if p_eigen_kind = p_ander_kind then
    raise exception 'Een verzamelaar kan niet met zichzelf ruilen.';
  end if;
  if p_ik_krijg = p_ander_krijgt then
    raise exception 'Beide kanten van de ruil zijn dezelfde sticker.';
  end if;

  v_sleutel := public.gezin_sleutel(auth.uid());
  if public.gezin_van_kind(p_eigen_kind) is distinct from v_sleutel then
    raise exception 'Die verzamelaar hoort niet bij jouw gezin.';
  end if;
  if public.gezin_van_kind(p_ander_kind) is null then
    raise exception 'De andere verzamelaar bestaat niet.';
  end if;

  if not exists (
    select 1 from public.stickers s
    where s.kind_id = p_eigen_kind and s.nummer = p_ik_krijg and s.status = 'ZOEKT'
  ) or not exists (
    select 1 from public.stickers s
    where s.kind_id = p_ander_kind and s.nummer = p_ik_krijg and s.status = 'RUILT'
  ) or not exists (
    select 1 from public.stickers s
    where s.kind_id = p_eigen_kind and s.nummer = p_ander_krijgt and s.status = 'RUILT'
  ) or not exists (
    select 1 from public.stickers s
    where s.kind_id = p_ander_kind and s.nummer = p_ander_krijgt and s.status = 'ZOEKT'
  ) then
    raise exception 'De ruil % ⇄ % klopt niet meer — een van beide lijsten is ondertussen aangepast. Herlaad de pagina.',
      p_ik_krijg, p_ander_krijgt;
  end if;

  if p_eigen_kind < p_ander_kind then
    v_a := p_eigen_kind; v_sticker_a := p_ik_krijg;
    v_b := p_ander_kind; v_sticker_b := p_ander_krijgt;
  else
    v_a := p_ander_kind; v_sticker_a := p_ander_krijgt;
    v_b := p_eigen_kind; v_sticker_b := p_ik_krijg;
  end if;

  select r.id into v_id
  from public.ruilen r
  where r.kind_a = v_a and r.kind_b = v_b
    and r.sticker_a = v_sticker_a and r.sticker_b = v_sticker_b
    and (r.bevestigd_a is null or r.bevestigd_b is null)
    and r.geweigerd is null;
  if found then
    return v_id;
  end if;

  insert into public.ruilen (kind_a, kind_b, sticker_a, sticker_b, aangemaakt_door)
  values (v_a, v_b, v_sticker_a, v_sticker_b, auth.uid())
  returning id into v_id;

  return v_id;
end;
$fn$;

-- ============================================================
-- 2. Een dossier registreren (alles of niets)
-- ============================================================
-- p_paren: [{"ik_krijg": "FRA12", "ander_krijgt": "GER7"}, ...]
--
-- Eén functie = één transactie: klopt één paar niet meer, dan wordt er NIETS
-- geregistreerd. Een half dossier ("twee van de drie staan erin") is aan tafel
-- verwarrender dan een duidelijke fout.
--
-- Per paar hergebruikt dit ruil_registreren() uit sql/016, zodat de controle
-- op de match op één plek blijft staan. Stond het paar al open (bv. omdat Sol
-- het zelf al registreerde), dan komt die bestaande rij terug: ze krijgt geen
-- nieuw dossier, maar jouw kant wordt wel bevestigd — dat is precies "ik
-- bevestig wat Sol registreerde".
create or replace function public.ruil_dossier_registreren(
  p_eigen_kind uuid,
  p_ander_kind uuid,
  p_paren      jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_dossier uuid := gen_random_uuid();
  v_paar    jsonb;
  v_id      uuid;
  v_ruil    public.ruilen%rowtype;
begin
  if jsonb_typeof(p_paren) is distinct from 'array' or jsonb_array_length(p_paren) = 0 then
    raise exception 'Kies minstens één ruil.';
  end if;

  for v_paar in select * from jsonb_array_elements(p_paren) loop
    v_id := public.ruil_registreren(
      p_eigen_kind,
      p_ander_kind,
      v_paar->>'ik_krijg',
      v_paar->>'ander_krijgt'
    );

    update public.ruilen set dossier_id = v_dossier
    where id = v_id and dossier_id is null;

    select * into v_ruil from public.ruilen where id = v_id;
    if v_ruil.kind_a = p_eigen_kind then
      update public.ruilen set bevestigd_a = coalesce(bevestigd_a, now()) where id = v_id;
    else
      update public.ruilen set bevestigd_b = coalesce(bevestigd_b, now()) where id = v_id;
    end if;
  end loop;

  return v_dossier;
end;
$fn$;

revoke all on function public.ruil_dossier_registreren(uuid, uuid, jsonb) from public;
revoke all on function public.ruil_dossier_registreren(uuid, uuid, jsonb) from anon;
grant execute on function public.ruil_dossier_registreren(uuid, uuid, jsonb) to authenticated;

-- ============================================================
-- 3. Bevestigen: een geweigerde ruil kan niet meer bevestigd worden
-- ============================================================
-- Zelfde handtekening en gedrag als in sql/016, met één controle erbij.
create or replace function public.ruil_bevestigen(
  p_ruil_id   uuid,
  p_kind_id   uuid,
  p_bevestigd boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ruil   public.ruilen%rowtype;
  v_moment timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Niet aangemeld.';
  end if;
  if public.gezin_van_kind(p_kind_id) is distinct from public.gezin_sleutel(auth.uid()) then
    raise exception 'Je kan enkel voor je eigen verzamelaar bevestigen.';
  end if;

  select * into v_ruil from public.ruilen where id = p_ruil_id;
  if not found then
    raise exception 'Die ruil bestaat niet.';
  end if;
  if v_ruil.geweigerd is not null then
    raise exception 'Deze ruil werd geweigerd en kan niet meer bevestigd worden.';
  end if;

  v_moment := case when p_bevestigd then now() end;

  if v_ruil.kind_a = p_kind_id then
    update public.ruilen set bevestigd_a = v_moment where id = p_ruil_id;
  elsif v_ruil.kind_b = p_kind_id then
    update public.ruilen set bevestigd_b = v_moment where id = p_ruil_id;
  else
    raise exception 'Die verzamelaar hoort niet bij deze ruil.';
  end if;
end;
$fn$;

-- ============================================================
-- 4. Weigeren (per ruil)
-- ============================================================
-- Een voltooide ruil weiger je niet meer: die is door beide kanten bevestigd.
-- Wie weigert, trekt daarmee ook een eventuele eigen bevestiging in — "ik
-- bevestig én ik weiger" bestaat niet.
create or replace function public.ruil_weigeren(
  p_ruil_id uuid,
  p_kind_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ruil public.ruilen%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Niet aangemeld.';
  end if;
  if public.gezin_van_kind(p_kind_id) is distinct from public.gezin_sleutel(auth.uid()) then
    raise exception 'Je kan enkel voor je eigen verzamelaar weigeren.';
  end if;

  select * into v_ruil from public.ruilen where id = p_ruil_id;
  if not found then
    raise exception 'Die ruil bestaat niet.';
  end if;
  if v_ruil.kind_a <> p_kind_id and v_ruil.kind_b <> p_kind_id then
    raise exception 'Die verzamelaar hoort niet bij deze ruil.';
  end if;
  if v_ruil.bevestigd_a is not null and v_ruil.bevestigd_b is not null then
    raise exception 'Deze ruil is al door beide kanten bevestigd.';
  end if;

  update public.ruilen
  set geweigerd = now(),
      bevestigd_a = case when kind_a = p_kind_id then null else bevestigd_a end,
      bevestigd_b = case when kind_b = p_kind_id then null else bevestigd_b end
  where id = p_ruil_id;
end;
$fn$;

revoke all on function public.ruil_weigeren(uuid, uuid) from public;
revoke all on function public.ruil_weigeren(uuid, uuid) from anon;
grant execute on function public.ruil_weigeren(uuid, uuid) to authenticated;

-- ============================================================
-- 5. mijn_ruilen(): dossier, weigering en wie registreerde
-- ============================================================
-- Drie kolommen erbij tegenover sql/016:
--   dossier_id           — null bij ruilen van vóór deze migratie
--   geweigerd            — wanneer (en dus of) er geweigerd werd
--   door_eigen_gezin     — registreerde jouw gezin dit? Daarmee weet de pagina
--                          of dit in "Te bevestigen" hoort (de ander
--                          registreerde) of bij "wacht op de ander".
-- En een status erbij: GEWEIGERD.
drop function if exists public.mijn_ruilen();

create function public.mijn_ruilen()
returns table (
  id                uuid,
  aangemaakt        timestamptz,
  dossier_id        uuid,
  eigen_kind_id     uuid,
  eigen_kind        text,
  eigen_krijgt      text,
  eigen_krijgt_naam text,
  eigen_krijgt_land text,
  eigen_bevestigd   timestamptz,
  ander_kind_id     uuid,
  ander_kind        text,
  ander_krijgt      text,
  ander_krijgt_naam text,
  ander_krijgt_land text,
  ander_bevestigd   timestamptz,
  eigen_gezin       boolean,
  door_eigen_gezin  boolean,
  geweigerd         timestamptz,
  status            text
)
language sql
security definer
stable
set search_path = ''
as $fn$
  with sleutel as (
    select public.gezin_sleutel(auth.uid()) as id
    where auth.uid() is not null
  ),
  gedraaid as (
    select
      r.id,
      r.created_at,
      r.dossier_id,
      (public.gezin_van_kind(r.kind_a) = s.id) as ik_ben_a,
      r.kind_a, r.kind_b, r.sticker_a, r.sticker_b, r.bevestigd_a, r.bevestigd_b,
      r.geweigerd,
      (r.aangemaakt_door is not null and public.gezin_sleutel(r.aangemaakt_door) = s.id) as door_eigen
    from public.ruilen r
    cross join sleutel s
    where public.gezin_van_kind(r.kind_a) = s.id
       or public.gezin_van_kind(r.kind_b) = s.id
  )
  select
    g.id,
    g.created_at,
    g.dossier_id,
    case when g.ik_ben_a then g.kind_a else g.kind_b end,
    (select k.voornaam from public.kinderen k
      where k.id = case when g.ik_ben_a then g.kind_a else g.kind_b end),
    case when g.ik_ben_a then g.sticker_a else g.sticker_b end,
    (select c.naam from public.sticker_catalogus c
      where c.code = case when g.ik_ben_a then g.sticker_a else g.sticker_b end),
    (select c.land_code from public.sticker_catalogus c
      where c.code = case when g.ik_ben_a then g.sticker_a else g.sticker_b end),
    case when g.ik_ben_a then g.bevestigd_a else g.bevestigd_b end,
    case when g.ik_ben_a then g.kind_b else g.kind_a end,
    (select k.voornaam from public.kinderen k
      where k.id = case when g.ik_ben_a then g.kind_b else g.kind_a end),
    case when g.ik_ben_a then g.sticker_b else g.sticker_a end,
    (select c.naam from public.sticker_catalogus c
      where c.code = case when g.ik_ben_a then g.sticker_b else g.sticker_a end),
    (select c.land_code from public.sticker_catalogus c
      where c.code = case when g.ik_ben_a then g.sticker_b else g.sticker_a end),
    case when g.ik_ben_a then g.bevestigd_b else g.bevestigd_a end,
    public.gezin_van_kind(g.kind_a) = public.gezin_van_kind(g.kind_b),
    g.door_eigen,
    g.geweigerd,
    case
      when g.geweigerd is not null then 'GEWEIGERD'
      when g.bevestigd_a is not null and g.bevestigd_b is not null then 'VOLTOOID'
      else 'GEREGISTREERD'
    end
  from gedraaid g
  order by g.created_at desc;
$fn$;

revoke all on function public.mijn_ruilen() from public;
revoke all on function public.mijn_ruilen() from anon;
grant execute on function public.mijn_ruilen() to authenticated;

-- ============================================================
-- 6. Opvolging: GEWEIGERD apart tonen
-- ============================================================
create or replace function public.ruil_overzicht()
returns table (
  id           uuid,
  aangemaakt   timestamptz,
  kind_a       text,
  sticker_a    text,
  bevestigd_a  timestamptz,
  kind_b       text,
  sticker_b    text,
  bevestigd_b  timestamptz,
  zelfde_gezin boolean,
  status       text,
  dagen_open   integer
)
language sql
security definer
stable
set search_path = ''
as $fn$
  select
    r.id,
    r.created_at,
    ka.voornaam,
    r.sticker_a,
    r.bevestigd_a,
    kb.voornaam,
    r.sticker_b,
    r.bevestigd_b,
    public.gezin_van_kind(r.kind_a) = public.gezin_van_kind(r.kind_b),
    case
      when r.geweigerd is not null then 'GEWEIGERD'
      when r.bevestigd_a is not null and r.bevestigd_b is not null then 'VOLTOOID'
      when r.bevestigd_a is not null or  r.bevestigd_b is not null then 'HALF'
      else 'GEREGISTREERD'
    end,
    extract(day from now() - r.created_at)::int
  from public.ruilen r
  join public.kinderen ka on ka.id = r.kind_a
  join public.kinderen kb on kb.id = r.kind_b
  where public.is_beheerder()
  order by r.created_at desc;
$fn$;

-- ============================================================
-- 7. Eenzijdige ruilen (tegenpartij zonder account)
-- ============================================================
-- Gewone tabel met RLS, zonder security definer-functies: er valt niets te
-- controleren bij een ander gezin, dus volstaat "enkel voor je eigen kind".
-- tegenpartij is vrije tekst ("Jan Peeters") — geen account, geen kind-rij.
create table if not exists public.eenzijdige_ruilen (
  id           uuid primary key default gen_random_uuid(),
  kind_id      uuid not null references public.kinderen(id) on delete cascade,
  dossier_id   uuid not null,
  tegenpartij  text not null check (length(trim(tegenpartij)) > 0),
  ik_krijg     text not null,
  ik_geef      text not null,
  aangemaakt_door uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.eenzijdige_ruilen is
  'Ruilen met iemand zonder account. Enkel de eigen kant, meteen afgerond.
   Verandert NOOIT iets aan public.stickers.';

create index if not exists idx_eenzijdige_ruilen_kind on public.eenzijdige_ruilen (kind_id);

alter table public.eenzijdige_ruilen enable row level security;

drop policy if exists eenzijdige_ruilen_select on public.eenzijdige_ruilen;
create policy eenzijdige_ruilen_select
  on public.eenzijdige_ruilen for select
  using (auth.uid() is not null and public.gezin_van_kind(kind_id) = public.gezin_sleutel(auth.uid()));

drop policy if exists eenzijdige_ruilen_insert on public.eenzijdige_ruilen;
create policy eenzijdige_ruilen_insert
  on public.eenzijdige_ruilen for insert
  with check (auth.uid() is not null and public.gezin_van_kind(kind_id) = public.gezin_sleutel(auth.uid()));

drop policy if exists eenzijdige_ruilen_delete on public.eenzijdige_ruilen;
create policy eenzijdige_ruilen_delete
  on public.eenzijdige_ruilen for delete
  using (auth.uid() is not null and public.gezin_van_kind(kind_id) = public.gezin_sleutel(auth.uid()));

grant select, insert, delete on public.eenzijdige_ruilen to authenticated;

-- ============================================================
-- Snelle controle
-- ============================================================
-- 1) Een dossier van twee ruilen registreren:
--      select public.ruil_dossier_registreren('<eigen-kind>', '<ander-kind>',
--        '[{"ik_krijg":"BEL3","ander_krijgt":"GER15"},{"ik_krijg":"FRA12","ander_krijgt":"BEL1"}]');
--    -- verwacht: één uuid; beide rijen hebben dat dossier_id en jouw kant bevestigd.
--
-- 2) Klopt één paar niet, dan staat er niets:
--      select count(*) from public.ruilen where dossier_id = '<uuid uit een mislukte poging>';
--    -- verwacht: 0 (de hele aanroep werd teruggedraaid).
--
-- 3) Weigeren door de andere kant, en opnieuw registreren mag:
--      select public.ruil_weigeren('<ruil-uuid>', '<ander-kind>');
--      select status from public.mijn_ruilen() where id = '<ruil-uuid>';  -- GEWEIGERD
