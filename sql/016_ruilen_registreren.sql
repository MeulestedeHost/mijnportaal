-- Panini Ruilportaal — Ruilen registreren, bevestigen en opvolgen
-- Voer dit uit na sql/015_wijk_en_altijd_naam.sql.
--
-- WAT DIT TOEVOEGT. Tot nu toonde de ruilpagina enkel wie wat had: het
-- afspreken en het ruilen zelf gebeurde daarbuiten, en niemand kon achteraf
-- nog zien wat er effectief geruild werd. Vanaf nu kunnen twee verzamelaars
-- een ruil REGISTREREN (ik geef jou deze, jij geeft mij die) en die elk apart
-- BEVESTIGEN zodra ze effectief van hand gewisseld is.
--
-- WAT DIT BEWUST NIET DOET. Het systeem verplaatst of verwijdert GEEN
-- stickers. Een geregistreerde of zelfs voltooide ruil raakt public.stickers
-- niet aan: 'zoek ik' en 'heb ik dubbel' blijven exact staan zoals het kind
-- ze zelf zette. Elke verzamelaar beheert zijn eigen collectie — het portaal
-- houdt enkel bij wat er is afgesproken. Dat is een uitdrukkelijke keuze: een
-- automatisch bijgewerkte lijst die niet klopt met de map thuis is erger dan
-- geen lijst, en op een ruilbeurs gaat er altijd wel iets anders dan gepland.
--
-- BEVESTIGEN GEBEURT PER KANT. Elke ruil heeft twee kanten en elke kant
-- bevestigt voor zichzelf. Bevestigt Valentijn, dan verandert er niets aan wat
-- Ivo ziet staan — enkel Valentijns eigen betrokken stickers krijgen op zijn
-- scherm een markering ("volgens jou is deze geruild, kijk je collectie na").
-- Pas als beide kanten bevestigd hebben, is de ruil voltooid. Ook dan blijft
-- ze in de historiek staan.
--
-- Niet destructief: één tabel bij, vijf functies bij, en get_matches krijgt
-- twee kolommen extra (drop+create, want Postgres kan de kolomlijst van een
-- functie niet via create or replace wijzigen).

-- ============================================================
-- 1. Hulpfunctie: bij welk gezin hoort dit kind?
-- ============================================================
-- Nodig omdat een ruil per definitie twee gezinnen raakt: om te beoordelen of
-- jij aan deze ruil mag komen, moet er gekeken worden naar een kind dat NIET
-- van jou is — en public.kinderen laat je via RLS enkel je eigen rijen zien.
-- security definer stapt daaroverheen, maar geeft niets prijs: het antwoord
-- is een gezins-uuid, geen naam en geen contactgegeven.
create or replace function public.gezin_van_kind(p_kind_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.gezin_sleutel(k.user_id)
  from public.kinderen k
  where k.id = p_kind_id;
$fn$;

revoke all on function public.gezin_van_kind(uuid) from public;
revoke all on function public.gezin_van_kind(uuid) from anon;
grant execute on function public.gezin_van_kind(uuid) to authenticated;

-- ============================================================
-- 2. De tabel
-- ============================================================
-- kind_a/kind_b zijn de twee verzamelaars, sticker_a/sticker_b wat ze elk
-- ONTVANGEN. sticker_a hoort dus bij kind_a: "kind_a krijgt sticker_a van
-- kind_b". Wie de ruil registreerde staat apart in aangemaakt_door — dat is
-- geen kant, enkel herkomst.
--
-- WAAROM kind_a ALTIJD DE KLEINSTE UUID IS. Dezelfde ruil kan door beide
-- kanten geregistreerd worden. Zonder vaste volgorde staat hij dan twee keer
-- in de tabel, één keer gespiegeld, en telt het overzicht dubbel. De functie
-- ruil_registreren() hieronder draait het paar daarom altijd in dezelfde
-- volgorde vóór het wegschrijven; de unieke index kan zo zijn werk doen.
create table if not exists public.ruilen (
  id              uuid primary key default gen_random_uuid(),
  kind_a          uuid not null references public.kinderen(id) on delete cascade,
  kind_b          uuid not null references public.kinderen(id) on delete cascade,
  sticker_a       text not null,
  sticker_b       text not null,
  bevestigd_a     timestamptz,
  bevestigd_b     timestamptz,
  aangemaakt_door uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint ruil_kanonieke_volgorde check (kind_a < kind_b)
);

comment on table public.ruilen is
  'Geregistreerde ruilafspraken. Verandert NOOIT iets aan public.stickers — elke
   verzamelaar beheert zijn eigen collectie, dit is enkel de afspraak erover.';

create index if not exists idx_ruilen_kind_a on public.ruilen (kind_a);
create index if not exists idx_ruilen_kind_b on public.ruilen (kind_b);

-- Eenzelfde openstaande afspraak niet twee keer. Voltooide ruilen vallen
-- buiten de index: dezelfde twee stickers een tweede keer ruilen mag, dat is
-- een nieuwe afspraak.
create unique index if not exists ruilen_uniek_openstaand
  on public.ruilen (kind_a, kind_b, sticker_a, sticker_b)
  where bevestigd_a is null or bevestigd_b is null;

alter table public.ruilen enable row level security;

-- Lezen mag wie aan één van beide kanten zit. Schrijven gebeurt uitsluitend
-- via de functies hieronder (security definer), want die controleren méér dan
-- een policy kan: bestaat de match wel, en klopt de richting.
drop policy if exists ruilen_select on public.ruilen;
create policy ruilen_select
  on public.ruilen for select
  using (
    auth.uid() is not null
    and (
      public.gezin_van_kind(kind_a) = public.gezin_sleutel(auth.uid())
      or public.gezin_van_kind(kind_b) = public.gezin_sleutel(auth.uid())
    )
  );

-- ============================================================
-- 3. get_matches(): kind-id van de tegenpartij + paginanummer
-- ============================================================
-- Twee kolommen erbij tegenover sql/015, de rest is ongewijzigd:
--
--   ander_kind_id — nodig om de ruilpagina per RUILER te kunnen groeperen en
--                   om een ruil aan een concrete tegenpartij te hangen. Een
--                   uuid verklapt niets: naam, wijk, e-mail en telefoon
--                   blijven exact even streng geregeld als voordien.
--   pagina        — het paginanummer uit het album, zodat de ruilpagina de
--                   landen in albumvolgorde kan zetten zonder daarvoor de
--                   hele catalogus te moeten ophalen.
--
-- LET OP — GEVOLG VOOR DE UNION. De union (niet union all) liet tot nu twee
-- kinderen van hetzelfde gezin met dezelfde sticker samenvallen tot één
-- regel. Met ander_kind_id erbij verschillen die rijen en blijven ze apart
-- staan. Dat is precies de bedoeling: je wil zien mét wie je kan ruilen, niet
-- dát er iemand is.
drop function if exists public.get_matches(uuid);

create function public.get_matches(p_kind_id uuid)
returns table (
  richting       text,
  code           text,
  nummer         integer,
  land_code      text,
  land_naam      text,
  land_naam_en   text,
  pagina         integer,
  sticker_naam   text,
  aantal         integer,
  ander_kind_id  uuid,
  ander_kind     text,
  eigen_gezin    boolean,
  ander_wijk     text,
  ander_email    text,
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
    c.pagina,
    c.naam,
    ander.aantal,
    ak.id,
    ak.voornaam,
    public.gezin_sleutel(ak.user_id) = ek.sleutel,
    case
      when public.gezin_sleutel(ak.user_id) <> ek.sleutel
      then (select nullif(g2.wijk, '') from public.gezinnen g2
             where g2.id = public.gezin_sleutel(ak.user_id))
    end,
    case
      when public.gezin_sleutel(ak.user_id) <> ek.sleutel and public.beurs_voorbij()
      then (select nullif(l.email, '') from public.gezin_leden l
             where l.user_id = ak.user_id)
    end,
    case
      when public.gezin_sleutel(ak.user_id) <> ek.sleutel and public.beurs_voorbij()
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

  union

  -- Jij hebt deze sticker dubbel, iemand anders zoekt ze
  select
    'jij_hebt_dubbel'::text,
    c.code,
    c.nummer,
    c.land_code,
    c.land_naam,
    c.land_naam_en,
    c.pagina,
    c.naam,
    mij.aantal,
    ak.id,
    ak.voornaam,
    public.gezin_sleutel(ak.user_id) = ek.sleutel,
    case
      when public.gezin_sleutel(ak.user_id) <> ek.sleutel
      then (select nullif(g2.wijk, '') from public.gezinnen g2
             where g2.id = public.gezin_sleutel(ak.user_id))
    end,
    case
      when public.gezin_sleutel(ak.user_id) <> ek.sleutel and public.beurs_voorbij()
      then (select nullif(l.email, '') from public.gezin_leden l
             where l.user_id = ak.user_id)
    end,
    case
      when public.gezin_sleutel(ak.user_id) <> ek.sleutel and public.beurs_voorbij()
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
-- 4. Een ruil registreren
-- ============================================================
-- Wordt aangeroepen vanuit het venster "Ruil registreren". p_ik_krijg is de
-- sticker die JOUW verzamelaar ontvangt, p_ander_krijgt die van de ander.
--
-- WAAROM DE MATCH HIER OPNIEUW GECONTROLEERD WORDT. De pagina toont enkel
-- echte matches, maar tussen het laden van die pagina en het klikken op de
-- knop kan een van beide kinderen zijn lijst aangepast hebben. Een afspraak
-- vastleggen die op dat moment nergens meer op slaat, levert een historiek op
-- waar niemand nog wijs uit raakt. Klopt de richting niet meer, dan zegt de
-- functie dat met zoveel woorden in plaats van stilletjes iets weg te
-- schrijven.
--
-- Bestaat dezelfde openstaande afspraak al, dan wordt ze niet verdubbeld maar
-- gewoon teruggegeven: twee keer op de knop duwen mag geen twee ruilen maken.
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

  -- Klopt de ruil nog? Jij zoekt wat je krijgt en de ander heeft het dubbel;
  -- omgekeerd voor de andere kant.
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
    raise exception 'Deze ruil klopt niet meer — een van beide lijsten is ondertussen aangepast. Herlaad de pagina.';
  end if;

  -- Altijd dezelfde kant boven, zodat dezelfde afspraak van beide kanten
  -- dezelfde rij oplevert.
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
    and (r.bevestigd_a is null or r.bevestigd_b is null);
  if found then
    return v_id;
  end if;

  insert into public.ruilen (kind_a, kind_b, sticker_a, sticker_b, aangemaakt_door)
  values (v_a, v_b, v_sticker_a, v_sticker_b, auth.uid())
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.ruil_registreren(uuid, uuid, text, text) from public;
revoke all on function public.ruil_registreren(uuid, uuid, text, text) from anon;
grant execute on function public.ruil_registreren(uuid, uuid, text, text) to authenticated;

-- ============================================================
-- 5. Een kant bevestigen (of die bevestiging weer intrekken)
-- ============================================================
-- p_kind_id zegt vóór welke kant je bevestigt. Dat moet expliciet, want bij
-- een ruil tussen twee kinderen van hetzelfde gezin zitten beide kanten bij
-- jou en is "jouw kant" anders niet te bepalen.
--
-- Intrekken mag: wie per ongeluk bevestigt, moet dat kunnen rechtzetten. De
-- andere kant blijft daarbij onaangeroerd.
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

revoke all on function public.ruil_bevestigen(uuid, uuid, boolean) from public;
revoke all on function public.ruil_bevestigen(uuid, uuid, boolean) from anon;
grant execute on function public.ruil_bevestigen(uuid, uuid, boolean) to authenticated;

-- ============================================================
-- 6. Mijn ruilen ophalen
-- ============================================================
-- Draait elke rij zo dat "eigen" altijd de kant van jouw gezin is, ongeacht of
-- die als a of als b in de tabel staat. De pagina hoeft dan niet zelf te
-- puzzelen welke kant van haar is.
--
-- Zit je aan beide kanten (twee kinderen van hetzelfde gezin), dan komt de rij
-- één keer terug met eigen_gezin = true; de pagina toont dan voor allebei een
-- bevestigknop.
create or replace function public.mijn_ruilen()
returns table (
  id                uuid,
  aangemaakt        timestamptz,
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
      -- Ben ik kant a, of kant b? Bij een ruil binnen het eigen gezin zijn
      -- beide kanten van mij; dan geldt a als "eigen".
      (public.gezin_van_kind(r.kind_a) = s.id) as ik_ben_a,
      r.kind_a, r.kind_b, r.sticker_a, r.sticker_b, r.bevestigd_a, r.bevestigd_b
    from public.ruilen r
    cross join sleutel s
    where public.gezin_van_kind(r.kind_a) = s.id
       or public.gezin_van_kind(r.kind_b) = s.id
  )
  select
    g.id,
    g.created_at,
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
    case
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
-- 7. Overzicht voor de organisatie
-- ============================================================
-- Enkel voor wie in public.beheerders staat (sql/007). Zonder dat recht komt
-- er geen enkele rij terug — geen foutmelding maar ook geen gegevens, want
-- hier passeren namen van álle deelnemende kinderen.
--
-- Bedoeld om op te volgen welke ruilen nog niet rond zijn: wie heeft al
-- bevestigd, wie nog niet, en hoe lang staat een afspraak al open.
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

revoke all on function public.ruil_overzicht() from public;
revoke all on function public.ruil_overzicht() from anon;
grant execute on function public.ruil_overzicht() to authenticated;

-- ============================================================
-- Snelle controle
-- ============================================================
-- 1) get_matches geeft nu ander_kind_id en pagina terug:
--      select richting, code, pagina, ander_kind_id, ander_kind
--        from public.get_matches('<kind-uuid>') limit 5;
--
-- 2) Een ruil registreren (als de match echt bestaat):
--      select public.ruil_registreren('<eigen-kind>', '<ander-kind>', 'BEL3', 'IVO5');
--
-- 3) Je eigen kant bevestigen, en nakijken dat de status meegaat:
--      select public.ruil_bevestigen('<ruil-uuid>', '<eigen-kind>', true);
--      select status, eigen_bevestigd, ander_bevestigd from public.mijn_ruilen();
--    -- verwacht: GEREGISTREERD zolang de andere kant nog niet bevestigde.
--
-- 4) Controleer dat er GEEN stickers verdwenen zijn (dat hoort ook zo):
--      select count(*) from public.stickers;
--    -- moet exact gelijk zijn aan vóór het registreren.
