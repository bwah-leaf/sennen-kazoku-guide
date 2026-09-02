(() => {
  "use strict";

  const colors = {
    "1A 03 0A": "#292721",
    "1A 03 0B": "#d12f55",
    "1A 03 0C": "#1769c2",
    "1A 03 0D": "#b56b00"
  };
  const tokenPattern = /(\{\{HEX:([^}]+)\}\})/g;
  const events = new Map();
  let scriptsLoaded = false;
  let scriptsPromise = null;
  let pages = [];

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function normalizeCode(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  }

  function textMarkup(text, color) {
    const value = escapeHtml(text).replaceAll("\r\n", "<br>").replaceAll("\n", "<br>");
    return color === colors["1A 03 0A"] ? value : `<span style="color:${color}">${value}</span>`;
  }

  function translatedPages(script) {
    const result = [];
    let page = [];
    let color = colors["1A 03 0A"];
    let cursor = 0;
    let match;
    const pushPage = () => {
      const html = page.join("").replace(/^(?:<br>)+|(?:<br>)+$/g, "");
      if (html) result.push(html);
      page = [];
    };

    tokenPattern.lastIndex = 0;
    while ((match = tokenPattern.exec(script))) {
      if (match.index > cursor) page.push(textMarkup(script.slice(cursor, match.index), color));
      const code = normalizeCode(match[2]);
      if (colors[code]) {
        color = colors[code];
      } else if (code === "1A 01") {
        page.push("<br>");
      } else if (code === "1A 02" || code === "1A 09") {
        pushPage();
      } else if (/^1A 06 [0-9A-F]{2} [0-9A-F]{2}$/.test(code)) {
        const id = code.split(" ").slice(2).join("");
        page.push(`<span class="event-script-variable">&lt;캐릭터 이름 0x${id}&gt;</span>`);
      } else if (/^1A 05 [0-9A-F]{2} [0-9A-F]{2}$/.test(code)) {
        const id = code.split(" ").slice(2).join("");
        page.push(`<span class="event-script-variable">&lt;동적 값 0x${id}&gt;</span>`);
      }
      cursor = tokenPattern.lastIndex;
    }
    if (cursor < script.length) page.push(textMarkup(script.slice(cursor), color));
    pushPage();
    return result.length ? result : ["<p class=\"event-script-empty\">표시할 번역 본문이 없습니다.</p>"];
  }

  const dialog = document.createElement("dialog");
  dialog.className = "event-script-dialog";
  dialog.setAttribute("aria-labelledby", "event-script-title");
  dialog.innerHTML = `
    <div class="event-script-shell">
      <header>
        <div><span id="event-script-id" class="outcome-id"></span><h2 id="event-script-title"></h2></div>
        <button class="event-script-close" type="button" aria-label="닫기">×</button>
      </header>
      <div id="event-script-page" class="event-script-page"></div>
      <footer class="event-script-meta"><span id="event-script-count" aria-live="polite"></span></footer>
    </div>`;
  document.body.append(dialog);

  const title = dialog.querySelector("#event-script-title");
  const id = dialog.querySelector("#event-script-id");
  const page = dialog.querySelector("#event-script-page");
  const count = dialog.querySelector("#event-script-count");

  function renderPages() {
    page.innerHTML = pages.map((html, index) => `
      ${index ? '<div class="event-script-page-divider" aria-hidden="true"><span>다음 페이지</span></div>' : ""}
      <section class="event-script-page-section" aria-label="${index + 1}페이지">${html}</section>
    `).join("");
    count.textContent = pages.length > 1 ? `총 ${pages.length}페이지 분량` : "1페이지 분량";
    page.scrollTop = 0;
  }

  async function loadScripts() {
    if (scriptsLoaded) return;
    if (!scriptsPromise) {
      const url = window.EVENT_SCRIPTS_URL || "assets/data/event-scripts-ko.json";
      scriptsPromise = fetch(url).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }).then((data) => {
        (data.events || []).forEach((event) => {
          const current = events.get(String(event.id)) || {};
          events.set(String(event.id), { ...current, ...event });
        });
        scriptsLoaded = true;
      });
    }
    return scriptsPromise;
  }

  async function open(eventId) {
    let event = events.get(String(eventId));
    if (!event) return;
    title.textContent = event.title_ko || "번역 이벤트";
    id.textContent = event.id || eventId;
    pages = ["<p class=\"event-script-empty\">번역 본문을 불러오는 중…</p>"];
    renderPages();
    if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    try {
      await loadScripts();
      event = events.get(String(eventId)) || event;
      pages = translatedPages(String(event.script_ko || ""));
    } catch (error) {
      pages = [`<p class="event-script-empty">번역 본문을 읽지 못했습니다: ${escapeHtml(error.message)}</p>`];
    }
    renderPages();
  }

  dialog.querySelector(".event-script-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

  window.EventScriptReader = {
    setEvents(values) {
      events.clear();
      (values || []).forEach((event) => events.set(String(event.id), event));
    },
    open
  };
})();
