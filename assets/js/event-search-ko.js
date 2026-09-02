(() => {
  "use strict";

  const labels = { unknown: "미확인", inferred_from_text: "문맥 추정", static_confirmed: "정적 확인", static_structure: "구조 확인", runtime_confirmed: "실기 확인", conflicting: "결과 충돌" };
  const search = document.querySelector("#event-search");
  const category = document.querySelector("#event-category");
  const status = document.querySelector("#event-status");
  const effect = document.querySelector("#event-effect");
  const conditionEvidence = document.querySelector("#condition-evidence");
  const summary = document.querySelector("#event-summary");
  const list = document.querySelector("#event-list");
  let events = [];

  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function addOptions(select, values, labeler = (value) => value) {
    [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b, "ko")).forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = labeler(value);
      select.append(option);
    });
  }

  function renderGuideCondition(guide) {
    if (!guide) return "";
    const details = (guide.details || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    return `<details class="guide-condition">
      <summary>공략용 발생 조건 <span class="event-id">${escapeHtml(guide.certainty || "정리됨")}</span></summary>
      <p>${escapeHtml(guide.summary)}</p>
      ${details ? `<ul>${details}</ul>` : ""}
      ${guide.caution ? `<p class="event-condition-caution"><b>주의:</b> ${escapeHtml(guide.caution)}</p>` : ""}
    </details>`;
  }

  function renderRoutes(condition, hasGuide) {
    if (!condition?.mapped) return '<p class="event-condition-caution">발생 계층이 연결되지 않았습니다.</p>';
    const groups = (condition.groups || []).map((item) => `<span>${escapeHtml(item.name)}</span>`).join("");
    const routes = (condition.route_groups || []).map((route, index) => {
      const upper = (route.occurrence_conditions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      const readableVariants = (route.variant_conditions || []).filter((item) => !String(item).includes("함수 0x"));
      const machineVariants = (route.variant_conditions || []).filter((item) => String(item).includes("함수 0x"));
      const variants = readableVariants.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      const machine = machineVariants.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("");
      const functions = [...(route.condition_functions || []), ...(route.variant_predicates || [])].map((item) => `<code>${escapeHtml(item)}</code>`).join(" · ");
      return `<details class="event-condition-route">
        <summary>${escapeHtml(route.group_name || "발생 그룹")} · ${escapeHtml(route.mode_label || "후보 경로")} · ${Number(route.route_count || 1).toLocaleString("ko-KR")}개</summary>
        ${upper ? `<h4>상위 조건</h4><ul>${upper}</ul>` : ""}
        ${variants ? `<h4>결과 조건</h4><ul>${variants}</ul>` : ""}
        ${machine ? `<details><summary>해석 전 기계 분석식</summary><p class="event-condition-caution">공략 조건으로 번역되기 전의 내부 함수 호출입니다.</p><ul>${machine}</ul></details>` : ""}
        ${functions ? `<details><summary>분석 주소</summary>${functions}</details>` : ""}
      </details>`;
    }).join("");
    return `<div class="event-badges condition-groups">${groups}</div><p><b>대상:</b> ${escapeHtml(condition.family_type || "미정")}</p>${routes}`;
  }

  function render() {
    const needle = search.value.trim().toLocaleLowerCase("ko");
    const selectedCategory = category.value;
    const selectedStatus = status.value;
    const selectedEvidence = conditionEvidence.value;
    const filtered = events.filter((event) => {
      if (selectedCategory && event.category !== selectedCategory) return false;
      if (selectedStatus && event.trigger_status !== selectedStatus) return false;
      if (effect.value === "none" && (event.effects || []).length) return false;
      if (effect.value && effect.value !== "none" && !(event.effects || []).some((item) => String(item).includes(effect.value))) return false;
      if (selectedEvidence === "secondary_outcome" && !event.occurrence_condition?.secondary_outcome) return false;
      if (selectedEvidence === "range_confirmed" && !(event.static_condition?.range_checks || []).length) return false;
      if (selectedEvidence === "selector_found" && !event.static_condition?.has_event_specific_selector) return false;
      if (!needle) return true;
      return [event.id, event.title_ko, event.title_uid, event.script_uid, event.trigger_summary, event.category, ...(event.effects || []), ...(event.occurrence_condition?.occurrence_conditions || []), ...(event.occurrence_condition?.variant_conditions || [])].join(" ").toLocaleLowerCase("ko").includes(needle);
    });
    summary.textContent = `전체 ${events.length.toLocaleString("ko-KR")}개 중 ${filtered.length.toLocaleString("ko-KR")}개`;
    const shown = filtered.slice(0, 200);
    list.innerHTML = shown.map((event) => `<article class="event-card" id="${escapeHtml(event.id)}">
      <div class="event-card-head"><h2>${escapeHtml(event.title_ko)}</h2><span class="event-id">${escapeHtml(event.id)}</span></div>
      <p class="event-badges"><span>${escapeHtml(event.category)}</span><span>${escapeHtml(labels[event.trigger_status] || event.trigger_status)}</span>${event.title_basis === "fallback_id" ? "<span>제목 미번역</span>" : ""}</p>
      <p>${escapeHtml(event.trigger_summary)}</p>
      <button class="event-reader-button" type="button" data-event-reader-id="${escapeHtml(event.id)}">번역 이벤트 읽기</button>
      ${renderGuideCondition(event.guide_condition)}
      <details class="event-static-condition"><summary>${event.guide_condition ? "기술 분석 근거" : "발생 조건"}</summary>${renderRoutes(event.occurrence_condition, Boolean(event.guide_condition))}</details>
      ${(event.requirements || []).length ? `<h3>필요 조건</h3><ul>${event.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      <h3>이벤트 후 변화</h3>
      ${(event.effects || []).length
        ? `<ul>${event.effects.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : '<p class="event-condition-caution">공통 수치 변경 루틴에서 확인된 직접 변화 없음</p>'}
      ${event.strategy ? `<p><b>공략:</b> ${escapeHtml(event.strategy)}</p>` : ""}
      <details><summary>분석 식별자</summary><code>${escapeHtml(event.title_uid)}</code> · <code>${escapeHtml(event.script_uid)}</code>${event.effect_analysis?.post_function ? ` · 결과 함수 <code>${escapeHtml(event.effect_analysis.post_function)}</code>` : ""}</details>
    </article>`).join("");
    if (filtered.length > shown.length) list.insertAdjacentHTML("beforeend", `<p class="event-limit">처음 ${shown.length}개만 표시합니다. 검색어나 필터를 더 입력하세요.</p>`);
  }

  fetch(window.EVENT_DATA_URL).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }).then((data) => {
    events = data.events || [];
    window.EventScriptReader?.setEvents(events);
    const params = new URLSearchParams(window.location.search);
    search.value = params.get("q") || params.get("id") || "";
    addOptions(category, events.map((event) => event.category));
    addOptions(status, events.map((event) => event.trigger_status), (value) => labels[value] || value);
    [search, category, status, effect, conditionEvidence].forEach((control) => control.addEventListener("input", render));
    render();
  }).catch((error) => { summary.textContent = `한국어 이벤트 데이터를 읽지 못했습니다: ${error.message}`; });

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-event-reader-id]");
    if (button) window.EventScriptReader?.open(button.dataset.eventReaderId);
  });
})();
