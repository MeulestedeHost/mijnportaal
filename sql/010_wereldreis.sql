-- Panini Ruilportaal — FIFA Wereldreis, fase 1: cijfers per land
-- Voer dit uit na sql/009_gezin_en_whatsapp.sql.
--
-- Niet destructief: er komt één functie bij. Geen tabel, geen kolom, geen
-- policy. De wereldreis rekent volledig op wat er al staat —
-- public.sticker_catalogus voor de landen, public.stickers voor wat een
-- verzamelaar zoekt of dubbel heeft.
--
-- HET REKENMODEL. Een kind registreert enkel wat het ZOEKT en wat het DUBBEL
-- heeft; al de rest geldt als aanwezig (zo werkt de kindpagina sinds
-- sql/006_kindproof.sql, waar status 'HEEFT' verdween). Vandaar:
--
--     heeft = totaal aantal stickers van het land - gezochte stickers
--
-- Dat heeft één gevolg dat je moet kennen voor je het scherm ziet: een
-- verzamelaar die nog niets aanduidde, staat overal op 100 %. De wereldreis
-- begint dus vol en loopt leeg naarmate een kind invult wat het mist. De
-- front-end zegt dat er met zoveel woorden bij; hier staat het omdat de
-- formule anders als een fout leest.
--
-- Glansvarianten (BEL2s naast BEL2) tellen enkel mee wanneer toon_glans
-- aanstaat in public.instellingen — exact dezelfde regel als
-- kind_statistieken() en get_matches(), anders zouden België, Frankrijk en
-- Duitsland hier 38 stickers tellen en op de rest van de site 20.

-- ============================================================
-- wereldreis_landen(): één rij per land van het album
-- ============================================================
-- security definer, met de toegangscontrole expliciet in de CTE 'eigen_kind':
-- auth.uid() moet ingevuld zijn én p_kind_id moet bij hetzelfde gezin horen.
-- Klopt daar iets niet aan, dan is eigen_kind leeg en levert de hele query nul
-- rijen — dezelfde constructie als in get_matches().
--
-- De rijen van PANINI (het logo) en FWC (de WK-specials) komen mee terug. Die
-- horen niet op een kaart, maar ze horen wel bij het album: de pagina toont ze
-- als losse regel onder de kaart, zodat de tellers optellen tot het volledige
-- album en niemand zich afvraagt waar die 20 stickers gebleven zijn. De kolom
-- 'categorie' zegt welke rij waar hoort: 'team' gaat naar de kaart, de rest
-- niet.

create or replace function public.wereldreis_landen(p_kind_id uuid)
returns table (
  land_code text,
  land_naam text,
  categorie text,
  totaal    integer,
  gezocht   integer,
  dubbel    integer,
  heeft     integer,
  procent   integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with eigen_kind as (
    select k.id
    from public.kinderen k
    where k.id = p_kind_id
      and auth.uid() is not null
      and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())
  ),
  glans_ok as (
    select coalesce((select i.toon_glans from public.instellingen i where i.id = 1), false) as aan
  ),
  meetellend as (
    select c.land_code, c.land_naam, c.categorie, c.code
    from public.sticker_catalogus c
    cross join glans_ok g
    where g.aan or not c.glans
  )
  select
    c.land_code,
    min(c.land_naam),
    min(c.categorie),
    count(*)::int,
    count(s.id) filter (where s.status = 'ZOEKT')::int,
    count(s.id) filter (where s.status = 'RUILT')::int,
    (count(*) - count(s.id) filter (where s.status = 'ZOEKT'))::int,
    round(
      100.0 * (count(*) - count(s.id) filter (where s.status = 'ZOEKT'))
      / greatest(count(*), 1)
    )::int
  from eigen_kind ek
  cross join meetellend c
  left join public.stickers s
         on s.kind_id = ek.id
        and s.nummer  = c.code
  group by c.land_code
  order by 2;
$fn$;

revoke all on function public.wereldreis_landen(uuid) from public;
revoke all on function public.wereldreis_landen(uuid) from anon;
grant execute on function public.wereldreis_landen(uuid) to authenticated;

-- ============================================================
-- Snelle controle
-- ============================================================
-- 1) Neem een kind_id uit je eigen gezin en draai:
--      select * from public.wereldreis_landen('<kind-uuid>');
--    Verwacht: 50 rijen (48 landen + PANINI + FWC), samen 980 stickers
--    (of 1034 wanneer toon_glans aanstaat).
--
-- 2) Het totaal moet gelijk zijn aan de catalogus:
--      select sum(totaal) from public.wereldreis_landen('<kind-uuid>');
--
-- 3) Een kind_id van een ánder gezin hoort nul rijen te geven — niet een
--    lijst met alles op 100 %.
