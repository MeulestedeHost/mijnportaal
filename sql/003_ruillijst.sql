-- Panini Ruilportaal — Ruillijst: referentielijst + status per kind
-- Voer dit uit in de Supabase SQL Editor, daarna sql/005_seed_stickers.sql.
--
-- Niet-destructief: raakt de bestaande tabellen 'kinderen' en 'stickers'
-- niet aan. De oude tabel 'stickers' (bezit per kind, vrij ingetypt nummer)
-- blijft voorlopig staan zodat de live site niet breekt; die kan pas weg
-- wanneer ruillijst.html in gebruik is.

-- ============================================================
-- 1. Referentielijst: alle 980 stickers (vast, zelden gewijzigd)
-- ============================================================
create table if not exists public.sticker_catalogus (
  id         bigint generated always as identity primary key,
  categorie  text not null check (categorie in ('logo', 'special', 'team')),
  land_code  text not null,
  land_naam  text not null,
  nummer     integer not null,
  code       text not null unique,
  naam       text,                -- spelersnaam / omschrijving
  glans      boolean not null default false,  -- glansvariant (code eindigt op 's')
  pagina     integer,             -- albumpagina, optioneel
  created_at timestamptz not null default now()
);

create index if not exists idx_catalogus_land on public.sticker_catalogus (land_code);
create index if not exists idx_catalogus_sort on public.sticker_catalogus (land_naam, nummer, glans);

-- ============================================================
-- 2. Status per KIND per sticker
-- ============================================================
create table if not exists public.sticker_status (
  id            bigint generated always as identity primary key,
  kind_id       uuid   not null references public.kinderen(id) on delete cascade,
  sticker_id    bigint not null references public.sticker_catalogus(id) on delete cascade,
  heeft         boolean not null default false,
  dubbel_aantal integer not null default 0 check (dubbel_aantal >= 0),
  zoekt         boolean not null default false,
  updated_at    timestamptz not null default now(),
  unique (kind_id, sticker_id)
);

create index if not exists idx_status_kind    on public.sticker_status (kind_id);
create index if not exists idx_status_sticker on public.sticker_status (sticker_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_status on public.sticker_status;
create trigger trg_touch_status
  before update on public.sticker_status
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 3. Row Level Security
-- ============================================================
alter table public.sticker_catalogus enable row level security;
alter table public.sticker_status    enable row level security;

-- Referentielijst: iedereen die ingelogd is mag ze lezen
drop policy if exists catalogus_select on public.sticker_catalogus;
create policy catalogus_select
  on public.sticker_catalogus for select
  to authenticated
  using (true);

-- Ontbrekende sticker toevoegen mag, maar met formaatcontrole: dit is een
-- gedeelde lijst, één gebruiker mag ze niet kunnen vervuilen met rommel.
drop policy if exists catalogus_insert on public.sticker_catalogus;
create policy catalogus_insert
  on public.sticker_catalogus for insert
  to authenticated
  with check (
    categorie in ('logo', 'special', 'team')
    and land_code = upper(land_code)
    and char_length(land_code) between 2 and 8
    and char_length(land_naam) between 2 and 60
    and nummer between 0 and 999
    and char_length(code) between 2 and 20
  );

-- Status: toegang loopt via het kind van de ingelogde ouder.
-- Zelfde EXISTS-patroon als de bestaande policies op public.stickers.
drop policy if exists status_select on public.sticker_status;
create policy status_select
  on public.sticker_status for select
  to authenticated
  using (exists (select 1 from public.kinderen k
                 where k.id = sticker_status.kind_id and k.user_id = auth.uid()));

drop policy if exists status_insert on public.sticker_status;
create policy status_insert
  on public.sticker_status for insert
  to authenticated
  with check (exists (select 1 from public.kinderen k
                      where k.id = sticker_status.kind_id and k.user_id = auth.uid()));

drop policy if exists status_update on public.sticker_status;
create policy status_update
  on public.sticker_status for update
  to authenticated
  using (exists (select 1 from public.kinderen k
                 where k.id = sticker_status.kind_id and k.user_id = auth.uid()))
  with check (exists (select 1 from public.kinderen k
                      where k.id = sticker_status.kind_id and k.user_id = auth.uid()));

drop policy if exists status_delete on public.sticker_status;
create policy status_delete
  on public.sticker_status for delete
  to authenticated
  using (exists (select 1 from public.kinderen k
                 where k.id = sticker_status.kind_id and k.user_id = auth.uid()));
