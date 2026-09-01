// auth.js — Authenticatie logica (uitsluitend Supabase Magic Link)
import { supabase, getCurrentUser } from "./supabase.js";

document.addEventListener("DOMContentLoaded", async () => {
  const loginForm = document.getElementById("login-form");
  if (loginForm) initLoginPage();
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) initLogout();
});

function initLoginPage() {
  // Al ingelogd (herstelde sessie)? Meteen doorsturen.
  getCurrentUser().then((user) => {
    if (user) window.location.href = "/dashboard.html";
  });

  const loginForm = document.getElementById("login-form");
  const loginBtn = document.getElementById("login-btn");
  const messageEl = document.getElementById("message");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim().toLowerCase();
    if (!isValidEmail(email)) {
      showMessage(messageEl, "Voer een geldig e-mailadres in.", "error");
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
      showMessage(
        messageEl,
        "Magic link verstuurd! Controleer je e-mail (ook de spam-map) en klik op de link om in te loggen.",
        "success"
      );
      loginForm.reset();
    } catch (err) {
      showMessage(messageEl, "Fout: " + err.message, "error");
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

function showMessage(el, text, type) {
  el.textContent = text;
  el.className = "message message--show message--" + type;
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
