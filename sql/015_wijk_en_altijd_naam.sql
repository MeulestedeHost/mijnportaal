-- Panini Ruilportaal — Voornaam altijd zichtbaar + wijk/gemeente bij een match
-- Voer dit uit na sql/014_na_beurs_contact.sql.
--
-- WAT VERANDERT ER EN WAAROM. Tot nu toonde get_matches de voornaam van een
-- ánder gezin pas zodra het beursvenster begon. Het idee was: wie eerder wil
-- weten met wie hij kan ruilen, moet daarvoor naar de beurs komen. In de
-- praktijk wonen sommige verzamelaars naast elkaar — die hoeven niet tot de
-- beurs te wachten om al te ruilen, en dat scheelt drukte op de beursdag zelf
-- voor wie wél van ver komt. Twee dingen dus:
--
--   1. De voornaam van een match komt vanaf nu ALTIJD mee terug, ongeacht het
--      beursvenster. E-mailadres en WhatsApp blijven wél pas na de beurs
--      zichtbaar (sql/014) — voor die twee verandert hier niets.
--   2. Een gezin kan optioneel een wijk (in Gent) of gemeente invullen. Is dat
--      ingevuld, dan komt het mee bij elke match met een ánder gezin — meteen,
--      niet pas na de beurs — zodat je in één oogopslag ziet of het om een
--      buur gaat of om iemand die verder weg woont.
--
-- GEEN VINKJE VOOR DE WIJK, ZOALS BIJ TELEFOON. Leeg laten is hier het
-- vinkje: vul je niets in, dan komt er ook niets terug (net als e-mail leeg
-- zou zijn moest iemand ooit zonder e-mailadres kunnen inloggen). Er is dus
-- geen aparte 'wijk_delen'-kolom nodig.
--
-- Niet destructief: er verdwijnt geen kolom of rij, get_matches krijgt enkel
-- een kolom extra (drop+create is nodig omdat Postgres de kolomlijst van een
-- functie niet via create or replace kan wijzigen).

-- ============================================================
-- 1. Kolom voor wijk/gemeente
-- ============================================================
alter table public.gezinnen
  add column if not exists wijk text;

comment on column public.gezinnen.wijk is
  'Wijk in Gent, of gemeente daarbuiten. Vrij invulveld, leeg mag. Komt mee bij
   elke match met een ánder gezin, ongeacht het beursvenster — zie get_matches().';

-- ============================================================
-- 2. get_matches(): voornaam altijd, wijk altijd, e-mail/telefoon pas na de beurs
-- ============================================================
drop function if exists public.get_matches(uuid);

create function public.get_matches(p_kind_id uuid)
returns table (
  richting       text,
  code           text,
  nummer         integer,
  land_code      text,
  land_naam      text,
  land_naam_en   text,
  sticker_naam   text,
  aantal         integer,
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
    c.naam,
    ander.aantal,
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

  union   -- union, niet union all: dezelfde sticker via meerdere kinderen van
          -- hetzelfde gezin valt zo samen tot één regel

  -- Jij hebt deze sticker dubbel, iemand anders zoekt ze
  select
    'jij_hebt_dubbel'::text,
    c.code,
    c.nummer,
    c.land_code,
    c.land_naam,
    c.land_naam_en,
    c.naam,
    mij.aantal,
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
-- Wat hierdoor ongebruikt raakt
-- ============================================================
-- public.beurs_actief() wordt door get_matches niet langer aangeroepen — de
-- voornaam hangt niet meer af van het beursvenster. De functie blijft gewoon
-- bestaan (sql/006) voor het geval een latere pagina "is de beurs nu bezig"
-- rechtstreeks moet kunnen opvragen.
