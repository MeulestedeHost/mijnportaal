-- Panini Ruilportaal — een voltooide ruil automatisch verwerken in de lijst
-- Voer dit uit na sql/022_ruildossiers.sql.
--
-- WAAROM. "Ruilen wijzigt nooit iemands lijst" stond hier bewust, omdat enkel
-- de eigenaar weet wat er echt in de map zit. Maar zodra BEIDE kanten
-- bevestigen ("deze sticker werd effectief geruild"), is er geen twijfel meer
-- over wat er gebeurde — en dan is een rode herinnering ("vergeet dit niet
-- zelf aan te passen") pure wrijving. Vanaf hier past de databank zelf de
-- lijst van beide verzamelaars aan op het moment dat de tweede bevestiging
-- binnenkomt.
--
-- WAT ER PRECIES GEBEURT bij VOLTOOID (kind_a ⇄ kind_b, sticker_a ⇄ sticker_b):
--   - kind_a KRIJGT sticker_a: de ZOEKT-rij verdwijnt (geen rij meer = in het
--     album) — exact bepaalInboeking() in js/inboeken.js, "uitZoek".
--   - kind_b GEEFT sticker_a: één exemplaar minder op de RUILT-rij, of de rij
--     verdwijnt helemaal als dat het laatste exemplaar was.
--   - Spiegelbeeld voor sticker_b: kind_b krijgt, kind_a geeft.
--
-- WAT ER NIET VERANDERT. Favorieten blijven gewoon staan, ook als dat een
-- reservering "over budget" achterlaat — exact het precedent dat
-- sql/018_favorieten.sql al zet bij een handmatige aanpassing van 'aantal'
-- ("stilletjes een keuze van de gebruiker weggooien is erger dan ze even te
-- veel laten staan"). Oude, al vóór deze migratie voltooide ruilen krijgen
-- GEEN 'toegepast': niet-destructief, geen verrassende retroactieve
-- aanpassing aan een lijst die intussen allang anders kan zijn.
--
-- ALLES OF NIETS. Is een van beide lijsten intussen gewijzigd (de ruil wél
-- geregistreerd, maar de checklist nadien aangepast), dan faalt de hele
-- bevestiging met een duidelijke fout — dezelfde aanpak als ruil_registreren()
-- in sql/022. Stilzwijgend een verkeerde lijst bijwerken zou hier erger zijn
-- dan gewoon niets doen.
--
-- Niet destructief: één kolom bij op ruilen, één functie vervangen
-- (create or replace) en één functie opnieuw aangemaakt omdat de kolomlijst
-- verandert (drop + create, net als mijn_ruilen() in sql/022).

-- ============================================================
-- 1. ruilen.toegepast
-- ============================================================
alter table public.ruilen add column if not exists toegepast timestamptz;

comment on column public.ruilen.toegepast is
  'Wanneer (en dus of) deze ruil automatisch in beide lijsten verwerkt is —
   pas gezet zodra bevestigd_a én bevestigd_b allebei niet-leeg zijn. Eenmaal
   gezet kan geen van beide kanten zijn bevestiging nog intrekken: de
   stickers zijn dan al echt verplaatst.';

-- ============================================================
-- 2. ruil_bevestigen(): bij VOLTOOID meteen de lijst bijwerken
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
  v_ruil            public.ruilen%rowtype;
  v_moment          timestamptz;
  v_naam_a          text;
  v_naam_b          text;
  v_status          text;
  v_aantal_a_geeft  integer; -- kind_a's dubbels van sticker_b, vóór het wegschrijven
  v_aantal_b_geeft  integer; -- kind_b's dubbels van sticker_a, vóór het wegschrijven
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
  -- Eenmaal verwerkt in beide lijsten kan een bevestiging niet meer
  -- ingetrokken worden: de stickers zijn dan al echt verplaatst, en dat
  -- terugdraaien zou een tweede, onzichtbare aanpassing aan iemands lijst
  -- betekenen.
  if v_ruil.toegepast is not null then
    raise exception 'Deze ruil is al verwerkt in beide lijsten en kan niet meer gewijzigd worden.';
  end if;

  v_moment := case when p_bevestigd then now() end;

  if v_ruil.kind_a = p_kind_id then
    update public.ruilen set bevestigd_a = v_moment where id = p_ruil_id;
  elsif v_ruil.kind_b = p_kind_id then
    update public.ruilen set bevestigd_b = v_moment where id = p_ruil_id;
  else
    raise exception 'Die verzamelaar hoort niet bij deze ruil.';
  end if;

  select * into v_ruil from public.ruilen where id = p_ruil_id;

  -- Pas wanneer deze bevestiging de TWEEDE kant is, is de ruil voltooid.
  if v_ruil.bevestigd_a is not null and v_ruil.bevestigd_b is not null then
    select voornaam into v_naam_a from public.kinderen where id = v_ruil.kind_a;
    select voornaam into v_naam_b from public.kinderen where id = v_ruil.kind_b;

    select status into v_status from public.stickers
     where kind_id = v_ruil.kind_a and nummer = v_ruil.sticker_a;
    if v_status is distinct from 'ZOEKT' then
      raise exception 'De lijst van % is ondertussen gewijzigd — % staat er niet (meer) als "zoek ik" op. Herlaad de pagina.',
        v_naam_a, v_ruil.sticker_a;
    end if;

    select status into v_status from public.stickers
     where kind_id = v_ruil.kind_b and nummer = v_ruil.sticker_b;
    if v_status is distinct from 'ZOEKT' then
      raise exception 'De lijst van % is ondertussen gewijzigd — % staat er niet (meer) als "zoek ik" op. Herlaad de pagina.',
        v_naam_b, v_ruil.sticker_b;
    end if;

    select aantal into v_aantal_b_geeft from public.stickers
     where kind_id = v_ruil.kind_b and nummer = v_ruil.sticker_a and status = 'RUILT';
    if v_aantal_b_geeft is null then
      raise exception 'De lijst van % is ondertussen gewijzigd — % staat er niet (meer) als dubbel op. Herlaad de pagina.',
        v_naam_b, v_ruil.sticker_a;
    end if;

    select aantal into v_aantal_a_geeft from public.stickers
     where kind_id = v_ruil.kind_a and nummer = v_ruil.sticker_b and status = 'RUILT';
    if v_aantal_a_geeft is null then
      raise exception 'De lijst van % is ondertussen gewijzigd — % staat er niet (meer) als dubbel op. Herlaad de pagina.',
        v_naam_a, v_ruil.sticker_b;
    end if;

    -- Alle vier de voorwaarden kloppen: nu pas de databank echt bijwerken.
    -- "Krijgen" verwijdert de ZOEKT-rij (geen rij = in het album, zie
    -- bepaalInboeking() in js/inboeken.js); "geven" verlaagt het aantal
    -- dubbels met één, of verwijdert de rij als dit het laatste exemplaar was.
    delete from public.stickers where kind_id = v_ruil.kind_a and nummer = v_ruil.sticker_a;
    delete from public.stickers where kind_id = v_ruil.kind_b and nummer = v_ruil.sticker_b;

    if v_aantal_b_geeft > 1 then
      update public.stickers set aantal = aantal - 1
       where kind_id = v_ruil.kind_b and nummer = v_ruil.sticker_a;
    else
      delete from public.stickers where kind_id = v_ruil.kind_b and nummer = v_ruil.sticker_a;
    end if;

    if v_aantal_a_geeft > 1 then
      update public.stickers set aantal = aantal - 1
       where kind_id = v_ruil.kind_a and nummer = v_ruil.sticker_b;
    else
      delete from public.stickers where kind_id = v_ruil.kind_a and nummer = v_ruil.sticker_b;
    end if;

    update public.ruilen set toegepast = now() where id = p_ruil_id;
  end if;
end;
$fn$;

-- ============================================================
-- 3. mijn_ruilen(): 'toegepast' erbij, zodat de pagina de rode herinnering
--    enkel nog toont voor ruilen die dat nog nodig hebben (van vóór deze
--    migratie, of nog niet voltooid)
-- ============================================================
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
  toegepast         timestamptz,
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
      r.toegepast,
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
    g.toegepast,
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
-- Snelle controle
-- ============================================================
-- 1) Registreer en bevestig een ruil langs beide kanten, en kijk dan in de
--    lijsten van beide verzamelaars: de ZOEKT-rij van wat ze ontvingen moet
--    weg zijn, en hun dubbel-aantal van wat ze gaven met één verminderd (of
--    de rij weg, als het hun laatste exemplaar was).
--      select status, aantal from public.stickers
--       where kind_id = '<kind-a>' and nummer in ('<sticker_a>', '<sticker_b>');
--
-- 2) toegepast staat gezet, en intrekken lukt niet meer:
--      select toegepast from public.mijn_ruilen() where id = '<ruil-uuid>';
--      select public.ruil_bevestigen('<ruil-uuid>', '<kind-a>', false);
--      -- verwacht: foutmelding "al verwerkt in beide lijsten"
--
-- 3) Klopt een lijst niet meer (bv. de ZOEKT-rij zelf al verwijderd), dan
--    faalt de TWEEDE bevestiging met een duidelijke fout en blijft er niets
--    aangepast — ook niet de bevestiging zelf (alles-of-niets, één transactie).
