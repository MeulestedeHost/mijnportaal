-- Panini Ruilportaal — online ruilen: afspraken, gesprekken, sterren, ruilmomenten
--
-- WAAROM. De beurzen in het CCM zijn voorbij (8 november 2026). Aan de
-- ruiltafel wisselen stickers meteen van hand; online zit er tijd tussen
-- afspreken en ontvangen — soms een postzegel. Een ruil krijgt daarom fases, en
-- een gesprek om tot die afspraak te komen. Zie Todo.md, "Online ruilen".
--
--   VOORGESTELD ─(iedereen heeft geantwoord)─► GERESERVEERD ─► VRIJGEGEVEN
--                                                 │
--                                         (wat + hoe vastgelegd)
--                                                 ▼
--                                             BEVESTIGD ─► AFGESPRONGEN
--                                                 │         (of GESCHIL als
--                                       (elke kant: ontvangen)  iemand al
--                                                 ▼              ontving)
--                                           GEREALISEERD
--   Plus VERVALLEN: te lang geen antwoord of geen afronding.
--
-- EEN MODEL VOOR RUIL EN KRING. Een afspraak heeft deelnemers (2 bij een ruil,
-- 3 of 4 bij een kettingruil) en items: "van_kind geeft sticker aan naar_kind".
-- Een gewone ruil is dan gewoon een kring van twee. De oude tabel
-- public.ruilen blijft voor de ruiltafel (ruilbeursmodus), ongewijzigd.
--
-- RESERVEREN. Dezelfde afleiding als sql/023 — geen status op stickers.
-- _gereserveerd() telt vanaf nu ook items van afspraken die gereserveerd,
-- bevestigd of in geschil zijn, zolang de betrokken kant nog niet verwerkte.
-- get_matches(), ruil_registreren(), de favorieten en de kettingruil rekenen
-- allemaal op _gereserveerd() en volgen dus vanzelf.
--
-- VERWERKEN = "ik heb ontvangen". Dezelfde regel als op de ruiltafel: wie zijn
-- kant als gerealiseerd aanduidt, ziet zijn eigen lijst meteen bijgewerkt.
-- Terugzetten (afgesprongen na een geschil) enkel als de lijst nog exact is
-- wat de verwerking achterliet — anders nazien, zoals in 023.
--
-- RUILMOMENTEN staan in een EIGEN tabel en niet als soort in public.events.
-- huidig_event(), de aanwezigheden, de statistieken en de gasten lezen events
-- allemaal als "ruilbeurs"; een ruilmoment daartussen zou in elk van die zes
-- functies een uitzondering vragen, en een vergeten uitzondering start een
-- sperperiode. Een ruilmoment heeft geen sperperiode en geen aanwezigheid.
--
-- RUILBEURSMODUS. In de aanloop naar een beurs (fase 'voor' of 'tijdens')
-- kan je geen nieuwe online ruil voorstellen, en gesprekken lopen nog één dag
-- door na de start van de aanloop. Afronden (vrijgeven, ontvangen,
-- afgesprongen) blijft altijd mogelijk: aanwezigheid stuurt wat je voorgesteld
-- krijgt, niet wat mag (sql/025).
--
-- Niet destructief: enkel nieuwe tabellen en functies, en _gereserveerd()
-- vervangen door een versie die hetzelfde telt plus de afspraken.

-- ============================================================
-- 1. Tabellen
-- ============================================================
create table if not exists public.ruilmomenten (
  id         uuid primary key default gen_random_uuid(),
  start      timestamptz not null,
  einde      timestamptz not null,
  plaats     text not null default 'CC Meulestede, Meulesteedsesteenweg 515, 9000 Gent',
  opmerking  text not null default '',
  created_at timestamptz not null default now(),
  constraint ruilmoment_volgorde check (einde > start)
);

create index if not exists idx_ruilmomenten_start on public.ruilmomenten (start);

create table if not exists public.afspraken (
  id                 uuid primary key default gen_random_uuid(),
  soort              text not null default 'ruil',
  status             text not null default 'VOORGESTELD',
  aangemaakt_door    uuid references public.kinderen(id) on delete set null,
  aangemaakt_op      timestamptz not null default now(),
  gereserveerd_op    timestamptz,
  bevestigd_op       timestamptz,
  afgesloten_op      timestamptz,
  afgesloten_door    uuid references public.kinderen(id) on delete set null,
  geschil_op         timestamptz,
  geschil_beslissing text,
  wijze              text,
  ruilmoment_id      uuid references public.ruilmomenten(id) on delete set null,
  afspraak_tekst     text not null default '',
  laatste_bericht_op timestamptz not null default now(),
  constraint afspraak_soort check (soort in ('ruil', 'ketting')),
  constraint afspraak_status check (status in (
    'VOORGESTELD', 'GERESERVEERD', 'BEVESTIGD', 'GEREALISEERD',
    'VRIJGEGEVEN', 'AFGESPRONGEN', 'GESCHIL', 'VERVALLEN')),
  constraint afspraak_wijze check (wijze is null or wijze in ('verzenden', 'afspreken', 'afhalen')),
  constraint afspraak_tekst_lengte check (char_length(afspraak_tekst) <= 500)
);

create index if not exists idx_afspraken_status on public.afspraken (status);

create table if not exists public.afspraak_deelnemers (
  afspraak_id     uuid not null references public.afspraken(id) on delete cascade,
  kind_id         uuid not null references public.kinderen(id) on delete cascade,
  geantwoord_op   timestamptz,
  gerealiseerd_op timestamptz,
  nazien_op       timestamptz,
  primary key (afspraak_id, kind_id)
);

create index if not exists idx_afspraak_deelnemers_kind on public.afspraak_deelnemers (kind_id);

-- Eén rij per sticker die van hand wisselt. De verwerkingskolommen houden bij
-- wat er effectief gebeurde, zodat het veilig terug kan (zelfde idee als
-- zoekt_weg_x / dubbels_voor_x in 023).
create table if not exists public.afspraak_items (
  id               uuid primary key default gen_random_uuid(),
  afspraak_id      uuid not null references public.afspraken(id) on delete cascade,
  van_kind         uuid not null references public.kinderen(id) on delete cascade,
  naar_kind        uuid not null references public.kinderen(id) on delete cascade,
  sticker          text not null,
  van_verwerkt     boolean not null default false,
  van_dubbels_voor integer,
  naar_verwerkt    boolean not null default false,
  naar_zoekt_weg   boolean,
  constraint item_niet_zelf check (van_kind <> naar_kind),
  -- Een verzamelaar geeft een sticker hoogstens één keer weg en krijgt hem
  -- hoogstens één keer binnen dezelfde afspraak.
  constraint item_uniek_van  unique (afspraak_id, van_kind, sticker),
  constraint item_uniek_naar unique (afspraak_id, naar_kind, sticker)
);

create index if not exists idx_afspraak_items_van  on public.afspraak_items (van_kind, sticker);
create index if not exists idx_afspraak_items_naar on public.afspraak_items (naar_kind, sticker);

-- Het gesprek. Afzender is een gezin (het account); auteur_kind zegt welk kind
-- typte, leeg = een ouder. auteur_naam wordt bij het schrijven vastgelegd, zodat
-- een bericht leesbaar blijft als een kind later verwijderd wordt.
create table if not exists public.berichten (
  id           uuid primary key default gen_random_uuid(),
  afspraak_id  uuid not null references public.afspraken(id) on delete cascade,
  gezin        uuid,
  auteur_user  uuid references auth.users(id) on delete set null,
  auteur_kind  uuid references public.kinderen(id) on delete set null,
  auteur_naam  text not null default '',
  systeem      boolean not null default false,
  tekst        text not null,
  created_at   timestamptz not null default now(),
  constraint bericht_lengte check (char_length(tekst) between 1 and 1000)
);

create index if not exists idx_berichten_afspraak on public.berichten (afspraak_id, created_at);

-- Gelezen per gezin: ouders delen het toestel met de kinderen, dus "gelezen"
-- is een gezinszaak.
create table if not exists public.afspraak_gelezen (
  afspraak_id uuid not null references public.afspraken(id) on delete cascade,
  gezin       uuid not null,
  gelezen_op  timestamptz not null default now(),
  primary key (afspraak_id, gezin)
);

create table if not exists public.bericht_meldingen (
  id          uuid primary key default gen_random_uuid(),
  bericht_id  uuid references public.berichten(id) on delete set null,
  afspraak_id uuid not null references public.afspraken(id) on delete cascade,
  gezin       uuid not null,
  reden       text not null default '',
  created_at  timestamptz not null default now(),
  behandeld   timestamptz,
  constraint melding_reden_lengte check (char_length(reden) <= 500)
);

create table if not exists public.blokkades (
  gezin       uuid not null,
  geblokkeerd uuid not null,
  created_at  timestamptz not null default now(),
  primary key (gezin, geblokkeerd)
);

-- Sterren per gezin. Eén beoordeling per afspraak per richting; aanpassen mag.
create table if not exists public.beoordelingen (
  afspraak_id uuid not null references public.afspraken(id) on delete cascade,
  van_gezin   uuid not null,
  voor_gezin  uuid not null,
  sterren     integer not null,
  created_at  timestamptz not null default now(),
  primary key (afspraak_id, van_gezin, voor_gezin),
  constraint beoordeling_sterren check (sterren between 1 and 5),
  constraint beoordeling_niet_zelf check (van_gezin <> voor_gezin)
);

create index if not exists idx_beoordelingen_voor on public.beoordelingen (voor_gezin);

-- Wanneer een gezin het laatst een mail kreeg over nieuwe berichten.
create table if not exists public.mail_meldingen (
  gezin          uuid primary key,
  laatst_gemaild timestamptz not null
);

-- RLS aan, en enkel ruilmomenten rechtstreeks leesbaar. Al de rest loopt via
-- de functies hieronder: die controleren méér dan een policy kan (hoor je bij
-- deze afspraak, mag je nog schrijven, klopt de fase).
alter table public.ruilmomenten        enable row level security;
alter table public.afspraken           enable row level security;
alter table public.afspraak_deelnemers enable row level security;
alter table public.afspraak_items      enable row level security;
alter table public.berichten           enable row level security;
alter table public.afspraak_gelezen    enable row level security;
alter table public.bericht_meldingen   enable row level security;
alter table public.blokkades           enable row level security;
alter table public.beoordelingen       enable row level security;
alter table public.mail_meldingen      enable row level security;

drop policy if exists ruilmomenten_select on public.ruilmomenten;
create policy ruilmomenten_select on public.ruilmomenten for select to authenticated using (true);
drop policy if exists ruilmomenten_insert on public.ruilmomenten;
create policy ruilmomenten_insert on public.ruilmomenten for insert to authenticated with check (public.is_beheerder());
drop policy if exists ruilmomenten_update on public.ruilmomenten;
create policy ruilmomenten_update on public.ruilmomenten for update to authenticated using (public.is_beheerder()) with check (public.is_beheerder());
drop policy if exists ruilmomenten_delete on public.ruilmomenten;
create policy ruilmomenten_delete on public.ruilmomenten for delete to authenticated using (public.is_beheerder());

grant select, insert, update, delete on public.ruilmomenten to authenticated;

-- ============================================================
-- 2. Termijnen en fase
-- ============================================================
-- Online duurt langer dan aan tafel: 14 dagen om af te spreken, 30 dagen om
-- de post te laten aankomen. Eén plek, zoals _ruil_termijn() in 023.
create or replace function public._afspraak_termijn(p_fase text)
returns interval
language sql
immutable
set search_path = ''
as $fn$
  select case p_fase
    when 'VOORGESTELD'  then interval '14 days'
    when 'GERESERVEERD' then interval '14 days'
    when 'BEVESTIGD'    then interval '30 days'
  end;
$fn$;

-- Tot wanneer mag er in een gesprek geschreven worden? Leeg = geen grens
-- (online modus). In de aanloop naar een beurs: nog één dag na de start van
-- de aanloop.
create or replace function public._online_schrijven_tot()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $fn$
  select case when h.fase in ('voor', 'tijdens') then h.filter_vanaf + interval '1 day' end
  from public.huidig_event() h;
$fn$;

-- Is deze afspraak nog niet over zijn termijn? (Ook gebruikt door
-- _gereserveerd(): een verlopen afspraak houdt niemands stickers vast, ook al
-- is ze nog niet opgeruimd.)
create or replace function public._afspraak_loopt(p_status text, p_gereserveerd timestamptz, p_bevestigd timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select case p_status
    when 'GERESERVEERD' then p_gereserveerd > now() - public._afspraak_termijn('GERESERVEERD')
    when 'BEVESTIGD'    then p_bevestigd    > now() - public._afspraak_termijn('BEVESTIGD')
    when 'GESCHIL'      then true
    else false
  end;
$fn$;

-- ============================================================
-- 3. _gereserveerd(): ook de afspraken
-- ============================================================
-- Het eerste deel is letterlijk sql/023. Het tweede telt items van lopende
-- afspraken waarvan deze kant nog niet verwerkte.
create or replace function public._gereserveerd(p_kind_id uuid, p_code text, p_richting text)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select (
    select count(*)::int
    from public.ruilen r
    where (r.kind_a = p_kind_id or r.kind_b = p_kind_id)
      and r.geweigerd is null
      and r.vervallen is null
      and (r.bevestigd_a is null or r.bevestigd_b is null)
      and (r.verwerkt_a is null) <> (r.verwerkt_b is null)
      and coalesce(r.verwerkt_a, r.verwerkt_b) > now() - public._ruil_termijn()
      and (
        (r.kind_a = p_kind_id and r.verwerkt_a is null
          and ((p_richting = 'krijgt' and r.sticker_a = p_code)
            or (p_richting = 'geeft'  and r.sticker_b = p_code)))
        or
        (r.kind_b = p_kind_id and r.verwerkt_b is null
          and ((p_richting = 'krijgt' and r.sticker_b = p_code)
            or (p_richting = 'geeft'  and r.sticker_a = p_code)))
      )
  ) + (
    select count(*)::int
    from public.afspraak_items i
    join public.afspraken a on a.id = i.afspraak_id
    where i.sticker = p_code
      and public._afspraak_loopt(a.status, a.gereserveerd_op, a.bevestigd_op)
      and ((p_richting = 'geeft'  and i.van_kind  = p_kind_id and not i.van_verwerkt)
        or (p_richting = 'krijgt' and i.naar_kind = p_kind_id and not i.naar_verwerkt))
  );
$fn$;

revoke all on function public._afspraak_termijn(text) from public, anon, authenticated;
revoke all on function public._online_schrijven_tot() from public, anon, authenticated;
revoke all on function public._afspraak_loopt(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._gereserveerd(uuid, text, text) from public, anon, authenticated;

-- ============================================================
-- 4. Interne hulpfuncties
-- ============================================================
-- Hoort het gezin van de aanroeper bij deze afspraak? Beheerders mogen
-- meelezen bij een geschil of een melding — enkel dan.
create or replace function public._afspraak_toegang(p_afspraak uuid, p_beheer boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select auth.uid() is not null and (
    exists (
      select 1 from public.afspraak_deelnemers d
      where d.afspraak_id = p_afspraak
        and public.gezin_van_kind(d.kind_id) = public.gezin_sleutel(auth.uid())
    )
    or (p_beheer and public.is_beheerder() and exists (
      select 1 from public.afspraken a
      where a.id = p_afspraak
        and (a.status = 'GESCHIL' or a.geschil_op is not null
          or exists (select 1 from public.bericht_meldingen m where m.afspraak_id = a.id))
    ))
  );
$fn$;

-- Het gezin dat de actie deed, staat mee op het bericht: zo telt "Guus
-- bevestigde de ruil" niet als ongelezen bij Guus zelf. Leeg bij wat het
-- portaal zelf doet (vervallen), dan is het voor iedereen nieuw.
create or replace function public._systeembericht(p_afspraak uuid, p_tekst text)
returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into public.berichten (afspraak_id, gezin, systeem, tekst, auteur_naam)
  values (p_afspraak,
          case when auth.uid() is not null then public.gezin_sleutel(auth.uid()) end,
          true, p_tekst, 'Ruilportaal');
  update public.afspraken set laatste_bericht_op = now() where id = p_afspraak;
$fn$;

create or replace function public._kind_naam(p_kind uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((select k.voornaam || coalesce(' ' || nullif(left(k.familienaam, 1), '') || '.', '')
                   from public.kinderen k where k.id = p_kind), 'een verzamelaar');
$fn$;

-- Verwerk de lijst van één deelnemer: wat hij krijgt uit "zoek ik", wat hij
-- geeft één dubbel minder. Overslaan wat al gebeurd is — exact zoals
-- _ruil_kant_verwerken() in 023.
create or replace function public._afspraak_kant_verwerken(p_afspraak uuid, p_kind uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item   public.afspraak_items%rowtype;
  v_status text;
  v_aantal integer;
begin
  for v_item in
    select * from public.afspraak_items
    where afspraak_id = p_afspraak and naar_kind = p_kind and not naar_verwerkt
    for update
  loop
    select s.status into v_status from public.stickers s
     where s.kind_id = p_kind and s.nummer = v_item.sticker for update;
    if v_status = 'ZOEKT' then
      delete from public.stickers where kind_id = p_kind and nummer = v_item.sticker;
    end if;
    update public.afspraak_items
       set naar_verwerkt = true, naar_zoekt_weg = (v_status = 'ZOEKT')
     where id = v_item.id;
    v_status := null;
  end loop;

  for v_item in
    select * from public.afspraak_items
    where afspraak_id = p_afspraak and van_kind = p_kind and not van_verwerkt
    for update
  loop
    select s.aantal into v_aantal from public.stickers s
     where s.kind_id = p_kind and s.nummer = v_item.sticker and s.status = 'RUILT' for update;
    if v_aantal > 1 then
      update public.stickers set aantal = v_aantal - 1
       where kind_id = p_kind and nummer = v_item.sticker;
    elsif v_aantal = 1 then
      delete from public.stickers where kind_id = p_kind and nummer = v_item.sticker;
    end if;
    update public.afspraak_items
       set van_verwerkt = true, van_dubbels_voor = v_aantal
     where id = v_item.id;
    v_aantal := null;
  end loop;

  update public.afspraak_deelnemers set gerealiseerd_op = now()
   where afspraak_id = p_afspraak and kind_id = p_kind and gerealiseerd_op is null;
end;
$fn$;

-- Terugzetten, per item, enkel als de lijst nog exact is wat de verwerking
-- achterliet. Lukt een item niet, dan blijft het zoals het is en krijgt de
-- deelnemer een nazien-markering.
create or replace function public._afspraak_kant_terugzetten(p_afspraak uuid, p_kind uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item   public.afspraak_items%rowtype;
  v_status text;
  v_aantal integer;
  v_ok     boolean := true;
  v_item_ok boolean;
begin
  for v_item in
    select * from public.afspraak_items
    where afspraak_id = p_afspraak and naar_kind = p_kind and naar_verwerkt
    for update
  loop
    v_item_ok := true;
    if v_item.naar_zoekt_weg then
      perform 1 from public.stickers s where s.kind_id = p_kind and s.nummer = v_item.sticker for update;
      if found then
        v_item_ok := false;
      else
        insert into public.stickers (kind_id, nummer, status, aantal)
        values (p_kind, v_item.sticker, 'ZOEKT', 1);
      end if;
    end if;
    if v_item_ok then
      update public.afspraak_items set naar_verwerkt = false, naar_zoekt_weg = null where id = v_item.id;
    else
      v_ok := false;
    end if;
  end loop;

  for v_item in
    select * from public.afspraak_items
    where afspraak_id = p_afspraak and van_kind = p_kind and van_verwerkt
    for update
  loop
    v_item_ok := true;
    if v_item.van_dubbels_voor is not null then
      v_status := null; v_aantal := null;
      select s.status, s.aantal into v_status, v_aantal from public.stickers s
       where s.kind_id = p_kind and s.nummer = v_item.sticker for update;
      if v_item.van_dubbels_voor > 1 then
        v_item_ok := v_status = 'RUILT' and v_aantal = v_item.van_dubbels_voor - 1;
      else
        v_item_ok := v_status is null;
      end if;
      if v_item_ok then
        insert into public.stickers (kind_id, nummer, status, aantal)
        values (p_kind, v_item.sticker, 'RUILT', v_item.van_dubbels_voor)
        on conflict (kind_id, nummer) do update set status = 'RUILT', aantal = excluded.aantal;
      end if;
    end if;
    if v_item_ok then
      update public.afspraak_items set van_verwerkt = false, van_dubbels_voor = null where id = v_item.id;
    else
      v_ok := false;
    end if;
  end loop;

  update public.afspraak_deelnemers
     set gerealiseerd_op = null,
         nazien_op = case when v_ok then nazien_op else now() end
   where afspraak_id = p_afspraak and kind_id = p_kind;
  return v_ok;
end;
$fn$;

-- Afsluiten als niemand verwerkte (vrijgeven, afgesprongen, vervallen) of na
-- een beslissing; zet terug wat verwerkt was.
create or replace function public._afspraak_afsluiten(p_afspraak uuid, p_status text, p_door uuid, p_tekst text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_kind uuid;
begin
  if p_status in ('VRIJGEGEVEN', 'AFGESPRONGEN', 'VERVALLEN') then
    for v_kind in
      select d.kind_id from public.afspraak_deelnemers d
      where d.afspraak_id = p_afspraak and d.gerealiseerd_op is not null
    loop
      perform public._afspraak_kant_terugzetten(p_afspraak, v_kind);
    end loop;
  end if;
  update public.afspraken
     set status = p_status, afgesloten_op = now(), afgesloten_door = p_door
   where id = p_afspraak;
  perform public._systeembericht(p_afspraak, p_tekst);
end;
$fn$;

-- Van VOORGESTELD naar GERESERVEERD zodra elk gezin geantwoord heeft. Wat
-- intussen niet meer kan (een lijst werd aangepast, of een sticker zit al in
-- een andere ruil) valt eruit, met een melding in het gesprek.
create or replace function public._afspraak_reserveren(p_afspraak uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item  public.afspraak_items%rowtype;
  v_weg   text[] := '{}';
begin
  perform 1 from public.afspraken where id = p_afspraak and status = 'VOORGESTELD' for update;
  if not found then return; end if;
  if exists (select 1 from public.afspraak_deelnemers d
             where d.afspraak_id = p_afspraak and d.geantwoord_op is null) then
    return;
  end if;

  -- Twee reserveringen tegelijk op dezelfde laatste dubbel: de tweede wacht.
  perform 1 from public.stickers s
   where (s.kind_id, s.nummer) in (
     select i.van_kind, i.sticker from public.afspraak_items i where i.afspraak_id = p_afspraak
     union
     select i.naar_kind, i.sticker from public.afspraak_items i where i.afspraak_id = p_afspraak)
   for update;

  for v_item in select * from public.afspraak_items where afspraak_id = p_afspraak loop
    if public._dubbels_vrij(v_item.van_kind, v_item.sticker) < 1
       or not public._zoekt_vrij(v_item.naar_kind, v_item.sticker) then
      v_weg := v_weg || v_item.sticker;
      delete from public.afspraak_items where id = v_item.id;
    end if;
  end loop;

  if array_length(v_weg, 1) > 0 then
    perform public._systeembericht(p_afspraak,
      'Niet meer beschikbaar, dus uit de ruil gehaald: ' || array_to_string(v_weg, ', ') || '.');
  end if;

  if not exists (select 1 from public.afspraak_items where afspraak_id = p_afspraak) then
    perform public._afspraak_afsluiten(p_afspraak, 'VRIJGEGEVEN', null,
      'Er blijft geen enkele sticker over om te ruilen. De ruil is gesloten.');
    return;
  end if;

  update public.afspraken set status = 'GERESERVEERD', gereserveerd_op = now() where id = p_afspraak;
  perform public._systeembericht(p_afspraak,
    'Iedereen heeft geantwoord: de stickers zijn nu gereserveerd. Spreek af hoe je ruilt en bevestig de ruil.');
end;
$fn$;

-- Eén afspraak over haar termijn: afhandelen. Wie al ontving, zet zijn kant
-- niet zomaar terug — dat wordt een geschil voor de organisatie.
create or replace function public._afspraak_termijn_afhandelen(p_afspraak uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_a public.afspraken%rowtype;
begin
  select * into v_a from public.afspraken where id = p_afspraak for update;
  if not found then return; end if;

  if v_a.status = 'VOORGESTELD' and v_a.aangemaakt_op <= now() - public._afspraak_termijn('VOORGESTELD') then
    perform public._afspraak_afsluiten(p_afspraak, 'VERVALLEN', null,
      'Vervallen: niet iedereen antwoordde binnen 14 dagen.');
  elsif v_a.status = 'GERESERVEERD' and v_a.gereserveerd_op <= now() - public._afspraak_termijn('GERESERVEERD') then
    perform public._afspraak_afsluiten(p_afspraak, 'VERVALLEN', null,
      'Vervallen: de ruil werd niet binnen 14 dagen bevestigd. De stickers zijn weer vrij.');
  elsif v_a.status = 'BEVESTIGD' and v_a.bevestigd_op <= now() - public._afspraak_termijn('BEVESTIGD') then
    if exists (select 1 from public.afspraak_deelnemers d
               where d.afspraak_id = p_afspraak and d.gerealiseerd_op is not null) then
      update public.afspraken set status = 'GESCHIL', geschil_op = now() where id = p_afspraak;
      perform public._systeembericht(p_afspraak,
        'Na 30 dagen heeft nog niet iedereen aangeduid dat de ruil gerealiseerd is. De organisatie kijkt mee.');
    else
      perform public._afspraak_afsluiten(p_afspraak, 'VERVALLEN', null,
        'Vervallen: na 30 dagen duidde niemand aan dat de ruil gerealiseerd is. De stickers zijn weer vrij.');
    end if;
  end if;
end;
$fn$;

revoke all on function public._afspraak_toegang(uuid, boolean) from public, anon, authenticated;
revoke all on function public._systeembericht(uuid, text) from public, anon, authenticated;
revoke all on function public._kind_naam(uuid) from public, anon, authenticated;
revoke all on function public._afspraak_kant_verwerken(uuid, uuid) from public, anon, authenticated;
revoke all on function public._afspraak_kant_terugzetten(uuid, uuid) from public, anon, authenticated;
revoke all on function public._afspraak_afsluiten(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public._afspraak_reserveren(uuid) from public, anon, authenticated;
revoke all on function public._afspraak_termijn_afhandelen(uuid) from public, anon, authenticated;

-- ============================================================
-- 5. Een ruil voorstellen
-- ============================================================
-- p_items: [{"van": kind_id, "naar": kind_id, "sticker": "BEL3"}, ...]
-- Bij soort 'ruil' precies twee verzamelaars; bij 'ketting' drie of vier.
create or replace function public.afspraak_voorstellen(
  p_eigen_kind uuid,
  p_soort      text,
  p_items      jsonb,
  p_bericht    text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sleutel uuid;
  v_id      uuid;
  v_item    jsonb;
  v_van     uuid;
  v_naar    uuid;
  v_code    text;
  v_kinderen uuid[] := '{}';
  v_aantal  integer;
  v_fase    text;
begin
  if auth.uid() is null then
    raise exception 'Niet aangemeld.';
  end if;
  v_sleutel := public.gezin_sleutel(auth.uid());
  if public.gezin_van_kind(p_eigen_kind) is distinct from v_sleutel then
    raise exception 'Die verzamelaar hoort niet bij jouw gezin.';
  end if;
  if p_soort not in ('ruil', 'ketting') then
    raise exception 'Onbekende soort ruil.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Kies minstens één sticker om te ruilen.';
  end if;
  if char_length(coalesce(p_bericht, '')) > 1000 then
    raise exception 'Dat bericht is te lang (hoogstens 1000 tekens).';
  end if;

  select h.fase into v_fase from public.huidig_event() h;
  if v_fase in ('voor', 'tijdens') then
    raise exception 'Er komt een ruilbeurs aan: tot die voorbij is, kan je geen nieuwe online ruil voorstellen. Ruil op de beurs zelf!';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_van  := (v_item->>'van')::uuid;
    v_naar := (v_item->>'naar')::uuid;
    v_code := v_item->>'sticker';
    if v_van is null or v_naar is null or coalesce(v_code, '') = '' or v_van = v_naar then
      raise exception 'Een van de stickers in het voorstel is onvolledig.';
    end if;
    if public.gezin_van_kind(v_van) is null or public.gezin_van_kind(v_naar) is null then
      raise exception 'Een van de verzamelaars bestaat niet meer.';
    end if;
    if public._dubbels_vrij(v_van, v_code) < 1 or not public._zoekt_vrij(v_naar, v_code) then
      raise exception 'Sticker % kan niet meer in deze ruil — een lijst werd aangepast, of hij zit al in een andere ruil. Herlaad de pagina.', v_code;
    end if;
    if not v_van = any(v_kinderen) then v_kinderen := v_kinderen || v_van; end if;
    if not v_naar = any(v_kinderen) then v_kinderen := v_kinderen || v_naar; end if;
  end loop;

  if not p_eigen_kind = any(v_kinderen) then
    raise exception 'Je eigen verzamelaar zit niet in dit voorstel.';
  end if;
  v_aantal := array_length(v_kinderen, 1);
  if p_soort = 'ruil' and v_aantal <> 2 then
    raise exception 'Een gewone ruil is tussen twee verzamelaars.';
  end if;
  if p_soort = 'ketting' and (v_aantal < 3 or v_aantal > 4) then
    raise exception 'Een kettingruil is tussen drie of vier verzamelaars.';
  end if;
  if (select count(distinct public.gezin_van_kind(k)) from unnest(v_kinderen) k) < 2 then
    raise exception 'Binnen je eigen gezin ruil je gewoon thuis.';
  end if;
  if exists (
    select 1 from public.blokkades b, unnest(v_kinderen) k
    where (b.gezin = v_sleutel and b.geblokkeerd = public.gezin_van_kind(k))
       or (b.geblokkeerd = v_sleutel and b.gezin = public.gezin_van_kind(k))
  ) then
    raise exception 'Met een van deze gezinnen kan je niet ruilen.';
  end if;

  insert into public.afspraken (soort, aangemaakt_door)
  values (p_soort, p_eigen_kind)
  returning id into v_id;

  insert into public.afspraak_deelnemers (afspraak_id, kind_id, geantwoord_op)
  select v_id, k, case when public.gezin_van_kind(k) = v_sleutel then now() end
  from unnest(v_kinderen) k;

  insert into public.afspraak_items (afspraak_id, van_kind, naar_kind, sticker)
  select v_id, (e->>'van')::uuid, (e->>'naar')::uuid, e->>'sticker'
  from jsonb_array_elements(p_items) e;

  perform public._systeembericht(v_id,
    public._kind_naam(p_eigen_kind) || ' stelt een ' ||
    case when p_soort = 'ketting' then 'kettingruil' else 'ruil' end ||
    ' voor. Zodra iedereen antwoordt, worden de stickers gereserveerd.');

  if coalesce(trim(p_bericht), '') <> '' then
    insert into public.berichten (afspraak_id, gezin, auteur_user, auteur_kind, auteur_naam, tekst)
    values (v_id, v_sleutel, auth.uid(), p_eigen_kind, public._kind_naam(p_eigen_kind), trim(p_bericht));
  end if;

  insert into public.afspraak_gelezen (afspraak_id, gezin) values (v_id, v_sleutel)
  on conflict (afspraak_id, gezin) do update set gelezen_op = now();

  return v_id;
end;
$fn$;

-- ============================================================
-- 6. Schrijven in het gesprek
-- ============================================================
-- p_kind: welk kind typt (moet van het eigen gezin zijn), leeg = een ouder.
create or replace function public.afspraak_bericht(
  p_afspraak uuid,
  p_kind     uuid,
  p_tekst    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sleutel uuid;
  v_naam    text;
  v_id      uuid;
  v_tot     timestamptz;
  v_status  text;
begin
  if not public._afspraak_toegang(p_afspraak) then
    raise exception 'Dit gesprek is niet van jouw gezin.';
  end if;
  v_sleutel := public.gezin_sleutel(auth.uid());
  if coalesce(trim(p_tekst), '') = '' then
    raise exception 'Je bericht is leeg.';
  end if;
  if char_length(p_tekst) > 1000 then
    raise exception 'Dat bericht is te lang (hoogstens 1000 tekens).';
  end if;

  select a.status into v_status from public.afspraken a where a.id = p_afspraak;
  if v_status in ('GEREALISEERD', 'VRIJGEGEVEN', 'AFGESPRONGEN', 'VERVALLEN') then
    raise exception 'Deze ruil is afgesloten; het gesprek is gesloten.';
  end if;

  v_tot := public._online_schrijven_tot();
  if v_tot is not null and now() > v_tot then
    raise exception 'Het portaal staat in ruilbeursmodus: gesprekken liggen stil tot na de beurs. Je kan de ruil wel nog afronden.';
  end if;

  if p_kind is not null then
    if public.gezin_van_kind(p_kind) is distinct from v_sleutel then
      raise exception 'Die verzamelaar hoort niet bij jouw gezin.';
    end if;
    v_naam := public._kind_naam(p_kind);
  else
    select coalesce(nullif(trim(l.voornaam), ''), 'Ouder') into v_naam
      from public.gezin_leden l where l.user_id = auth.uid();
    v_naam := coalesce(v_naam, 'Ouder') || ' (ouder)';
  end if;

  insert into public.berichten (afspraak_id, gezin, auteur_user, auteur_kind, auteur_naam, tekst)
  values (p_afspraak, v_sleutel, auth.uid(), p_kind, v_naam, trim(p_tekst))
  returning id into v_id;

  update public.afspraken set laatste_bericht_op = now() where id = p_afspraak;
  insert into public.afspraak_gelezen (afspraak_id, gezin) values (p_afspraak, v_sleutel)
  on conflict (afspraak_id, gezin) do update set gelezen_op = now();

  -- Antwoorden = akkoord om te reserveren (ook als het eigen kind niet typte:
  -- het gezin heeft geantwoord).
  update public.afspraak_deelnemers d set geantwoord_op = now()
   where d.afspraak_id = p_afspraak and d.geantwoord_op is null
     and public.gezin_van_kind(d.kind_id) = v_sleutel;

  perform public._afspraak_reserveren(p_afspraak);
  return v_id;
end;
$fn$;

-- ============================================================
-- 7. Fases
-- ============================================================
create or replace function public._afspraak_eigen_kind(p_afspraak uuid, p_kind uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Niet aangemeld.';
  end if;
  if public.gezin_van_kind(p_kind) is distinct from public.gezin_sleutel(auth.uid()) then
    raise exception 'Je kan enkel voor je eigen verzamelaar handelen.';
  end if;
  if not exists (select 1 from public.afspraak_deelnemers d
                 where d.afspraak_id = p_afspraak and d.kind_id = p_kind) then
    raise exception 'Die verzamelaar hoort niet bij deze ruil.';
  end if;
end;
$fn$;

revoke all on function public._afspraak_eigen_kind(uuid, uuid) from public, anon, authenticated;

-- Vrijgeven: zolang de ruil niet bevestigd is, door elke deelnemer.
create or replace function public.afspraak_vrijgeven(p_afspraak uuid, p_kind uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  perform public._afspraak_eigen_kind(p_afspraak, p_kind);
  select status into v_status from public.afspraken where id = p_afspraak for update;
  if v_status not in ('VOORGESTELD', 'GERESERVEERD') then
    raise exception 'Deze ruil is al bevestigd of afgesloten. Ging hij niet door, duid dan "afgesprongen" aan.';
  end if;
  perform public._afspraak_afsluiten(p_afspraak, 'VRIJGEGEVEN', p_kind,
    public._kind_naam(p_kind) || ' gaf de reservatie vrij. De stickers zijn weer beschikbaar voor iedereen.');
end;
$fn$;

-- Bevestigen: wat en hoe. Kan opnieuw zolang niemand ontving (de wijze
-- aanpassen).
create or replace function public.afspraak_bevestigen(
  p_afspraak   uuid,
  p_kind       uuid,
  p_wijze      text,
  p_ruilmoment uuid default null,
  p_tekst      text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_a       public.afspraken%rowtype;
  v_moment  public.ruilmomenten%rowtype;
  v_zin     text;
begin
  perform public._afspraak_eigen_kind(p_afspraak, p_kind);
  select * into v_a from public.afspraken where id = p_afspraak for update;
  if v_a.status = 'VOORGESTELD' then
    raise exception 'Nog niet iedereen heeft geantwoord: de stickers zijn nog niet gereserveerd.';
  end if;
  if v_a.status not in ('GERESERVEERD', 'BEVESTIGD') then
    raise exception 'Deze ruil kan niet meer bevestigd worden.';
  end if;
  if v_a.status = 'BEVESTIGD' and exists (
       select 1 from public.afspraak_deelnemers d
       where d.afspraak_id = p_afspraak and d.gerealiseerd_op is not null) then
    raise exception 'Iemand heeft zijn stickers al ontvangen; de afspraak ligt vast.';
  end if;
  if p_wijze not in ('verzenden', 'afspreken', 'afhalen') then
    raise exception 'Kies hoe jullie ruilen: verzenden, afspreken of afhalen.';
  end if;
  if char_length(coalesce(p_tekst, '')) > 500 then
    raise exception 'De afspraak is te lang (hoogstens 500 tekens).';
  end if;
  if p_wijze = 'afhalen' then
    select * into v_moment from public.ruilmomenten where id = p_ruilmoment;
    if not found then
      raise exception 'Kies een ruilmoment in het CC Meulestede.';
    end if;
    if v_moment.einde <= now() then
      raise exception 'Dat ruilmoment is al voorbij. Kies een ander.';
    end if;
  end if;

  update public.afspraken
     set status = 'BEVESTIGD',
         bevestigd_op = case when status = 'BEVESTIGD' then bevestigd_op else now() end,
         wijze = p_wijze,
         ruilmoment_id = case when p_wijze = 'afhalen' then p_ruilmoment end,
         afspraak_tekst = coalesce(trim(p_tekst), '')
   where id = p_afspraak;

  v_zin := case p_wijze
    when 'verzenden' then 'per post'
    when 'afspreken' then 'door af te spreken'
    else 'via het ruilmoment van ' ||
         to_char(v_moment.start at time zone 'Europe/Brussels', 'DD/MM/YYYY "om" HH24:MI') ||
         ' in het CC Meulestede'
  end;
  perform public._systeembericht(p_afspraak,
    public._kind_naam(p_kind) || case when v_a.status = 'BEVESTIGD' then ' paste de afspraak aan' else ' bevestigde de ruil' end ||
    ': jullie ruilen ' || v_zin ||
    case when coalesce(trim(p_tekst), '') <> '' then '. Afspraak: ' || trim(p_tekst) else '' end ||
    '. Duid "ontvangen" aan zodra je stickers binnen zijn.');
end;
$fn$;

-- Ontvangen: de eigen lijst verwerken. Zijn alle deelnemers rond, dan is de
-- ruil gerealiseerd.
create or replace function public.afspraak_gerealiseerd(p_afspraak uuid, p_kind uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  perform public._afspraak_eigen_kind(p_afspraak, p_kind);
  select status into v_status from public.afspraken where id = p_afspraak for update;
  if v_status = 'GERESERVEERD' then
    raise exception 'Bevestig eerst de ruil: hoe ruilen jullie?';
  end if;
  if v_status not in ('BEVESTIGD', 'GESCHIL') then
    raise exception 'Deze ruil kan niet (meer) als gerealiseerd aangeduid worden.';
  end if;
  if exists (select 1 from public.afspraak_deelnemers
             where afspraak_id = p_afspraak and kind_id = p_kind and gerealiseerd_op is not null) then
    return;
  end if;

  perform public._afspraak_kant_verwerken(p_afspraak, p_kind);
  perform public._systeembericht(p_afspraak,
    public._kind_naam(p_kind) || ' heeft zijn stickers ontvangen. Zijn lijst is bijgewerkt.');

  if not exists (select 1 from public.afspraak_deelnemers
                 where afspraak_id = p_afspraak and gerealiseerd_op is null) then
    update public.afspraken set status = 'GEREALISEERD', afgesloten_op = now() where id = p_afspraak;
    perform public._systeembericht(p_afspraak,
      'De ruil is gerealiseerd. Bedankt! Je kan het andere gezin nu sterren geven.');
  end if;
end;
$fn$;

-- Afgesprongen: na bevestigen. Ontving nog niemand iets, dan is het gewoon
-- gedaan. Ontving iemand wel, dan staan twee verhalen tegenover elkaar: een
-- geschil voor de platformverantwoordelijke.
create or replace function public.afspraak_afgesprongen(p_afspraak uuid, p_kind uuid, p_reden text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_reden  text := coalesce(nullif(trim(p_reden), ''), '');
begin
  perform public._afspraak_eigen_kind(p_afspraak, p_kind);
  if char_length(v_reden) > 500 then
    raise exception 'De reden is te lang (hoogstens 500 tekens).';
  end if;
  select status into v_status from public.afspraken where id = p_afspraak for update;
  if v_status in ('VOORGESTELD', 'GERESERVEERD') then
    perform public.afspraak_vrijgeven(p_afspraak, p_kind);
    return;
  end if;
  if v_status <> 'BEVESTIGD' then
    raise exception 'Deze ruil kan niet (meer) als afgesprongen aangeduid worden.';
  end if;

  if exists (select 1 from public.afspraak_deelnemers d
             where d.afspraak_id = p_afspraak and d.gerealiseerd_op is not null) then
    update public.afspraken set status = 'GESCHIL', geschil_op = now() where id = p_afspraak;
    perform public._systeembericht(p_afspraak,
      public._kind_naam(p_kind) || ' meldt dat de ruil afgesprongen is, terwijl iemand al ontving' ||
      case when v_reden <> '' then ' (' || v_reden || ')' else '' end ||
      '. De organisatie bekijkt dit en beslist.');
  else
    perform public._afspraak_afsluiten(p_afspraak, 'AFGESPRONGEN', p_kind,
      public._kind_naam(p_kind) || ' meldt dat de ruil afgesprongen is' ||
      case when v_reden <> '' then ' (' || v_reden || ')' else '' end ||
      '. De stickers zijn weer vrij.');
  end if;
end;
$fn$;

-- De platformverantwoordelijke beslist over een geschil.
--   GEREALISEERD: de ruil telt als gedaan. Wie nog niet verwerkte, wordt NIET
--     automatisch verwerkt (het portaal weet niet wat er in zijn map zit) maar
--     krijgt een nazien-markering; de reservering vervalt.
--   AFGESPRONGEN: wat verwerkt was, gaat veilig terug.
create or replace function public.afspraak_geschil_beslissen(p_afspraak uuid, p_uitkomst text, p_toelichting text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_tekst  text := coalesce(nullif(trim(p_toelichting), ''), '');
begin
  if not public.is_beheerder() then
    raise exception 'Enkel de organisatie kan een geschil beslissen.';
  end if;
  select status into v_status from public.afspraken where id = p_afspraak for update;
  if v_status <> 'GESCHIL' then
    raise exception 'Deze ruil is (niet meer) in geschil.';
  end if;
  update public.afspraken set geschil_beslissing = p_uitkomst || case when v_tekst <> '' then ': ' || v_tekst else '' end
   where id = p_afspraak;

  if p_uitkomst = 'GEREALISEERD' then
    update public.afspraak_items set van_verwerkt = true where afspraak_id = p_afspraak and not van_verwerkt;
    update public.afspraak_items set naar_verwerkt = true where afspraak_id = p_afspraak and not naar_verwerkt;
    update public.afspraak_deelnemers
       set nazien_op = now(), gerealiseerd_op = now()
     where afspraak_id = p_afspraak and gerealiseerd_op is null;
    update public.afspraken set status = 'GEREALISEERD', afgesloten_op = now() where id = p_afspraak;
    perform public._systeembericht(p_afspraak,
      'De organisatie besliste: de ruil is gerealiseerd.' ||
      case when v_tekst <> '' then ' ' || v_tekst else '' end ||
      ' Wie nog niet aanduidde dat hij ontving: kijk je lijst zelf even na.');
  elsif p_uitkomst = 'AFGESPRONGEN' then
    perform public._afspraak_afsluiten(p_afspraak, 'AFGESPRONGEN', null,
      'De organisatie besliste: de ruil is afgesprongen.' ||
      case when v_tekst <> '' then ' ' || v_tekst else '' end ||
      ' Wat al verwerkt was, is teruggezet (of staat bij nazien).');
  else
    raise exception 'Kies GEREALISEERD of AFGESPRONGEN.';
  end if;
end;
$fn$;

-- ============================================================
-- 8. Lezen
-- ============================================================
-- Alle afspraken van het eigen gezin, nieuwste activiteit eerst.
create or replace function public.mijn_afspraken()
returns table (
  id                 uuid,
  soort              text,
  status             text,
  aangemaakt_op      timestamptz,
  laatste_bericht_op timestamptz,
  wijze              text,
  deelnemers         jsonb,
  items              jsonb,
  ongelezen          integer,
  actie              text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with mij as (select public.gezin_sleutel(auth.uid()) as sleutel where auth.uid() is not null),
  eigen as (
    select distinct a.*
    from public.afspraken a
    join public.afspraak_deelnemers d on d.afspraak_id = a.id
    cross join mij
    where public.gezin_van_kind(d.kind_id) = mij.sleutel
  )
  select
    a.id, a.soort,
    case when a.status in ('VOORGESTELD', 'GERESERVEERD', 'BEVESTIGD')
              and not public._afspraak_loopt(case when a.status = 'VOORGESTELD' then 'GERESERVEERD' else a.status end,
                                             coalesce(a.gereserveerd_op, a.aangemaakt_op), a.bevestigd_op)
         then 'VERVALLEN' else a.status end,
    a.aangemaakt_op, a.laatste_bericht_op, a.wijze,
    (select jsonb_agg(jsonb_build_object(
              'kind_id', d.kind_id,
              'naam', public._kind_naam(d.kind_id),
              'eigen_gezin', public.gezin_van_kind(d.kind_id) = (select sleutel from mij),
              'geantwoord', d.geantwoord_op is not null,
              'gerealiseerd', d.gerealiseerd_op is not null,
              'nazien', d.nazien_op is not null)
            order by d.kind_id)
       from public.afspraak_deelnemers d where d.afspraak_id = a.id),
    (select coalesce(jsonb_agg(jsonb_build_object('van', i.van_kind, 'naar', i.naar_kind, 'sticker', i.sticker)
            order by i.sticker), '[]'::jsonb)
       from public.afspraak_items i where i.afspraak_id = a.id),
    (select count(*)::int from public.berichten b
      where b.afspraak_id = a.id
        and b.gezin is distinct from (select sleutel from mij)
        and b.created_at > coalesce((select g.gelezen_op from public.afspraak_gelezen g
                                     where g.afspraak_id = a.id and g.gezin = (select sleutel from mij)),
                                    '-infinity'::timestamptz)),
    -- Wat moet MIJN gezin nu doen? Leeg = niets, wachten op de anderen.
    case
      when a.status = 'VOORGESTELD' and exists (
             select 1 from public.afspraak_deelnemers d
             where d.afspraak_id = a.id and d.geantwoord_op is null
               and public.gezin_van_kind(d.kind_id) = (select sleutel from mij))
        then 'antwoorden'
      when a.status = 'GERESERVEERD' then 'bevestigen'
      when a.status in ('BEVESTIGD', 'GESCHIL') and exists (
             select 1 from public.afspraak_deelnemers d
             where d.afspraak_id = a.id and d.gerealiseerd_op is null
               and public.gezin_van_kind(d.kind_id) = (select sleutel from mij))
        then 'ontvangen'
      when a.status in ('GEREALISEERD', 'AFGESPRONGEN') and a.afgesloten_op > now() - interval '30 days'
           and exists (
             select 1 from public.afspraak_deelnemers d
             where d.afspraak_id = a.id
               and public.gezin_van_kind(d.kind_id) <> (select sleutel from mij)
               and not exists (select 1 from public.beoordelingen bo
                               where bo.afspraak_id = a.id
                                 and bo.van_gezin = (select sleutel from mij)
                                 and bo.voor_gezin = public.gezin_van_kind(d.kind_id)))
        then 'beoordelen'
    end
  from eigen a
  order by a.laatste_bericht_op desc;
$fn$;

-- Eén afspraak met alles erop en eraan, en meteen gelezen.
create or replace function public.afspraak_detail(p_afspraak uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sleutel uuid;
  v_a       public.afspraken%rowtype;
  v_beheer  boolean;
  v_uit     jsonb;
begin
  if not public._afspraak_toegang(p_afspraak, true) then
    raise exception 'Dit gesprek is niet van jouw gezin.';
  end if;
  v_sleutel := public.gezin_sleutel(auth.uid());
  v_beheer := not public._afspraak_toegang(p_afspraak, false);

  perform public._afspraak_termijn_afhandelen(p_afspraak);
  select * into v_a from public.afspraken where id = p_afspraak;

  if not v_beheer then
    insert into public.afspraak_gelezen (afspraak_id, gezin) values (p_afspraak, v_sleutel)
    on conflict (afspraak_id, gezin) do update set gelezen_op = now();
  end if;

  select jsonb_build_object(
    'id', v_a.id,
    'soort', v_a.soort,
    'status', v_a.status,
    'aangemaakt_op', v_a.aangemaakt_op,
    'gereserveerd_op', v_a.gereserveerd_op,
    'bevestigd_op', v_a.bevestigd_op,
    'afgesloten_op', v_a.afgesloten_op,
    'wijze', v_a.wijze,
    'afspraak_tekst', v_a.afspraak_tekst,
    'geschil_beslissing', v_a.geschil_beslissing,
    'als_beheerder', v_beheer,
    'schrijven_tot', public._online_schrijven_tot(),
    'vervalt_op', case v_a.status
        when 'VOORGESTELD'  then v_a.aangemaakt_op + public._afspraak_termijn('VOORGESTELD')
        when 'GERESERVEERD' then v_a.gereserveerd_op + public._afspraak_termijn('GERESERVEERD')
        when 'BEVESTIGD'    then v_a.bevestigd_op + public._afspraak_termijn('BEVESTIGD')
      end,
    'ruilmoment', (select jsonb_build_object('id', m.id, 'start', m.start, 'einde', m.einde, 'plaats', m.plaats)
                     from public.ruilmomenten m where m.id = v_a.ruilmoment_id),
    'deelnemers', (select jsonb_agg(jsonb_build_object(
          'kind_id', d.kind_id,
          'naam', public._kind_naam(d.kind_id),
          'voornaam', (select k.voornaam from public.kinderen k where k.id = d.kind_id),
          'gezin', public.gezin_van_kind(d.kind_id),
          'eigen_gezin', public.gezin_van_kind(d.kind_id) = v_sleutel,
          'geantwoord', d.geantwoord_op is not null,
          'gerealiseerd', d.gerealiseerd_op is not null,
          'nazien', d.nazien_op is not null) order by d.kind_id)
        from public.afspraak_deelnemers d where d.afspraak_id = p_afspraak),
    -- Ouders per gezin, enkel de voornaam: voor de @-lijst.
    'ouders', (select coalesce(jsonb_agg(distinct jsonb_build_object(
          'gezin', l.gezin_id, 'voornaam', l.voornaam, 'eigen_gezin', l.gezin_id = v_sleutel)), '[]'::jsonb)
        from public.gezin_leden l
        where nullif(trim(l.voornaam), '') is not null
          and l.gezin_id in (select public.gezin_van_kind(d.kind_id) from public.afspraak_deelnemers d
                              where d.afspraak_id = p_afspraak)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
          'van', i.van_kind, 'naar', i.naar_kind, 'sticker', i.sticker,
          'naam', c.naam, 'land', c.land_naam) order by c.land_code, c.nummer, i.sticker), '[]'::jsonb)
        from public.afspraak_items i
        left join public.sticker_catalogus c on c.code = i.sticker
        where i.afspraak_id = p_afspraak),
    'berichten', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', b.id, 'systeem', b.systeem, 'auteur', b.auteur_naam,
          'auteur_kind', b.auteur_kind,
          'eigen', b.gezin = v_sleutel, 'tekst', b.tekst, 'op', b.created_at) order by b.created_at), '[]'::jsonb)
        from public.berichten b where b.afspraak_id = p_afspraak),
    'mijn_beoordelingen', (select coalesce(jsonb_object_agg(bo.voor_gezin::text, bo.sterren), '{}'::jsonb)
        from public.beoordelingen bo where bo.afspraak_id = p_afspraak and bo.van_gezin = v_sleutel)
  ) into v_uit;
  return v_uit;
end;
$fn$;

-- Opruimen bij paginabezoek, zoals ruilen_verlopen_verwerken() in 023: wie de
-- pagina opent, handelt de verlopen afspraken van zijn eigen gezin af. Na 90
-- dagen gaan de berichten van een afgesloten afspraak weg (privacy).
create or replace function public.afspraken_verlopen_verwerken()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sleutel uuid;
  v_id      uuid;
  v_aantal  integer := 0;
begin
  if auth.uid() is null then
    return 0;
  end if;
  v_sleutel := public.gezin_sleutel(auth.uid());

  for v_id in
    select distinct a.id
    from public.afspraken a
    join public.afspraak_deelnemers d on d.afspraak_id = a.id
    where public.gezin_van_kind(d.kind_id) = v_sleutel
      and ((a.status = 'VOORGESTELD'  and a.aangemaakt_op   <= now() - public._afspraak_termijn('VOORGESTELD'))
        or (a.status = 'GERESERVEERD' and a.gereserveerd_op <= now() - public._afspraak_termijn('GERESERVEERD'))
        or (a.status = 'BEVESTIGD'    and a.bevestigd_op    <= now() - public._afspraak_termijn('BEVESTIGD')))
  loop
    perform public._afspraak_termijn_afhandelen(v_id);
    v_aantal := v_aantal + 1;
  end loop;

  delete from public.berichten b
   using public.afspraken a
   where b.afspraak_id = a.id
     and a.afgesloten_op < now() - interval '90 days'
     and not exists (select 1 from public.bericht_meldingen m where m.afspraak_id = a.id and m.behandeld is null);

  return v_aantal;
end;
$fn$;

-- ============================================================
-- 9. Melden en blokkeren
-- ============================================================
create or replace function public.bericht_melden(p_afspraak uuid, p_bericht uuid, p_reden text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public._afspraak_toegang(p_afspraak) then
    raise exception 'Dit gesprek is niet van jouw gezin.';
  end if;
  if p_bericht is not null and not exists (
       select 1 from public.berichten b where b.id = p_bericht and b.afspraak_id = p_afspraak) then
    raise exception 'Dat bericht hoort niet bij dit gesprek.';
  end if;
  if char_length(coalesce(p_reden, '')) > 500 then
    raise exception 'De reden is te lang (hoogstens 500 tekens).';
  end if;
  insert into public.bericht_meldingen (bericht_id, afspraak_id, gezin, reden)
  values (p_bericht, p_afspraak, public.gezin_sleutel(auth.uid()), coalesce(trim(p_reden), ''));
end;
$fn$;

-- Blokkeren: met dat gezin kan je geen nieuwe ruil meer beginnen, en een
-- lopende afspraak die nog niet bevestigd is, gaat dicht.
create or replace function public.gezin_blokkeren(p_afspraak uuid, p_ander_kind uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sleutel uuid;
  v_ander   uuid;
  v_eigen   uuid;
  v_status  text;
begin
  if not public._afspraak_toegang(p_afspraak) then
    raise exception 'Dit gesprek is niet van jouw gezin.';
  end if;
  v_sleutel := public.gezin_sleutel(auth.uid());
  v_ander := public.gezin_van_kind(p_ander_kind);
  if v_ander is null or v_ander = v_sleutel or not exists (
       select 1 from public.afspraak_deelnemers d where d.afspraak_id = p_afspraak and d.kind_id = p_ander_kind) then
    raise exception 'Die verzamelaar hoort niet bij dit gesprek.';
  end if;

  insert into public.blokkades (gezin, geblokkeerd) values (v_sleutel, v_ander)
  on conflict do nothing;

  select status into v_status from public.afspraken where id = p_afspraak for update;
  if v_status in ('VOORGESTELD', 'GERESERVEERD') then
    select d.kind_id into v_eigen from public.afspraak_deelnemers d
     where d.afspraak_id = p_afspraak and public.gezin_van_kind(d.kind_id) = v_sleutel limit 1;
    perform public._afspraak_afsluiten(p_afspraak, 'VRIJGEGEVEN', v_eigen,
      'Deze ruil is gesloten. De stickers zijn weer vrij.');
  end if;
end;
$fn$;

-- Kind-id's van gezinnen waarmee je niet (meer) ruilt — in beide richtingen,
-- zodat de ruilplanner ze kan weglaten.
create or replace function public.mijn_blokkades()
returns table (kind_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select k.id
  from public.kinderen k
  join public.blokkades b
    on (b.gezin = public.gezin_sleutel(auth.uid()) and b.geblokkeerd = public.gezin_sleutel(k.user_id))
    or (b.geblokkeerd = public.gezin_sleutel(auth.uid()) and b.gezin = public.gezin_sleutel(k.user_id))
  where auth.uid() is not null;
$fn$;

-- ============================================================
-- 10. Sterren
-- ============================================================
create or replace function public.beoordelen(p_afspraak uuid, p_ander_kind uuid, p_sterren integer)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sleutel uuid;
  v_ander   uuid;
  v_status  text;
begin
  if not public._afspraak_toegang(p_afspraak) then
    raise exception 'Dit gesprek is niet van jouw gezin.';
  end if;
  v_sleutel := public.gezin_sleutel(auth.uid());
  v_ander := public.gezin_van_kind(p_ander_kind);
  if v_ander is null or v_ander = v_sleutel or not exists (
       select 1 from public.afspraak_deelnemers d where d.afspraak_id = p_afspraak and d.kind_id = p_ander_kind) then
    raise exception 'Je kan enkel een ander gezin uit deze ruil beoordelen.';
  end if;
  select status into v_status from public.afspraken where id = p_afspraak;
  if v_status not in ('GEREALISEERD', 'AFGESPRONGEN') then
    raise exception 'Sterren geven kan pas als de ruil gerealiseerd of afgesprongen is.';
  end if;
  if p_sterren is null or p_sterren < 1 or p_sterren > 5 then
    raise exception 'Kies 1 tot 5 sterren.';
  end if;

  insert into public.beoordelingen (afspraak_id, van_gezin, voor_gezin, sterren)
  values (p_afspraak, v_sleutel, v_ander, p_sterren)
  on conflict (afspraak_id, van_gezin, voor_gezin)
  do update set sterren = excluded.sterren, created_at = now();
end;
$fn$;

-- Gemiddelde en aantal per verzamelaar (de sterren zijn van zijn gezin).
-- Aantal gerealiseerde online ruilen erbij: dat is ook vertrouwen, en voor
-- niemand te bespelen met een slechte bui.
create or replace function public.gezin_sterren(p_kinderen uuid[])
returns table (kind_id uuid, gemiddelde numeric, aantal integer, gerealiseerd integer)
language sql
stable
security definer
set search_path = ''
as $fn$
  with k as (
    select k.id, public.gezin_sleutel(k.user_id) as gezin
    from public.kinderen k
    where k.id = any(p_kinderen) and auth.uid() is not null
  )
  select k.id,
         (select round(avg(b.sterren)::numeric, 2) from public.beoordelingen b where b.voor_gezin = k.gezin),
         (select count(*)::int from public.beoordelingen b where b.voor_gezin = k.gezin),
         (select count(distinct a.id)::int
            from public.afspraken a
            join public.afspraak_deelnemers d on d.afspraak_id = a.id
           where a.status = 'GEREALISEERD'
             and public.gezin_van_kind(d.kind_id) = k.gezin)
  from k;
$fn$;

-- ============================================================
-- 11. Ruilmomenten op de startpagina (niet ingelogd)
-- ============================================================
create or replace function public.ruilmomenten_info()
returns table (start timestamptz, einde timestamptz, plaats text, opmerking text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.start, m.einde, m.plaats, m.opmerking
  from public.ruilmomenten m
  where m.einde > now()
  order by m.start
  limit 6;
$fn$;

-- ============================================================
-- 12. Organisatie: geschillen en meldingen
-- ============================================================
create or replace function public.beheer_afspraken()
returns table (
  afspraak_id uuid,
  soort       text,
  status      text,
  reden       text,
  sinds       timestamptz,
  deelnemers  text,
  melding     text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select a.id, a.soort, a.status, 'geschil', a.geschil_op,
         (select string_agg(public._kind_naam(d.kind_id), ', ') from public.afspraak_deelnemers d where d.afspraak_id = a.id),
         null::text
  from public.afspraken a
  where public.is_beheerder() and a.status = 'GESCHIL'
  union all
  select a.id, a.soort, a.status, 'melding', m.created_at,
         (select string_agg(public._kind_naam(d.kind_id), ', ') from public.afspraak_deelnemers d where d.afspraak_id = a.id),
         coalesce(nullif(m.reden, ''), '(geen reden)') ||
           coalesce(' — bericht: "' || (select left(b.tekst, 200) from public.berichten b where b.id = m.bericht_id) || '"', '')
  from public.bericht_meldingen m
  join public.afspraken a on a.id = m.afspraak_id
  where public.is_beheerder() and m.behandeld is null
  order by 5 desc;
$fn$;

create or replace function public.melding_behandeld(p_afspraak uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_beheerder() then
    raise exception 'Enkel voor de organisatie.';
  end if;
  update public.bericht_meldingen set behandeld = now() where afspraak_id = p_afspraak and behandeld is null;
end;
$fn$;

-- ============================================================
-- 13. Mailmeldingen (enkel voor de Edge Function, service_role)
-- ============================================================
-- Welke gezinnen hebben ongelezen berichten van een ander gezin, minstens 10
-- minuten oud (wie actief aan het chatten is, krijgt geen mail), en kregen de
-- voorbije 3 uur geen mail? Het adres is dat van elke ouder in het gezin, of
-- het aanmeldadres als er (nog) geen gezin is. Enkel naar ouders: kinderen
-- hebben geen eigen adres in het portaal.
create or replace function public.mail_meldingen_klaar()
returns table (gezin uuid, email text, voornaam text, ongelezen integer)
language sql
stable
security definer
set search_path = ''
as $fn$
  with deel as (
    select distinct a.id as afspraak_id, public.gezin_van_kind(d.kind_id) as gezin
    from public.afspraken a
    join public.afspraak_deelnemers d on d.afspraak_id = a.id
    where a.status in ('VOORGESTELD', 'GERESERVEERD', 'BEVESTIGD', 'GESCHIL')
  ),
  open as (
    select dl.gezin, count(*)::int as ongelezen
    from deel dl
    join public.berichten b on b.afspraak_id = dl.afspraak_id
    left join public.afspraak_gelezen g on g.afspraak_id = dl.afspraak_id and g.gezin = dl.gezin
    left join public.mail_meldingen mm on mm.gezin = dl.gezin
    where b.gezin is distinct from dl.gezin
      and b.created_at > coalesce(g.gelezen_op, '-infinity'::timestamptz)
      and b.created_at > coalesce(mm.laatst_gemaild, '-infinity'::timestamptz)
      and b.created_at < now() - interval '10 minutes'
      and coalesce(mm.laatst_gemaild, '-infinity'::timestamptz) < now() - interval '3 hours'
    group by dl.gezin
  )
  select o.gezin, l.email, nullif(l.voornaam, ''), o.ongelezen
  from open o join public.gezin_leden l on l.gezin_id = o.gezin
  where nullif(l.email, '') is not null
  union
  select o.gezin, u.email::text, null, o.ongelezen
  from open o join auth.users u on u.id = o.gezin
  where not exists (select 1 from public.gezin_leden l where l.gezin_id = o.gezin)
    and nullif(u.email, '') is not null;
$fn$;

create or replace function public.mail_meldingen_verstuurd(p_gezinnen uuid[])
returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into public.mail_meldingen (gezin, laatst_gemaild)
  select g, now() from unnest(p_gezinnen) g
  on conflict (gezin) do update set laatst_gemaild = now();
$fn$;

-- ============================================================
-- 14. Rechten
-- ============================================================
do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.afspraak_voorstellen(uuid, text, jsonb, text)',
    'public.afspraak_bericht(uuid, uuid, text)',
    'public.afspraak_vrijgeven(uuid, uuid)',
    'public.afspraak_bevestigen(uuid, uuid, text, uuid, text)',
    'public.afspraak_gerealiseerd(uuid, uuid)',
    'public.afspraak_afgesprongen(uuid, uuid, text)',
    'public.afspraak_geschil_beslissen(uuid, text, text)',
    'public.mijn_afspraken()',
    'public.afspraak_detail(uuid)',
    'public.afspraken_verlopen_verwerken()',
    'public.bericht_melden(uuid, uuid, text)',
    'public.gezin_blokkeren(uuid, uuid)',
    'public.mijn_blokkades()',
    'public.beoordelen(uuid, uuid, integer)',
    'public.gezin_sterren(uuid[])',
    'public.beheer_afspraken()',
    'public.melding_behandeld(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  execute 'revoke all on function public.ruilmomenten_info() from public';
  execute 'grant execute on function public.ruilmomenten_info() to anon, authenticated';

  foreach f in array array[
    'public.mail_meldingen_klaar()',
    'public.mail_meldingen_verstuurd(uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$do$;
