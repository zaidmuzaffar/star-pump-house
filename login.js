import './dialogs.js?v=55';
import { auth } from './firebase-config.js?v=55';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';

const form = document.getElementById("login-form");
if (new URLSearchParams(location.search).get("other")) document.getElementById("other-note").hidden = false;
const loginBtn = document.getElementById("login-btn");
const pwInput = document.getElementById("password");
const pwToggle = document.getElementById("pw-toggle");

pwToggle.addEventListener("click", () => {
  const show = pwInput.type === "password";
  pwInput.type = show ? "text" : "password";
  pwToggle.textContent = show ? "Hide" : "Show";
  pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (loginBtn.disabled) return;

  const email = document.getElementById("email").value.trim();
  const password = pwInput.value;
  if (!email || !password) { alert("Please enter your email and password."); return; }

  loginBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // tell the other tabs of this browser to sign out (one login per browser)
    try { localStorage.setItem("sph-login", String(Date.now())); } catch (e) {}
    window.location.href = "dashboard.html";
  } catch (error) {
    const c = String((error && (error.code || error.message)) || "");
    alert(/network/.test(c) ? "No internet connection. Please check the internet and try again."
      : /too-many-requests/.test(c) ? "Too many wrong tries. Please wait a few minutes, or use \"Forgot password\"."
      : /user-disabled/.test(c) ? "This account has been switched off. Please ask the shop owner."
      : /invalid-email/.test(c) ? "This email address is not correct. Please check it."
      : "Incorrect email or password.");
  } finally {
    loginBtn.disabled = false;
  }
});

// Forgot password: Firebase emails a link to set a new password
document.getElementById("forgot-btn").addEventListener("click", async (e) => {
  const b = e.currentTarget; if (b.disabled) return;
  const email = document.getElementById("email").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert("Please type your email in the Email box first, then press \"Forgot password?\" again."); return; }
  b.disabled = true;
  try { await sendPasswordResetEmail(auth, email); alert(`If an account exists for ${email}, a link to set a new password has been sent. Check Inbox and Spam.`); }
  catch (err) { alert(/network/.test(String(err.code || err.message)) ? "No internet connection. Please try again." : /too-many/.test(String(err.code)) ? "Please wait a few minutes and try again." : "Could not send the email. Please check the address and try again."); }
  finally { b.disabled = false; }
});
