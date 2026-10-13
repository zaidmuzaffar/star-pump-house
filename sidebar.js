// Sidebar.
// Computer (wide screen): collapsible 248px <-> 76px (icons only); the choice is remembered between pages.
// Phone / tablet (narrow screen): the sidebar is hidden; a top bar with a ☰ menu button slides it in from the left.
(function () {
  const shell = document.querySelector(".shell");
  const toggle = document.getElementById("sidebar-toggle");
  const side = document.querySelector(".side");
  if (!shell || !side) return;

  // ----- wide screen: collapse / expand -----
  let saved = null;
  try { saved = localStorage.getItem("sph-sidebar"); } catch (e) {}
  function apply(collapsed) {
    shell.classList.toggle("collapsed", collapsed);
    if (toggle) toggle.setAttribute("aria-label", collapsed ? "Expand menu" : "Collapse menu");
  }
  apply(saved === "collapsed");
  if (toggle) toggle.addEventListener("click", () => {
    if (isNarrow()) { closeMenu(); return; }
    const collapsed = !shell.classList.contains("collapsed");
    apply(collapsed);
    try { localStorage.setItem("sph-sidebar", collapsed ? "collapsed" : "open"); } catch (e) {}
  });

  // ----- narrow screen: drawer -----
  const mq = window.matchMedia("(max-width: 1023px)");
  const isNarrow = () => mq.matches;
  const main = document.querySelector(".main");
  const active = side.querySelector(".nv.on .lbl");

  // shop name saved by the website after login (Profile → Shop name)
  let shopName = "";
  try { shopName = sessionStorage.getItem("sph-shop") || ""; } catch (e) {}
  if (shopName) side.querySelectorAll(".brand-name").forEach((n) => { n.textContent = shopName; });
  const bar = document.createElement("div");
  bar.className = "mbar";
  bar.innerHTML = `<button type="button" class="menu-btn" aria-label="Open menu" aria-expanded="false">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg></button>
    <span class="mbar-brand"><span class="mbar-mark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"></path></svg></span>
      <span class="mbar-text"><b>${(shopName || "Star Pump House").replace(/[<>&]/g, "")}</b>${active ? `<small>${active.textContent}</small>` : ""}</span></span>`;
  if (main) main.insertBefore(bar, main.firstChild);
  const menuBtn = bar.querySelector(".menu-btn");

  const scrim = document.createElement("div");
  scrim.className = "side-scrim";
  document.body.appendChild(scrim);

  function openMenu() { shell.classList.add("menu-open"); menuBtn.setAttribute("aria-expanded", "true"); document.body.classList.add("no-scroll"); }
  function closeMenu() { shell.classList.remove("menu-open"); menuBtn.setAttribute("aria-expanded", "false"); document.body.classList.remove("no-scroll"); }
  menuBtn.addEventListener("click", () => (shell.classList.contains("menu-open") ? closeMenu() : openMenu()));
  scrim.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && shell.classList.contains("menu-open")) closeMenu(); });
  side.addEventListener("click", (e) => { if (isNarrow() && e.target.closest("a.nv, [data-signout]")) closeMenu(); });
  mq.addEventListener ? mq.addEventListener("change", () => { if (!isNarrow()) closeMenu(); }) : mq.addListener(() => { if (!isNarrow()) closeMenu(); });
})();
