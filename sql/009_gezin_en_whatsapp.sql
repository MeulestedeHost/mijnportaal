-- Panini Ruilportaal — Twee volwassenen op één gezin + WhatsApp click-to-chat
-- Voer dit uit na sql/008_matches_eigen_gezin.sql.
--
-- Twee dingen, en ze hangen samen:
--
-- 1. EEN GEZIN KAN TWEE LOGINS HEBBEN.
--    Tot nu was "het gezin" gelijk aan één rij in auth.users: kinderen.user_id
--    wees naar de ouder die inlogde, en RLS vergeleek dat met auth.uid(). Eén
--    ouder had dus de sleutel, de andere zag niets. Vanaf nu bestaat er een
--    gezin (public.gezinnen) met leden (public.gezin_leden), en kijkt RLS niet
--    meer naar "is dit jouw user_id" maar naar "zit die user_id in hetzelfde
--    gezin als jij".
--
--    Bewust NIET gedaan: kinderen.user_id vervangen door een gezin_id. Dat zou
--    elke bestaande rij moeten migreren en elke policy en functie in één keer
--    moeten omzetten. In plaats daarvan is er public.gezin_sleutel(user): het
--    gezin_id als je in een gezin zit, en anders je eigen user_id. Wie nooit
--    een tweede volwassene toevoegt, merkt dus niets — zijn sleutel is zijn
--    user_id, precies zoals vroeger.
--
-- 2. WHATSAPP. Een gezin kan één gsm-nummer bewaren en zelf beslissen of het
--    tijdens de ruilbeurs aan andere gezinnen getoond wordt. get_matches geeft
--    dat nummer enkel terug wanneer alle drie kloppen: het beursvenster staat
--    open, het andere gezin zette 'delen' aan, en het is niet je eigen gezin
--    (dat regel je thuis). Buiten het venster staat er null — net als bij de
--    voornaam. Daarnaast krijgt de beurs zelf een organisatornummer in
--    public.instellingen, voor vragen van deelnemers.
--
-- Niet destructief: er worden enkel tabellen, functies en policies bijgemaakt
-- of vervangen. Bestaande kinderen, stickers en instellingen blijven staan.

-- ============================================================
-- 1. Tabellen
-- ============================================================

-- Het gezin zelf houdt bijna niets bij: het bestaat om leden aan te hangen en
-- om één contactnummer te dragen.
create table if not exists public.gezinnen (
  id             uuid primary key default gen_random_uuid(),
  telefoon       text,
  telefoon_delen boolean not null default false,
  created_at     timestamptz not null default now(),
  -- E.164, zoals wa.me het wil: landcode zonder nullen ervoor. De front-end
  -- zet '0470 12 34 56' om naar '+32470123456'; deze check is het vangnet.
  constraint gezin_telefoon_formaat
    check (telefoon is null or telefoon ~ '^\+[1-9][0-9]{7,14}$')
);

-- user_id is de primary key: je hoort bij hoogstens één gezin. Dat is geen
-- technische beperking maar een inhoudelijke — anders is "welk gezin ben jij"
-- geen vraag met één antwoord, en dat is precies wat RLS nodig heeft.
create table if not exists public.gezin_leden (
  gezin_id    uuid not null references public.gezinnen(id) on delete cascade,
  user_id     uuid primary key references auth.users(id) on delete cascade,
  voornaam    text not null default '',
  familienaam text not null default '',
  email       text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists idx_gezin_leden_gezin on public.gezin_leden (gezin_id);

-- Een uitnodiging is een e-mailadres dat klaarstaat. De tweede ouder hoeft geen
-- aparte uitnodigingsmail te krijgen: hij logt gewoon in op dat adres — met een
-- magic link of met Google, dat maakt niet uit — en public.gezin_koppel_mij()
-- (blok 4) hangt hem bij de eerste keer inloggen aan het gezin.
create table if not exists public.gezin_uitnodigingen (
  id               uuid primary key default gen_random_uuid(),
  gezin_id         uuid not null references public.gezinnen(id) on delete cascade,
  email            text not null,
  voornaam         text not null default '',
  familienaam      text not null default '',
  uitgenodigd_door uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

-- Eén openstaande uitnodiging per adres: twee gezinnen kunnen niet tegelijk op
-- dezelfde persoon wachten.
create unique index if not exists idx_uitnodiging_email
  on public.gezin_uitnodigingen (lower(email));

-- ============================================================
-- 2. De sleutel waar alle policies op draaien
-- ============================================================

-- security definer, en dat is hier essentieel: deze functie wordt AANGEROEPEN
-- DOOR de policies op gezin_leden zelf. Las ze die tabel als de ingelogde
-- gebruiker, dan zou de policy zichzelf oproepen — oneindige recursie. Als
-- definer draait ze met de rechten van de eigenaar en gaat ze langs RLS heen.
create or replace function public.gezin_sleutel(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select l.gezin_id from public.gezin_leden l where l.user_id = p_user),
    p_user
  );
$fn$;

revoke all on function public.gezin_sleutel(uuid) from public;
revoke all on function public.gezin_sleutel(uuid) from anon;
grant execute on function public.gezin_sleutel(uuid) to authenticated;

create or replace function public.mijn_gezin_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select l.gezin_id from public.gezin_leden l where l.user_id = auth.uid();
$fn$;

revoke all on function public.mijn_gezin_id() from public;
revoke all on function public.mijn_gezin_id() from anon;
grant execute on function public.mijn_gezin_id() to authenticated;

-- Het e-mailadres uit het token. auth.email() bestaat in Supabase maar is
-- afgeraden; dit leest dezelfde claim rechtstreeks. Belangrijk: die claim staat
-- er ook bij een Google-login, met exact hetzelfde adres als het Google-account.
-- Uitnodigingen werken dus voor beide manieren van aanmelden.
create or replace function public.jwt_email()
returns text
language sql
stable
as $fn$
  select lower(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email');
$fn$;

revoke all on function public.jwt_email() from public;
revoke all on function public.jwt_email() from anon;
grant execute on function public.jwt_email() to authenticated;

-- ============================================================
-- 3. RLS op de nieuwe tabellen
-- ============================================================
alter table public.gezinnen            enable row level security;
alter table public.gezin_leden         enable row level security;
alter table public.gezin_uitnodigingen enable row level security;

-- gezinnen: je ziet en bewerkt enkel je eigen gezin. Insert loopt via
-- public.gezin_verzeker() (blok 4), delete gebeurt automatisch wanneer het
-- laatste lid weggaat (trigger onderaan blok 4) — dus geen policy voor beide.
drop policy if exists gezinnen_select on public.gezinnen;
create policy gezinnen_select
  on public.gezinnen for select
  to authenticated
  using (id = public.mijn_gezin_id());

drop policy if exists gezinnen_update on public.gezinnen;
create policy gezinnen_update
  on public.gezinnen for update
  to authenticated
  using (id = public.mijn_gezin_id())
  with check (id = public.mijn_gezin_id());

-- gezin_leden: je ziet je huisgenoten.
drop policy if exists gezin_leden_select on public.gezin_leden;
create policy gezin_leden_select
  on public.gezin_leden for select
  to authenticated
  using (public.gezin_sleutel(user_id) = public.gezin_sleutel(auth.uid()));

-- Je eigen naam mag je aanpassen, die van je partner niet. Beide volwassenen
-- zijn gelijk in rechten, maar elkaars naam herschrijven hoort daar niet bij.
drop policy if exists gezin_leden_update on public.gezin_leden;
create policy gezin_leden_update
  on public.gezin_leden for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Beide volwassenen zijn gelijk: elk lid kan het gezin verlaten én de ander
-- loskoppelen. Dat is de keuze die bij "gelijke rechten" hoort; wie dat te ver
-- vindt gaan, vervangt de using-regel hieronder door user_id = auth.uid().
-- LET OP bij loskoppelen: de verzamelaars die die persoon aanmaakte gaan met
-- hem mee (kinderen.user_id blijft van hem). Ze verdwijnen dus uit jouw lijst.
drop policy if exists gezin_leden_delete on public.gezin_leden;
create policy gezin_leden_delete
  on public.gezin_leden for delete
  to authenticated
  using (public.gezin_sleutel(user_id) = public.gezin_sleutel(auth.uid()));

-- Geen insert-policy: lid word je enkel via gezin_verzeker() of
-- gezin_koppel_mij(), zodat de controles in blok 4 niet te omzeilen zijn.

-- Uitnodigingen: zichtbaar voor het gezin dat ze plaatste, intrekken mag ook.
-- Inserten enkel via nodig_volwassene_uit() (blok 4).
drop policy if exists uitnodigingen_select on public.gezin_uitnodigingen;
create policy uitnodigingen_select
  on public.gezin_uitnodigingen for select
  to authenticated
  using (gezin_id = public.mijn_gezin_id());

drop policy if exists uitnodigingen_delete on public.gezin_uitnodigingen;
create policy uitnodigingen_delete
  on public.gezin_uitnodigingen for delete
  to authenticated
  using (gezin_id = public.mijn_gezin_id());

-- ============================================================
-- 4. Gezin aanmaken, uitnodigen, koppelen
-- ============================================================

-- Een gezin ontstaat pas wanneer je het nodig hebt: bij het uitnodigen van een
-- tweede volwassene, of bij het bewaren van een telefoonnummer. Wie alleen
-- werkt, houdt gewoon geen rij in public.gezinnen.
create or replace function public.gezin_verzeker()
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Niet ingelogd.';
  end if;

  select l.gezin_id into v_id from public.gezin_leden l where l.user_id = auth.uid();
  if v_id is not null then
    return v_id;
  end if;

  insert into public.gezinnen default values returning id into v_id;
  insert into public.gezin_leden (gezin_id, user_id, email)
  values (v_id, auth.uid(), coalesce(public.jwt_email(), ''));
  return v_id;
end;
$fn$;

revoke all on function public.gezin_verzeker() from public;
revoke all on function public.gezin_verzeker() from anon;
grant execute on function public.gezin_verzeker() to authenticated;

-- Hoeveel volwassenen mogen in één gezin? Twee — één gezin, twee ouders, en een
-- gedeeld account is geen abonnement dat je blijft doorgeven. Leden én
-- openstaande uitnodigingen tellen mee. Wil je er drie (nieuwe partner,
-- grootouder), zet dit getal dan op 3; er hangt verder niets aan vast.
create or replace function public.nodig_volwassene_uit(
  p_voornaam    text,
  p_familienaam text,
  p_email       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_max_leden constant integer := 2;
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_gezin  uuid;
  v_aantal integer;
  v_ander  uuid;
begin
  if auth.uid() is null then
    raise exception 'Niet ingelogd.';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Dat is geen geldig e-mailadres.';
  end if;
  if length(trim(coalesce(p_voornaam, ''))) = 0 or length(trim(coalesce(p_familienaam, ''))) = 0 then
    raise exception 'Vul de voornaam en de familienaam in.';
  end if;
  if v_email = public.jwt_email() then
    raise exception 'Dat is je eigen e-mailadres — je zit al in dit gezin.';
  end if;

  v_gezin := public.gezin_verzeker();

  -- Hoort dat adres al bij een gezin? Dan is dit geen uitnodiging maar een
  -- overname, en die weigeren we: de andere volwassene moet zijn huidige gezin
  -- eerst zelf verlaten.
  select l.gezin_id into v_ander
  from public.gezin_leden l
  where lower(l.email) = v_email;

  if v_ander = v_gezin then
    raise exception 'Die persoon staat al in jullie gezin.';
  elsif v_ander is not null then
    raise exception 'Dat e-mailadres hoort al bij een ander gezin.';
  end if;

  select (select count(*) from public.gezin_leden l where l.gezin_id = v_gezin)
       + (select count(*) from public.gezin_uitnodigingen u where u.gezin_id = v_gezin)
    into v_aantal;

  if v_aantal >= c_max_leden then
    raise exception 'Een gezin telt hoogstens % volwassenen. Trek eerst een uitnodiging in of koppel iemand los.', c_max_leden;
  end if;

  insert into public.gezin_uitnodigingen (gezin_id, email, voornaam, familienaam, uitgenodigd_door)
  values (v_gezin, v_email, trim(p_voornaam), trim(p_familienaam), auth.uid())
  on conflict (lower(email)) do nothing;

  if not found then
    raise exception 'Voor dat e-mailadres staat al een uitnodiging open.';
  end if;
end;
$fn$;

revoke all on function public.nodig_volwassene_uit(text, text, text) from public;
revoke all on function public.nodig_volwassene_uit(text, text, text) from anon;
grant execute on function public.nodig_volwassene_uit(text, text, text) to authenticated;

-- Dit is de spil van de hele uitnodigingsflow: de front-end roept ze aan bij
-- elke lading van het dashboard. Staat er een uitnodiging klaar op het adres
-- waarmee je net inlogde, dan word je hier lid — zonder aparte mail, zonder
-- code, zonder wachtwoord. Of je met een magic link of met Google binnenkwam
-- speelt geen rol: er wordt op het e-mailadres in het token vergeleken.
-- Klopt er niets van, dan doet ze eenvoudigweg niets.
create or replace function public.gezin_koppel_mij()
returns table (gekoppeld boolean, gezin uuid, melding text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := public.jwt_email();
  v_mijn  uuid;
  v_uitn  public.gezin_uitnodigingen%rowtype;
begin
  if auth.uid() is null then
    return query select false, null::uuid, 'Niet ingelogd.'::text;
    return;
  end if;

  select l.gezin_id into v_mijn from public.gezin_leden l where l.user_id = auth.uid();

  -- Het e-mailadres in gezin_leden is enkel een kopie voor de weergave (en om
  -- te kunnen nagaan of een adres al ergens hangt). Bij elke login even
  -- gelijkzetten kost niets en houdt de lijst kloppend.
  if v_mijn is not null and v_email is not null then
    update public.gezin_leden
       set email = v_email
     where user_id = auth.uid() and email is distinct from v_email;
  end if;

  if v_email is null then
    return query select false, v_mijn, null::text;
    return;
  end if;

  select * into v_uitn
  from public.gezin_uitnodigingen u
  where lower(u.email) = v_email;

  if not found then
    return query select false, v_mijn, null::text;
    return;
  end if;

  if v_mijn is not null then
    -- Je zit al ergens. De uitnodiging blijft staan; de gezinspagina toont
    -- waarom er niets gebeurt.
    return query select false, v_mijn,
      'Er staat een uitnodiging voor je klaar bij een ander gezin. Verlaat eerst dit gezin om ze te aanvaarden.'::text;
    return;
  end if;

  insert into public.gezin_leden (gezin_id, user_id, voornaam, familienaam, email)
  values (v_uitn.gezin_id, auth.uid(), v_uitn.voornaam, v_uitn.familienaam, v_email);

  delete from public.gezin_uitnodigingen where id = v_uitn.id;

  return query select true, v_uitn.gezin_id,
    'Je bent gekoppeld aan het gezin dat je uitnodigde.'::text;
end;
$fn$;

revoke all on function public.gezin_koppel_mij() from public;
revoke all on function public.gezin_koppel_mij() from anon;
grant execute on function public.gezin_koppel_mij() to authenticated;

-- Een gezin zonder leden hoort niet te blijven rondslingeren met een
-- telefoonnummer erin.
create or replace function public.ruim_leeg_gezin_op()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  delete from public.gezinnen g
  where g.id = old.gezin_id
    and not exists (select 1 from public.gezin_leden l where l.gezin_id = g.id);
  return old;
end;
$fn$;

drop trigger if exists trg_ruim_leeg_gezin_op on public.gezin_leden;
create trigger trg_ruim_leeg_gezin_op
  after delete on public.gezin_leden
  for each row execute function public.ruim_leeg_gezin_op();

-- ============================================================
-- 5. Bestaande policies: van "jouw user_id" naar "jouw gezin"
-- ============================================================
-- Dit is de eigenlijke omschakeling. Zit je in geen enkel gezin, dan geeft
-- gezin_sleutel je eigen user_id terug en zeggen deze policies exact hetzelfde
-- als voorheen.

drop policy if exists kinderen_select on public.kinderen;
create policy kinderen_select
  on public.kinderen for select
  to authenticated
  using (public.gezin_sleutel(user_id) = public.gezin_sleutel(auth.uid()));

-- Insert blijft op je eigen user_id staan: je voegt verzamelaars toe onder je
-- eigen login. Je partner ziet en bewerkt ze daarna wél.
drop policy if exists kinderen_insert on public.kinderen;
create policy kinderen_insert
  on public.kinderen for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists kinderen_update on public.kinderen;
create policy kinderen_update
  on public.kinderen for update
  to authenticated
  using (public.gezin_sleutel(user_id) = public.gezin_sleutel(auth.uid()))
  with check (public.gezin_sleutel(user_id) = public.gezin_sleutel(auth.uid()));

drop policy if exists kinderen_delete on public.kinderen;
create policy kinderen_delete
  on public.kinderen for delete
  to authenticated
  using (public.gezin_sleutel(user_id) = public.gezin_sleutel(auth.uid()));

-- stickers: toegang loopt via het kind, dus enkel de vergelijking verandert.
drop policy if exists stickers_select on public.stickers;
create policy stickers_select
  on public.stickers for select
  to authenticated
  using (exists (select 1 from public.kinderen k
                 where k.id = stickers.kind_id
                   and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())));

drop policy if exists stickers_insert on public.stickers;
create policy stickers_insert
  on public.stickers for insert
  to authenticated
  with check (exists (select 1 from public.kinderen k
                      where k.id = stickers.kind_id
                        and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())));

drop policy if exists stickers_update on public.stickers;
create policy stickers_update
  on public.stickers for update
  to authenticated
  using (exists (select 1 from public.kinderen k
                 where k.id = stickers.kind_id
                   and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())))
  with check (exists (select 1 from public.kinderen k
                      where k.id = stickers.kind_id
                        and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())));

drop policy if exists stickers_delete on public.stickers;
create policy stickers_delete
  on public.stickers for delete
  to authenticated
  using (exists (select 1 from public.kinderen k
                 where k.id = stickers.kind_id
                   and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())));

-- sticker_status uit 003 wordt door de front-end niet gebruikt, maar laten we
-- niet met een oudere regel achter dan de rest.
drop policy if exists status_select on public.sticker_status;
create policy status_select
  on public.sticker_status for select
  to authenticated
  using (exists (select 1 from public.kinderen k
                 where k.id = sticker_status.kind_id
                   and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())));

drop policy if exists status_insert on public.sticker_status;
create policy status_insert
  on public.sticker_status for insert
  to authenticated
  with check (exists (select 1 from public.kinderen k
                      where k.id = sticker_status.kind_id
                        and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())));

drop policy if exists status_update on public.sticker_status;
create policy status_update
  on public.sticker_status for update
  to authenticated
  using (exists (select 1 from public.kinderen k
                 where k.id = sticker_status.kind_id
                   and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())))
  with check (exists (select 1 from public.kinderen k
                      where k.id = sticker_status.kind_id
                        and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())));

drop policy if exists status_delete on public.sticker_status;
create policy status_delete
  on public.sticker_status for delete
  to authenticated
  using (exists (select 1 from public.kinderen k
                 where k.id = sticker_status.kind_id
                   and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid())));

-- ============================================================
-- 6. Het nummer van de organisator
-- ============================================================
-- Eén nummer voor de hele beurs, enkel te wijzigen door een beheerder (de
-- bestaande policy instellingen_update uit 007 dekt deze kolommen mee). Staat
-- het leeg, dan toont de site geen enkele knop — dat is de bedoelde
-- standaardtoestand tot jij je nummer invult op instellingen.html.
alter table public.instellingen
  add column if not exists whatsapp_nummer text;

alter table public.instellingen
  add column if not exists whatsapp_bericht text;

alter table public.instellingen drop constraint if exists instellingen_whatsapp_formaat;
alter table public.instellingen add constraint instellingen_whatsapp_formaat
  check (whatsapp_nummer is null or whatsapp_nummer ~ '^\+[1-9][0-9]{7,14}$');

-- ============================================================
-- 7. get_matches(): eigen gezin en het nummer van het andere gezin
-- ============================================================
-- Twee wijzigingen tegenover 008:
--   * 'eigen gezin' is nu het GEZIN, niet de user_id. Zitten twee ouders op één
--     gezin, dan blijft een ruil tussen hun kinderen dus 'thuis'.
--   * er komt één kolom bij: ander_whatsapp. Die staat enkel gevuld wanneer het
--     beursvenster open is, het andere gezin zijn nummer wil delen, en het niet
--     je eigen gezin is. In alle andere gevallen null.
--
-- Er gaat nog steeds geen e-mailadres, familienaam, user_id of kind_id van een
-- ander gezin over de lijn.
drop function if exists public.get_matches(uuid);

create function public.get_matches(p_kind_id uuid)
returns table (
  richting       text,
  code           text,
  nummer         integer,
  land_naam      text,
  sticker_naam   text,
  ander_kind     text,
  eigen_gezin    boolean,
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
    c.land_naam,
    c.naam,
    case
      when public.gezin_sleutel(ak.user_id) = ek.sleutel then ak.voornaam
      when public.beurs_actief()                         then ak.voornaam
    end,
    public.gezin_sleutel(ak.user_id) = ek.sleutel,
    case
      when public.gezin_sleutel(ak.user_id) <> ek.sleutel and public.beurs_actief()
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
    c.land_naam,
    c.naam,
    case
      when public.gezin_sleutel(ak.user_id) = ek.sleutel then ak.voornaam
      when public.beurs_actief()                         then ak.voornaam
    end,
    public.gezin_sleutel(ak.user_id) = ek.sleutel,
    case
      when public.gezin_sleutel(ak.user_id) <> ek.sleutel and public.beurs_actief()
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
-- 8. kind_statistieken(): tellers voor het hele gezin
-- ============================================================
-- Enige wijziging tegenover 008: de laatste regel. De tweede volwassene ziet de
-- cijfers van álle verzamelaars van het gezin, ook die zijn partner aanmaakte.
create or replace function public.kind_statistieken()
returns table (
  kind_id uuid,
  zoekt   integer,
  dubbel  integer,
  matches integer
)
language sql
security definer
stable
set search_path = ''
as $fn$
  with glans_ok as (
    select coalesce((select i.toon_glans from public.instellingen i where i.id = 1), false) as aan
  )
  select
    k.id,
    (select count(*)::int from public.stickers s
       join public.sticker_catalogus c on c.code = s.nummer
      where s.kind_id = k.id and s.status = 'ZOEKT' and (g.aan or not c.glans)),
    (select count(*)::int from public.stickers s
       join public.sticker_catalogus c on c.code = s.nummer
      where s.kind_id = k.id and s.status = 'RUILT' and (g.aan or not c.glans)),
    (select count(distinct s.nummer)::int
       from public.stickers s
       join public.sticker_catalogus c on c.code = s.nummer
       join public.stickers a on a.nummer = s.nummer and a.status = 'RUILT'
                             and a.kind_id <> k.id
      where s.kind_id = k.id and s.status = 'ZOEKT' and (g.aan or not c.glans))
  from public.kinderen k
  cross join glans_ok g
  where auth.uid() is not null
    and public.gezin_sleutel(k.user_id) = public.gezin_sleutel(auth.uid());
$fn$;

revoke all on function public.kind_statistieken() from public;
revoke all on function public.kind_statistieken() from anon;
grant execute on function public.kind_statistieken() to authenticated;

-- ============================================================
-- 9. Snelle controle
-- ============================================================
-- 1) Nodig jezelf uit met een tweede adres (mag een wegwerpadres zijn):
--      select public.nodig_volwassene_uit('Test', 'Ouder', 'tweede@voorbeeld.be');
--    Log daarna in het portaal in met dat adres. Op het dashboard moet je
--    dezelfde verzamelaars zien.
--
-- 2) Wie zit er in mijn gezin?
--      select l.voornaam, l.email from public.gezin_leden l
--       where l.gezin_id = public.mijn_gezin_id();
--
-- 3) Het nummer van de organisator zetten kan ook hier, in plaats van op
--    instellingen.html:
--      update public.instellingen
--         set whatsapp_nummer = '+32470123456'
--       where id = 1;
