-- ============================================================
-- get_matches(): eerste letter van de achternaam van de tegenpartij
-- ============================================================
-- Eén kolom erbij tegenover sql/016, de rest is ongewijzigd: ander_kind_letter
-- (left(familienaam, 1)). Nodig voor de ruilerkeuze die vanuit Snelruilen een
-- tegenpartij laat kiezen (js/ruilregistratie.js) — met enkel de voornaam
-- (sql/015: "altijd naam") lopen twee kinderen met dezelfde voornaam door
-- elkaar in die lijst. Dezelfde behandeling als voornaam zelf: onvoorwaardelijk
-- zichtbaar, niet achter het beursvenster (dat regelt enkel e-mail/telefoon).
--
-- Zolang dit bestand niet gedraaid is, ontbreekt de kolom gewoon in het
-- antwoord van get_matches() en toont de ruilerkeuze enkel de voornaam — de
-- rest van de site blijft intussen ongewijzigd werken.
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
    ander.aantal,
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
  where g.aan or not c.glans

  order by 1, 4, 3, 2;
$fn$;

revoke all on function public.get_matches(uuid) from public;
revoke all on function public.get_matches(uuid) from anon;
grant execute on function public.get_matches(uuid) to authenticated;
