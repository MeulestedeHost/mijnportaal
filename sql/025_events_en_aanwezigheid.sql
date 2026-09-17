-- Panini Ruilportaal — Events en aanwezigheid
-- Voer dit uit na sql/024_kaart_zoomdrempel.sql.
--
-- WAAROM. Tot nu was er één ruilbeurs: twee kolommen op de singleton-rij van
-- public.instellingen (beurs_start/beurs_einde), en verder niets. Er komen er
-- meer — 06/09/2026 is geweest, 11/10/2026 staat klaar — en niet elke
-- verzamelaar komt naar elke beurs. Wie thuis blijft, hoort niet in de
-- ruilplanner van iemand die wél gaat: dan loop je op de beursdag achter namen
-- aan die er niet zijn.
--
-- DRIE FASES, EN ZE VOLGEN ALLE DRIE UIT DE KALENDER. De organisator zet geen
-- schakelaar om; er is enkel een lijst events en één getal (hoeveel dagen op
-- voorhand de filter aangaat).
--
--   'open'    — geen event in zicht. Iedereen zichtbaar, zoals het hele jaar
--               door. Contactgegevens zichtbaar zodra er ooit een beurs
--               afgelopen is (sql/014).
--   'voor'    — vanaf filter_dagen_vooraf dagen vóór de start tot de start.
--               Enkel verzamelaars waarvan de ouder "we komen" aanduidde.
--   'tijdens' — van start tot einde. Enkel wie aan de deur aangemeld is.
--
-- Na het einde van een event valt alles terug op 'open': iedereen doet weer
-- mee en de contactgegevens komen terug. Dat blijft zo tot de aanloop naar het
-- volgende event begint. Zichtbaarheid van personen en zichtbaarheid van
-- contactgegevens lopen dus gelijk — één begrip, geen tweede kalender.
--
-- WAT ER NIET GEFILTERD WORDT, EN WAAROM:
--   * je eigen gezin — broer en zus ruilen thuis, niet op de beurs (sql/008).
--   * je eigen verzamelaar — wie zelf niets aanduidde, krijgt geen lege pagina
--     zonder uitleg, maar de gewone lijst plus een melding. Enkel de
--     TEGENPARTIJ wordt weggelaten.
--   * mijn_ruilen() en ruil_overzicht() — een lopende afspraak met iemand die
--     niet komt, moet je nog altijd kunnen bevestigen of weigeren.
--   * ruil_registreren() — controleert de lijsten, niet de aanwezigheid. Wie
--     aan tafel staat maar nog niet afgevinkt is, kan gewoon ruilen.
--     Aanwezigheid stuurt WIE JE VOORGESTELD KRIJGT, niet wat mag.
--   * favorieten — die blijven staan. Een ruiler die er even niet is, verdwijnt
--     uit beeld en komt na de beurs vanzelf terug.
--
-- Niet destructief: er verdwijnt geen kolom en geen rij. Het bestaande venster
-- op public.instellingen wordt overgezet als eerste event en blijft daarna
-- ongebruikt staan.

-- ============================================================
-- 1. Hoeveel dagen op voorhand gaat de filter aan?
-- ============================================================
-- Eén getal voor de hele beurs, niet per event: de organisator stelt dit één
-- keer in en het geldt voor elke editie. De keuzes staan vast (7/14/21/30) —
-- een vrij getal nodigt uit tot 1 of 365, en allebei breken ze het portaal op
-- een manier die pas weken later opvalt.
alter table public.instellingen
  add column if not exists filter_dagen_vooraf smallint not null default 14;

alter table public.instellingen
  drop constraint if exists instellingen_filter_dagen_check;
alter table public.instellingen
  add constraint instellingen_filter_dagen_check
  check (filter_dagen_vooraf in (7, 14, 21, 30));

comment on column public.instellingen.filter_dagen_vooraf is
  'Zoveel dagen vóór de start van een event tonen de ruilmodules enkel nog
   verzamelaars die aangeduid hebben dat ze komen, en verdwijnen e-mail en
   WhatsApp. Zie public.huidig_event().';

-- ============================================================
-- 2. De events
-- ============================================================
-- Één rij per beursdag. De historiek zit in deze tabel: een event verdwijnt
-- niet als het voorbij is, het schuift gewoon naar achteren in de lijst.
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  naam       text not null,
  start      timestamptz not null,
  einde      timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint event_venster_geldig check (einde > start)
);

create index if not exists idx_events_start on public.events (start);

-- Het venster dat nu op public.instellingen staat, wordt het eerste event: wat
-- er ingesteld staat, gaat niet verloren.
--
-- LET OP — DE BEURS VAN 6 SEPTEMBER STAAT DAAR NIET MEER IN. Er was maar één
-- venster, en dat is intussen naar 11 oktober verzet. Wil je die eerste editie
-- in de historiek, voeg ze er dan zelf bij (hier, of op instellingen.html):
--
--   insert into public.events (naam, start, einde)
--   values ('Ruilbeurs 06/09/2026',
--           timestamp '2026-09-06 14:00' at time zone 'Europe/Brussels',
--           timestamp '2026-09-06 17:00' at time zone 'Europe/Brussels');
--
-- Wie er toen was, is nergens vastgelegd — dat systeem bestond nog niet. De rij
-- is dus een lege kolom in het overzicht, tenzij je ze met de hand aanvult.
insert into public.events (naam, start, einde)
select 'Ruilbeurs ' || to_char(i.beurs_start at time zone 'Europe/Brussels', 'DD/MM/YYYY'),
       i.beurs_start, i.beurs_einde
from public.instellingen i
where i.id = 1
  and not exists (select 1 from public.events);

alter table public.events enable row level security;

-- Wanneer de beurs doorgaat is geen geheim: elke ingelogde gebruiker leest de
-- lijst. De startpagina (niet ingelogd) gaat via public.beurs_info().
drop policy if exists events_select on public.events;
create policy events_select
  on public.events for select
  to authenticated
  using (true);

-- Beheren doet enkel een beheerder — zelfde lijn als public.instellingen
-- (sql/007), maar hier mét insert en delete: een event bijmaken hoort bij de
-- beheerpagina, een singleton-rij bijmaken niet.
drop policy if exists events_insert on public.events;
create policy events_insert
  on public.events for insert
  to authenticated
  with check (public.is_beheerder());

drop policy if exists events_update on public.events;
create policy events_update
  on public.events for update
  to authenticated
  using (public.is_beheerder())
  with check (public.is_beheerder());

drop policy if exists events_delete on public.events;
create policy events_delete
  on public.events for delete
  to authenticated
  using (public.is_beheerder());

drop trigger if exists trg_touch_events on public.events;
create trigger trg_touch_events
  before update on public.events
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 3. De aanwezigheden
-- ============================================================
-- TWEE TIJDSTEMPELS IN PLAATS VAN TWEE VINKJES. 'komt' is een keuze van de
-- ouder en mag heen en weer; 'aangemeld_op' is een gebeurtenis aan de deur, en
-- dan wil je ook weten wanneer. Afvinken zet hem terug op null.
--
-- HISTORIEK OVERLEEFT EEN VERWIJDERDE VERZAMELAAR. kind_id gaat bij het
-- verwijderen van een kind op null (geen cascade zoals bij stickers): de rij
-- blijft staan zonder naam, zodat "hoeveel kinderen waren er op 06/09" ook
-- volgend jaar nog klopt. Wie weg is, is weg — geteld wordt hij nog.
create table if not exists public.aanwezigheden (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events(id) on delete cascade,
  kind_id        uuid references public.kinderen(id) on delete set null,
  komt           boolean not null default false,
  komt_op        timestamptz,
  aangemeld_op   timestamptz,
  aangemeld_door uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Partieel: één rij per verzamelaar per event, maar geanonimiseerde rijen
-- (kind_id null) mogen met meerdere naast elkaar bestaan.
create unique index if not exists idx_aanwezig_uniek
  on public.aanwezigheden (event_id, kind_id) where kind_id is not null;
create index if not exists idx_aanwezig_event on public.aanwezigheden (event_id);
create index if not exists idx_aanwezig_kind  on public.aanwezigheden (kind_id);

alter table public.aanwezigheden enable row level security;

-- Lezen mag je voor je eigen gezin. Een beheerder leest alles, maar via
-- public.aanwezigheden_overzicht() — dat scheelt hem de RLS-omweg en levert
-- meteen de namen erbij.
drop policy if exists aanwezigheden_select on public.aanwezigheden;
create policy aanwezigheden_select
  on public.aanwezigheden for select
  to authenticated
  using (
    kind_id is not null
    and public.gezin_van_kind(kind_id) = public.gezin_sleutel(auth.uid())
  );

-- BEWUST geen insert/update/delete-policy, net als bij public.ruilen
-- (sql/016): schrijven loopt via de twee functies hieronder. Een policy kan
-- niet uit elkaar houden wie 'komt' zet (de ouder) en wie 'aangemeld_op' zet
-- (de organisatie) — dat is een kolomverschil, en RLS werkt per rij.

-- ============================================================
-- 4. In welke fase zitten we?
-- ============================================================
-- Geeft altijd precies één rij terug, ook als er nog geen enkel event bestaat
-- (dan staan de kolommen op null en is de fase 'open'). Zo hoeft geen enkele
-- oproeper een leeg resultaat af te handelen.
create or replace function public.huidig_event()
returns table (
  id           uuid,
  naam         text,
  start        timestamptz,
  einde        timestamptz,
  filter_vanaf timestamptz,
  fase         text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with dagen as (
    select coalesce(
      (select i.filter_dagen_vooraf from public.instellingen i where i.id = 1), 14
    ) as n
  ),
  bezig as (
    select e.id, e.naam, e.start, e.einde from public.events e
    where now() >= e.start and now() < e.einde
    order by e.start limit 1
  ),
  komend as (
    select e.id, e.naam, e.start, e.einde from public.events e
    where e.start > now()
    order by e.start limit 1
  ),
  voorbij as (
    select e.id, e.naam, e.start, e.einde from public.events e
    where e.einde <= now()
    order by e.einde desc limit 1
  ),
  gekozen as (
    select b.id, b.naam, b.start, b.einde, 'tijdens'::text as fase from bezig b
    union all
    select k.id, k.naam, k.start, k.einde,
           case when now() >= k.start - (select d.n from dagen d) * interval '1 day'
                then 'voor' else 'open' end
      from komend k
     where not exists (select 1 from bezig)
    union all
    select v.id, v.naam, v.start, v.einde, 'open'::text
      from voorbij v
     where not exists (select 1 from bezig) and not exists (select 1 from komend)
    union all
    select null::uuid, null::text, null::timestamptz, null::timestamptz, 'open'::text
     where not exists (select 1 from public.events)
  )
  select g.id, g.naam, g.start, g.einde,
         g.start - (select d.n from dagen d) * interval '1 day',
         g.fase
  from gekozen g;
$fn$;

revoke all on function public.huidig_event() from public;
revoke all on function public.huidig_event() from anon;
grant execute on function public.huidig_event() to authenticated;

-- beurs_actief() en beurs_voorbij() kijken vanaf nu naar public.events in
-- plaats van naar de twee kolommen op public.instellingen. De betekenis van
-- beurs_actief() blijft gelijk; die van beurs_voorbij() verandert wél, zie de
-- kop van dit bestand: contactgegevens verdwijnen opnieuw zodra de aanloop
-- naar het volgende event begint, en komen terug zodra dat event gedaan is.
create or replace function public.beurs_actief()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.events e where now() >= e.start and now() < e.einde
  );
$fn$;

revoke all on function public.beurs_actief() from public;
revoke all on function public.beurs_actief() from anon;
grant execute on function public.beurs_actief() to authenticated;

create or replace function public.beurs_voorbij()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select (select h.fase from public.huidig_event() h) = 'open'
     and exists (select 1 from public.events e where e.einde <= now());
$fn$;

revoke all on function public.beurs_voorbij() from public;
revoke all on function public.beurs_voorbij() from anon;
grant execute on function public.beurs_voorbij() to authenticated;

-- ============================================================
-- 5. Wat de startpagina mag weten (niet ingelogd)
-- ============================================================
-- index.html draait met de anon-sleutel en mag public.events dus niet lezen.
-- Deze functie geeft enkel wat er op de affiche staat: naam, datum, uur, de
-- fase en het aantal dagen dat de filter vooraf aangaat. Geen enkel gegeven
-- over een deelnemer.
create or replace function public.beurs_info()
returns table (
  naam                text,
  start               timestamptz,
  einde               timestamptz,
  fase                text,
  filter_vanaf        timestamptz,
  filter_dagen_vooraf smallint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select h.naam, h.start, h.einde, h.fase, h.filter_vanaf,
         coalesce((select i.filter_dagen_vooraf from public.instellingen i where i.id = 1), 14::smallint)
  from public.huidig_event() h;
$fn$;

revoke all on function public.beurs_info() from public;
grant execute on function public.beurs_info() to anon;
grant execute on function public.beurs_info() to authenticated;

-- ============================================================
-- 6. Aanduiden dat je komt (de ouder)
-- ============================================================
create or replace function public.aanwezigheid_zetten(
  p_kind_id  uuid,
  p_event_id uuid,
  p_komt     boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Niet aangemeld.';
  end if;
  if public.gezin_van_kind(p_kind_id) is distinct from public.gezin_sleutel(auth.uid()) then
    raise exception 'Die verzamelaar hoort niet bij jouw gezin.';
  end if;
  -- Een voorbije beurs ligt vast: daar verandert een ouder niets meer aan.
  if not exists (select 1 from public.events e where e.id = p_event_id and e.einde > now()) then
    raise exception 'Die ruilbeurs is voorbij.';
  end if;

  update public.aanwezigheden a
     set komt    = p_komt,
         komt_op = case when p_komt then coalesce(a.komt_op, now()) end
   where a.event_id = p_event_id and a.kind_id = p_kind_id;

  if not found then
    insert into public.aanwezigheden (event_id, kind_id, komt, komt_op)
    values (p_event_id, p_kind_id, p_komt, case when p_komt then now() end);
  end if;
end;
$fn$;

revoke all on function public.aanwezigheid_zetten(uuid, uuid, boolean) from public;
revoke all on function public.aanwezigheid_zetten(uuid, uuid, boolean) from anon;
grant execute on function public.aanwezigheid_zetten(uuid, uuid, boolean) to authenticated;

-- ============================================================
-- 7. Afvinken aan de deur (de organisatie)
-- ============================================================
-- Aanmelden zet 'komt' mee op true: wie binnenstapt, komt. Andersom niet — het
-- vinkje uithalen betekent "toch niet binnengekomen", niet "komt niet".
create or replace function public.aanmelden_zetten(
  p_kind_id   uuid,
  p_event_id  uuid,
  p_aangemeld boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_beheerder() then
    raise exception 'Enkel de organisatie kan verzamelaars aanmelden.';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Dat event bestaat niet.';
  end if;
  if not exists (select 1 from public.kinderen k where k.id = p_kind_id) then
    raise exception 'Die verzamelaar bestaat niet.';
  end if;

  update public.aanwezigheden a
     set aangemeld_op   = case when p_aangemeld then coalesce(a.aangemeld_op, now()) end,
         aangemeld_door = case when p_aangemeld then auth.uid() end,
         komt           = a.komt or p_aangemeld,
         komt_op        = case when a.komt or p_aangemeld then coalesce(a.komt_op, now()) end
   where a.event_id = p_event_id and a.kind_id = p_kind_id;

  if not found then
    insert into public.aanwezigheden
      (event_id, kind_id, komt, komt_op, aangemeld_op, aangemeld_door)
    values
      (p_event_id, p_kind_id, p_aangemeld, case when p_aangemeld then now() end,
       case when p_aangemeld then now() end, case when p_aangemeld then auth.uid() end);
  end if;
end;
$fn$;

revoke all on function public.aanmelden_zetten(uuid, uuid, boolean) from public;
revoke all on function public.aanmelden_zetten(uuid, uuid, boolean) from anon;
grant execute on function public.aanmelden_zetten(uuid, uuid, boolean) to authenticated;

-- ============================================================
-- 8. De tabel voor de organisatiepagina
-- ============================================================
-- Eén rij per verzamelaar, met alle events in één jsonb-kolom. Zo hoeft de
-- pagina geen kruistabel op te bouwen en groeit een extra event vanzelf mee:
--   { "<event_id>": { "komt": true, "aangemeld": false } }
create or replace function public.aanwezigheden_overzicht()
returns table (
  kind_id      uuid,
  voornaam     text,
  familienaam  text,
  ouders       text,
  wijk         text,
  aanwezigheid jsonb
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
             where a.kind_id = k.id), '{}'::jsonb)
  from public.kinderen k
  where public.is_beheerder()
  order by k.voornaam, k.familienaam;
$fn$;

revoke all on function public.aanwezigheden_overzicht() from public;
revoke all on function public.aanwezigheden_overzicht() from anon;
grant execute on function public.aanwezigheden_overzicht() to authenticated;

-- Tellingen per event, inclusief de geanonimiseerde rijen van verzamelaars die
-- intussen verwijderd zijn — anders zakt een cijfer uit het verleden.
create or replace function public.aanwezigheid_statistiek()
returns table (
  event_id  uuid,
  naam      text,
  start     timestamptz,
  gepland   integer,
  aangemeld integer,
  anoniem   integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select e.id, e.naam, e.start,
         count(*) filter (where a.komt)::integer,
         count(*) filter (where a.aangemeld_op is not null)::integer,
         count(*) filter (where a.id is not null and a.kind_id is null)::integer
  from public.events e
  left join public.aanwezigheden a on a.event_id = e.id
  where public.is_beheerder()
  group by e.id, e.naam, e.start
  order by e.start desc;
$fn$;

revoke all on function public.aanwezigheid_statistiek() from public;
revoke all on function public.aanwezigheid_statistiek() from anon;
grant execute on function public.aanwezigheid_statistiek() to authenticated;

-- ============================================================
-- 9. get_matches(): de tegenpartij moet er ook effectief zijn
-- ============================================================
-- Zelfde kolommen als sql/023 — de drie oproepers (js/ruilen.js,
-- js/stickers.js, js/ruilregistratie.js) merken hier niets van.
--
-- Twee dingen veranderen aan de binnenkant:
--   1. De CTE 'zichtbaar' bepaalt één keer WIE er als tegenpartij mag
--      verschijnen, in plaats van per rij een functie aan te roepen. Voor de
--      fase 'open' is dat gewoon iedereen.
--   2. gezin_sleutel(ak.user_id) stond zes keer per rij in de query en komt nu
--      uit diezelfde CTE. Dat is geen nieuwe regel, enkel minder werk.
drop function if exists public.get_matches(uuid);

create function public.get_matches(p_kind_id uuid)
returns table (
  richting        text,
  code            text,
  nummer          integer,
  land_code       text,
  land_naam       text,
  land_naam_en    text,
  pagina          integer,
  sticker_naam    text,
  aantal          integer,
  ander_kind_id   uuid,
  ander_kind      text,
  ander_kind_letter text,
  eigen_gezin     boolean,
  ander_wijk      text,
  ander_email     text,
  ander_whatsapp  text
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
  ),
  na_beurs as (
    select public.beurs_voorbij() as ja
  ),
  fase as (
    select h.id as event_id, h.fase from public.huidig_event() h
  ),
  -- Wie mag er als tegenpartij verschijnen? Buiten de aanloop naar een event
  -- iedereen; in de aanloop wie zei dat hij komt; op de beursdag wie effectief
  -- binnenkwam. Het eigen gezin valt er nooit uit.
  zichtbaar as (
    select k.id, public.gezin_sleutel(k.user_id) as sleutel
    from public.kinderen k
    cross join fase f
    cross join eigen_kind ek
    where f.fase = 'open'
       or public.gezin_sleutel(k.user_id) = ek.sleutel
       or exists (
            select 1 from public.aanwezigheden a
            where a.event_id = f.event_id
              and a.kind_id = k.id
              and case when f.fase = 'tijdens'
                       then a.aangemeld_op is not null
                       else a.komt end
          )
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
    public._dubbels_vrij(ander.kind_id, ander.nummer),
    ak.id,
    ak.voornaam,
    left(ak.familienaam, 1),
    z.sleutel = ek.sleutel,
    case
      when z.sleutel <> ek.sleutel
      then (select nullif(g2.wijk, '') from public.gezinnen g2 where g2.id = z.sleutel)
    end,
    case
      when z.sleutel <> ek.sleutel and nb.ja
      then (select nullif(l.email, '') from public.gezin_leden l where l.user_id = ak.user_id)
    end,
    case
      when z.sleutel <> ek.sleutel and nb.ja
      then (select g2.telefoon from public.gezinnen g2
             where g2.id = z.sleutel and g2.telefoon_delen)
    end
  from eigen_kind ek
  cross join glans_ok g
  cross join na_beurs nb
  join public.stickers mij   on mij.kind_id = ek.id and mij.status = 'ZOEKT'
  join public.stickers ander on ander.nummer = mij.nummer and ander.status = 'RUILT'
  join public.kinderen ak    on ak.id = ander.kind_id and ak.id <> ek.id
  join zichtbaar z           on z.id = ak.id
  join public.sticker_catalogus c on c.code = mij.nummer
  where (g.aan or not c.glans)
    and public._zoekt_vrij(ek.id, mij.nummer)
    and public._dubbels_vrij(ander.kind_id, ander.nummer) > 0

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
    public._dubbels_vrij(ek.id, mij.nummer),
    ak.id,
    ak.voornaam,
    left(ak.familienaam, 1),
    z.sleutel = ek.sleutel,
    case
      when z.sleutel <> ek.sleutel
      then (select nullif(g2.wijk, '') from public.gezinnen g2 where g2.id = z.sleutel)
    end,
    case
      when z.sleutel <> ek.sleutel and nb.ja
      then (select nullif(l.email, '') from public.gezin_leden l where l.user_id = ak.user_id)
    end,
    case
      when z.sleutel <> ek.sleutel and nb.ja
      then (select g2.telefoon from public.gezinnen g2
             where g2.id = z.sleutel and g2.telefoon_delen)
    end
  from eigen_kind ek
  cross join glans_ok g
  cross join na_beurs nb
  join public.stickers mij   on mij.kind_id = ek.id and mij.status = 'RUILT'
  join public.stickers ander on ander.nummer = mij.nummer and ander.status = 'ZOEKT'
  join public.kinderen ak    on ak.id = ander.kind_id and ak.id <> ek.id
  join zichtbaar z           on z.id = ak.id
  join public.sticker_catalogus c on c.code = mij.nummer
  where (g.aan or not c.glans)
    and public._dubbels_vrij(ek.id, mij.nummer) > 0
    and public._zoekt_vrij(ander.kind_id, ander.nummer)

  order by 1, 4, 3, 2;
$fn$;

revoke all on function public.get_matches(uuid) from public;
revoke all on function public.get_matches(uuid) from anon;
grant execute on function public.get_matches(uuid) to authenticated;

-- Snelle controle na het draaien:
--   select * from public.huidig_event();
--   select public.beurs_actief(), public.beurs_voorbij();
--   select naam, start, einde from public.events order by start;
