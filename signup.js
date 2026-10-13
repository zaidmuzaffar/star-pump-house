import './dialogs.js?v=55';
import { auth } from './firebase-config.js?v=55';
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification, fetchSignInMethodsForEmail } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';
import { attachAutoCapitalize } from './utils.js?v=55';

const form = document.getElementById("signup-form");
const done = document.getElementById("signup-done");
const sentTo = document.getElementById("sent-to");
const backBtn = document.getElementById("signup-back");
const signupBtn = document.getElementById("signup-btn");
const fullNameInput = document.getElementById("full-name");

attachAutoCapitalize(fullNameInput);

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,14}$/;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (signupBtn.disabled) return;

  const fullName = fullNameInput.value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const confirmPassword = document.getElementById("confirm-password").value;

  if (!fullName || !email || !password || !confirmPassword) { alert("Please fill in all fields."); return; }

  // First: is this email already used? (before talking about the password)
  if (await emailTaken(email)) { alert(TAKEN); return; }

  if (password !== confirmPassword) {
    alert("Passwords do not match.");
    return;
  }

  if (!passwordRegex.test(password)) {
    alert("Password must be 6-14 characters and include an uppercase letter, a lowercase letter, a number, and a special character.");
    return;
  }

  signupBtn.disabled = true;

  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, email, password);
    try { localStorage.setItem("sph-login", String(Date.now())); } catch (e) {}
    await updateProfile(credential.user, { displayName: fullName });
  } catch (error) {
    alert(signupError(error));
    signupBtn.disabled = false;
    return;
  }

  try {
    await sendEmailVerification(credential.user);
  } catch (error) {
    alert("Your account was created, but the verification email could not be sent (" + error.message + "). You can still log in.");
  }

  sentTo.textContent = email;
  form.hidden = true;
  done.hidden = false;
  signupBtn.disabled = false;
});

backBtn.addEventListener("click", () => {
  done.hidden = true;
  form.hidden = false;
});

const TAKEN = "This email already has an account. Please go to Login and sign in with it. (Forgot the password? Use \"Forgot password?\" on the Login page.)";
// Firebase answers this only when "Email enumeration protection" is OFF in the Firebase console;
// when it is ON the answer is always "not used", and the check happens when the account is created.
async function emailTaken(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  try { const m = await fetchSignInMethodsForEmail(auth, email); return Array.isArray(m) && m.length > 0; } catch (e) { return false; }
}
// tell them as soon as they leave the email box
const emailInput = document.getElementById("signup-email");
emailInput.addEventListener("change", async () => { const v = emailInput.value.trim(); if (v && await emailTaken(v)) alert(TAKEN); });

// Plain words instead of Firebase codes
function signupError(error) {
  const c = String((error && (error.code || error.message)) || "");
  if (/email-already-in-use/.test(c)) return TAKEN;
  if (/invalid-email/.test(c)) return "This email address is not correct. Please check it and try again.";
  if (/weak-password/.test(c)) return "This password is too weak. Use 6-14 characters with a capital letter, a small letter, a number and a symbol.";
  if (/network/.test(c)) return "No internet connection. Please check the internet and try again.";
  if (/too-many-requests/.test(c)) return "Too many tries. Please wait a few minutes and try again.";
  return "Could not create the account. Please try again in a moment.";
}
