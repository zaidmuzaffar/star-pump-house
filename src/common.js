import { app, auth } from './firebase-config.js?v=55';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, terminate, clearIndexedDbPersistence, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, getDocs, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';
import { confirmDialog } from './dialogs.js?v=55';

export { auth, onSnapshot, addDoc, updateDoc, deleteDoc, getDocs, setDoc, getDoc };
// Records are kept in a cache on this device, so every page shows its data at once (from the cache)
// and then updates from the internet in the background. The cache is wiped on Sign out.
function makeDb() {
  try { return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e) { return getFirestore(app); }
}
export const db = makeDb();
export const col = (uid, name) => collection(db, "users", uid, name);
export const ref = (uid, name, id) => doc(db, "users", uid, name, id);

// Who is logged in: the shop OWNER (his own data) or a SALESMAN (works in the owner's shop, can only sell).
// A salesman's email is added by the owner on the Profile page (staffIndex/{email} -> ownerUid).
// The owner always stays owner: someone who already has his own shop settings is never treated as staff.
export const SALESMAN_PAGES = ["stock.html", "settings.html"];
let whoCache = null;
function buildWho(user, link) {
  const u = Object.create(user);
  Object.defineProperty(u, "uid", { value: link ? link.ownerUid : user.uid, enumerable: true });
  u.authUid = user.uid;
  u.role = link ? "salesman" : "owner";
  u.staffName = link ? (link.name || user.displayName || user.email) : "";
  u.shopOwnerName = link ? (link.shopName || "") : "";
  document.documentElement.dataset.role = u.role;
  return u;
}
const WHO_KEY = "sph-who";
export async function whoAmI(user) {
  if (whoCache && whoCache.authUid === user.uid) return whoCache;
  // Same login as on the last page: answer at once, check again quietly in the background.
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(WHO_KEY) || "null"); } catch (e) {}
  if (saved && saved.authUid === user.uid) {
    whoCache = buildWho(user, saved.link);
    lookupWho(user).then((link) => { if (link !== undefined && JSON.stringify(link) !== JSON.stringify(saved.link)) { remember(user, link); location.reload(); } });
    return whoCache;
  }
  const found = await lookupWho(user);
  const link = found === undefined ? null : found;
  if (found !== undefined) remember(user, link);
  whoCache = buildWho(user, link);
  return whoCache;
}
function remember(user, link) {
  try {
    sessionStorage.setItem(WHO_KEY, JSON.stringify({ authUid: user.uid, link }));
    if (link) sessionStorage.setItem("sph-role", "salesman"); else sessionStorage.removeItem("sph-role");
  } catch (e) {}
}
async function lookupWho(user) {
  const email = String(user.email || "").toLowerCase();
  let link = null;
  if (email) {
    try {
      const s = await getDoc(doc(db, "staffIndex", email));
      const d = s.exists() ? s.data() : null;
      if (d && d.ownerUid && d.ownerUid !== user.uid) {
        const own = await getDoc(doc(db, "users", user.uid, "settings", "shop")).catch(() => null);
        if (!own || !own.exists()) link = d;
      }
    } catch (e) {
      // no access to staffIndex = the rules were never updated: a normal owner. Anything else (offline): unknown.
      if (!/permission|insufficient/i.test(String(e && (e.code || e.message)))) return undefined;
    }
  }
  return link ? { ownerUid: link.ownerUid, name: link.name || "", shopName: link.shopName || "" } : null;
}

// Shop name at the top of the menu (and the phone top bar). Kept for the session so it shows at once.
export function showShopName(name) {
  if (!name) return;
  try { sessionStorage.setItem("sph-shop", name); } catch (e) {}
  document.querySelectorAll(".brand-name, .mbar-text b").forEach((n) => { n.textContent = name; });
}
async function loadShopName(me) {
  let s;
  try { s = await getDoc(doc(db, "users", me.uid, "settings", "shop")); } catch (e) { return; }
  const name = s.exists() ? (s.data().shopName || "") : "";
  if (name) { showShopName(name); return; }
  // A new owner who has not named the shop yet: ask once (a salesman never sees this)
  if (me.role === "owner") askShopName(me);
}
function askShopName(me) {
  if (document.getElementById("shop-ask")) return;
  const box = document.createElement("div");
  box.className = "overlay msg active"; box.id = "shop-ask";
  box.innerHTML = `<div class="dlg sm" role="dialog" aria-labelledby="shop-ask-t">
    <div class="dlg-head"><div class="stack"><h2 class="dlg-title" id="shop-ask-t">Welcome! What is your shop's name?</h2>
      <span class="dlg-sub">It shows at the top of every page, on receipts and reports. You can change it later in Profile.</span></div></div>
    <div class="dlg-body">
      <label class="fgroup"><span class="lbl">Shop name <span class="req">*</span></span><input class="inp" id="shop-ask-name" placeholder="e.g. Ali Pump House" autocomplete="off"></label>
      <label class="fgroup"><span class="lbl">Shop phone (optional)</span><input class="inp" id="shop-ask-phone" inputmode="numeric" maxlength="13" placeholder="03XXXXXXXXX"></label>
    </div>
    <div class="dlg-foot"><button type="button" class="btn pri" id="shop-ask-save" style="flex:1">Save</button></div></div>`;
  document.body.appendChild(box);
  const nameIn = box.querySelector("#shop-ask-name"), phoneIn = box.querySelector("#shop-ask-phone"), btn = box.querySelector("#shop-ask-save");
  nameIn.addEventListener("input", () => { if (nameIn.value) nameIn.value = nameIn.value.charAt(0).toUpperCase() + nameIn.value.slice(1); });
  phoneIn.addEventListener("input", () => { phoneIn.value = phoneIn.value.replace(/\D/g, ""); });
  const save = async () => {
    const name = nameIn.value.trim().replace(/\s+/g, " ");
    if (!name) { nameIn.focus(); nameIn.style.borderColor = "#B3362E"; return; }
    btn.disabled = true;
    try {
      await setDoc(doc(db, "users", me.uid, "settings", "shop"), { shopName: name, shopPhone: phoneIn.value }, { merge: true });
      showShopName(name); box.remove();
    } catch (e) { alert("Could not save the shop name: " + e.message); btn.disabled = false; }
  };
  btn.addEventListener("click", save);
  nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
  setTimeout(() => nameIn.focus(), 60);
}

// Wipe this tab's login and the records saved on this device.
let leaving = false; // true while signing out, so closing listeners don't show error popups
async function endSession(to) {
  leaving = true;
  try { ["sph-role", WHO_KEY, "sph-shop"].forEach((k) => sessionStorage.removeItem(k)); } catch (e) {}
  try { await signOut(auth); } catch (e) {}
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch (e) {}
  window.location.href = to;
}

// One login per browser: when someone logs in on another tab of THIS browser, this tab signs out.
// (Other phones / computers are not affected.)
export const LOGIN_EVENT = "sph-login";
window.addEventListener("storage", (e) => {
  if (e.key !== LOGIN_EVENT || !e.newValue) return;
  if (!auth.currentUser || /login\.html|signup\.html/.test(location.pathname)) return;
  endSession("login.html?other=1");
});

// Auth guard: shows the page once a user is confirmed, otherwise goes to login.
export function start(onReady) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    const me = await whoAmI(user);
    const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (me.role === "salesman" && !SALESMAN_PAGES.includes(page)) { location.replace("stock.html"); return; }
    document.body.classList.remove("auth-checking");
    document.querySelectorAll(".brand-sub").forEach((n) => { n.textContent = me.role === "salesman" ? "Salesman" : "Manager panel"; });
    onReady(me);
    loadShopName(me);
  });
  document.querySelectorAll("[data-signout]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!(await confirmDialog({ title: "Sign out?", message: "Are you sure you want to sign out? You will need your email and password to log in again.", confirmLabel: "Sign out", danger: true }))) return;
      endSession("login.html");
    });
  });
}

// Live collection -> array of [id, data]
export function listen(uid, name, callback) {
  return onSnapshot(col(uid, name), (snap) => {
    const entries = [];
    snap.forEach((d) => entries.push([d.id, d.data()]));
    callback(entries);
  }, (error) => {
    // While signing out the database is closed on purpose; those errors are expected, so stay quiet.
    if (leaving || !auth.currentUser) return;
    alert(`Error loading ${name}: ` + error.message);
  });
}

export function showToast(el, html, ms = 7000) {
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, ms);
}
