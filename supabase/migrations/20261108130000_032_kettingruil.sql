-- Panini Ruilportaal — kettingruil voor 3 of 4 verzamelaars
-- Bouwt voort op sql/023 (vrije exemplaren) en sql/025 (aanwezigheid).
--
-- WAAROM. Een gewone ruil vraagt dat twee verzamelaars elk iets hebben wat de
-- ander zoekt. Vaak klopt maar één richting: Sol wil jouw dubbel, maar heeft
-- niets voor jou. Een kring lost dat op — jij geeft aan Sol, Sol aan Jules,
-- Jules aan jou (Todo.md, "Ruilkringen": het enige wat een score niet kan).
-- get_matches() toont enkel wat tussen JOU en een ander past; wat Sol en Jules
-- onderling kunnen, ziet niemand. Daarom deze twee functies.
--
-- WAT ER PRIJSGEGEVEN WORDT, EN WAAROM DAT AANVAARDBAAR IS. ketting_lijsten()
-- geeft de volledige vrije Zoek ik- en dubbellijst van de gekozen verzamelaars.
-- Dat is meer dan get_matches(), maar nodig zodra er een gast (geen account)
-- meedoet: van die gast typ je codes in, en dan moet je per code weten wie van
-- de groep hem zoekt of dubbel heeft — zonder een aanvraag per code op de
-- beurswifi. Begrensd: hoogstens 3 anderen per aanvraag, en enkel wie in de
-- huidige fase ook in get_matches() zou mogen verschijnen. Geen naam buiten
-- voornaam + eerste letter (sql/021), geen contactgegevens.
--
-- WAT ER BEWUST NIET BIJKOMT. Geen tabel en geen nieuwe ruilstatus. Elke
-- deelnemer legt zijn eigen deel vast met eenzijdig_registreren() (sql/023):
-- "ik kreeg X, ik gaf Y" — dat is één paar, precies zoals die functie het
-- verwacht, en het verwerkt meteen de eigen lijst. Bevestigen = je eigen lijst
-- verwerken blijft dus gelden, en er blijft niets hangen omdat één schakel
-- van de kring niet bevestigt.
--
-- Niet destructief: enkel nieuwe functies.

-- ============================================================
-- 1. Mag deze verzamelaar als tegenpartij verschijnen?
-- ============================================================
-- DEZELFDE REGEL als de CTE 'zichtbaar' in get_matches() (sql/025). Wie die
-- regel aanpast, past hem hier mee aan. get_matches() zelf blijft ongemoeid:
-- die is de kern van zes schermen, en hem herschrijven voor een nieuwe functie
-- is een risico dat deze functie niet waard is.
create or replace function public._tegenpartij_zichtbaar(p_eigen_kind uuid, p_ander uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  with f as (select h.id as event_id, h.fase from public.huidig_event() h)
  select coalesce((
    select f.fase = 'open'
        or public.gezin_van_kind(p_ander) = public.gezin_van_kind(p_eigen_kind)
        or exists (
             select 1 from public.aanwezigheden a
             where a.event_id = f.event_id
               and a.kind_id = p_ander
               and case when f.fase = 'tijdens'
                        then a.aangemeld_op is not null
                        else a.komt end
           )
    from f
  ), true);
$fn$;

revoke all on function public._tegenpartij_zichtbaar(uuid, uuid) from public, anon, authenticated;

-- ============================================================
-- 2. Met wie kan je een kring vormen?
-- ============================================================
-- Niet enkel wie in get_matches() staat: in een kring van vier (jij → Sol →
-- Mila → Jules → jij) hoeft Mila met jou rechtstreeks niets te kunnen.
-- Enkel wie iets op zijn lijst heeft — een lege lijst kan in geen kring.
create or replace function public.ketting_kandidaten(p_kind_id uuid)
returns table (
  kind_id     uuid,
  voornaam    text,
  letter      text,
  eigen_gezin boolean
)
language plpgsql
stable
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

  return query
  select k.id,
         k.voornaam,
         left(k.familienaam, 1),
         public.gezin_van_kind(k.id) = public.gezin_van_kind(p_kind_id)
  from public.kinderen k
  where k.id <> p_kind_id
    and exists (select 1 from public.stickers s where s.kind_id = k.id)
    and public._tegenpartij_zichtbaar(p_kind_id, k.id)
  order by k.voornaam, left(k.familienaam, 1);
end;
$fn$;

revoke all on function public.ketting_kandidaten(uuid) from public;
revoke all on function public.ketting_kandidaten(uuid) from anon;
grant execute on function public.ketting_kandidaten(uuid) to authenticated;

-- ============================================================
-- 3. De vrije lijsten van de groep
-- ============================================================
-- Vrij zoals in get_matches(): een dubbel of een Zoek ik die al in een
-- openstaande ruil beloofd is, telt niet (sql/023). 'aantal' is bij RUILT het
-- vrije aantal, bij ZOEKT altijd 1. Je eigen verzamelaar zit er ook in, zodat
-- de pagina met één soort gegevens rekent.
create or replace function public.ketting_lijsten(p_kind_id uuid, p_kinderen uuid[])
returns table (
  kind_id uuid,
  status  text,
  code    text,
  aantal  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_ander uuid;
  v_glans boolean := coalesce((select i.toon_glans from public.instellingen i where i.id = 1), false);
begin
  if auth.uid() is null then
    raise exception 'Niet aangemeld.';
  end if;
  if public.gezin_van_kind(p_kind_id) is distinct from public.gezin_sleutel(auth.uid()) then
    raise exception 'Die verzamelaar hoort niet bij jouw gezin.';
  end if;
  if coalesce(cardinality(p_kinderen), 0) not between 1 and 3 then
    raise exception 'Een kettingruil heeft 1 tot 3 andere verzamelaars met een account.';
  end if;
  if (select count(distinct x) from unnest(p_kinderen) x) <> cardinality(p_kinderen)
     or p_kind_id = any(p_kinderen) then
    raise exception 'Kies elke verzamelaar maar één keer.';
  end if;

  foreach v_ander in array p_kinderen loop
    if not exists (select 1 from public.kinderen k where k.id = v_ander)
       or not public._tegenpartij_zichtbaar(p_kind_id, v_ander) then
      raise exception 'Een van de gekozen verzamelaars doet nu niet mee — kies de groep opnieuw.';
    end if;
  end loop;

  return query
  select s.kind_id,
         s.status,
         s.nummer,
         case when s.status = 'RUILT' then public._dubbels_vrij(s.kind_id, s.nummer) else 1 end
  from public.stickers s
  join public.sticker_catalogus c on c.code = s.nummer
  where s.kind_id = any(array_append(p_kinderen, p_kind_id))
    and (v_glans or not c.glans)
    and case when s.status = 'ZOEKT' then public._zoekt_vrij(s.kind_id, s.nummer)
             when s.status = 'RUILT' then public._dubbels_vrij(s.kind_id, s.nummer) > 0
             else false end;
end;
$fn$;

revoke all on function public.ketting_lijsten(uuid, uuid[]) from public;
revoke all on function public.ketting_lijsten(uuid, uuid[]) from anon;
grant execute on function public.ketting_lijsten(uuid, uuid[]) to authenticated;

-- Snelle controle na het draaien (als ingelogde ouder, via de API):
--   select * from public.ketting_kandidaten('<eigen kind>');
--   select * from public.ketting_lijsten('<eigen kind>', array['<sol>', '<jules>']::uuid[]);
