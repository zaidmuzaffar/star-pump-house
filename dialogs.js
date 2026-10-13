// Styled confirm / alert popups (replace the plain browser ones).
let root = null, current = null;

const ICONS = {
  danger: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M6 7l1 13h10l1-13"></path></svg>',
  info: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8v.5"></path></svg>',
  ok: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l3 3 5-6"></path></svg>'
};

function ensure() {
  if (root) return root;
  root = document.createElement("div");
  root.className = "overlay msg";
  root.innerHTML = `<div class="dlg sm" role="alertdialog" aria-modal="true">
    <div class="dlg-body msg-body"><span class="msg-ico"></span><div class="stack"><h2 class="dlg-title msg-title"></h2><p class="msg-text"></p></div></div>
    <div class="dlg-foot"><button type="button" class="btn sec msg-cancel"></button><button type="button" class="btn pri msg-ok"></button></div>
  </div>`;
  document.body.appendChild(root);
  return root;
}

function open({ title, message, confirmLabel, cancelLabel, danger, icon, hideCancel }) {
  return new Promise((resolve) => {
    if (current) current(false);
    const r = ensure();
    const ico = r.querySelector(".msg-ico"), ok = r.querySelector(".msg-ok"), cancel = r.querySelector(".msg-cancel");
    r.querySelector(".msg-title").textContent = title;
    r.querySelector(".msg-text").textContent = message;
    ico.className = "msg-ico" + (danger ? " danger" : "");
    ico.innerHTML = ICONS[icon || (danger ? "danger" : "info")];
    ok.textContent = confirmLabel;
    ok.className = "btn msg-ok " + (danger ? "red" : "pri");
    cancel.textContent = cancelLabel;
    cancel.hidden = !!hideCancel;
    r.classList.add("active");
    (danger ? cancel : ok).focus();

    const done = (value) => {
      r.classList.remove("active");
      ok.onclick = cancel.onclick = r.onclick = null;
      document.removeEventListener("keydown", onKey, true);
      current = null;
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); done(false); }
    };
    current = done;
    document.addEventListener("keydown", onKey, true);
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    r.onclick = (e) => { if (e.target === r) done(false); };
  });
}

export function confirmDialog({ title = "Are you sure?", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
  return open({ title, message, confirmLabel, cancelLabel, danger });
}

// A plain notice with one "OK" button (info icon).
export function infoDialog({ title = "", message = "", okLabel = "OK" } = {}) {
  return open({ title, message, confirmLabel: okLabel, cancelLabel: "", icon: "info", hideCancel: true });
}

export function showMessage(message, title) {
  const text = String(message);
  const bad = /error|could not|incorrect|do not match|only \d|must|please/i.test(text);
  return open({ title: title || (/error|could not/i.test(text) ? "Something went wrong" : "Please check"), message: text, confirmLabel: "OK", cancelLabel: "", icon: bad ? "info" : "ok", hideCancel: true });
}

// Every alert() on the site now uses the styled popup.
window.alert = (message) => { showMessage(message); };
