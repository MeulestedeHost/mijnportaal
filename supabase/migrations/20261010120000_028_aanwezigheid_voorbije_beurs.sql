-- Panini Ruilportaal — een ouder mag ook voor een voorbije beurs aanduiden wie er was
-- Bouwt voort op sql/025_events_en_aanwezigheid.sql.
--
-- WAAROM. aanwezigheid_zetten() weigerde een beurs die al voorbij was ("die ligt
-- vast"). Maar het systeem is er pas na de beurs van 6 september gekomen, dus
-- wie er toen was, stond nergens — en kan ook nooit meer ingevuld worden. Het
-- historiek-overzicht van de organisatie (aanwezigheden.html) blijft zo een lege
-- kolom voor de eerste editie.
--
-- Wat er NIET verandert: het filteren. huidig_event() en get_matches() kijken
-- enkel naar de lopende of eerstvolgende beurs; een vinkje bij een voorbije beurs
-- beïnvloedt niemands ruilplanner. Het blijft ook beperkt tot je eigen gezin.
--
-- Niet destructief: enkel de controle "einde > now()" valt weg. Het event moet
-- nog altijd bestaan.
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
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Die ruilbeurs bestaat niet.';
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
