import { confirmDialog } from './dialogs.js?v=55';
import { auth, db, start, setDoc, getDoc, getDocs, col, deleteDoc, listen, showShopName } from './common.js?v=55';
import { doc } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js';
import { updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider, sendEmailVerification, reload } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';
import { attachAutoCapitalize, attachNumberFormatting, formatDateDMY, isoFromDate, esc } from './utils.js?v=55';

const el = (id) => document.getElementById(id);
const nameInput = el("profile-name"), emailInput = el("profile-email");
const shopNameInput = el("shop-name"), shopPhoneInput = el("shop-phone");
const toast = el("toast"), toastText = el("toast-text");

attachAutoCapitalize(nameInput);
attachAutoCapitalize(shopNameInput);
attachNumberFormatting(shopPhoneInput, false);

function say(message) {
  toastText.textContent = message;
  toast.hidden = false;
  clearTimeout(say._t);
  say._t = setTimeout(() => { toast.hidden = true; }, 5000);
}

// Everything the shop stores. "settings" holds the shop name/phone.
const BACKUP_COLLECTIONS = ["products", "sales", "upcoming", "suppliers", "purchases", "supplierPayments", "shops", "shopBills", "shopPayments", "pendingProducts", "payments", "returns", "closings", "expenses", "settings"];

function showLastBackup(iso) {
  if (!iso) { el("bk-last").textContent = "Last backup: never"; return; }
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const days = Math.round((t - new Date(y, m - 1, d)) / 86400000);
  el("bk-last").textContent = "Last backup: " + formatDateDMY(iso) + (days === 0 ? " (today)" : days === 1 ? " (yesterday)" : ` (${days} days ago)`);
}

function paintHeader(user, displayName) {
  const shown = displayName || user.email;
  el("avatar").textContent = shown.charAt(0).toUpperCase();
  el("p-name").textContent = shown;
  el("p-mail").textContent = user.email;
  const badge = el("p-verified");
  badge.classList.toggle("no", !user.emailVerified);
  badge.lastChild.textContent = user.emailVerified ? "Verified" : "Not verified";
  const created = user.metadata && user.metadata.creationTime ? isoFromDate(new Date(user.metadata.creationTime)) : "";
  el("p-since").textContent = created ? "Member since " + formatDateDMY(created) : "";
  el("verify-box").hidden = !!user.emailVerified;
}

// ---------- Email verification ----------
el("verify-send").addEventListener("click", async (e) => {
  const b = e.currentTarget; if (b.disabled) return; b.disabled = true;
  try { await sendEmailVerification(auth.currentUser); say(`Verification email sent to ${auth.currentUser.email}. Check Inbox and Spam, open the email and press the link.`); }
  catch (err) { alert(/too-many/i.test(err.code || err.message) ? "An email was sent a moment ago. Please wait a few minutes, then try again." : "Could not send the email: " + err.message); }
  finally { setTimeout(() => { b.disabled = false; }, 30000); }
});
el("verify-check").addEventListener("click", async () => {
  try { await reload(auth.currentUser); } catch (e) {}
  paintHeader(auth.currentUser, auth.currentUser.displayName);
  say(auth.currentUser.emailVerified ? "Email verified. ✓" : "Not verified yet. Open the link in the email first, then press this again.");
});

start(async (user) => {
  emailInput.value = user.email;
  // fresh "verified" status (it changes after the email link is opened)
  reload(auth.currentUser).then(() => paintHeader(auth.currentUser, auth.currentUser.displayName)).catch(() => {});
  if (user.role === "owner") initStaff(user);
  nameInput.value = user.displayName || "";
  paintHeader(user, user.displayName);
  try {
    const snap = await getDoc(doc(db, "users", user.uid, "settings", "shop"));
    const s = snap.exists() ? snap.data() : {};
    shopNameInput.value = s.shopName || "Star Pump House";
    shopPhoneInput.value = s.shopPhone || "";
    showLastBackup(s.lastBackup);
  } catch (e) {
    shopNameInput.value = "Star Pump House";
  }

  el("save-profile-btn").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    const newName = nameInput.value.trim();
    const shopName = shopNameInput.value.trim();
    if (!newName) { alert("Please enter a username."); return; }
    if (!shopName && user.role === "owner") { alert("Please enter a shop name."); return; }
    btn.disabled = true;
    try {
      await updateProfile(auth.currentUser, { displayName: newName });
      paintHeader(auth.currentUser, newName);
      if (user.role !== "owner") { say("Account details saved."); return; }
      try {
        await setDoc(doc(db, "users", user.uid, "settings", "shop"), { shopName, shopPhone: shopPhoneInput.value }, { merge: true });
        showShopName(shopName);
      } catch (e) {
        alert("Your username was saved, but shop details could not be saved: " + e.message + "\n\nPlease allow the 'settings' collection in your Firestore rules.");
        return;
      }
      say("Account details saved.");
    } catch (error) {
      alert("Error updating profile: " + error.message);
    } finally { btn.disabled = false; }
  });

  // ---------- Backup (JSON file) ----------
  el("bk-download-btn").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const data = { app: "star-pump-house", version: 1, createdAt: new Date().toISOString(), collections: {} };
      let total = 0;
      for (const name of BACKUP_COLLECTIONS) {
        const snap = await getDocs(col(user.uid, name));
        const docs = {};
        snap.forEach((d) => { docs[d.id] = d.data(); total++; });
        data.collections[name] = docs;
      }
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `star-pump-house-backup-${formatDateDMY(isoFromDate(new Date()))}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      const stamp = isoFromDate(new Date());
      try { await setDoc(doc(db, "users", user.uid, "settings", "shop"), { lastBackup: stamp }, { merge: true }); } catch (e) {}
      showLastBackup(stamp);
      say(`Backup downloaded (${total} records). Keep the file somewhere safe.`);
    } catch (error) {
      alert("Could not make the backup: " + error.message);
    } finally { btn.disabled = false; }
  });

  el("bk-restore-btn").addEventListener("click", () => { el("bk-file").value = ""; el("bk-file").click(); });
  el("bk-file").addEventListener("change", async () => {
    const file = el("bk-file").files[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { alert("This file could not be read. Please pick a Star Pump House backup (.json) file."); return; }
    if (!data || data.app !== "star-pump-house" || !data.collections) { alert("This is not a Star Pump House backup file."); return; }
    const names = Object.keys(data.collections).filter((n) => BACKUP_COLLECTIONS.includes(n));
    const count = names.reduce((a, n) => a + Object.keys(data.collections[n] || {}).length, 0);
    const when = data.createdAt ? formatDateDMY(isoFromDate(new Date(data.createdAt))) : "unknown date";
    if (!(await confirmDialog({ title: "Restore this backup?", message: `Backup from ${when} with ${count} records. Records in the file will be written back; anything with the same record will be replaced by the backup copy. Records you added after the backup are kept.`, confirmLabel: "Restore" }))) return;
    const btn = el("bk-restore-btn");
    btn.disabled = true;
    try {
      let done = 0;
      for (const n of names) {
        const entries = Object.entries(data.collections[n] || {});
        for (let i = 0; i < entries.length; i += 20) {
          await Promise.all(entries.slice(i, i + 20).map(([id, d]) => setDoc(doc(db, "users", user.uid, n, id), d)));
          done += Math.min(20, entries.length - i);
        }
      }
      say(`Backup restored (${done} records).`);
    } catch (error) {
      alert("Restore stopped with an error: " + error.message);
    } finally { btn.disabled = false; }
  });

  el("save-pw-btn").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    const current = el("pw-current").value, next = el("pw-new").value, confirm = el("pw-confirm").value;
    if (!current || !next || !confirm) { alert("Please fill in all three password fields."); return; }
    if (next.length < 6) { alert("New password must be at least 6 characters."); return; }
    if (next !== confirm) { alert("New passwords do not match."); return; }
    btn.disabled = true;
    try {
      await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(user.email, current));
      await updatePassword(auth.currentUser, next);
      el("pw-current").value = ""; el("pw-new").value = ""; el("pw-confirm").value = "";
      say("Password updated.");
    } catch (error) {
      const wrong = ["auth/wrong-password", "auth/invalid-credential", "auth/invalid-login-credentials"].includes(error.code);
      alert(wrong ? "Your current password is incorrect." : "Could not update password: " + error.message);
    } finally { btn.disabled = false; }
  });
});

// ---------- Salesman logins (owner only) ----------
// users/{owner}/staff/{email} = the list the owner sees; staffIndex/{email} = how the salesman's login finds this shop.
function initStaff(user) {
  const list = el("st-list");
  let rows = [];
  const draw = () => {
    list.innerHTML = rows.length ? rows.map(([id, s]) => `<div class="staff-row"><span class="avatar" style="width:36px;height:36px;font-size:14px;flex:none">${esc((s.name || "?").charAt(0).toUpperCase())}</span><span class="stack"><b>${esc(s.name || "")}</b><span class="muted" style="font-size:13px">${esc(s.email || id)} · added ${formatDateDMY(s.createdAt || "")}</span></span><button type="button" class="btn btn-danger" data-rm="${esc(id)}">Remove</button></div>`).join("")
      : '<div class="staff-row"><span class="muted">No salesman yet.</span></div>';
  };
  listen(user.uid, "staff", (r) => { rows = r; draw(); });
  el("st-add").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget; if (btn.disabled) return;
    const name = el("st-name").value.trim(), email = el("st-email").value.trim().toLowerCase();
    if (!name) { alert("Please enter the salesman's name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert("Please enter a correct email address."); return; }
    if (email === String(user.email || "").toLowerCase()) { alert("This is your own email. Use the salesman's email."); return; }
    btn.disabled = true;
    try {
      let shopName = "";
      try { const s = await getDoc(doc(db, "users", user.uid, "settings", "shop")); shopName = s.exists() ? s.data().shopName || "" : ""; } catch (e) {}
      const createdAt = isoFromDate(new Date());
      await setDoc(doc(db, "staffIndex", email), { ownerUid: user.uid, name, email, shopName, role: "salesman", createdAt });
      await setDoc(doc(db, "users", user.uid, "staff", email), { name, email, role: "salesman", createdAt });
      el("st-name").value = ""; el("st-email").value = "";
      say(`${name} added. He can now sign up / log in with ${email}.`);
    } catch (e) {
      alert("Could not add the salesman: " + e.message + "\n\nPaste the new Firestore rules first (see README), then try again.");
    } finally { btn.disabled = false; }
  });
  list.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    const id = b.dataset.rm, r = rows.find(([x]) => x === id);
    if (!(await confirmDialog({ title: "Remove this salesman?", message: `${r ? r[1].name : id} will not be able to sell any more. His old sales stay.`, confirmLabel: "Remove", danger: true }))) return;
    try { await deleteDoc(doc(db, "staffIndex", id)); await deleteDoc(doc(db, "users", user.uid, "staff", id)); }
    catch (err) { alert("Could not remove: " + err.message); }
  });
}
