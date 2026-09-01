// auth.js — Authenticatie logica (uitsluitend Supabase Magic Link)
import { supabase, getCurrentUser } from "./supabase.js";

// Foutcodes die Supabase in de redirect-URL kan meegeven na het klikken op
// een magic link, vertaald naar begrijpelijke tekst.
const AUTH_FOUTEN = {
  otp_expired:
    "Deze inloglink is verlopen of werd al gebruikt. Een link is maar één keer bruikbaar — vraag hieronder een nieuwe aan.",
  access_denied:
    "De inloglink werd geweigerd. Vraag hieronder een nieuwe link aan.",
  otp_disabled:
    "Aanmelden via e-mail staat momenteel uitgeschakeld. Neem contact op via valentijn@meulestede.gent.",
  email_not_confirmed:
    "Dit e-mailadres is nog niet bevestigd. Vraag hieronder een nieuwe link aan.",
};

const FOUT_OPSLAG_KEY = "panini-auth-fout";

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Fout uit de magic-link redirect? Tonen (of meenemen naar de loginpagina).
  const urlFout = leesAuthFoutUitUrl();
  if (urlFout) {
    // URL opschonen zodat de fout niet terugkomt bij een refresh.
    window.history.replaceState({}, document.title, window.location.pathname);
    if (!document.getElementById("login-form")) {
      sessionStorage.setItem(FOUT_OPSLAG_KEY, urlFout);
      window.location.replace("/login.html");
      return;
    }
    toonMelding(document.getElementById("message"), urlFout, "error");
  }

  // 2. Fout die van een andere pagina werd meegegeven.
  const bewaardeFout = sessionStorage.getItem(FOUT_OPSLAG_KEY);
  if (bewaardeFout) {
    sessionStorage.removeItem(FOUT_OPSLAG_KEY);
    const messageEl = document.getElementById("message");
    if (messageEl) toonMelding(messageEl, bewaardeFout, "error");
  }

  const loginForm = document.getElementById("login-form");
  if (loginForm) initLoginPage(Boolean(urlFout || bewaardeFout));

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) initLogout();

  const landing = document.getElementById("landing-hero");
  if (landing) initLandingPage();
});

function leesAuthFoutUitUrl() {
  const uitHash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const uitQuery = new URLSearchParams(window.location.search);
  const code = uitHash.get("error_code") || uitQuery.get("error_code");
  const fout = uitHash.get("error") || uitQuery.get("error");
  if (!code && !fout) return null;
  const omschrijving =
    uitHash.get("error_description") || uitQuery.get("error_description") || "onbekende fout";
  return AUTH_FOUTEN[code] || AUTH_FOUTEN[fout] || "Aanmelden mislukt: " + omschrijving;
}

function initLoginPage(alFoutGetoond) {
  // Al ingelogd (herstelde sessie of net via magic link)? Meteen doorsturen.
  if (!alFoutGetoond) {
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) window.location.replace("/dashboard.html");
    });
  }

  const loginForm = document.getElementById("login-form");
  const loginBtn = document.getElementById("login-btn");
  const messageEl = document.getElementById("message");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim().toLowerCase();
    if (!isGeldigEmail(email)) {
      toonMelding(messageEl, "Voer een geldig e-mailadres in.", "error");
      return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = "Versturen…";
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          // Na het klikken op de magic link belandt de gebruiker rechtstreeks
          // op het dashboard, ingelogd (detectSessionInUrl verwerkt de sessie).
          emailRedirectTo: `${window.location.origin}/dashboard.html`,
        },
      });
      if (error) throw error;
      toonMelding(
        messageEl,
        "Magic link verstuurd! Controleer je e-mail (ook de spam-map) en klik op de link om in te loggen. De link werkt één keer.",
        "success"
      );
      loginForm.reset();
    } catch (err) {
      toonMelding(messageEl, "Fout: " + err.message, "error");
    }
    loginBtn.disabled = false;
    loginBtn.textContent = "Magic link versturen";
  });
}

function initLogout() {
  const logoutBtn = document.getElementById("logout-btn");
  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    logoutBtn.textContent = "Uitloggen…";
    await supabase.auth.signOut();
    window.location.href = "/login.html";
  });
}

// Landt een geslaagde magic link op de startpagina (Site URL) i.p.v. op het
// dashboard, dan sturen we de gebruiker alsnog door.
async function initLandingPage() {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) window.location.replace("/dashboard.html");
  });
  const user = await getCurrentUser();
  if (user) window.location.replace("/dashboard.html");
}

function toonMelding(el, tekst, type) {
  if (!el) return;
  el.textContent = tekst;
  el.className = "message message--show message--" + type;
}
function isGeldigEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
