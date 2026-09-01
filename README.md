# MijnPortaal

Een veilig portaal waar gebruikers kunnen aanmelden met hun e-mailadres (OTP/magic link), inloggen en formulieren invullen die opgeslagen worden in een Supabase-database. Gehost op Cloudflare Pages.

## 1. Supabase instellen
1. Maak een project op supabase.com
2. Voer sql/schema.sql uit in de SQL Editor
3. Authentication → Email inschakelen, OTP template aanpassen
4. Settings → API: kopieer Project URL + anon key

## 2. App configureren
Vul SUPABASE_URL en SUPABASE_ANON_KEY in js/supabase.js

## 3. Cloudflare Pages
1. Push code naar GitHub
2. Cloudflare → Workers & Pages → Create → Pages → Connect to Git
3. Build command: leeg | Output: /
4. Deploy

## 4. Supabase redirect URL
Authentication → URL Configuration → voeg https://jouw-site.pages.dev/** toe

## Beveiliging
- Alleen anon key in client-code (publiek, veilig)
- Row Level Security: gebruikers zien enkel eigen data
- Inputvalidatie + XSS-bescherming (textContent sanitization)
- ES Modules
- service_role key nooit in client-code