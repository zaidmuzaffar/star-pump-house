// Light / dark theme. A small round button sits at the top-right of every page (always in the same place).
// Pressing it: a circle grows from the top-right corner down to the bottom-left and the whole site changes theme.
// The choice is remembered on this device. Loaded in <head> (not as a module) so a dark page never flashes white.
(function () {
  var KEY = "sph-theme";
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved === "dark") root.setAttribute("data-theme", "dark");
  // Salesman login: hide the owner-only menu before the page paints (common.js confirms it after login)
  try { if (sessionStorage.getItem("sph-role") === "salesman") root.setAttribute("data-role", "salesman"); } catch (e) {}

  // Phone / tablet: "Laptop view" shows the full laptop layout (sidebar and all), zoomed to fit the screen.
  var VKEY = "sph-view";
  // only touch phones / tablets (never a laptop or desktop, whatever its screen size)
  var touch = window.matchMedia && matchMedia("(hover: none) and (pointer: coarse)").matches;
  var smallDevice = touch && Math.min(screen.width, screen.height) < 1024;
  var laptopView = false, fit = 1;
  try { laptopView = smallDevice && localStorage.getItem(VKEY) === "laptop"; } catch (e) {}
  if (laptopView) {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) { vp = document.createElement("meta"); vp.name = "viewport"; document.head.appendChild(vp); }
    // zoom so the whole 1280px laptop page fits the phone's width (you can still pinch to zoom in)
    fit = Math.round(Math.min(1, (window.innerWidth && window.innerWidth < 1280 ? window.innerWidth : screen.width) / 1280) * 1000) / 1000;
    vp.setAttribute("content", "width=1280, initial-scale=" + fit);
    root.classList.add("laptop-view");
  }
  var LAPTOP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"></rect><path d="M2 19h20"></path></svg>';
  var PHONE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2"></rect><path d="M11 18h2"></path></svg>';

  var MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"></path></svg>';
  var SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';

  var isDark = function () { return root.getAttribute("data-theme") === "dark"; };

  function paint(btn) {
    btn.innerHTML = isDark() ? SUN : MOON;
    var label = isDark() ? "Switch to light theme" : "Switch to dark theme";
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }

  function apply(next, btn) {
    if (next === "dark") root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
    try { localStorage.setItem(KEY, next); } catch (e) {}
    paint(btn);
  }

  function toggle(btn) {
    var next = isDark() ? "light" : "dark";
    var r = btn.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var R = Math.ceil(Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)));
    btn.classList.remove("spin"); void btn.offsetWidth; btn.classList.add("spin");
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { apply(next, btn); return; }

    // Modern browsers: the new look is revealed inside a growing circle.
    if (document.startViewTransition) {
      var t = document.startViewTransition(function () { apply(next, btn); });
      t.ready.then(function () {
        root.animate(
          { clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + R + "px at " + x + "px " + y + "px)"] },
          { duration: 750, easing: "cubic-bezier(.45,0,.25,1)", pseudoElement: "::view-transition-new(root)" }
        );
      }).catch(function () {});
      return;
    }

    // Older browsers: a round wipe in the new background colour, then the switch.
    var c = document.createElement("div");
    c.className = "theme-wipe";
    c.style.left = (x - R) + "px"; c.style.top = (y - R) + "px";
    c.style.width = c.style.height = (2 * R) + "px";
    document.body.appendChild(c);
    c.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 600, easing: "cubic-bezier(.45,0,.25,1)" }).onfinish = function () {
      apply(next, btn);
      c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250 }).onfinish = function () { c.remove(); };
    };
  }

  function place() {
    if (document.getElementById("theme-btn")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "theme-btn";
    btn.className = "theme-btn";
    paint(btn);
    btn.addEventListener("click", function () { toggle(btn); });
    document.body.appendChild(btn);
    if (smallDevice) {
      var vb = document.createElement("button");
      vb.type = "button";
      vb.id = "view-btn";
      vb.className = "view-btn";
      vb.innerHTML = laptopView ? PHONE + "<span>Mobile view</span>" : LAPTOP + "<span>Laptop view</span>";
      vb.setAttribute("aria-label", laptopView ? "Switch to mobile view" : "Switch to laptop view");
      vb.addEventListener("click", function () {
        try { localStorage.setItem(VKEY, laptopView ? "mobile" : "laptop"); } catch (e) {}
        location.reload();
      });
      document.body.appendChild(vb);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place); else place();

  // Phones: when you tap a search box, it moves to the top of the screen so the matching rows show
  // between the search box and the keyboard (instead of hiding behind the keyboard).
  // Laptop view: the phone must not zoom in on the search box (that pushed the table off to the side and you had to
  // swipe left / right). While a search box is in use the zoom is held at "whole page fits", then given back.
  var isSearch = function (t) { return t && t.tagName === "INPUT" && (t.type === "search" || (t.closest && t.closest(".search"))); };
  var vpMeta = function () { return document.querySelector('meta[name="viewport"]'); };
  var baseVp = (vpMeta() && vpMeta().getAttribute("content")) || "width=device-width, initial-scale=1.0";
  var holdZoom = function (on) {
    if (!laptopView) return;
    var m = vpMeta(); if (!m) return;
    m.setAttribute("content", "width=1280, initial-scale=" + fit + (on ? ", maximum-scale=" + fit : ""));
  };
  // After typing in any box (edit forms, prices, search...) the phone zooms back out to where it was:
  // for a moment the zoom is capped at the normal size, which makes the phone go back, then it is freed again
  // (so you can still pinch to zoom whenever you want).
  var isField = function (t) { return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") && t.type !== "checkbox" && t.type !== "radio" && t.type !== "button"; };
  var resetTimer = null;
  var zoomBack = function () {
    var m = vpMeta(); if (!m) return;
    var base = laptopView ? "width=1280, initial-scale=" + fit : baseVp;
    m.setAttribute("content", base + ", maximum-scale=" + (laptopView ? fit : 1));
    setTimeout(function () { if (!isField(document.activeElement)) m.setAttribute("content", base); }, 350);
  };
  if (touch) {
    document.addEventListener("touchstart", function (e) { if (laptopView && isSearch(e.target)) holdZoom(true); }, { capture: true, passive: true });
    document.addEventListener("focusin", function (e) {
      var inp = e.target;
      if (!isSearch(inp)) return;
      if (laptopView) holdZoom(true);
      else if (window.innerWidth > 1023) return;
      document.body.classList.add("kb-search");
      var box = inp.closest(".search") || inp;
      var go = function () {
        var r = box.getBoundingClientRect();
        var ov = box.closest(".overlay");
        if (ov) { ov.scrollTo({ top: ov.scrollTop + r.top - 12, behavior: "smooth" }); return; }
        var bar = document.querySelector(".mbar");
        var off = (bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().height : 0) + (laptopView ? 64 : 10);   // laptop view: stay under the two round buttons
        window.scrollTo({ top: window.scrollY + r.top - off, left: laptopView ? 0 : window.scrollX, behavior: "smooth" });
      };
      setTimeout(go, 60); setTimeout(go, 450);   // again once the keyboard has opened
      inp.addEventListener("input", function once() { go(); inp.removeEventListener("input", once); });
    });
    document.addEventListener("focusout", function (e) {
      if (isSearch(e.target)) {
        setTimeout(function () { if (!isSearch(document.activeElement)) document.body.classList.remove("kb-search"); }, 300);
      }
      if (isField(e.target)) {
        // moving straight to the next box keeps the zoom; only when you are done (no box in use) it zooms out
        clearTimeout(resetTimer);
        resetTimer = setTimeout(function () { if (!isField(document.activeElement)) zoomBack(); }, 250);
      }
    });
  }
})();
