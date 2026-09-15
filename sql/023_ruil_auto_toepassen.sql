-- Panini Ruilportaal — een ruil meteen verwerken in je eigen lijst
-- Voer dit uit na sql/022_ruildossiers.sql.
--
-- DE REGEL. Bevestigen = je eigen kant verwerken. Registreren telt als
-- bevestigen. Wie registreert, ziet zijn lijst dus meteen bijgewerkt: de
-- boekhouding van een verzamelaar is zijn eigen verantwoordelijkheid, en die
-- wacht niet op iemand anders. Tot sql/022 wijzigde een ruil nooit een lijst;
-- dat blijft zo voor de kant die nog NIET bevestigde.
--
-- WAT "VERWERKEN" IS (per kant):
--   - KRIJGEN: de ZOEKT-rij verdwijnt (geen rij = in het album), exact
--     bepaalInboeking() in js/inboeken.js. Staat de sticker niet (meer) op
--     ZOEKT, dan is dat al gebeurd en wordt het overgeslagen.
--   - GEVEN: één dubbel minder, of de RUILT-rij verdwijnt bij het laatste
--     exemplaar. Is er geen dubbel meer, dan ook overslaan.
-- Wat er effectief gebeurde, wordt bijgehouden (zoekt_weg_x, dubbels_voor_x):
-- enkel zo kan het later veilig terug.
--
-- DE ANDERE KANT: RESERVERING, GEEN WIJZIGING. Zolang Sol niet antwoordt,
-- blijft haar lijst zoals ze is, maar zijn de betrokken exemplaren bezet: de
-- dubbel die ze geeft telt niet meer mee als beschikbaar, de sticker die ze
-- krijgt staat niet meer open voor andere ruilen. Dat is geen status op
-- public.stickers — daar staat één rij per sticker met een aantal, en
-- "1 van 3 dubbels bezet" past niet in een statuswoord — maar een afleiding
-- uit public.ruilen (_gereserveerd() hieronder). Er is dus niets dat uit sync
-- kan raken: de reservering verdwijnt vanzelf zodra de ruil bevestigd,
-- geweigerd of vervallen is.
--
-- NIET DOORGAAN. Weigert Sol, annuleert Guus, of antwoordt Sol niet binnen
-- DRIE DAGEN, dan zet het portaal terug wat het bij Guus verwerkte — maar
-- ENKEL als zijn lijst daar nog exact zo bij staat. Paste Guus intussen zelf
-- iets aan, dan wordt er niets aangeraakt en krijgt hij een melding
-- (nazien_x): een automatisch "herstel" bovenop een wijziging die het portaal
-- niet kent, zou de lijst net fout maken. Die drie dagen worden niet door een
-- geplande taak afgedwongen: de reservering vervalt vanzelf in de afleiding,
-- en het terugzetten gebeurt bij het eerste paginabezoek van een van beide
-- kanten (ruilen_verlopen_verwerken()).
--
-- RUILEN ZONDER ACCOUNT volgen dezelfde regel: registreren verwerkt meteen de
-- eigen lijst (eenzijdig_registreren()). Er is geen andere kant, dus ook geen
-- reservering en geen terugzetten.
--
-- FAVORIETEN. Het budget voor "heb ik dubbel" telt vanaf nu enkel VRIJE
-- dubbels: een dubbel die al in een openstaande ruil zit, is al beloofd.
-- Bestaande favorieten blijven staan, ook boven budget (precedent sql/018).
--
-- OUDE RUILEN (van vóór deze migratie) hebben geen verwerkt_x. Ze worden niet
-- retroactief verwerkt, reserveren niets en vervallen niet: daar blijft het
-- zoals het was, met de herinnering om je lijst zelf na te kijken.
--
-- Niet destructief: kolommen bij, één index opnieuw aangemaakt, functies
-- vervangen of bijgemaakt, één schrijfrecht ingetrokken (rechtstreeks
-- invoegen in eenzijdige_ruilen, dat voortaan via de functie gaat).

-- ============================================================
-- 1. Kolommen
-- ============================================================
alter table public.ruilen add column if not exists verwerkt_a     timestamptz;
alter table public.ruilen add column if not exists verwerkt_b     timestamptz;
alter table public.ruilen add column if not exists zoekt_weg_a    boolean;
alter table public.ruilen add column if not exists zoekt_weg_b    boolean;
alter table public.ruilen add column if not exists dubbels_voor_a integer;
alter table public.ruilen add column if not exists dubbels_voor_b integer;
alter table public.ruilen add column if not exists nazien_a       timestamptz;
alter table public.ruilen add column if not exists nazien_b       timestamptz;
alter table public.ruilen add column if not exists geweigerd_door uuid references public.kinderen(id) on delete set null;
alter table public.ruilen add column if not exists vervallen      timestamptz;

comment on column public.ruilen.verwerkt_a is
  'Wanneer de lijst van kind_a voor deze ruil bijgewerkt werd (bij zijn bevestiging). Leeg = niet verwerkt, of weer teruggezet.';
comment on column public.ruilen.zoekt_weg_a is
  'Verwijderde de verwerking de ZOEKT-rij van kind_a? Nodig om veilig terug te zetten.';
comment on column public.ruilen.dubbels_voor_a is
  'Aantal dubbels van kind_a vóór de verwerking (leeg = er werd niets gegeven). Nodig om veilig terug te zetten.';
comment on column public.ruilen.nazien_a is
  'De ruil ging niet door, maar de lijst van kind_a was intussen gewijzigd en werd daarom NIET teruggezet.';

alter table public.eenzijdige_ruilen add column if not exists verwerkt timestamptz;

-- Een vervallen paar is niet meer openstaand: hetzelfde paar mag daarna
-- opnieuw geregistreerd worden.
drop index if exists public.ruilen_uniek_openstaand;
create unique index ruilen_uniek_openstaand
  on public.ruilen (kind_a, kind_b, sticker_a, sticker_b)
  where (bevestigd_a is null or bevestigd_b is null) and geweigerd is null and vervallen is null;

-- ============================================================
-- 2. Hulpfuncties (intern — geen rechten voor de pagina)
-- ============================================================
-- Eén plek voor de termijn.
create or replace function public._ruil_termijn()
returns interval
language sql
immutable
set search_path = ''
as $fn$ select interval '3 days' $fn$;

-- Hoeveel openstaande ruilen reserveren deze sticker bij dit kind?
-- p_richting 'geeft': dit kind moet hem nog afgeven; 'krijgt': dit kind moet
-- hem nog ontvangen. Enkel de kant die nog niet verwerkte, is gereserveerd.
create or replace function public._gereserveerd(p_kind_id uuid, p_code text, p_richting text)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
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
    );
$fn$;

-- Dubbels die nog niet in een openstaande ruil beloofd zijn.
create or replace function public._dubbels_vrij(p_kind_id uuid, p_code text)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select greatest(
    coalesce((select s.aantal from public.stickers s
               where s.kind_id = p_kind_id and s.nummer = p_code and s.status = 'RUILT'), 0)
    - public._gereserveerd(p_kind_id, p_code, 'geeft'),
    0);
$fn$;

-- Staat deze sticker op "zoek ik", en is hij nog niet beloofd in een ruil?
create or replace function public._zoekt_vrij(p_kind_id uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (select 1 from public.stickers s
                  where s.kind_id = p_kind_id and s.nummer = p_code and s.status = 'ZOEKT')
     and public._gereserveerd(p_kind_id, p_code, 'krijgt') = 0;
$fn$;

-- De lijst van één kant bijwerken. Doet niets als die kant al verwerkt is.
create or replace function public._ruil_kant_verwerken(p_ruil_id uuid, p_kind_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ruil      public.ruilen%rowtype;
  v_krijgt    text;
  v_geeft     text;
  v_status    text;
  v_aantal    integer;
  v_zoekt_weg boolean := false;
begin
  select * into v_ruil from public.ruilen where id = p_ruil_id for update;
  if not found then
    raise exception 'Die ruil bestaat niet.';
  end if;

  if v_ruil.kind_a = p_kind_id then
    if v_ruil.verwerkt_a is not null then return; end if;
    v_krijgt := v_ruil.sticker_a;
    v_geeft  := v_ruil.sticker_b;
  elsif v_ruil.kind_b = p_kind_id then
    if v_ruil.verwerkt_b is not null then return; end if;
    v_krijgt := v_ruil.sticker_b;
    v_geeft  := v_ruil.sticker_a;
  else
    raise exception 'Die verzamelaar hoort niet bij deze ruil.';
  end if;

  select s.status into v_status from public.stickers s
   where s.kind_id = p_kind_id and s.nummer = v_krijgt
   for update;
  if v_status = 'ZOEKT' then
    delete from public.stickers where kind_id = p_kind_id and nummer = v_krijgt;
    v_zoekt_weg := true;
  end if;

  select s.aantal into v_aantal from public.stickers s
   where s.kind_id = p_kind_id and s.nummer = v_geeft and s.status = 'RUILT'
   for update;
  if v_aantal > 1 then
    update public.stickers set aantal = v_aantal - 1
     where kind_id = p_kind_id and nummer = v_geeft;
  elsif v_aantal = 1 then
    delete from public.stickers where kind_id = p_kind_id and nummer = v_geeft;
  end if;

  if v_ruil.kind_a = p_kind_id then
    update public.ruilen
       set verwerkt_a = now(), zoekt_weg_a = v_zoekt_weg, dubbels_voor_a = v_aantal
     where id = p_ruil_id;
  else
    update public.ruilen
       set verwerkt_b = now(), zoekt_weg_b = v_zoekt_weg, dubbels_voor_b = v_aantal
     where id = p_ruil_id;
  end if;
end;
$fn$;

-- De verwerking van één kant ongedaan maken — enkel als de lijst nog exact
-- is wat de verwerking achterliet. Anders niets aanraken en nazien_x zetten.
-- Geeft terug of het terugzetten lukte (of niet nodig was).
create or replace function public._ruil_kant_terugzetten(p_ruil_id uuid, p_kind_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ruil      public.ruilen%rowtype;
  v_is_a      boolean;
  v_krijgt    text;
  v_geeft     text;
  v_verwerkt  timestamptz;
  v_zoekt_weg boolean;
  v_voor      integer;
  v_status    text;
  v_aantal    integer;
  v_ok        boolean := true;
begin
  select * into v_ruil from public.ruilen where id = p_ruil_id for update;
  if not found then
    raise exception 'Die ruil bestaat niet.';
  end if;

  if v_ruil.kind_a = p_kind_id then
    v_is_a := true;
    v_krijgt := v_ruil.sticker_a; v_geeft := v_ruil.sticker_b;
    v_verwerkt := v_ruil.verwerkt_a; v_zoekt_weg := v_ruil.zoekt_weg_a; v_voor := v_ruil.dubbels_voor_a;
  elsif v_ruil.kind_b = p_kind_id then
    v_is_a := false;
    v_krijgt := v_ruil.sticker_b; v_geeft := v_ruil.sticker_a;
    v_verwerkt := v_ruil.verwerkt_b; v_zoekt_weg := v_ruil.zoekt_weg_b; v_voor := v_ruil.dubbels_voor_b;
  else
    raise exception 'Die verzamelaar hoort niet bij deze ruil.';
  end if;

  if v_verwerkt is null then
    return true;
  end if;

  -- Klopt de lijst nog met wat de verwerking achterliet?
  if v_zoekt_weg then
    perform 1 from public.stickers s
     where s.kind_id = p_kind_id and s.nummer = v_krijgt
     for update;
    if found then v_ok := false; end if;
  end if;

  if v_voor is not null then
    select s.status, s.aantal into v_status, v_aantal from public.stickers s
     where s.kind_id = p_kind_id and s.nummer = v_geeft
     for update;
    if v_voor > 1 then
      if v_status is distinct from 'RUILT' or v_aantal is distinct from v_voor - 1 then
        v_ok := false;
      end if;
    elsif v_status is not null then
      v_ok := false;
    end if;
  end if;

  if v_ok then
    if v_zoekt_weg then
      insert into public.stickers (kind_id, nummer, status, aantal)
      values (p_kind_id, v_krijgt, 'ZOEKT', 1);
    end if;
    if v_voor is not null then
      insert into public.stickers (kind_id, nummer, status, aantal)
      values (p_kind_id, v_geeft, 'RUILT', v_voor)
      on conflict (kind_id, nummer) do update set status = 'RUILT', aantal = excluded.aantal;
    end if;
  end if;

  if v_is_a then
    update public.ruilen
       set verwerkt_a = null, zoekt_weg_a = null, dubbels_voor_a = null,
           nazien_a = case when v_ok then null else now() end
     where id = p_ruil_id;
  else
    update public.ruilen
       set verwerkt_b = null, zoekt_weg_b = null, dubbels_voor_b = null,
           nazien_b = case when v_ok then null else now() end
     where id = p_ruil_id;
  end if;

  return v_ok;
end;
$fn$;

-- Een ruil waar de andere kant niet binnen de termijn antwoordde: de
-- verwerkte kant terugzetten en de ruil als vervallen markeren.
create or replace function public._ruil_laten_vervallen(p_ruil_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ruil public.ruilen%rowtype;
begin
  select * into v_ruil from public.ruilen where id = p_ruil_id for update;
  if not found
     or v_ruil.geweigerd is not null
     or v_ruil.vervallen is not null
     or (v_ruil.bevestigd_a is not null and v_ruil.bevestigd_b is not null)
     or (v_ruil.verwerkt_a is null) = (v_ruil.verwerkt_b is null)
     or coalesce(v_ruil.verwerkt_a, v_ruil.verwerkt_b) > now() - public._ruil_termijn() then
    return;
  end if;

  perform public._ruil_kant_terugzetten(
    p_ruil_id,
    case when v_ruil.verwerkt_a is not null then v_ruil.kind_a else v_ruil.kind_b end
  );
  update public.ruilen set vervallen = now() where id = p_ruil_id;
end;
$fn$;

revoke all on function public._ruil_termijn() from public, anon, authenticated;
revoke all on function public._gereserveerd(uuid, text, text) from public, anon, authenticated;
revoke all on function public._dubbels_vrij(uuid, text) from public, anon, authenticated;
revoke all on function public._zoekt_vrij(uuid, text) from public, anon, authenticated;
revoke all on function public._ruil_kant_verwerken(uuid, uuid) from public, anon, authenticated;
revoke all on function public._ruil_kant_terugzetten(uuid, uuid) from public, anon, authenticated;
revoke all on function public._ruil_laten_vervallen(uuid) from public, anon, authenticated;

-- ============================================================
-- 3. Vervallen ruilen afhandelen (bij elk paginabezoek)
-- ============================================================
-- Enkel ruilen waar het eigen gezin bij hoort: wie de pagina opent, ruimt
-- zijn eigen verlopen afspraken op. Voor derden speelt het geen rol — de
-- reservering telt na de termijn al niet meer mee in _gereserveerd().
create or replace function public.ruilen_verlopen_verwerken()
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
    select r.id
    from public.ruilen r
    where r.geweigerd is null
      and r.vervallen is null
      and (r.bevestigd_a is null or r.bevestigd_b is null)
      and (r.verwerkt_a is null) <> (r.verwerkt_b is null)
      and coalesce(r.verwerkt_a, r.verwerkt_b) <= now() - public._ruil_termijn()
      and (public.gezin_van_kind(r.kind_a) = v_sleutel
        or public.gezin_van_kind(r.kind_b) = v_sleutel)
  loop
    perform public._ruil_laten_vervallen(v_id);
    v_aantal := v_aantal + 1;
  end loop;

  return v_aantal;
end;
$fn$;

revoke all on function public.ruilen_verlopen_verwerken() from public;
revoke all on function public.ruilen_verlopen_verwerken() from anon;
grant execute on function public.ruilen_verlopen_verwerken() to authenticated;

-- ============================================================
-- 4. ruil_registreren(): reserveringen tellen mee
-- ============================================================
-- Zelfde handtekening als in sql/022. Twee verschillen:
--   - Een bestaand openstaand paar komt terug VÓÓR de controle op de lijsten:
--     de kant die al registreerde, heeft zijn lijst al bijgewerkt, dus die
--     controle zou net falen op wat het portaal zelf deed.
--   - Een nieuw paar kan enkel met exemplaren die nog niet in een andere
--     openstaande ruil beloofd zijn — aan beide kanten.
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
  v_oud       uuid;
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

  if p_eigen_kind < p_ander_kind then
    v_a := p_eigen_kind; v_sticker_a := p_ik_krijg;
    v_b := p_ander_kind; v_sticker_b := p_ander_krijgt;
  else
    v_a := p_ander_kind; v_sticker_a := p_ander_krijgt;
    v_b := p_eigen_kind; v_sticker_b := p_ik_krijg;
  end if;

  -- Verlopen afspraken van deze twee eerst afhandelen, zodat ze deze
  -- registratie niet blokkeren.
  for v_oud in
    select r.id from public.ruilen r
    where (r.kind_a in (v_a, v_b) or r.kind_b in (v_a, v_b))
      and r.geweigerd is null and r.vervallen is null
  loop
    perform public._ruil_laten_vervallen(v_oud);
  end loop;

  -- Twee registraties tegelijk op dezelfde laatste dubbel: de tweede wacht
  -- hier tot de eerste klaar is, en ziet dan de reservering.
  perform 1 from public.stickers s
   where s.kind_id in (p_eigen_kind, p_ander_kind)
     and s.nummer in (p_ik_krijg, p_ander_krijgt)
   for update;

  select r.id into v_id
  from public.ruilen r
  where r.kind_a = v_a and r.kind_b = v_b
    and r.sticker_a = v_sticker_a and r.sticker_b = v_sticker_b
    and (r.bevestigd_a is null or r.bevestigd_b is null)
    and r.geweigerd is null
    and r.vervallen is null;
  if found then
    return v_id;
  end if;

  if not public._zoekt_vrij(p_eigen_kind, p_ik_krijg)
     or public._dubbels_vrij(p_ander_kind, p_ik_krijg) < 1
     or public._dubbels_vrij(p_eigen_kind, p_ander_krijgt) < 1
     or not public._zoekt_vrij(p_ander_kind, p_ander_krijgt) then
    raise exception 'De ruil % ⇄ % kan niet meer — een van beide lijsten is ondertussen aangepast, of een sticker zit al in een andere ruil die nog bevestigd moet worden. Herlaad de pagina.',
      p_ik_krijg, p_ander_krijgt;
  end if;

  insert into public.ruilen (kind_a, kind_b, sticker_a, sticker_b, aangemaakt_door)
  values (v_a, v_b, v_sticker_a, v_sticker_b, auth.uid())
  returning id into v_id;

  return v_id;
end;
$fn$;

-- ============================================================
-- 5. ruil_dossier_registreren(): registreren = bevestigen = verwerken
-- ============================================================
-- Nog steeds alles of niets. Per paar: registreren, bevestigen en de eigen
-- lijst meteen bijwerken — het volgende paar rekent dus al verder op die
-- bijgewerkte lijst. Stond de eigen kant al bevestigd zonder verwerking (een
-- ruil van vóór deze migratie), dan blijft dat zo.
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

    select * into v_ruil from public.ruilen where id = v_id for update;
    if v_ruil.kind_a = p_eigen_kind then
      if v_ruil.bevestigd_a is null then
        update public.ruilen set bevestigd_a = now() where id = v_id;
        perform public._ruil_kant_verwerken(v_id, p_eigen_kind);
      end if;
    else
      if v_ruil.bevestigd_b is null then
        update public.ruilen set bevestigd_b = now() where id = v_id;
        perform public._ruil_kant_verwerken(v_id, p_eigen_kind);
      end if;
    end if;
  end loop;

  return v_dossier;
end;
$fn$;

-- ============================================================
-- 6. ruil_bevestigen(): bevestigen verwerkt, intrekken annuleert
-- ============================================================
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
  v_ruil public.ruilen%rowtype;
  v_is_a boolean;
  v_eigen_bevestigd timestamptz;
  v_eigen_verwerkt  timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Niet aangemeld.';
  end if;
  if public.gezin_van_kind(p_kind_id) is distinct from public.gezin_sleutel(auth.uid()) then
    raise exception 'Je kan enkel voor je eigen verzamelaar bevestigen.';
  end if;

  select * into v_ruil from public.ruilen where id = p_ruil_id for update;
  if not found then
    raise exception 'Die ruil bestaat niet.';
  end if;
  if v_ruil.geweigerd is not null then
    raise exception 'Deze ruil werd geweigerd of geannuleerd en kan niet meer bevestigd worden.';
  end if;
  if v_ruil.vervallen is not null
     or ((v_ruil.bevestigd_a is null or v_ruil.bevestigd_b is null)
         and (v_ruil.verwerkt_a is null) <> (v_ruil.verwerkt_b is null)
         and coalesce(v_ruil.verwerkt_a, v_ruil.verwerkt_b) <= now() - public._ruil_termijn()) then
    raise exception 'Deze ruil is vervallen: hij werd niet binnen 3 dagen bevestigd. Herlaad de pagina.';
  end if;

  if v_ruil.kind_a = p_kind_id then
    v_is_a := true;
    v_eigen_bevestigd := v_ruil.bevestigd_a;
    v_eigen_verwerkt  := v_ruil.verwerkt_a;
  elsif v_ruil.kind_b = p_kind_id then
    v_is_a := false;
    v_eigen_bevestigd := v_ruil.bevestigd_b;
    v_eigen_verwerkt  := v_ruil.verwerkt_b;
  else
    raise exception 'Die verzamelaar hoort niet bij deze ruil.';
  end if;

  if p_bevestigd then
    if v_eigen_bevestigd is not null then
      return;
    end if;
    if v_is_a then
      update public.ruilen set bevestigd_a = now() where id = p_ruil_id;
    else
      update public.ruilen set bevestigd_b = now() where id = p_ruil_id;
    end if;
    perform public._ruil_kant_verwerken(p_ruil_id, p_kind_id);
    return;
  end if;

  -- Intrekken.
  if v_eigen_bevestigd is null then
    return;
  end if;
  if v_ruil.bevestigd_a is not null and v_ruil.bevestigd_b is not null then
    raise exception 'Deze ruil is al door beide kanten bevestigd — intrekken kan niet meer.';
  end if;

  if v_eigen_verwerkt is null then
    -- Een ruil van vóór deze migratie: zoals vroeger, enkel de bevestiging weg.
    if v_is_a then
      update public.ruilen set bevestigd_a = null where id = p_ruil_id;
    else
      update public.ruilen set bevestigd_b = null where id = p_ruil_id;
    end if;
    return;
  end if;

  -- De eigen lijst werd al bijgewerkt: intrekken is de ruil annuleren.
  perform public._ruil_kant_terugzetten(p_ruil_id, p_kind_id);
  update public.ruilen
     set geweigerd = now(),
         geweigerd_door = p_kind_id,
         bevestigd_a = case when v_is_a then null else bevestigd_a end,
         bevestigd_b = case when v_is_a then bevestigd_b else null end
   where id = p_ruil_id;
end;
$fn$;

-- ============================================================
-- 7. ruil_weigeren(): de andere kant terugzetten
-- ============================================================
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

  select * into v_ruil from public.ruilen where id = p_ruil_id for update;
  if not found then
    raise exception 'Die ruil bestaat niet.';
  end if;
  if v_ruil.kind_a <> p_kind_id and v_ruil.kind_b <> p_kind_id then
    raise exception 'Die verzamelaar hoort niet bij deze ruil.';
  end if;
  if v_ruil.geweigerd is not null then
    return;
  end if;
  if v_ruil.vervallen is not null then
    raise exception 'Deze ruil is al vervallen.';
  end if;
  if v_ruil.bevestigd_a is not null and v_ruil.bevestigd_b is not null then
    raise exception 'Deze ruil is al door beide kanten bevestigd.';
  end if;

  -- Wat het portaal al verwerkte, veilig terugzetten — aan welke kant ook.
  perform public._ruil_kant_terugzetten(p_ruil_id, v_ruil.kind_a);
  perform public._ruil_kant_terugzetten(p_ruil_id, v_ruil.kind_b);

  update public.ruilen
  set geweigerd = now(),
      geweigerd_door = p_kind_id,
      bevestigd_a = case when kind_a = p_kind_id then null else bevestigd_a end,
      bevestigd_b = case when kind_b = p_kind_id then null else bevestigd_b end
  where id = p_ruil_id;
end;
$fn$;

-- ============================================================
-- 8. Ruilen zonder account: meteen verwerken
-- ============================================================
-- Krijgen volgt bepaalInboeking() volledig (ZOEKT → weg, anders een dubbel
-- meer): er is geen match die garandeert dat de sticker gezocht werd. Geven
-- kan enkel met een vrije dubbel — wie iets weggeeft wat hij niet dubbel
-- heeft, zou een gat in zijn album slaan.
create or replace function public.eenzijdig_registreren(
  p_eigen_kind  uuid,
  p_tegenpartij text,
  p_paren       jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_dossier uuid := gen_random_uuid();
  v_paar    jsonb;
  v_krijg   text;
  v_geef    text;
  v_status  text;
  v_aantal  integer;
begin
  if auth.uid() is null then
    raise exception 'Niet aangemeld.';
  end if;
  if public.gezin_van_kind(p_eigen_kind) is distinct from public.gezin_sleutel(auth.uid()) then
    raise exception 'Die verzamelaar hoort niet bij jouw gezin.';
  end if;
  if length(trim(coalesce(p_tegenpartij, ''))) = 0 then
    raise exception 'Met wie ruil je?';
  end if;
  if jsonb_typeof(p_paren) is distinct from 'array' or jsonb_array_length(p_paren) = 0 then
    raise exception 'Kies minstens één ruil.';
  end if;

  for v_paar in select * from jsonb_array_elements(p_paren) loop
    v_krijg := v_paar->>'ik_krijg';
    v_geef  := v_paar->>'ander_krijgt';
    if v_krijg is null or v_geef is null then
      raise exception 'Elke ruil heeft een sticker aan beide kanten nodig.';
    end if;
    if v_krijg = v_geef then
      raise exception 'Beide kanten van de ruil zijn dezelfde sticker.';
    end if;

    perform 1 from public.stickers s
     where s.kind_id = p_eigen_kind and s.nummer in (v_krijg, v_geef)
     for update;

    -- Geven
    if public._dubbels_vrij(p_eigen_kind, v_geef) < 1 then
      raise exception 'Je hebt % niet (meer) vrij als dubbel — hij staat niet in je dubbels, of zit al in een andere ruil.', v_geef;
    end if;
    select s.aantal into v_aantal from public.stickers s
     where s.kind_id = p_eigen_kind and s.nummer = v_geef and s.status = 'RUILT';
    if v_aantal > 1 then
      update public.stickers set aantal = v_aantal - 1
       where kind_id = p_eigen_kind and nummer = v_geef;
    else
      delete from public.stickers where kind_id = p_eigen_kind and nummer = v_geef;
    end if;

    -- Krijgen
    v_status := null;
    select s.status into v_status from public.stickers s
     where s.kind_id = p_eigen_kind and s.nummer = v_krijg;
    if v_status = 'ZOEKT' then
      if public._gereserveerd(p_eigen_kind, v_krijg, 'krijgt') > 0 then
        raise exception '% zit al in een andere ruil die nog bevestigd moet worden.', v_krijg;
      end if;
      delete from public.stickers where kind_id = p_eigen_kind and nummer = v_krijg;
    elsif v_status = 'RUILT' then
      update public.stickers set aantal = aantal + 1
       where kind_id = p_eigen_kind and nummer = v_krijg;
    else
      insert into public.stickers (kind_id, nummer, status, aantal)
      values (p_eigen_kind, v_krijg, 'RUILT', 1);
    end if;

    insert into public.eenzijdige_ruilen
      (kind_id, dossier_id, tegenpartij, ik_krijg, ik_geef, aangemaakt_door, verwerkt)
    values
      (p_eigen_kind, v_dossier, trim(p_tegenpartij), v_krijg, v_geef, auth.uid(), now());
  end loop;

  return v_dossier;
end;
$fn$;

revoke all on function public.eenzijdig_registreren(uuid, text, jsonb) from public;
revoke all on function public.eenzijdig_registreren(uuid, text, jsonb) from anon;
grant execute on function public.eenzijdig_registreren(uuid, text, jsonb) to authenticated;

-- Rechtstreeks invoegen zou een ruil vastleggen zonder de lijst bij te werken.
drop policy if exists eenzijdige_ruilen_insert on public.eenzijdige_ruilen;
revoke insert on public.eenzijdige_ruilen from authenticated;

-- ============================================================
-- 9. Favorieten: enkel vrije dubbels tellen voor het budget
-- ============================================================
create or replace function public.favoriet_budget_bewaken()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_budget   integer;
  v_gebruikt integer;
begin
  if new.richting <> 'jij_hebt_dubbel' then
    return new;
  end if;

  v_budget := public._dubbels_vrij(new.kind_id, new.code);

  select count(*)
    into v_gebruikt
    from public.favorieten f
   where f.kind_id  = new.kind_id
     and f.code     = new.code
     and f.richting = 'jij_hebt_dubbel'
     and f.id is distinct from new.id;

  if v_gebruikt >= v_budget then
    raise exception
      'Je hebt % keer % vrij als dubbel, en die zijn al gereserveerd of zitten in een ruil. Geef er eerst een vrij.',
      v_budget, new.code
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

-- ============================================================
-- 10. get_matches(): gereserveerde exemplaren tellen niet mee
-- ============================================================
-- Zelfde kolommen als sql/021. 'aantal' is voortaan het aantal VRIJE
-- exemplaren; een ruilkans verdwijnt als er niets meer vrij is.
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
  where (g.aan or not c.glans)
    and public._dubbels_vrij(ek.id, mij.nummer) > 0
    and public._zoekt_vrij(ander.kind_id, ander.nummer)

  order by 1, 4, 3, 2;
$fn$;

revoke all on function public.get_matches(uuid) from public;
revoke all on function public.get_matches(uuid) from anon;
grant execute on function public.get_matches(uuid) to authenticated;

-- ============================================================
-- 11. mijn_ruilen(): verwerking, termijn en vervallen
-- ============================================================
-- Tegenover sql/022 erbij: eigen_verwerkt, ander_verwerkt, eigen_nazien,
-- ander_nazien, geweigerd_door, vervalt_op, en de status VERVALLEN (ook al
-- vóór ruilen_verlopen_verwerken() hem effectief afhandelde).
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
  eigen_verwerkt    timestamptz,
  eigen_nazien      timestamptz,
  ander_kind_id     uuid,
  ander_kind        text,
  ander_krijgt      text,
  ander_krijgt_naam text,
  ander_krijgt_land text,
  ander_bevestigd   timestamptz,
  ander_verwerkt    timestamptz,
  ander_nazien      timestamptz,
  eigen_gezin       boolean,
  door_eigen_gezin  boolean,
  geweigerd         timestamptz,
  geweigerd_door    uuid,
  vervalt_op        timestamptz,
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
      r.*,
      (public.gezin_van_kind(r.kind_a) = s.id) as ik_ben_a,
      (r.aangemaakt_door is not null and public.gezin_sleutel(r.aangemaakt_door) = s.id) as door_eigen,
      case
        when r.geweigerd is null and r.vervallen is null
         and (r.bevestigd_a is null or r.bevestigd_b is null)
         and (r.verwerkt_a is null) <> (r.verwerkt_b is null)
        then coalesce(r.verwerkt_a, r.verwerkt_b) + public._ruil_termijn()
      end as termijn_einde
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
    case when g.ik_ben_a then g.verwerkt_a else g.verwerkt_b end,
    case when g.ik_ben_a then g.nazien_a else g.nazien_b end,
    case when g.ik_ben_a then g.kind_b else g.kind_a end,
    (select k.voornaam from public.kinderen k
      where k.id = case when g.ik_ben_a then g.kind_b else g.kind_a end),
    case when g.ik_ben_a then g.sticker_b else g.sticker_a end,
    (select c.naam from public.sticker_catalogus c
      where c.code = case when g.ik_ben_a then g.sticker_b else g.sticker_a end),
    (select c.land_code from public.sticker_catalogus c
      where c.code = case when g.ik_ben_a then g.sticker_b else g.sticker_a end),
    case when g.ik_ben_a then g.bevestigd_b else g.bevestigd_a end,
    case when g.ik_ben_a then g.verwerkt_b else g.verwerkt_a end,
    case when g.ik_ben_a then g.nazien_b else g.nazien_a end,
    public.gezin_van_kind(g.kind_a) = public.gezin_van_kind(g.kind_b),
    g.door_eigen,
    g.geweigerd,
    g.geweigerd_door,
    case when g.termijn_einde > now() then g.termijn_einde end,
    case
      when g.geweigerd is not null then 'GEWEIGERD'
      when g.vervallen is not null or g.termijn_einde <= now() then 'VERVALLEN'
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
-- 12. Opvolging: VERVALLEN apart tonen
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
      when r.vervallen is not null
        or ((r.bevestigd_a is null or r.bevestigd_b is null)
            and (r.verwerkt_a is null) <> (r.verwerkt_b is null)
            and coalesce(r.verwerkt_a, r.verwerkt_b) <= now() - public._ruil_termijn()) then 'VERVALLEN'
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
-- Snelle controle
-- ============================================================
-- 1) Guus registreert (FRA12 weg, ARG1 erbij). Meteen daarna:
--      select status, aantal from public.stickers
--       where kind_id = '<guus>' and nummer in ('ARG1', 'FRA12');
--    -- ARG1: geen rij meer (was ZOEKT); FRA12: één dubbel minder of weg.
--    Sol's lijst is ongewijzigd, maar:
--      select public._dubbels_vrij('<sol>', 'ARG1');   -- één minder dan haar aantal
--
-- 2) Sol bevestigt → haar lijst bijgewerkt, status VOLTOOID.
--
-- 3) Sol weigert → Guus' ARG1 staat terug op ZOEKT en FRA12 terug op het oude
--    aantal — tenzij Guus intussen zelf iets aanpaste: dan blijft alles staan
--    en is nazien gezet:
--      select eigen_nazien from public.mijn_ruilen() where id = '<ruil>';
