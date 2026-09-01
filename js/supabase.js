// supabase.js — Supabase client initialisatie
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://iriqsfxcrfdnkfvqmirw.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_a_FThAr0HuB5UFdwzCv4og_Lz2lM1nb";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export async function getCurrentUser() {
  // getSession() wacht op de initialisatie van de client, inclusief het
  // uitlezen van de sessie uit de URL na het klikken op een magic link.
  // Zonder deze stap kan getUser() te vroeg draaien en ten onrechte null
  // teruggeven, waardoor een net ingelogde gebruiker terug naar de
  // loginpagina gestuurd wordt.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return null;
  return user;
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "/login.html";
    return null;
  }
  return user;
}