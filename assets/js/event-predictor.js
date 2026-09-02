(() => {
  "use strict";

  const stateSelect = document.querySelector("#planned-event");
  const stateFilter = document.querySelector("#event-filter");
  const stateLinks = document.querySelector("#event-links");
  const fieldsHost = document.querySelector("#dynamic-fields");
  const arrowsHost = document.querySelector("#arrow-choice");
  const itemSelect = document.querySelector("#prediction-item");
  const itemNote = document.querySelector("#item-effect-note");
  const summaryHost = document.querySelector("#prediction-summary");
  const selectionFlowHost = document.querySelector("#selection-flow");
  const outcomesHost = document.querySelector("#branch-results");
  const evidenceHost = document.querySelector("#evidence-content");
  const caption = document.querySelector("#prediction-caption");
  const calculateButton = document.querySelector("#calculate");

  let definitions = {};
  let plannedStates = [];
  let itemData = { items: [], mood_levels: [] };
  const numberFormat = new Intl.NumberFormat("ko-KR");
  const attributeFields = { 0: "attribute_0", 1: "attribute_1", 2: "attribute_2_arrow", 3: "attribute_3", 5: "attribute_5", 6: "attribute_6" };
  const statusLabels = {
    direct_condition: "결과 조건에 직접 영향",
    relationship_route: "관계 경로에 간접 영향",
    dream_route: "꿈·진로 경로에 간접 영향",
    candidate_weight: "결과 후보 가중치에 간접 영향",
    current_interest_route: "예정 상태 진행도에 영향",
    no_confirmed_link: "결과 분기 직접 영향 미확인",
    none: "화살 사용 안 함"
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function currentState() {
    if (!stateSelect.options.length) return null;
    return plannedStates.find((state) => state.id === stateSelect.value) || plannedStates[0];
  }

  function selectedArrowKey() {
    return document.querySelector('input[name="arrow"]:checked')?.value || "none";
  }

  function selectedItem() {
    return itemData.items.find((item) => item.key === itemSelect?.value) || itemData.items[0] || {
      key: "none", label: "사용하지 않음", description: "현재 수치 유지", calculation: { operation: "none" }
    };
  }

  function updateItemNote() {
    const item = selectedItem();
    const operation = item.calculation?.operation;
    const suffix = operation === "unmodeled"
      ? ` 예측 수치에는 아직 직접 반영하지 않습니다: ${item.calculation.reason}`
      : operation === "none" ? "" : " 아이템 효과를 먼저 적용한 뒤 결과 확률을 계산합니다.";
    itemNote.textContent = `${item.description || ""}${suffix}`;
    itemNote.classList.toggle("is-unmodeled", operation === "unmodeled");
  }

  function renderItems() {
    const previous = itemSelect.value;
    itemSelect.innerHTML = itemData.items.map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`).join("");
    if ([...itemSelect.options].some((option) => option.value === previous)) itemSelect.value = previous;
    if (!itemSelect.value && itemSelect.options.length) itemSelect.selectedIndex = 0;
    updateItemNote();
  }

  function renderStateSelector() {
    const selected = stateSelect.value;
    const needle = stateFilter.value.trim().toLocaleLowerCase("ko");
    const filtered = needle
      ? plannedStates.filter((state) => `${state.title_ko} ${state.id} ${state.outcomes.map((item) => item.title_ko).join(" ")}`.toLocaleLowerCase("ko").includes(needle))
      : plannedStates;
    stateSelect.innerHTML = filtered.map((state) =>
      `<option value="${escapeHtml(state.id)}">${escapeHtml(state.title_ko)} · 결과 ${numberFormat.format(state.outcome_count)}개</option>`
    ).join("");
    if ([...stateSelect.options].some((option) => option.value === selected)) stateSelect.value = selected;
    if (!stateSelect.value && stateSelect.options.length) stateSelect.selectedIndex = 0;
    stateLinks.innerHTML = `<span>검색 결과 ${numberFormat.format(filtered.length)}개 / 전체 ${numberFormat.format(plannedStates.length)}개 예정 상태</span>`;
  }

  function comparisonsForState(state) {
    const seen = new Set();
    const result = [];
    state.outcomes.forEach((outcome) => {
      Object.values(outcome.arrow_analysis?.arrows || {}).forEach((analysis) => {
        (analysis.comparisons || []).forEach((item) => {
          const key = `${item.slot}:${item.attribute}:${item.operator}:${item.threshold}`;
          if (!seen.has(key)) { seen.add(key); result.push(item); }
        });
      });
    });
    return result;
  }

  function fieldKey(slot, attribute) {
    return `slot${slot}_attribute${attribute}`;
  }

  function personLabel(slot) {
    return Number(slot) === 0 ? "이벤트 발생 본인" : `관련 인물 슬롯 ${slot}`;
  }

  function fieldDefinition(attribute) {
    const key = attributeFields[attribute];
    return definitions.field_catalog?.[key] || { label: `속성 #${attribute}`, minimum: 0, maximum: 65535, default: 0 };
  }

  const abilityRanks = [
    { label: "F", minimum: 0, maximum: 799, representative: 400 },
    { label: "D", minimum: 800, maximum: 1599, representative: 1200 },
    { label: "C", minimum: 1600, maximum: 2399, representative: 2000 },
    { label: "B", minimum: 2400, maximum: 3199, representative: 2800 },
    { label: "A", minimum: 3200, maximum: 3999, representative: 3600 },
    { label: "S", minimum: 4000, maximum: 4799, representative: 4400 },
    { label: "SS", minimum: 4800, maximum: 5000, representative: 4900 }
  ];
  const moodLevels = [
    { label: "1단계", minimum: 0, maximum: 47, representative: 24 },
    { label: "2단계", minimum: 48, maximum: 95, representative: 72 },
    { label: "3단계", minimum: 96, maximum: 159, representative: 128 },
    { label: "4단계", minimum: 160, maximum: 207, representative: 184 },
    { label: "5단계", minimum: 208, maximum: 255, representative: 232 }
  ];

  function selectionDisplayOptions(item) {
    if (item.display_options?.length) return item.display_options;
    if ((item.metric_key === "slot0_intelligence" || item.label?.includes("지력")) && Number(item.maximum) === 5000) return abilityRanks;
    if (item.key === "global_0" || item.label === "가족 무드") return moodLevels;
    return [];
  }

  function selectionControl(item) {
    if (item.display_type === "skill_set") {
      const skills = item.relevant_skills || [];
      return `<fieldset class="field-label is-selection-field skill-field"><legend>${escapeHtml(item.label)}</legend><small>${escapeHtml(item.display_note || "결과 판정에 사용되는 보유 스킬")}</small><div class="skill-check-grid">${skills.map((skill) => `<label><input type="checkbox" data-selection-skill-key="${escapeHtml(item.key)}" data-skill-id="${skill.id}"><span>${escapeHtml(skill.name)}</span></label>`).join("")}</div></fieldset>`;
    }
    const options = selectionDisplayOptions(item);
    const defaultValue = Number(item.default ?? 0);
    const active = options.find((option) => defaultValue >= option.minimum && defaultValue <= option.maximum) || options[0];
    if (item.display_type === "enum") {
      return `<label class="field-label is-selection-field">${escapeHtml(item.label)}<small>${escapeHtml(item.display_note || "게임에서 확인한 항목을 선택합니다.")}</small><select class="wide-control" data-selection-key="${escapeHtml(item.key)}">${options.map((option) => `<option value="${option.representative}"${option === active ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>`;
    }
    const detail = options.length
      ? `<select class="wide-control" data-display-for="${escapeHtml(item.key)}">${options.map((option) => `<option value="${option.representative}"${option === active ? " selected" : ""}>${escapeHtml(option.label)} · 내부값 ${numberFormat.format(option.minimum)}~${numberFormat.format(option.maximum)}</option>`).join("")}</select>`
      : "";
    const note = item.display_note || (options === abilityRanks
      ? "게임의 F~SS 등급과 실제 이벤트 판정용 내부값"
      : options === moodLevels ? "게임의 1~5단계와 실제 이벤트 판정용 내부값" : "결과 선택에 직접 사용되는 수치");
    return `<label class="field-label is-selection-field">${escapeHtml(item.label)}<small>${escapeHtml(note)}</small>${detail}<input class="wide-control" data-selection-key="${escapeHtml(item.key)}" type="number" min="${item.minimum ?? 0}" max="${item.maximum ?? 65535}" value="${defaultValue}"${options.length ? ` aria-label="${escapeHtml(item.label)} 내부값"` : ""}></label>`;
  }

  function syncSelectionDisplay(control) {
    const key = control.dataset.selectionKey;
    const display = fieldsHost.querySelector(`select[data-display-for="${CSS.escape(key)}"]`);
    if (!display) return;
    const item = [...currentState().outcomes.flatMap((outcome) => outcome.selection_analysis?.inputs || [])].find((input) => input.key === key);
    const options = item ? selectionDisplayOptions(item) : key === "slot0_intelligence" ? abilityRanks : key === "global_0" ? moodLevels : [];
    const value = Number(control.value);
    const active = options.find((option) => value >= option.minimum && value <= option.maximum);
    if (active) display.value = String(active.representative);
  }

  function renderFields(state) {
    const comparisons = comparisonsForState(state);
    const fields = new Map();
    comparisons.forEach((item) => fields.set(fieldKey(item.slot, item.attribute), { slot: item.slot, attribute: item.attribute }));
    const comparedSlots = new Set([...fields.values()].map((item) => Number(item.slot)));
    comparedSlots.add(0);
    comparedSlots.forEach((slot) => {
      if (!fields.has(fieldKey(slot, 5))) fields.set(fieldKey(slot, 5), { slot, attribute: 5, interest: true });
    });
    const slots = [...comparedSlots].sort((a, b) => a - b);
    const targetOptions = slots.map((slot) => `<option value="${slot}">${escapeHtml(personLabel(slot))}</option>`).join("");
    const controls = [...fields.values()].map((item) => {
      const definition = fieldDefinition(item.attribute);
      const label = item.interest ? "현재 관심 몰입도" : definition.label;
      const note = item.interest ? "힘내라 +95 · 진정해 0 · 255에서 실행 단계" : `${personLabel(item.slot)} · 속성 #${item.attribute}`;
      return `<label class="field-label">${escapeHtml(label)}<small>${escapeHtml(note)}</small><input class="wide-control" data-slot="${item.slot}" data-attribute="${item.attribute}" type="number" min="${definition.minimum ?? 0}" max="${definition.maximum ?? 65535}" value="${definition.default ?? 0}"></label>`;
    }).join("");
    const selectionFields = new Map();
    state.outcomes.forEach((outcome) => {
      const item = outcome.selection_analysis;
      (item?.inputs || []).forEach((input) => {
        if (!selectionFields.has(input.key)) {
          selectionFields.set(input.key, structuredClone(input));
        } else if (input.display_type === "skill_set") {
          const existing = selectionFields.get(input.key);
          const merged = new Map((existing.relevant_skills || []).map((skill) => [Number(skill.id), skill]));
          (input.relevant_skills || []).forEach((skill) => merged.set(Number(skill.id), skill));
          existing.relevant_skills = [...merged.values()].sort((left, right) => Number(left.id) - Number(right.id));
        }
      });
      if (item?.metric_key && !selectionFields.has(item.metric_key)) selectionFields.set(item.metric_key, {
        key: item.metric_key, label: item.metric_label, minimum: item.minimum, maximum: item.maximum, default: item.default
      });
    });
    const selectionControls = [...selectionFields.values()].map(selectionControl).join("");
    fieldsHost.innerHTML = `<label class="field-label">화살 적용 대상<small>화살을 사용할 인물</small><select id="arrow-target-slot" class="wide-control">${targetOptions}</select></label>${selectionControls}${controls}`;
    fieldsHost.querySelectorAll("select[data-display-for]").forEach((control) => control.addEventListener("input", () => {
      const input = fieldsHost.querySelector(`input[data-selection-key="${CSS.escape(control.dataset.displayFor)}"]`);
      if (input) input.value = control.value;
      calculate();
    }));
    fieldsHost.querySelectorAll("[data-selection-key]").forEach((control) => control.addEventListener("input", () => {
      syncSelectionDisplay(control);
      calculate();
    }));
    fieldsHost.querySelectorAll("input[data-selection-skill-key]").forEach((control) => control.addEventListener("change", calculate));
    fieldsHost.querySelectorAll("input[data-slot], #arrow-target-slot").forEach((control) => control.addEventListener("input", calculate));
  }

  function directArrowKeys(state) {
    const result = new Set();
    state.outcomes.forEach((outcome) => Object.entries(outcome.arrow_analysis?.arrows || {}).forEach(([key, value]) => {
      if (value.status === "direct_condition") result.add(key);
    }));
    return result;
  }

  function renderArrows(state) {
    const previous = selectedArrowKey();
    const direct = directArrowKeys(state);
    const entries = Object.entries(definitions.arrows || {}).sort(([left], [right]) => {
      const rank = (key) => key === "none" ? -1 : direct.has(key) ? 0 : ["encourage", "calm"].includes(key) ? 1 : 2;
      return rank(left) - rank(right);
    });
    arrowsHost.querySelectorAll("label").forEach((node) => node.remove());
    entries.forEach(([key, arrow]) => {
      const label = document.createElement("label");
      if (direct.has(key)) label.classList.add("is-direct");
      label.innerHTML = `<input type="radio" name="arrow" value="${escapeHtml(key)}"${key === previous ? " checked" : ""}><span>${escapeHtml(arrow.label)}${direct.has(key) ? "<small>결과 직접 영향</small>" : ""}</span>`;
      label.querySelector("input").addEventListener("change", calculate);
      arrowsHost.append(label);
    });
    if (!arrowsHost.querySelector('input[name="arrow"]:checked')) arrowsHost.querySelector('input[value="none"]').checked = true;
  }

  function readValues() {
    const values = {};
    fieldsHost.querySelectorAll("input[data-slot]").forEach((control) => {
      const slot = Number(control.dataset.slot);
      const attribute = Number(control.dataset.attribute);
      const definition = fieldDefinition(attribute);
      const raw = Number(control.value);
      values[fieldKey(slot, attribute)] = Math.min(definition.maximum ?? raw, Math.max(definition.minimum ?? raw, Number.isFinite(raw) ? raw : 0));
    });
    fieldsHost.querySelectorAll("[data-selection-key]").forEach((control) => {
      const raw = Number(control.value);
      const minimum = Number(control.min || 0);
      const maximum = Number(control.max || 65535);
      values[control.dataset.selectionKey] = Math.min(maximum, Math.max(minimum, Number.isFinite(raw) ? raw : 0));
    });
    fieldsHost.querySelectorAll("input[data-selection-skill-key]").forEach((control) => {
      const key = control.dataset.selectionSkillKey;
      if (!Array.isArray(values[key])) values[key] = [];
      if (control.checked) values[key].push(Number(control.dataset.skillId));
    });
    return values;
  }

  function applyOperation(value, effect) {
    if (!effect) return value;
    if (effect.operation === "set") return effect.value;
    if (effect.operation === "add_saturating") return Math.min(effect.maximum, Number(value) + Number(effect.value));
    return value;
  }

  function adjustedValues(values, arrowKey, targetSlot) {
    const result = { ...values };
    const arrow = definitions.arrows[arrowKey] || definitions.arrows.none;
    Object.entries(attributeFields).forEach(([attributeText, definitionKey]) => {
      const key = fieldKey(targetSlot, Number(attributeText));
      if (key in result) result[key] = applyOperation(result[key], arrow.effects?.[definitionKey]);
    });
    return result;
  }

  function applyItemToValues(values, item, targetSlot) {
    const result = { ...values };
    const effect = item.calculation || { operation: "none" };
    if (effect.operation === "ability_rank_up") {
      const attribute = Number(effect.attribute);
      const keys = new Set([
        fieldKey(targetSlot, attribute),
        `person_s${targetSlot}_a${attribute}`,
        `slot${targetSlot}_attribute${attribute}`,
      ]);
      if (targetSlot === 0) {
        keys.add(`person_s15_a${attribute}`);
        if (attribute === 0) keys.add("slot0_intelligence");
      }
      keys.forEach((key) => {
        if (key in result) result[key] = Math.min(Number(effect.maximum || 5000), Number(result[key]) + Number(effect.amount || 800));
      });
    } else if (effect.operation === "mood_stage_up" && effect.key in result) {
      const levels = itemData.mood_levels || [];
      const value = Number(result[effect.key]);
      const index = levels.findIndex(([, minimum, maximum]) => value >= minimum && value <= maximum);
      if (index >= 0 && index + 1 < levels.length) result[effect.key] = Number(levels[index + 1][3]);
    }
    return result;
  }

  function itemChangeLabel(item, before, after, targetSlot) {
    const effect = item.calculation || {};
    if (effect.operation === "ability_rank_up") {
      const attribute = Number(effect.attribute);
      const candidateKeys = [
        targetSlot === 0 && attribute === 0 ? "slot0_intelligence" : "",
        `person_s${targetSlot}_a${attribute}`,
        fieldKey(targetSlot, attribute),
        targetSlot === 0 ? `person_s15_a${attribute}` : "",
      ].filter(Boolean);
      const key = candidateKeys.find((candidate) => candidate in before);
      if (!key) return `${item.label}: 이 예정 상태의 확인된 판정식에는 해당 능력치가 없어 확률은 변하지 않습니다.`;
      return `${item.label}: ${["지력", "체력", "매력", "운"][attribute]} ${gameValueLabel(key, before[key])} → ${gameValueLabel(key, after[key])}`;
    }
    if (effect.operation === "mood_stage_up") {
      if (!(effect.key in before)) return `${item.label}: 이 예정 상태의 확인된 판정식에는 가족 무드가 없어 확률은 변하지 않습니다.`;
      return `${item.label}: 가족 무드 ${gameValueLabel(effect.key, before[effect.key])} → ${gameValueLabel(effect.key, after[effect.key])}`;
    }
    if (effect.operation === "unmodeled") return `${item.label}: 효과는 확인됐지만 현재 예측 입력으로 수치화할 수 없습니다.`;
    return "아이템을 사용하지 않아 현재 수치를 유지합니다.";
  }

  function comparisonPass(value, operator, threshold) {
    if (operator === "<=") return value <= threshold;
    if (operator === ">=") return value >= threshold;
    if (operator === "<") return value < threshold;
    if (operator === ">") return value > threshold;
    if (operator === "==") return value === threshold;
    if (operator === "!=") return value !== threshold;
    return null;
  }

  function gameValueLabel(key, value) {
    const input = currentState()?.outcomes.flatMap((outcome) => outcome.selection_analysis?.inputs || []).find((item) => item.key === key);
    if (input?.display_type === "enum") {
      const option = selectionDisplayOptions(input).find((entry) => Number(entry.representative) === Number(value));
      if (option) return option.label;
    }
    const groups = key === "global_0" ? moodLevels : (key === "slot0_intelligence" || /person_s\d+_a[0-3]$/.test(key)) ? abilityRanks : null;
    const item = groups?.find((entry) => value >= entry.minimum && value <= entry.maximum);
    return item ? `${item.label}（내부값 ${numberFormat.format(value)}）` : numberFormat.format(value);
  }

  function isAbilityKey(key) {
    return key === "slot0_intelligence" || /person_s\d+_a[0-3]$/.test(key);
  }

  function abilityValueLabel(key, value) {
    if (!isAbilityKey(key)) return gameValueLabel(key, value);
    return abilityRanks.find((entry) => value >= entry.minimum && value <= entry.maximum)?.label || numberFormat.format(value);
  }

  function readableComparison(item) {
    if (!isAbilityKey(item.key)) return item.condition;
    const threshold = Number(item.threshold);
    const rankIndex = abilityRanks.findIndex((entry) => threshold >= entry.minimum && threshold <= entry.maximum);
    if (rankIndex < 0) return item.condition;
    const rank = abilityRanks[rankIndex];
    const prefix = String(item.condition || "").replace(/\s*(?:<=|>=|==|!=|<|>)\s*\d+\s*$/, "");
    let condition;
    if (item.operator === ">=" && threshold === rank.minimum) condition = `${rank.label} 이상`;
    else if (item.operator === ">" && threshold === rank.maximum && abilityRanks[rankIndex + 1]) condition = `${abilityRanks[rankIndex + 1].label} 이상`;
    else if (item.operator === "<=" && threshold === rank.maximum) condition = `${rank.label} 이하`;
    else if (item.operator === "<" && threshold === rank.minimum && abilityRanks[rankIndex - 1]) condition = `${abilityRanks[rankIndex - 1].label} 이하`;
    else if (item.operator === ">=") condition = `${rank.label} 등급 안의 세부 기준 이상`;
    else if (item.operator === ">") condition = `${rank.label} 등급 안의 세부 기준 초과`;
    else if (item.operator === "<=") condition = `${rank.label} 등급 안의 세부 기준 이하`;
    else if (item.operator === "<") condition = `${rank.label} 등급 안의 세부 기준 미만`;
    else if (item.operator === "==") condition = `${rank.label} 등급 안의 특정 기준과 일치`;
    else condition = `${rank.label} 등급 안의 특정 기준이 아님`;
    return `${prefix} ${condition}`;
  }

  function analysisFor(outcome, arrowKey) {
    if (arrowKey === "none") return { status: "none", direction: "화살을 사용하지 않아 현재 조건을 유지합니다.", comparisons: [] };
    return outcome.arrow_analysis?.arrows?.[arrowKey] || { status: "no_confirmed_link", direction: "이 결과 분기와 직접 연결된 판정은 확인되지 않았습니다.", comparisons: [] };
  }

  function selectionCheckPass(item, values) {
    if (item.skill_id !== undefined) {
      const held = (values[item.key] || []).includes(Number(item.skill_id));
      return item.operator === "not_contains" ? !held : held;
    }
    return comparisonPass(values[item.key] ?? 0, item.operator, item.threshold);
  }

  function evaluateProbabilityTree(node, values) {
    if (!node) return { probability: 1, conditional: false, unknownCount: 0, pureUnknown: false };
    const kind = node.type;
    if (kind === "constant") return { probability: node.value ? 1 : 0, conditional: false, unknownCount: 0, pureUnknown: false };
    if (kind === "random") {
      const denominator = Number(node.denominator || 0);
      return { probability: denominator ? Number(node.numerator || 0) / denominator : 0, conditional: false, unknownCount: 0, pureUnknown: false };
    }
    if (kind === "ability_gate") {
      if (!(node.key in values)) return { probability: 1, conditional: true, unknownCount: 1, pureUnknown: true };
      const value = Number(values[node.key] ?? 0);
      const gate = (node.gates || []).find((item) => comparisonPass(value, item.operator, item.threshold));
      const percent = Number(gate?.chance_percent ?? node.otherwise_percent ?? 0);
      return { probability: percent / 100, conditional: false, unknownCount: 0, pureUnknown: false };
    }
    if (kind === "check") {
      if (!(node.key in values)) return { probability: 1, conditional: true, unknownCount: 1, pureUnknown: true };
      return { probability: comparisonPass(values[node.key], node.operator, node.threshold) ? 1 : 0, conditional: false, unknownCount: 0, pureUnknown: false };
    }
    if (kind === "skill_check") {
      if (!(node.key in values)) return { probability: 1, conditional: true, unknownCount: 1, pureUnknown: true };
      const held = (values[node.key] || []).includes(Number(node.skill_id));
      const pass = node.negative ? !held : held;
      return { probability: pass ? 1 : 0, conditional: false, unknownCount: 0, pureUnknown: false };
    }
    if (kind === "unknown") return { probability: 1, conditional: true, unknownCount: 1, pureUnknown: true };
    if (kind === "not") {
      const child = evaluateProbabilityTree(node.item, values);
      if (child.pureUnknown) return child;
      return { ...child, probability: 1 - child.probability, pureUnknown: false };
    }
    const children = (node.items || []).map((item) => evaluateProbabilityTree(item, values));
    const conditional = children.some((item) => item.conditional);
    const unknownCount = children.reduce((sum, item) => sum + item.unknownCount, 0);
    if (kind === "or") {
      const probability = 1 - children.reduce((remaining, item) => remaining * (1 - item.probability), 1);
      return { probability, conditional, unknownCount, pureUnknown: children.length > 0 && children.every((item) => item.pureUnknown) };
    }
    const probability = children.reduce((result, item) => result * item.probability, 1);
    return { probability, conditional, unknownCount, pureUnknown: children.length > 0 && children.every((item) => item.pureUnknown) };
  }

  function candidateGate(outcome, values) {
    const selection = outcome.selection_analysis || {};
    if (selection.metric_key && selection.gates) {
      const value = values[selection.metric_key] ?? selection.default ?? 0;
      const gate = (selection.gates || []).find((item) => comparisonPass(value, item.operator, item.threshold));
      const chance = Number(gate?.chance_percent ?? 0) / 100;
      return {
        probability: chance,
        reason: chance
          ? `${selection.metric_label} ${gameValueLabel(selection.metric_key, value)}에서 이 단계의 난수 통과율은 ${numberFormat.format(chance * 100)}%입니다.`
          : `${selection.metric_label} ${gameValueLabel(selection.metric_key, value)}에서는 이 후보가 통과하지 않습니다.`
      };
    }
    if (selection.probability_tree) {
      const result = evaluateProbabilityTree(selection.probability_tree, values);
      const scope = result.conditional
        ? `화면에서 입력할 수 없는 내부 조건 ${result.unknownCount}개가 충족됐다고 가정한 결합 확률`
        : "현재 입력을 반영한 결합 확률";
      return { probability: result.probability, conditional: result.conditional, reason: `${scope}은 ${percentLabel(result.probability)}입니다.` };
    }
    const failedChecks = (selection.checks || []).filter((item) => !selectionCheckPass(item, values));
    if (failedChecks.length) {
      return { probability: 0, reason: `현재 입력에서 조건 ${failedChecks.length}개가 맞지 않아 건너뜁니다.` };
    }
    if (selection.fallback) {
      return { probability: 1, reason: "앞의 후보가 모두 실패했을 때 남는 기본 결과입니다." };
    }
    const probabilities = selection.probabilities || [];
    if (probabilities.length === 1) {
      const chance = Number(probabilities[0].percent) / 100;
      return { probability: chance, reason: `조건을 만족한 뒤 난수 ${probabilities[0].numerator}/${probabilities[0].denominator} 판정을 합니다.` };
    }
    if (probabilities.length > 1) {
      return { probability: null, reason: "여러 난수식의 결합 순서는 확인됐지만 하나의 최종 확률로 단순화하지 않았습니다." };
    }
    return { probability: 1, reason: "현재 입력에서 이 후보의 확인된 조건을 모두 만족합니다." };
  }

  function computeSelectionFlow(state, values) {
    if (!state.selection_model?.order_confirmed) return { confirmed: false, paths: [], byId: new Map() };
    const byId = new Map();
    const outcomeById = new Map(state.outcomes.map((outcome) => [outcome.id, outcome]));
    const modelPaths = state.selection_model.paths?.length
      ? state.selection_model.paths
      : [{ key: "primary", label: "후보 경로", outcome_ids: state.outcomes.map((outcome) => outcome.id) }];
    const paths = modelPaths.map((path) => {
      let remaining = 1;
      const rows = (path.outcome_ids || []).map((outcomeId, index) => {
        const outcome = outcomeById.get(outcomeId);
        if (!outcome) return null;
        const gate = candidateGate(outcome, values);
        const reach = remaining;
        let finalProbability = null;
        if (remaining !== null && gate.probability !== null) {
          finalProbability = remaining * gate.probability;
          remaining *= 1 - gate.probability;
        } else {
          remaining = null;
        }
        const row = {
          outcome,
          pathKey: path.key,
          pathLabel: path.label,
          conditional: modelPaths.length > 1,
          order: Number(outcome.selection_path_order || index + 1),
          gateProbability: gate.probability,
          reachProbability: reach,
          finalProbability,
          reason: gate.reason,
        };
        byId.set(outcome.id, row);
        return row;
      }).filter(Boolean);
      return { ...path, rows, remainder: remaining };
    });
    const mostLikelyIds = new Set();
    paths.forEach((path) => {
      const calculable = path.rows.filter((row) => Number.isFinite(row.finalProbability) && row.finalProbability > 0);
      if (!calculable.length) return;
      const maximum = Math.max(...calculable.map((row) => row.finalProbability));
      calculable.forEach((row) => {
        if (Math.abs(row.finalProbability - maximum) < 1e-9) mostLikelyIds.add(row.outcome.id);
      });
    });
    return { confirmed: true, paths, byId, mostLikelyIds, multiplePaths: paths.length > 1 };
  }

  function percentLabel(value) {
    if (value === null || value === undefined) return "계산 보류";
    const percent = Math.round(value * 1000) / 10;
    return `${numberFormat.format(percent)}%`;
  }

  function renderSelectionFlow(state, flow) {
    if (!flow.confirmed) {
      selectionFlowHost.innerHTML = `<h3>한 개가 선택되는 과정</h3><p>${escapeHtml(state.selection_model?.description || "후보 연결은 확인됐지만 검사 순서를 아직 확정하지 못했습니다.")}</p>`;
      return;
    }
    const renderRows = (path) => path.rows.map((row) => {
      const blocked = row.finalProbability === 0;
      const certain = row.finalProbability === 1;
      const random = row.finalProbability !== null && row.finalProbability > 0 && row.finalProbability < 1;
      const mostLikely = flow.mostLikelyIds?.has(row.outcome.id);
      const className = `${certain ? "is-selected" : blocked ? "is-blocked" : random ? "is-random" : ""}${mostLikely ? " is-most-likely" : ""}`.trim();
      const reach = row.reachProbability === null ? "앞 단계 결과에 따라 도달" : `이 단계 도달 ${percentLabel(row.reachProbability)}`;
      const result = row.finalProbability === null ? "최종 확률 미산출" : `최종 선택 ${percentLabel(row.finalProbability)}`;
      return `<li class="${className}"><span class="flow-step">${row.order}</span><div><b>${escapeHtml(row.outcome.title_ko)}${mostLikely ? '<em class="most-likely-label">가장 높은 확률</em>' : ""}</b><small>${escapeHtml(reach)} · ${escapeHtml(row.reason)}</small></div><strong>${escapeHtml(result)}</strong></li>`;
    }).join("");
    const pathHtml = flow.paths.map((path) => `<section class="selection-path"><h4>${escapeHtml(path.label)} · ${numberFormat.format(path.rows.length)}개</h4>${flow.multiplePaths ? "<p>이 경로가 먼저 선택되었다고 가정한 결과입니다.</p>" : ""}<ol class="selection-flow-list">${renderRows(path)}</ol></section>`).join("");
    const heading = flow.multiplePaths
      ? `${numberFormat.format(state.outcome_count)}개는 ${numberFormat.format(flow.paths.length)}개 경로로 나뉩니다`
      : `${numberFormat.format(state.outcome_count)}개 중 1개는 이렇게 결정됩니다`;
    const legend = flow.multiplePaths
      ? `<b>표시 확률은 각 경로 안에서의 조건부 확률</b>입니다. 먼저 어느 경로를 쓸지가 정해진 뒤, 그 경로의 앞 후보부터 검사합니다. 따라서 서로 다른 경로의 확률을 합쳐 전체 확률로 읽으면 안 됩니다.`
      : `<b>최종 선택 확률</b>은 “앞 후보들이 모두 실패할 확률 × 이 후보 자체의 통과율”입니다. 100%인 후보가 나오면 그 아래 후보는 검사하지 않습니다.`;
    selectionFlowHost.innerHTML = `<h3>${heading}</h3><p>${escapeHtml(state.selection_model.description)}</p>${pathHtml}<p class="selection-flow-legend">${legend}</p>`;
  }

  function outcomeCard(outcome, arrowKey, before, after, targetSlot, decision, mostLikely) {
    const analysis = analysisFor(outcome, arrowKey);
    const transitions = (analysis.comparisons || []).map((item) => {
      const key = fieldKey(item.slot, item.attribute);
      const beforeValue = before[key] ?? 0;
      const afterValue = after[key] ?? beforeValue;
      const beforePass = comparisonPass(beforeValue, item.operator, item.threshold);
      const afterPass = comparisonPass(afterValue, item.operator, item.threshold);
      return { ...item, beforeValue, afterValue, beforePass, afterPass, changed: beforePass !== afterPass, targeted: Number(item.slot) === targetSlot };
    });
    const favorable = transitions.filter((item) => item.changed && item.afterPass).length;
    const unfavorable = transitions.filter((item) => item.changed && !item.afterPass).length;
    const verdict = favorable > unfavorable ? "조건 통과 쪽으로 변화" : unfavorable > favorable ? "조건 이탈 쪽으로 변화" : statusLabels[analysis.status] || "영향 분석";
    const transitionHtml = transitions.length ? `<ul class="condition-transition-list">${transitions.map((item) =>
      `<li>${escapeHtml(personLabel(item.slot))}의 ${escapeHtml(fieldDefinition(item.attribute).label)} ${escapeHtml(item.operator)} ${numberFormat.format(item.threshold)} · ${numberFormat.format(item.beforeValue)}(${item.beforePass ? "통과" : "불통과"}) → ${numberFormat.format(item.afterValue)}(${item.afterPass ? "통과" : "불통과"})${item.targeted ? "" : " · 화살 대상 아님"}</li>`
    ).join("")}</ul>` : "";
    const selection = outcome.selection_analysis;
    let selectionHtml = "";
    let selectionClass = "";
    if (selection) {
      if (selection.metric_key && selection.gates) {
        const value = before[selection.metric_key] ?? selection.default ?? 0;
        const gate = (selection.gates || []).find((item) => comparisonPass(value, item.operator, item.threshold));
        const chance = gate?.chance_percent ?? 0;
        selectionClass = chance >= 80 ? "is-target-likely" : chance === 0 ? "is-target-impossible" : "";
        selectionHtml = `<section class="outcome-targeting"><h4>이 결과를 노리려면</h4><p class="target-chance"><span>현재 ${escapeHtml(selection.metric_label)}</span><strong>${escapeHtml(gameValueLabel(selection.metric_key, value))} · 분기 판정 통과율 ${numberFormat.format(chance)}%</strong></p><p>${escapeHtml(selection.advice)}</p><p>${escapeHtml(selection.arrow_advice)}</p><small>${escapeHtml(selection.note)}</small></section>`;
      } else if (selection.fallback) {
        selectionHtml = `<section class="outcome-targeting"><h4>이 결과를 노리려면</h4><p><strong>앞선 분기 실패 시 선택되는 기본 결과</strong></p><p>${escapeHtml(selection.advice)}</p><p>${escapeHtml(selection.arrow_advice)}</p><small>${escapeHtml(selection.note)}</small></section>`;
      } else {
        const checkRows = (selection.checks || []).map((item) => {
          if (item.skill_id !== undefined) {
            const held = (before[item.key] || []).includes(Number(item.skill_id));
            const pass = item.operator === "not_contains" ? !held : held;
            return `<li class="${pass ? "is-pass" : "is-fail"}">${escapeHtml(item.condition)} · 현재 ${held ? "보유" : "미보유"} → ${pass ? "충족" : "미충족"}</li>`;
          }
          const value = before[item.key] ?? 0;
          const pass = comparisonPass(value, item.operator, item.threshold);
          return `<li class="${pass ? "is-pass" : "is-fail"}">${escapeHtml(readableComparison(item))} · 현재 ${escapeHtml(abilityValueLabel(item.key, value))} → ${pass ? "충족" : "미충족"}</li>`;
        }).join("");
        const probabilities = (selection.probabilities || []).map((item) => `${item.numerator}/${item.denominator} (${numberFormat.format(item.percent)}%)`).join(" · ");
        const combinedProbability = selection.probability_tree && decision?.gateProbability !== null && decision?.gateProbability !== undefined
          ? `<p><b>${selection.probability_scope === "assuming_unexposed_conditions" ? "내부 조건 충족 가정 결합 확률" : "현재 입력의 결합 확률"}:</b> ${escapeHtml(percentLabel(decision.gateProbability))}</p>`
          : "";
        const formulas = (selection.condition_texts || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
        selectionHtml = `<section class="outcome-targeting"><h4>이 결과를 노리려면</h4>${checkRows ? `<ul class="target-check-list">${checkRows}</ul>` : ""}${combinedProbability}${probabilities ? `<p><b>포함된 난수 판정:</b> ${escapeHtml(probabilities)}</p>` : ""}<p>${escapeHtml(selection.advice)}</p><details><summary>확인된 ROM 분기식</summary><ul>${formulas}</ul></details><p>${escapeHtml(selection.arrow_advice)}</p><small>${escapeHtml(selection.note)}</small></section>`;
      }
    }
    const orderLabel = outcome.selection_path_label
      ? `${outcome.selection_path_label} · 검사 ${numberFormat.format(outcome.selection_path_order || 1)}`
      : `검사 ${numberFormat.format(outcome.selection_order || 1)}`;
    const probabilityLabel = decision?.finalProbability === null || decision?.finalProbability === undefined
      ? verdict
      : `${decision.conditional ? "경로 내 " : ""}최종 ${percentLabel(decision.finalProbability)}`;
    return `<article class="outcome-card ${favorable ? "is-favorable" : unfavorable ? "is-unfavorable" : ""} ${selectionClass} ${mostLikely ? "is-most-likely" : ""}">
      <header><div><span class="outcome-id">${escapeHtml(orderLabel)} · ${escapeHtml(outcome.id)}</span><h3>${escapeHtml(outcome.title_ko)}${mostLikely ? '<em class="most-likely-label">가장 높은 확률</em>' : ""}</h3><button class="event-reader-button compact" type="button" data-event-reader-id="${escapeHtml(outcome.id)}">번역 이벤트 읽기</button></div><span class="outcome-verdict">${escapeHtml(probabilityLabel)}</span></header>
      <p class="outcome-direction">${escapeHtml(analysis.direction || "직접 영향 미확인")}</p>
      ${transitionHtml}
      ${selectionHtml}
      <div class="outcome-columns outcome-effects-only"><section><h4>실행 후 변화</h4>${outcome.effects?.length ? `<ul>${outcome.effects.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>확인된 수치 변화 없음</p>"}</section></div>
    </article>`;
  }

  function calculate() {
    const state = currentState();
    if (!state) return;
    const arrowKey = selectedArrowKey();
    const arrow = definitions.arrows[arrowKey] || definitions.arrows.none;
    const item = selectedItem();
    const targetSlot = Number(fieldsHost.querySelector("#arrow-target-slot")?.value || 0);
    const rawBefore = readValues();
    const before = applyItemToValues(rawBefore, item, targetSlot);
    const after = adjustedValues(before, arrowKey, targetSlot);
    const selectionFlow = computeSelectionFlow(state, before);
    const immersionKey = fieldKey(targetSlot, 5);
    const beforeImmersion = before[immersionKey];
    const afterImmersion = after[immersionKey];
    let timingText = "예정 상태 실행 시점은 유지됩니다.";
    if (arrowKey === "encourage" && beforeImmersion !== undefined) timingText = afterImmersion >= 255 ? "몰입도가 가득 차 실행 단계에 도달합니다." : `몰입도가 ${numberFormat.format(beforeImmersion)} → ${numberFormat.format(afterImmersion)}로 올라 실행이 가까워집니다.`;
    if (arrowKey === "calm" && beforeImmersion !== undefined) timingText = `몰입도가 ${numberFormat.format(beforeImmersion)} → 0으로 초기화되어 이 예정 상태의 실행이 지연됩니다.`;
    const directCount = state.outcomes.filter((outcome) => analysisFor(outcome, arrowKey).status === "direct_condition").length;
    caption.textContent = `${state.title_ko}에서 ${item.label}·${arrow.label} 적용 후 가능한 ${state.outcome_count}개 결과를 비교합니다.`;
    summaryHost.innerHTML = `<div class="result-callout ${directCount ? "is-likely" : "is-possible"}"><span>예정 상태 진행</span><strong>${escapeHtml(timingText)}</strong><p><b>아이템 효과:</b> ${escapeHtml(itemChangeLabel(item, rawBefore, before, targetSlot))}</p><p><b>화살 자체 효과:</b> ${escapeHtml(arrow.description || "현재 상태 유지")}</p></div>
      <dl class="metric-list"><div><dt>예정 상태</dt><dd>${escapeHtml(state.title_ko)}</dd></div><div><dt>가능한 결과</dt><dd>${numberFormat.format(state.outcome_count)}개</dd></div><div><dt>선택한 아이템</dt><dd>${escapeHtml(item.label)}</dd></div><div><dt>선택한 화살</dt><dd>${escapeHtml(arrow.label)}</dd></div></dl>`;
    renderSelectionFlow(state, selectionFlow);
    outcomesHost.innerHTML = state.outcomes.map((outcome) => outcomeCard(outcome, arrowKey, before, after, targetSlot, selectionFlow.byId.get(outcome.id), selectionFlow.mostLikelyIds?.has(outcome.id))).join("");
    evidenceHost.innerHTML = `<dl class="evidence-grid"><div><dt>예정 상태 레코드</dt><dd>${escapeHtml(state.population_status)}</dd></div><div><dt>연결 처리 함수</dt><dd>${state.handler_functions.map((item) => `<code>${escapeHtml(item)}</code>`).join(" ")}</dd></div><div><dt>결과 이벤트 수</dt><dd>${numberFormat.format(state.outcome_count)}개</dd></div><div><dt>연결 상태</dt><dd>${escapeHtml(state.prediction_status)}</dd></div></dl>`;
  }

  function selectState() {
    const state = currentState();
    if (!state) {
      fieldsHost.innerHTML = "<p>검색 결과가 없습니다.</p>";
      outcomesHost.innerHTML = "";
      return;
    }
    renderFields(state);
    renderArrows(state);
    calculate();
  }

  function applySaveHandoff() {
    let handoff = null;
    try {
      handoff = JSON.parse(sessionStorage.getItem("sennen-family-predictor-handoff") || "null");
    } catch (_) {
      sessionStorage.removeItem("sennen-family-predictor-handoff");
    }
    if (!handoff || !plannedStates.some((state) => state.id === handoff.stateId)) return false;
    stateSelect.value = handoff.stateId;
    selectState();
    if (handoff.itemKey && [...itemSelect.options].some((option) => option.value === handoff.itemKey)) {
      itemSelect.value = handoff.itemKey;
      updateItemNote();
    }
    const values = handoff.values || {};
    fieldsHost.querySelectorAll("[data-selection-key]").forEach((control) => {
      const value = values[control.dataset.selectionKey];
      if (value !== undefined && !Array.isArray(value)) {
        control.value = String(value);
        syncSelectionDisplay(control);
      }
    });
    fieldsHost.querySelectorAll("input[data-selection-skill-key]").forEach((control) => {
      const held = values[control.dataset.selectionSkillKey];
      control.checked = Array.isArray(held) && held.includes(Number(control.dataset.skillId));
    });
    fieldsHost.querySelectorAll("input[data-slot][data-attribute]").forEach((control) => {
      const slot = Number(control.dataset.slot);
      const attribute = Number(control.dataset.attribute);
      const value = values[fieldKey(slot, attribute)] ?? values[`slot${slot}_attribute${attribute}`];
      if (value !== undefined) control.value = String(value);
    });
    if (handoff.memberName) caption.textContent = `${handoff.memberName}의 세이브 수치를 불러왔습니다.`;
    sessionStorage.removeItem("sennen-family-predictor-handoff");
    calculate();
    return true;
  }

  Promise.all([
    fetch(window.PREDICTOR_DATA_URL).then((response) => { if (!response.ok) throw new Error(`화살 정의 HTTP ${response.status}`); return response.json(); }),
    fetch(window.PLANNED_STATES_URL).then((response) => { if (!response.ok) throw new Error(`예정 상태 HTTP ${response.status}`); return response.json(); }),
    fetch(window.ITEM_EFFECTS_URL).then((response) => { if (!response.ok) throw new Error(`아이템 효과 HTTP ${response.status}`); return response.json(); })
  ]).then(([predictorData, stateData, loadedItemData]) => {
    definitions = predictorData;
    plannedStates = stateData.states || [];
    itemData = loadedItemData;
    renderItems();
    window.EventScriptReader?.setEvents(plannedStates.flatMap((state) => state.outcomes || []));
    renderStateSelector();
    stateSelect.addEventListener("change", selectState);
    stateFilter.addEventListener("input", () => { renderStateSelector(); selectState(); });
    calculateButton.addEventListener("click", calculate);
    itemSelect.addEventListener("change", () => { updateItemNote(); calculate(); });
    if (!applySaveHandoff()) {
      const example = plannedStates.find((state) => state.title_ko.includes("바의 마담"));
      if (example) stateSelect.value = example.id;
      selectState();
    }
  }).catch((error) => {
    summaryHost.innerHTML = `<p class="event-condition-caution">예측 데이터를 읽지 못했습니다: ${escapeHtml(error.message)}</p>`;
  });

  outcomesHost.addEventListener("click", (event) => {
    const button = event.target.closest("[data-event-reader-id]");
    if (button) window.EventScriptReader?.open(button.dataset.eventReaderId);
  });
})();
