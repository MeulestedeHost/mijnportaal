-- Panini Ruilportaal — zoomtrap waarop de wereldkaart van bol naar vijf iconen gaat
-- Voer dit uit na sql/023_ruil_auto_toepassen.sql.
--
-- WAAROM. Die drempel stond vast in js/wereldreis.js. Rond Europa overlappen
-- de clusters van vijf iconen zolang je niet op één land ingezoomd bent, en
-- hoe diep dat precies moet, hangt af van de schermen op de beurs — dus een
-- instelling in plaats van telkens een nieuwe deploy.
--
-- Leaflet-zoomtrap: 1 = de hele wereld (minZoom van de grote kaart),
-- 12 = maximaal ingezoomd (MAX_ZOOM in js/wereldreis.js). Standaard 10: op één
-- land ingezoomd. Daaronder klapt een tik op een bol enkel dat ene land open.
-- De minikaart op het dashboard trekt zich hier niets van aan: die toont altijd
-- de ministip.
--
-- Niet destructief: één kolom bij, met een standaardwaarde. Zolang dit niet
-- gedraaid is, gebruikt de pagina dezelfde standaard (10).

alter table public.instellingen
  add column if not exists kaart_ingezoomd_vanaf smallint not null default 10;

alter table public.instellingen
  drop constraint if exists instellingen_kaart_ingezoomd_vanaf_check;
alter table public.instellingen
  add constraint instellingen_kaart_ingezoomd_vanaf_check
  check (kaart_ingezoomd_vanaf between 1 and 12);

comment on column public.instellingen.kaart_ingezoomd_vanaf is
  'Vanaf deze Leaflet-zoomtrap (1-12) toont de wereldkaart per land de cluster
   van vijf iconen; eronder één bol per land, die enkel bij een tik openklapt.';

-- Snelle controle:
--   select kaart_ingezoomd_vanaf from public.instellingen where id = 1;  -- 10
