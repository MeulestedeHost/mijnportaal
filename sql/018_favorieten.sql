-- Panini Ruilportaal — Favorieten op de ruilpagina
-- Voer dit uit na sql/017_statistieken.sql.
--
-- Niet destructief: één tabel bij, één trigger bij. Geen bestaande rij, functie
-- of policy verandert.
--
-- WAT EEN FAVORIET IS. Eén regel, en al de rest volgt eruit:
--
--     Een favoriet is een RESERVERING van één exemplaar.
--
-- Daarmee is meteen duidelijk hoeveel je er mag zetten, en dat verschilt per
-- richting:
--
--   jij_zoekt        — je hebt er maar ÉÉN nodig, dus budget 1 per sticker.
--                      Zoek je FRA12 en hebben drie ruilers hem dubbel, dan
--                      reserveer je er één; bij de andere twee zie je dat je
--                      hem elders al vastlegde.
--   jij_hebt_dubbel  — je kan er zoveel weggeven als je er hebt, dus budget =
--                      het aantal dubbels dat je van die sticker hebt staan.
--
-- DE DATABANK BEWAAKT DAT BUDGET, NIET DE PAGINA. Twee tabbladen open, of een
-- trage verbinding waarbij je twee keer klikt, mag geen vierde reservering
-- opleveren op drie dubbels. Voor jij_zoekt volstaat een partiële unieke index
-- (max. één rij per sticker); voor jij_hebt_dubbel moet er geteld worden tegen
-- public.stickers.aantal, en dat doet de trigger onderaan.
--
-- WAT DIT NIET DOET. Een favoriet verplaatst niets en belooft niets aan de
-- andere kant: de tegenpartij ziet er niets van. Het is jouw eigen kladblad
-- voor "hier wil ik deze halen". Een échte afspraak blijft public.ruilen
-- (sql/016), met bevestiging langs twee kanten.

-- ============================================================
-- 1. De tabel
-- ============================================================
-- kind_id is JOUW verzamelaar (die reserveert), ander_kind_id is bij wie je
-- reserveert. code is de cataloguscode ("FRA12"), dezelfde sleutel die
-- public.stickers.nummer gebruikt.
--
-- richting gebruikt exact dezelfde twee woorden als get_matches(), zodat een
-- rij hier één-op-één op een ruilkans daar past en er nergens vertaald moet
-- worden.
create table if not exists public.favorieten (
  id            uuid primary key default gen_random_uuid(),
  kind_id       uuid not null references public.kinderen(id) on delete cascade,
  ander_kind_id uuid not null references public.kinderen(id) on delete cascade,
  code          text not null,
  richting      text not null check (richting in ('jij_zoekt', 'jij_hebt_dubbel')),
  created_at    timestamptz not null default now(),
  unique (kind_id, ander_kind_id, code, richting)
);

comment on table public.favorieten is
  'Reserveringen van één exemplaar: "deze sticker wil ik bij DEZE ruiler halen of
   aan DEZE ruiler geven". Puur jouw eigen voorkeur — de tegenpartij ziet er niets
   van en er verandert niets aan public.stickers. De echte afspraak is public.ruilen.';

create index if not exists idx_favorieten_kind on public.favorieten (kind_id);
create index if not exists idx_favorieten_ander on public.favorieten (ander_kind_id);

-- Budget voor "zoek ik" is altijd 1: je hebt maar één exemplaar nodig. Een
-- partiële unieke index is hier genoeg en veel goedkoper dan een trigger.
create unique index if not exists favorieten_zoekt_een_per_sticker
  on public.favorieten (kind_id, code)
  where richting = 'jij_zoekt';

-- ============================================================
-- 2. Budget voor "heb ik dubbel"
-- ============================================================
-- Hier is het budget het aantal dubbels dat je van die sticker hebt staan, en
-- dat is een getal in een andere tabel — geen index die dat kan afdwingen, dus
-- een trigger.
--
-- security definer omdat de trigger public.stickers moet kunnen tellen ook
-- wanneer de policy op die tabel voor deze aanroep niets zou teruggeven. Hij
-- geeft niets prijs: het antwoord is "mag wel" of "mag niet".
--
-- VERMINDER JE ACHTERAF JE AANTAL DUBBELS, dan kunnen er meer reserveringen
-- staan dan je exemplaren hebt. Die worden BEWUST niet automatisch opgeruimd:
-- stilletjes een keuze van de gebruiker weggooien is erger dan ze even te veel
-- laten staan. De ruilpagina rekent het budget telkens opnieuw uit, dus je
-- kan er gewoon geen nieuwe meer bij zetten tot je er eentje vrijgeeft.
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

  select coalesce(max(s.aantal), 0)
    into v_budget
    from public.stickers s
   where s.kind_id = new.kind_id
     and s.nummer  = new.code
     and s.status  = 'RUILT';

  select count(*)
    into v_gebruikt
    from public.favorieten f
   where f.kind_id  = new.kind_id
     and f.code     = new.code
     and f.richting = 'jij_hebt_dubbel'
     and f.id is distinct from new.id;

  if v_gebruikt >= v_budget then
    raise exception
      'Je hebt % keer % dubbel, en die zijn al gereserveerd. Geef er eerst een vrij.',
      v_budget, new.code
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists favorieten_budget on public.favorieten;
create trigger favorieten_budget
  before insert or update on public.favorieten
  for each row execute function public.favoriet_budget_bewaken();

-- ============================================================
-- 3. Toegang
-- ============================================================
-- Je beheert enkel de favorieten van je eigen verzamelaars — gezinsbreed, net
-- als bij public.stickers sinds sql/009. ander_kind_id blijft ongemoeid: dat
-- is enkel een verwijzing naar bij wie je reserveert, en verklapt niets, want
-- die naam kreeg je sowieso al via get_matches().
alter table public.favorieten enable row level security;

drop policy if exists favorieten_select on public.favorieten;
create policy favorieten_select
  on public.favorieten for select
  to authenticated
  using (public.gezin_van_kind(kind_id) = public.gezin_sleutel(auth.uid()));

drop policy if exists favorieten_insert on public.favorieten;
create policy favorieten_insert
  on public.favorieten for insert
  to authenticated
  with check (public.gezin_van_kind(kind_id) = public.gezin_sleutel(auth.uid()));

drop policy if exists favorieten_delete on public.favorieten;
create policy favorieten_delete
  on public.favorieten for delete
  to authenticated
  using (public.gezin_van_kind(kind_id) = public.gezin_sleutel(auth.uid()));

-- Geen update-policy: een reservering verplaatsen is ze vrijgeven en elders
-- opnieuw zetten. Eén manier om iets te doen is genoeg.
grant select, insert, delete on public.favorieten to authenticated;

-- ============================================================
-- Nakijken
-- ============================================================
-- 1) De tabel bestaat en is leeg:
--        select count(*) from public.favorieten;
--
-- 2) Het budget voor "zoek ik" is 1 — de tweede insert hoort te falen met
--    "duplicate key value violates unique constraint":
--        insert into public.favorieten (kind_id, ander_kind_id, code, richting)
--        values ('<jouw-kind>', '<ruiler-a>', 'FRA12', 'jij_zoekt');
--        insert into public.favorieten (kind_id, ander_kind_id, code, richting)
--        values ('<jouw-kind>', '<ruiler-b>', 'FRA12', 'jij_zoekt');
--
-- 3) Het budget voor dubbels volgt public.stickers.aantal — heb je er twee,
--    dan hoort de derde te falen met "Je hebt 2 keer ... dubbel".
