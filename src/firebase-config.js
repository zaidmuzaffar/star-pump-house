import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js';
import { getAuth, setPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyCue947Oaxyoau-uZ3Xlo49uo4b_8IjQEY",
  authDomain: "star-pump-house.firebaseapp.com",
  projectId: "star-pump-house",
  storageBucket: "star-pump-house.firebasestorage.app",
  messagingSenderId: "625696283364",
  appId: "1:625696283364:web:578dee6df9354da68b6af1"
};

export const app = initializeApp(firebaseConfig);

// ---------- App Check (protection) ----------
// Stops other websites / bots from using your Firebase project and your free AI quota.
// 1) Make a reCAPTCHA (score-based, Web) key in Google Cloud, 2) paste it below,
// 3) register the same key in Firebase → App Check → Apps (reCAPTCHA Enterprise).
// Leave it "" to keep App Check off.
const APP_CHECK_SITE_KEY = "6Leu9OstAAAAADvZdbTA8NAvOaB1Xi1bXCr-qic7";
if (APP_CHECK_SITE_KEY) {
  try {
    // On your own computer (127.0.0.1 / localhost) Firebase prints a "debug token" in the browser console once;
    // add it in Firebase → App Check → Manage debug tokens so the local copy keeps working.
    if (["127.0.0.1", "localhost"].includes(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('https://www.gstatic.com/firebasejs/12.7.0/firebase-app-check.js');
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  } catch (e) { console.warn("App Check could not start:", e); }
}
export const auth = getAuth(app);

// Log out automatically when the browser/tab is closed — login required again next time
setPersistence(auth, browserSessionPersistence);
