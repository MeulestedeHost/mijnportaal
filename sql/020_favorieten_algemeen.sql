-- Panini Ruilportaal — Algemene favorieten (vanaf de stickerpagina)
-- Voer dit uit na sql/019_stickers_updated_at.sql.
--
-- Niet destructief: één kolom wordt optioneel, één index bij. Geen bestaande
-- rij, functie of policy verandert.
--
-- WAT ER BIJKOMT. Tot nu kon een favoriet enkel op de ruilpagina gezet worden,
-- bij een SPECIFIEKE ruiler: "deze sticker wil ik bij DEZE persoon halen".
-- Op de stickerpagina (kind.html) bestaat die persoon nog niet — daar zie je
-- enkel je eigen lijst, niet met wie je kan ruilen. Toch wil je daar al
-- kunnen zeggen: "FRA20 is een prioriteit voor mij", zonder eerst naar de
-- ruilpagina te moeten om uit te zoeken wie hem heeft.
--
-- Dat wordt een ALGEMENE favoriet: dezelfde rij in public.favorieten, maar
-- met ander_kind_id = null — "ik weet nog niet bij wie, wijs zelf de beste
-- toe". js/ruilen.js doet die toewijzing bij het tekenen (niet in de
-- databank): van alle ruilers die deze sticker hebben of willen, krijgt de
-- hoogst gerangschikte (dezelfde rangschikking als de ruilerkaarten zelf —
-- favoriet → tweerichting → bundelgrootte → naam) de volle gele ster, en de
-- rest de gele contour, net als bij een gewone favoriet. Verandert die
-- rangschikking (een ruiler ruilt de sticker weg, een nieuwe biedt hem aan),
-- dan verschuift de ster gewoon mee bij de volgende keer dat de pagina
-- tekent — er ligt geen verouderde toewijzing vast in de databank.
--
-- WAAROM DIT VEILIG IS ZONDER DE TRIGGER TE WIJZIGEN. Het budget (sql/018:
-- 1 voor "zoek ik", het aantal dubbels voor "heb ik dubbel") wordt bewaakt
-- per (kind_id, code, richting) — geen enkele check daar kijkt naar
-- ander_kind_id. Een rij met ander_kind_id = null telt voor dat budget dus
-- precies hetzelfde mee als een rij met een concrete ruiler. Enkel de
-- kolom zelf moest NOT NULL afgeven, en er komt een eigen unieke index bij
-- specifiek voor de algemene rijen (hieronder) — de bestaande
-- favorieten_zoekt_een_per_sticker-index (op (kind_id, code), zonder
-- ander_kind_id) beschermde het budget van "zoek ik" hier toch al tegen.

-- ============================================================
-- 1. ander_kind_id mag leeg zijn
-- ============================================================
alter table public.favorieten
  alter column ander_kind_id drop not null;

comment on column public.favorieten.ander_kind_id is
  'Bij wie je reserveert. Leeg = een ALGEMENE favoriet (gezet vanaf de
   stickerpagina, nog niet aan een ruiler gekoppeld) — js/ruilen.js wijst die
   bij het tekenen toe aan de best gerangschikte ruiler die deze sticker
   heeft of wil.';

-- ============================================================
-- 2. Eén algemene favoriet per sticker per richting
-- ============================================================
-- De samengestelde unique constraint uit sql/018 (kind_id, ander_kind_id,
-- code, richting) beschermt hier niets: Postgres behandelt twee NULL-waarden
-- als verschillend, dus die constraint zou twee algemene rijen voor dezelfde
-- sticker gewoon toelaten. Voor "zoek ik" ving favorieten_zoekt_een_per_sticker
-- (op (kind_id, code), zonder ander_kind_id) dat toch al af; voor "heb ik
-- dubbel" was er nog niets dat het tegenhield. Deze index dekt allebei in één
-- keer, specifiek voor de algemene rijen.
create unique index if not exists favorieten_algemeen_een_per_sticker
  on public.favorieten (kind_id, code, richting)
  where ander_kind_id is null;

-- ============================================================
-- Nakijken
-- ============================================================
-- 1) Een algemene favoriet zetten en meteen nog eens proberen — de tweede
--    hoort te falen op "favorieten_algemeen_een_per_sticker":
--        insert into public.favorieten (kind_id, ander_kind_id, code, richting)
--        values ('<jouw-kind>', null, 'FRA20', 'jij_zoekt');
--        insert into public.favorieten (kind_id, ander_kind_id, code, richting)
--        values ('<jouw-kind>', null, 'FRA20', 'jij_zoekt');
--
-- 2) Een concrete en een algemene favoriet voor dezelfde sticker mogen niet
--    allebei bestaan als het budget dat niet toelaat — bij "zoek ik" (budget
--    1) hoort de tweede insert hier te falen op favorieten_zoekt_een_per_sticker:
--        insert into public.favorieten (kind_id, ander_kind_id, code, richting)
--        values ('<jouw-kind>', '<ruiler-a>', 'FRA20', 'jij_zoekt');
--        insert into public.favorieten (kind_id, ander_kind_id, code, richting)
--        values ('<jouw-kind>', null, 'FRA20', 'jij_zoekt');
