-- Panini Ruilportaal — Contact na de ruilbeurs: e-mailadres + WhatsApp
-- Voer dit uit na sql/013_landen_engels_en_pagina.sql.
--
-- WAT VERANDERT ER. Tot nu toonde get_matches een voornaam én — als dat gezin
-- zijn nummer deelde — een WhatsApp-nummer, allebei enkel TIJDENS het
-- beursvenster. Dat paste bij één beurs waarna niemand nog iets deed met het
-- portaal. Nu er op 11 oktober een tweede beurs is en het de bedoeling is dat
-- ruilen ook daarna nog doorloopt, verandert de opbouw:
--
--   VOOR de beurs   — zoals voorheen: geen voornaam, geen contactgegevens.
--                      Je ziet wél dát er een ruilkans is, niet met wie.
--   TIJDENS de beurs — enkel de voornaam. Je zoekt elkaar ter plekke op via
--                      het portaal; er komt geen telefoonnummer of e-mailadres
--                      bij, want dat heb je op de beurs zelf niet nodig.
--   NA de beurs     — voornaam + e-mailadres (van iedereen, zonder vinkje) en
--                      het WhatsApp-nummer als dat gezin op gezin.html koos om
--                      het te delen (dat vinkje betekende vroeger "tijdens de
--                      beurs", vanaf nu betekent het "na de beurs").
--
-- WAAROM E-MAIL ZONDER VINKJE, TELEFOON WEL. Een e-mailadres is al bekend
-- zodra iemand zich aanmeldt (Supabase Auth heeft het nodig) en staat al in
-- public.gezin_leden — het is geen extra gegeven dat iemand vrijwillig moest
-- toevoegen. Een gsm-nummer wél: dat typt een ouder zelf in op gezin.html, en
-- WhatsApp is persoonlijker dan e-mail. Dat verschil in gevoeligheid is de
-- reden waarom telefoon een vinkje behoudt en e-mail niet.
--
-- Niet destructief: er verdwijnt geen kolom of rij, get_matches krijgt enkel
-- een kolom extra (drop+create is nodig omdat Postgres de kolomlijst van een
-- functie niet via create or replace kan wijzigen).

-- ============================================================
-- 1. beurs_voorbij(): het spiegelbeeld van beurs_actief()
-- ============================================================
-- true vanaf het moment dat beurs_einde gepasseerd is, en dat blijft zo totdat
-- een beheerder op instellingen.html een nieuw (toekomstig) beursvenster
-- instelt — dan schuift het venster op en is de beurs weer niet voorbij.
create or replace function public.beurs_voorbij()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.instellingen i
    where i.id = 1 and now() >= i.beurs_einde
  );
$fn$;

revoke all on function public.beurs_voorbij() from public;
revoke all on function public.beurs_voorbij() from anon;
grant execute on function public.beurs_voorbij() to authenticated;

-- ============================================================
-- 2. get_matches(): voornaam tijdens én na de beurs, e-mail en telefoon pas na
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
    case
      when public.gezin_sleutel(ak.user_id) = ek.sleutel then ak.voornaam
      when public.beurs_actief() or public.beurs_voorbij() then ak.voornaam
    end,
    public.gezin_sleutel(ak.user_id) = ek.sleutel,
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

  union   -- union, niet union all: buiten het beursvenster vallen de
          -- naamloze rijen van meerdere kinderen samen tot één regel

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
    case
      when public.gezin_sleutel(ak.user_id) = ek.sleutel then ak.voornaam
      when public.beurs_actief() or public.beurs_voorbij() then ak.voornaam
    end,
    public.gezin_sleutel(ak.user_id) = ek.sleutel,
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
-- Snelle controle
-- ============================================================
-- 1) Ver in het verleden een beursvenster zetten en zelf een tweede gezin
--    simuleren is lastig in de SQL-editor; eenvoudiger is even handmatig
--    testen op ruilen.html vlak nadat je in instellingen.html een
--    beurs_einde in het verleden zette.
--
-- 2) Wie beheerder is, kan dit ook rechtstreeks nalezen:
--      select public.beurs_actief(), public.beurs_voorbij();
