// auth.js — Authenticatie logica (e-mail OTP / Magic Link)
import { supabase, getCurrentUser } from "./supabase.js";

document.addEventListener("DOMContentLoaded", async () => {
  const loginForm = document.getElementById("login-form");
  if (loginForm) initLoginPage();
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) initDashboardAuth();
});

function initLoginPage() {
  getCurrentUser().then((user) => {
    if (user) window.location.href = "/dashboard.html";
  });

  const loginForm = document.getElementById("login-form");
  const loginBtn = document.getElementById("login-btn");
  const otpSection = document.getElementById("otp-section");
  const verifyForm = document.getElementById("verify-form");
  const verifyBtn = document.getElementById("verify-btn");
  const resendBtn = document.getElementById("resend-btn");
  const messageEl = document.getElementById("message");
  let currentEmail = "";

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim().toLowerCase();
    if (!isValidEmail(email)) { showMessage(messageEl, "Voer een geldig e-mailadres in.", "error"); return; }
    currentEmail = email;
    loginBtn.disabled = true;
    loginBtn.textContent = "Versturen…";
    try {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw error;
      showMessage(messageEl, "Inlogcode verstuurd! Controleer je e-mail (ook spam-map).", "success");
      otpSection.classList.remove("hidden");
      loginForm.style.display = "none";
    } catch (err) {
      showMessage(messageEl, "Fout: " + err.message, "error");
      loginBtn.disabled = false;
      loginBtn.textContent = "Inlogcode versturen";
    }
  });

  verifyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = document.getElementById("token").value.trim();
    if (!/^\d{6}$/.test(token)) { showMessage(messageEl, "De code moet uit 6 cijfers bestaan.", "error"); return; }
    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verifiëren…";
    try {
      const { error } = await supabase.auth.verifyOtp({ email: currentEmail, token, type: "email" });
      if (error) throw error;
      showMessage(messageEl, "Succes! Je wordt doorgestuurd…", "success");
      setTimeout(() => { window.location.href = "/dashboard.html"; }, 800);
    } catch (err) {
      showMessage(messageEl, "Verificatie mislukt: " + err.message, "error");
      verifyBtn.disabled = false;
      verifyBtn.textContent = "Verifiëren";
    }
  });

  resendBtn.addEventListener("click", async () => {
    if (!currentEmail) return;
    resendBtn.disabled = true;
    resendBtn.textContent = "Versturen…";
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: currentEmail });
      if (error) throw error;
      showMessage(messageEl, "Nieuwe code verstuurd!", "success");
    } catch (err) { showMessage(messageEl, "Fout: " + err.message, "error"); }
    resendBtn.disabled = false;
    resendBtn.textContent = "Nieuwe code aanvragen";
  });
}

async function initDashboardAuth() {
  const user = await getCurrentUser();
  if (!user) { window.location.href = "/login.html"; return; }
  const emailEl = document.getElementById("user-email");
  if (emailEl) emailEl.textContent = user.email;
  const logoutBtn = document.getElementById("logout-btn");
  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    logoutBtn.textContent = "Uitloggen…";
    await supabase.auth.signOut();
    window.location.href = "/login.html";
  });
}

function showMessage(el, text, type) { el.textContent = text; el.className = "message message--show message--" + type; }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }