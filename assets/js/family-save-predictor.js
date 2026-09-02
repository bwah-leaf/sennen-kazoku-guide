(() => {
  "use strict";

  const fileInput = document.querySelector("#save-file");
  const dropZone = document.querySelector("#save-drop-zone");
  const statusHost = document.querySelector("#save-status");
  const summaryHost = document.querySelector("#save-summary");
  const resultsHost = document.querySelector("#family-results");
  const numberFormat = new Intl.NumberFormat("ko-KR");
  const SAVE_SESSION_KEY = "sennen-family-save-session-v2";
  const abilityRanks = [
    ["F", 0, 799], ["D", 800, 1599], ["C", 1600, 2399], ["B", 2400, 3199],
    ["A", 3200, 3999], ["S", 4000, 4799], ["SS", 4800, 5000]
  ];
  let plannedStates = [];
  let layout = null;
  let stateBySaveKey = new Map();
  let textMap = new Map();
  let skillById = new Map();
  let normalizedJob = new Map();
  let incomeClassByJobStatus = new Map();
  let lastMembers = [];
  let lastParsed = null;
  let itemData = { items: [], mood_levels: [] };
  const memberItemSelections = new Map();

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const u16 = (data, offset) => data[offset] | (data[offset + 1] << 8);
  const i32 = (data, offset) => (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24));
  const u32be = (data, offset) => ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

  function decodePackedDate(data, offset) {
    const first = data[offset], second = data[offset + 1], third = data[offset + 2];
    return { year: (second >> 1) | (third << 7), month: (first >> 5) | ((second & 1) << 3), day: first & 31 };
  }

  function ageAt(birth, current) {
    if (!birth.year || birth.year > current.year) return 0;
    let age = current.year - birth.year;
    if (current.month < birth.month || (current.month === birth.month && current.day < birth.day)) age -= 1;
    return Math.max(0, age);
  }

  function isLeadByte(value) {
    return (value >= 0x81 && value <= 0x9F) || (value >= 0xE0 && value <= 0xFC);
  }

  function decodeName(data, offset, size) {
    const parts = [];
    for (let cursor = offset; cursor < offset + size;) {
      const first = data[cursor++];
      if (first === 0 || first === 0xFF) break;
      let code = first;
      let bytes = [first];
      if (isLeadByte(first) && cursor < offset + size) {
        const second = data[cursor++];
        code = (first << 8) | second;
        bytes.push(second);
      }
      if (textMap.has(code)) parts.push(textMap.get(code));
      else {
        try { parts.push(new TextDecoder("shift_jis").decode(new Uint8Array(bytes))); }
        catch (_) { parts.push("□"); }
      }
    }
    return parts.join("") || "이름 없음";
  }

  async function inflateMgbaPng(raw) {
    const pngMagic = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (!pngMagic.every((value, index) => raw[index] === value)) return null;
    let cursor = 8;
    while (cursor + 12 <= raw.length) {
      const size = u32be(raw, cursor);
      const type = String.fromCharCode(...raw.slice(cursor + 4, cursor + 8));
      const start = cursor + 8, end = start + size;
      if (end + 4 > raw.length) throw new Error("상태저장 PNG 청크가 잘렸습니다.");
      if (type === "gbAs") {
        if (!("DecompressionStream" in window)) throw new Error("이 브라우저는 mGBA 상태저장 압축 해제를 지원하지 않습니다. 최신 Chrome/Edge에서 열어 주세요.");
        const stream = new Blob([raw.slice(start, end)]).stream().pipeThrough(new DecompressionStream("deflate"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }
      cursor = end + 4;
    }
    throw new Error("mGBA 상태 데이터(gbAs)를 찾지 못했습니다.");
  }

  async function normalizeSave(file) {
    const raw = new Uint8Array(await file.arrayBuffer());
    const inflated = await inflateMgbaPng(raw);
    const stateFormat = layout.formats.mgba_state;
    if (inflated) {
      if (inflated.length !== stateFormat.serialized_size) throw new Error(`지원하지 않는 mGBA 상태 크기입니다: 0x${inflated.length.toString(16)}`);
      return { data: inflated, format: stateFormat, label: "mGBA 상태저장" };
    }
    if (raw.length === stateFormat.serialized_size && raw[3] === 1) return { data: raw, format: stateFormat, label: "mGBA 원시 상태저장" };
    if (raw.length >= layout.formats.flash_save.minimum_size) return { data: raw, format: layout.formats.flash_save, label: "GBA FLASH 세이브" };
    throw new Error("지원하는 .sav 또는 mGBA .ss0~.ss9 형식이 아닙니다.");
  }

  function rankLabel(value) {
    return abilityRanks.find(([, minimum, maximum]) => value >= minimum && value <= maximum)?.[0] || String(value);
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

  function evaluateTree(node, values) {
    if (!node) return { probability: 1, conditional: false, unknownCount: 0, pureUnknown: false };
    if (node.type === "constant") return { probability: node.value ? 1 : 0, conditional: false, unknownCount: 0, pureUnknown: false };
    if (node.type === "random") return { probability: node.denominator ? Number(node.numerator) / Number(node.denominator) : 0, conditional: false, unknownCount: 0, pureUnknown: false };
    if (node.type === "ability_gate") {
      if (!(node.key in values)) return { probability: 1, conditional: true, unknownCount: 1, pureUnknown: true };
      const gate = (node.gates || []).find((item) => comparisonPass(values[node.key], item.operator, item.threshold));
      return { probability: Number(gate?.chance_percent ?? node.otherwise_percent ?? 0) / 100, conditional: false, unknownCount: 0, pureUnknown: false };
    }
    if (node.type === "check") {
      if (!(node.key in values)) return { probability: 1, conditional: true, unknownCount: 1, pureUnknown: true };
      return { probability: comparisonPass(values[node.key], node.operator, node.threshold) ? 1 : 0, conditional: false, unknownCount: 0, pureUnknown: false };
    }
    if (node.type === "skill_check") {
      if (!(node.key in values)) return { probability: 1, conditional: true, unknownCount: 1, pureUnknown: true };
      const held = (values[node.key] || []).includes(Number(node.skill_id));
      return { probability: (node.negative ? !held : held) ? 1 : 0, conditional: false, unknownCount: 0, pureUnknown: false };
    }
    if (node.type === "unknown") return { probability: 1, conditional: true, unknownCount: 1, pureUnknown: true };
    if (node.type === "not") {
      const child = evaluateTree(node.item, values);
      return child.pureUnknown ? child : { ...child, probability: 1 - child.probability, pureUnknown: false };
    }
    const children = (node.items || []).map((item) => evaluateTree(item, values));
    const conditional = children.some((item) => item.conditional);
    const unknownCount = children.reduce((sum, item) => sum + item.unknownCount, 0);
    const probability = node.type === "or"
      ? 1 - children.reduce((remaining, item) => remaining * (1 - item.probability), 1)
      : children.reduce((result, item) => result * item.probability, 1);
    return { probability, conditional, unknownCount, pureUnknown: children.length > 0 && children.every((item) => item.pureUnknown) };
  }

  function candidateGate(outcome, values) {
    const selection = outcome.selection_analysis || {};
    if (selection.metric_key && selection.gates) {
      const value = values[selection.metric_key] ?? selection.default ?? 0;
      const gate = (selection.gates || []).find((item) => comparisonPass(value, item.operator, item.threshold));
      return { probability: Number(gate?.chance_percent ?? 0) / 100, conditional: false };
    }
    if (selection.probability_tree) return evaluateTree(selection.probability_tree, values);
    const failed = (selection.checks || []).some((item) => {
      if (item.skill_id !== undefined) {
        const held = (values[item.key] || []).includes(Number(item.skill_id));
        return !(item.operator === "not_contains" ? !held : held);
      }
      return !comparisonPass(values[item.key] ?? 0, item.operator, item.threshold);
    });
    if (failed) return { probability: 0, conditional: false };
    if (selection.fallback) return { probability: 1, conditional: false };
    if ((selection.probabilities || []).length === 1) return { probability: Number(selection.probabilities[0].percent) / 100, conditional: false };
    if ((selection.probabilities || []).length > 1) return { probability: null, conditional: true };
    return { probability: 1, conditional: false };
  }

  function selectionRows(state, values) {
    const outcomeById = new Map(state.outcomes.map((item) => [item.id, item]));
    const paths = state.selection_model?.paths?.length ? state.selection_model.paths : [{ key: "primary", label: "후보 경로", outcome_ids: state.outcomes.map((item) => item.id) }];
    const rows = [];
    paths.forEach((path) => {
      let remaining = 1;
      (path.outcome_ids || []).forEach((id, index) => {
        const outcome = outcomeById.get(id);
        if (!outcome) return;
        const gate = candidateGate(outcome, values);
        const finalProbability = remaining === null || gate.probability === null ? null : remaining * gate.probability;
        rows.push({ outcome, path: path.label, order: index + 1, probability: finalProbability, conditional: gate.conditional || paths.length > 1 });
        remaining = remaining === null || gate.probability === null ? null : remaining * (1 - gate.probability);
      });
    });
    return rows;
  }

  function stateFor(record) {
    return stateBySaveKey.get(`${record.plannedTable}:${record.plannedIndex}`) || null;
  }

  function hydrateRecords(records) {
    records.forEach((record) => {
      record.state = stateFor(record);
      record.profileCode = Number(record.state?.save_refs?.find((item) => Number(item.table) === record.plannedTable && Number(item.index) === record.plannedIndex)?.profile_code ?? 255);
      record.stats = effectiveStats(record, record.state);
      record.jobCode = normalizedJob.get(record.jobRaw) ?? record.jobRaw;
    });
    return records;
  }

  function moodStage(value) {
    return (layout.family.mood_levels || []).find(([, minimum, maximum]) => value >= minimum && value <= maximum)?.[0] || 1;
  }

  function gradeLabel(value) {
    if (value === 0xFF) return "없음";
    const labels = ["1등급 (최상)", "2등급", "3등급", "4등급"];
    return labels[value] || `내부 등급 ${value}`;
  }

  function prosperityMetrics(assets, houseGrade, carGrade, records) {
    let score = 0;
    if (assets > 999999) score += 40;
    else if (assets > 499999) score += 35;
    else if (assets > 9999) score += 30;
    else if (assets > 4999) score += 25;
    else if (assets > 999) score += 20;
    else if (assets >= 0) score += 15;
    else if (assets <= -1000) score -= 100;

    score += [20, 15, 10, 5][houseGrade] || 0;
    score += [10, 8, 5, 3][carGrade] || 0;

    const incomeClass = records.reduce((maximum, record) => {
      const value = incomeClassByJobStatus.get(`${record.jobRaw}:${record.statusCode}`) || 0;
      return Math.max(maximum, value);
    }, 0);
    const incomePoints = { 10: 30, 9: 28, 8: 26, 7: 24, 6: 22, 5: 20, 4: 16, 3: 12, 2: 6 };
    score += incomePoints[incomeClass] || 0;
    score = Math.max(0, score);
    return { score, stage: score === 100 ? 5 : Math.floor(score / 20) + 1, incomeClass };
  }

  function bondMetrics(mood, householdHeadId, records) {
    if (records.length <= 1) return { score: 0, stage: 1 };
    let score = mood > 207 ? 50 : mood > 159 ? 40 : mood > 95 ? 30 : mood > 47 ? 10 : -10;
    score += ({ 8: 30, 7: 26, 6: 22, 5: 18, 4: 14, 3: 10, 2: 6 })[records.length] || 0;
    const head = records.find((record) => record.id === householdHeadId) || records[0];
    head.rawStats.forEach((value) => {
      score += value > 4599 ? 5 : value > 3999 ? 5 : value > 3199 ? 4 : value > 2399 ? 3 : value > 1599 ? 2 : value > 799 ? 1 : 0;
    });
    score = Math.max(0, score);
    return { score, stage: score === 100 ? 5 : Math.floor(score / 20) + 1 };
  }

  function parseFamilyValues(data, format, records) {
    const base = format.family_base;
    const family = layout.family;
    const mood = data[base + family.mood];
    const houseGrade = data[base + family.house_grade] & 0x0F;
    const carGrade = data[base + family.car_grade];
    const assets = i32(data, base + family.assets);
    const householdHeadId = u16(data, base + family.household_head_id);
    return {
      mood, moodStage: moodStage(mood), houseGrade, carGrade, assets, householdHeadId,
      prosperity: prosperityMetrics(assets, houseGrade, carGrade, records),
      bond: bondMetrics(mood, householdHeadId, records),
    };
  }

  function effectiveStats(record, state) {
    const ref = (state?.save_refs || []).find((item) => Number(item.table) === record.plannedTable && Number(item.index) === record.plannedIndex);
    const profile = Number(ref?.profile_code ?? 255);
    return record.rawStats.map((raw, attribute) => {
      let value = raw;
      if (record.roleCode === profile) value = Math.min(5000, Math.floor(raw * 5 / 4));
      else if ((record.roleCode === 1 && profile === 2) || (record.roleCode === 2 && profile === 1)) value = Math.floor(raw * 3 / 4);
      record.skills.forEach((skillId) => { value += Number(skillById.get(skillId)?.modifiers?.[attribute] || 0); });
      return clamp(value, 0, 5000);
    });
  }

  function selectedItemFor(member) {
    const key = memberItemSelections.get(member.index) || "none";
    return itemData.items.find((item) => item.key === key) || itemData.items[0] || { key: "none", label: "사용하지 않음", calculation: { operation: "none" } };
  }

  function itemAdjustedStats(person, target, item) {
    const stats = [...person.stats];
    const effect = item.calculation || {};
    if (person.id === target.id && effect.operation === "ability_rank_up") {
      const attribute = Number(effect.attribute);
      stats[attribute] = clamp(stats[attribute] + Number(effect.amount || 800), 0, Number(effect.maximum || 5000));
    }
    return stats;
  }

  function itemAdjustedMood(family, item) {
    const effect = item.calculation || {};
    if (effect.operation !== "mood_stage_up") return family.mood;
    const levels = itemData.mood_levels || [];
    const index = levels.findIndex(([, minimum, maximum]) => family.mood >= minimum && family.mood <= maximum);
    return index >= 0 && index + 1 < levels.length ? Number(levels[index + 1][3]) : family.mood;
  }

  function valuesFor(member, members, slots, family, item) {
    const values = {};
    const setPerson = (slot, person) => {
      if (!person) return;
      const stats = itemAdjustedStats(person, member, item);
      [0, 1, 2, 3].forEach((attribute) => {
        values[`person_s${slot}_a${attribute}`] = stats[attribute];
        values[`slot${slot}_attribute${attribute}`] = stats[attribute];
      });
      const extras = { 5: person.interest, 6: person.internalStatus5d, 7: person.jobMastery, 17: person.profileCode, 18: person.jobCode, 19: person.jobRaw, 20: person.statusCode, 24: person.gender, 25: person.appearanceType, 26: person.appearanceVariant, 27: person.age };
      Object.entries(extras).forEach(([attribute, value]) => {
        values[`person_s${slot}_a${attribute}`] = value;
        values[`slot${slot}_attribute${attribute}`] = value;
      });
      values[`person_s${slot}_skills`] = [...person.skills];
    };
    slots.forEach((id, slot) => setPerson(slot, members.find((item) => item.id === id)));
    setPerson(0, member);
    // Older extracted predicates used slot 15 for the event subject.  Populate
    // that alias as well until all historical predicate records are normalized.
    setPerson(15, member);
    values.slot0_intelligence = itemAdjustedStats(member, member, item)[0];
    values.global_0 = itemAdjustedMood(family, item);
    values.global_1 = family.houseGrade;
    values.global_3 = family.assets;
    values.global_8 = family.carGrade;
    return values;
  }

  function parseMembers(save) {
    const { data, format } = save;
    const personLayout = layout.person;
    const currentDate = decodePackedDate(data, format.current_date);
    const records = [];
    for (let index = 0; index < personLayout.count; index += 1) {
      const base = format.record_base + index * personLayout.stride;
      if (base + personLayout.stride > data.length) break;
      const id = u16(data, base + personLayout.id);
      if (id === 0xFFFF) continue;
      const birth = decodePackedDate(data, base + personLayout.birth_date);
      const rawStats = personLayout.stats.map((offset) => u16(data, base + offset));
      const plannedTable = u16(data, base + personLayout.planned_table);
      const plannedIndex = u16(data, base + personLayout.planned_index);
      const skills = [];
      for (let skillIndex = 0; skillIndex < personLayout.skill_count; skillIndex += 1) {
        const skill = data[base + personLayout.skills + skillIndex];
        if (skill !== 0xFF) skills.push(skill);
      }
      const appearance = data[base + personLayout.appearance];
      records.push({
        index, id, name: decodeName(data, base + personLayout.name, personLayout.name_size), birth,
        age: ageAt(birth, currentDate), rawStats, plannedTable, plannedIndex, skills,
        gender: data[base + personLayout.gender], roleCode: appearance & 0x0F,
        appearanceType: appearance >> 4, appearanceVariant: appearance & 0x0F,
        jobRaw: data[base + personLayout.job_raw], statusCode: data[base + personLayout.status_code],
        interest: data[base + personLayout.interest], internalStatus5d: data[base + personLayout.internal_status_5d],
        jobMastery: data[base + personLayout.job_mastery],
      });
    }
    hydrateRecords(records);
    const slots = [];
    if (format.slot_map + 32 <= data.length) for (let slot = 0; slot < 16; slot += 1) slots.push(u16(data, format.slot_map + slot * 2));
    return { records, slots, currentDate, family: parseFamilyValues(data, format, records) };
  }

  function percentLabel(row) {
    if (row.probabilityRange) {
      const [minimum, maximum] = row.probabilityRange.map((value) => Math.round(value * 1000) / 10);
      return minimum === maximum ? `${numberFormat.format(minimum)}%` : `경로별 ${numberFormat.format(minimum)}~${numberFormat.format(maximum)}%`;
    }
    if (row.probability === null) return "최종 확률 미산출";
    const value = Math.round(row.probability * 1000) / 10;
    return `${row.conditional ? "조건부 " : ""}${numberFormat.format(value)}%`;
  }

  function renderMember(member, members, slots, family) {
    const state = member.state;
    const stats = member.stats.map((value) => `${rankLabel(value)}(${numberFormat.format(value)})`);
    const skills = member.skills.map((id) => skillById.get(id)?.name || `스킬 ${id}`);
    if (!state) {
      return `<article class="family-member-card is-unresolved"><header><div><span>인물 ID ${member.id}</span><h3>${escapeHtml(member.name)} · ${member.age}세</h3></div><strong>예정 상태 없음</strong></header><p>저장값 ${member.plannedTable}:${member.plannedIndex}에 대응하는 활성 예정 상태가 없습니다.</p></article>`;
    }
    const item = selectedItemFor(member);
    const baseItem = itemData.items.find((entry) => entry.key === "none") || { calculation: { operation: "none" } };
    const baseValues = valuesFor(member, members, slots, family, baseItem);
    const values = valuesFor(member, members, slots, family, item);
    member.predictorValues = baseValues;
    member.predictorItemKey = item.key;
    const rawRows = selectionRows(state, values);
    const groupedRows = new Map();
    rawRows.forEach((row) => {
      // Several role/profile paths point at distinct event records carrying the
      // same visible title.  The family overview is about visible outcomes, so
      // collapse those records here; the detailed predictor keeps every path.
      const visibleKey = row.outcome.title_ko;
      const existing = groupedRows.get(visibleKey);
      if (!existing) {
        groupedRows.set(visibleKey, { ...row, paths: new Set([row.path]), probabilities: row.probability === null ? [] : [row.probability] });
        return;
      }
      existing.paths.add(row.path);
      if (row.probability !== null) existing.probabilities.push(row.probability);
      existing.conditional ||= row.conditional;
    });
    const rows = [...groupedRows.values()].map((row) => {
      const probabilities = [...new Set(row.probabilities)].sort((left, right) => left - right);
      return { ...row, path: [...row.paths].join(" · "), probability: probabilities.length === 1 ? probabilities[0] : row.probability, probabilityRange: probabilities.length > 1 ? [probabilities[0], probabilities.at(-1)] : null };
    });
    const knownProbability = (row) => row.probabilityRange ? row.probabilityRange[1] : row.probability;
    const calculable = rows.filter((row) => Number.isFinite(knownProbability(row)) && knownProbability(row) > 0);
    const maximum = calculable.length ? Math.max(...calculable.map(knownProbability)) : null;
    const outcomes = rows.map((row) => {
      const mostLikely = maximum !== null && Number.isFinite(knownProbability(row)) && Math.abs(knownProbability(row) - maximum) < 1e-9;
      return `<li class="${mostLikely ? "is-most-likely" : ""}"><span><b>${escapeHtml(row.outcome.title_ko)}${mostLikely ? '<em class="most-likely-label">가장 높은 확률</em>' : ""}</b><small>${escapeHtml(row.path)} · 검사 ${row.order}</small></span><strong>${escapeHtml(percentLabel(row))}</strong></li>`;
    }).join("");
    const effect = item.calculation || {};
    let itemEffect = item.description || "현재 수치 유지";
    if (effect.operation === "ability_rank_up") {
      const attribute = Number(effect.attribute);
      const changed = itemAdjustedStats(member, member, item)[attribute];
      itemEffect = `${["지력", "체력", "매력", "운"][attribute]} ${rankLabel(member.stats[attribute])}(${numberFormat.format(member.stats[attribute])}) → ${rankLabel(changed)}(${numberFormat.format(changed)})`;
    } else if (effect.operation === "mood_stage_up") {
      const changed = itemAdjustedMood(family, item);
      itemEffect = `가족 무드 ${moodStage(family.mood)}단계(${family.mood}) → ${moodStage(changed)}단계(${changed})`;
    } else if (effect.operation === "unmodeled") {
      itemEffect = `${item.description} 현재 예측 입력으로는 수치화하지 않습니다.`;
    }
    const itemOptions = itemData.items.map((entry) => `<option value="${escapeHtml(entry.key)}"${entry.key === item.key ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("");
    return `<article class="family-member-card"><header><div><span>인물 ID ${member.id} · ${member.gender ? "여성" : "남성"}</span><h3>${escapeHtml(member.name)} · ${member.age}세</h3></div><strong>${escapeHtml(state.title_ko)}</strong></header>
      <dl class="member-stat-grid"><div><dt>지력</dt><dd>${stats[0]}</dd></div><div><dt>체력</dt><dd>${stats[1]}</dd></div><div><dt>매력</dt><dd>${stats[2]}</dd></div><div><dt>운</dt><dd>${stats[3]}</dd></div><div><dt>직업 코드</dt><dd>${member.jobCode}</dd></div><div><dt>직업 숙련도</dt><dd>${member.jobMastery}</dd></div><div><dt>관심 몰입도</dt><dd>${member.interest}</dd></div><div><dt>보유 스킬</dt><dd>${skills.length}개</dd></div></dl>
      <p class="member-skills"><b>보유 스킬:</b> ${skills.length ? skills.map(escapeHtml).join(" · ") : "없음"}</p>
      <label class="member-item-choice">실행 전에 사용할 아이템<select class="wide-control" data-member-item="${member.index}">${itemOptions}</select><small>${escapeHtml(itemEffect)}</small></label>
      <ol class="member-outcome-list">${outcomes || "<li>연결된 결과 이벤트가 없습니다.</li>"}</ol>
      <button class="primary-button compact" type="button" data-open-member="${member.index}">이 인물로 상세 예측 열기</button>
    </article>`;
  }

  function summaryMarkup(parsed) {
    const family = parsed.family;
    return `<dl class="metric-list family-metric-list">
      <div><dt>현재 날짜</dt><dd>${parsed.currentDate.year}년 ${parsed.currentDate.month}월 ${parsed.currentDate.day}일</dd></div>
      <div><dt>가족 구성원</dt><dd>${parsed.records.length}명</dd></div>
      <div><dt>가족 무드</dt><dd>${family.moodStage}단계 <small>(내부값 ${family.mood})</small></dd></div>
      <div><dt>주택 등급</dt><dd>${escapeHtml(gradeLabel(family.houseGrade))}</dd></div>
      <div><dt>자동차 등급</dt><dd>${escapeHtml(gradeLabel(family.carGrade))}</dd></div>
      <div><dt>가족 자산</dt><dd>${numberFormat.format(family.assets)}만엔</dd></div>
      <div><dt>풍요로움</dt><dd>${family.prosperity.stage}단계 <small>(평가 ${family.prosperity.score}/100)</small></dd></div>
      <div><dt>유대</dt><dd>${family.bond.stage}단계 <small>(평가 ${family.bond.score}/100)</small></dd></div>
    </dl>`;
  }

  function compactSnapshot(fileName, saveLabel, parsed) {
    return {
      version: 2,
      fileName,
      saveLabel,
      currentDate: parsed.currentDate,
      slots: parsed.slots,
      family: parsed.family,
      records: parsed.records.map(({ state, predictorValues, stats, jobCode, ...record }) => record),
    };
  }

  function renderAnalysis(fileName, saveLabel, parsed, restored = false) {
    lastMembers = parsed.records;
    lastParsed = parsed;
    const linked = parsed.records.filter((item) => item.state).length;
    statusHost.textContent = `${fileName} · ${saveLabel} · 가족 ${parsed.records.length}명 분석 완료${restored ? " · 이 탭에 유지된 결과" : ""}`;
    summaryHost.innerHTML = summaryMarkup(parsed);
    resultsHost.innerHTML = parsed.records.map((member) => renderMember(member, parsed.records, parsed.slots, parsed.family)).join("");
    if (!restored) {
      try { sessionStorage.setItem(SAVE_SESSION_KEY, JSON.stringify(compactSnapshot(fileName, saveLabel, parsed))); }
      catch (_) { /* A full analysis still works even if storage is disabled. */ }
    }
    return linked;
  }

  function restoreAnalysis() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SAVE_SESSION_KEY) || "null");
      if (!saved || saved.version !== 2 || !Array.isArray(saved.records)) return false;
      const parsed = { records: hydrateRecords(saved.records), slots: saved.slots || [], currentDate: saved.currentDate, family: saved.family };
      renderAnalysis(saved.fileName || "이전에 불러온 세이브", saved.saveLabel || "세이브", parsed, true);
      return true;
    } catch (_) {
      sessionStorage.removeItem(SAVE_SESSION_KEY);
      return false;
    }
  }

  async function handleFile(file) {
    if (!layout || !plannedStates.length) return;
    statusHost.textContent = `${file.name}을 브라우저에서 읽는 중…`;
    resultsHost.innerHTML = "<p class=\"empty-state\">가족 레코드와 예정 상태를 해석하는 중입니다.</p>";
    try {
      const save = await normalizeSave(file);
      const parsed = parseMembers(save);
      if (!parsed.records.length) throw new Error("활성 가족 레코드를 찾지 못했습니다. 게임 진행 중 저장한 파일인지 확인해 주세요.");
      renderAnalysis(file.name, save.label, parsed);
    } catch (error) {
      lastMembers = [];
      lastParsed = null;
      statusHost.textContent = `분석 실패: ${error.message}`;
      resultsHost.innerHTML = `<p class="event-condition-caution">${escapeHtml(error.message)}</p>`;
    }
  }

  Promise.all([
    fetch(window.PLANNED_STATES_URL).then((response) => { if (!response.ok) throw new Error(`예정 상태 HTTP ${response.status}`); return response.json(); }),
    fetch(window.FAMILY_SAVE_LAYOUT_URL).then((response) => { if (!response.ok) throw new Error(`세이브 구조 HTTP ${response.status}`); return response.json(); }),
    fetch(window.ITEM_EFFECTS_URL).then((response) => { if (!response.ok) throw new Error(`아이템 효과 HTTP ${response.status}`); return response.json(); })
  ]).then(([statesData, layoutData, loadedItemData]) => {
    plannedStates = statesData.states || [];
    layout = layoutData;
    itemData = loadedItemData;
    textMap = new Map(layout.text_map.map((item) => [Number(item.code), item.char]));
    skillById = new Map(layout.skills.map((item) => [Number(item.id), item]));
    normalizedJob = new Map(layout.jobs.map((item) => [Number(item.raw), Number(item.normalized)]));
    incomeClassByJobStatus = new Map((layout.income_classes || []).map((item) => [`${Number(item.raw)}:${Number(item.status)}`, Number(item.income_class)]));
    stateBySaveKey = new Map();
    plannedStates.forEach((state) => (state.save_refs || []).forEach((ref) => stateBySaveKey.set(`${ref.table}:${ref.index}`, state)));
    if (!restoreAnalysis()) statusHost.textContent = `${numberFormat.format(plannedStates.length)}개 예정 상태와 세이브 구조를 읽었습니다. 파일을 선택하세요.`;
  }).catch((error) => {
    statusHost.textContent = `페이지 데이터를 읽지 못했습니다: ${error.message}`;
  });

  fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) handleFile(fileInput.files[0]); });
  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); }));
  dropZone.addEventListener("drop", (event) => { const file = event.dataTransfer?.files?.[0]; if (file) handleFile(file); });
  resultsHost.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-member]");
    if (!button) return;
    const member = lastMembers.find((item) => item.index === Number(button.dataset.openMember));
    if (!member?.state) return;
    sessionStorage.setItem("sennen-family-predictor-handoff", JSON.stringify({ stateId: member.state.id, values: member.predictorValues, memberName: member.name, itemKey: member.predictorItemKey || "none" }));
    window.location.href = "predictor.html?v=save-handoff1";
  });
  resultsHost.addEventListener("change", (event) => {
    const control = event.target.closest("[data-member-item]");
    if (!control || !lastParsed) return;
    memberItemSelections.set(Number(control.dataset.memberItem), control.value);
    resultsHost.innerHTML = lastParsed.records.map((member) => renderMember(member, lastParsed.records, lastParsed.slots, lastParsed.family)).join("");
  });
})();
