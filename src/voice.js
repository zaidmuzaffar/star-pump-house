// Voice input for Ask AI: press the mic, speak (Urdu or English), the question is sent when you stop.
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const wrap = document.getElementById("ai-mic-wrap");
  if (!SR || !wrap) return;   // Firefox and some browsers have no speech recognition: the mic stays hidden
  wrap.hidden = false;
  const mic = document.getElementById("ai-mic"), langBtn = document.getElementById("ai-lang");
  const q = document.getElementById("ai-q"), form = document.getElementById("ai-form"), foot = document.getElementById("ai-foot");
  const KEY = "sph-voice-lang", LANGS = { UR: "ur-PK", EN: "en-US" };
  let lang = "UR";
  try { lang = localStorage.getItem(KEY) === "EN" ? "EN" : "UR"; } catch (e) {}
  const footText = foot ? foot.textContent : "";
  const showLang = () => { langBtn.textContent = lang; langBtn.title = lang === "UR" ? "Speaking in Urdu (tap for English)" : "Speaking in English (tap for Urdu)"; };
  showLang();
  langBtn.addEventListener("click", () => { lang = lang === "UR" ? "EN" : "UR"; try { localStorage.setItem(KEY, lang); } catch (e) {} showLang(); });

  let rec = null, finalText = "", before = "", failed = false, askedMic = false;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // Ask the browser for the microphone first (iPhone / Chrome sometimes only show the "Allow microphone" box this way)
  async function askMic() {
    if (askedMic || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    askedMic = true;
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); return true; }
    catch (e) { return false; }
  }
  const say = (t) => { if (foot) foot.textContent = t || footText; };
  function stopUi() { mic.classList.remove("on"); mic.setAttribute("aria-label", "Speak your question"); say(""); rec = null; }

  function showBlocked() {
    say(isIOS
      ? "Mic is blocked. iPhone: Settings → Chrome (or Safari) → Microphone ON, and Settings → General → Keyboard → Enable Dictation ON. Or tap the text box and use the keyboard's own mic 🎤."
      : "Microphone is blocked. Click the lock icon next to the address → Microphone → Allow, then reload the page.");
    setTimeout(() => say(""), 15000);
    if (isIOS) q.focus();
  }

  mic.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = LANGS[lang]; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    finalText = ""; failed = false; before = q.value.trim();
    rec.onstart = () => { mic.classList.add("on"); mic.setAttribute("aria-label", "Stop listening"); say(lang === "UR" ? "Listening… bolein, phir ruk jayein (Urdu)" : "Listening… speak, then pause (English)"); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      q.value = [before, (finalText + interim).trim()].filter(Boolean).join(" ");
      q.dispatchEvent(new Event("input"));
    };
    rec.onerror = (e) => {
      failed = true;
      const blocked = e.error === "not-allowed" || e.error === "service-not-allowed";
      if (blocked && !askedMic) {
        // first time: ask for the mic properly, then try once more
        stopUi();
        askMic().then((ok) => { if (ok) mic.click(); else showBlocked(); });
        return;
      }
      const m = blocked ? null
        : e.error === "no-speech" ? "Didn't hear anything. Press the mic and speak again."
        : e.error === "language-not-supported" ? "This browser can't listen in this language. Tap UR/EN to switch."
        : e.error === "network" ? "Voice needs internet. Check the connection." : "Voice stopped: " + e.error;
      stopUi();
      if (blocked) showBlocked(); else { say(m); setTimeout(() => say(""), 6000); }
    };
    rec.onend = () => {
      const got = finalText.trim();
      if (rec) stopUi();
      if (!failed && got) { q.value = [before, got].filter(Boolean).join(" "); form.requestSubmit(); }
    };
    try { rec.start(); } catch (e) { stopUi(); }
  });
})();
