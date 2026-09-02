---
layout: default
title: 이벤트 찾아보기
permalink: /events/
---

# 이벤트 찾아보기

<p class="event-help">한국어 이벤트명·조건·UID를 검색하거나 분류와 검증 상태로 좁힐 수 있습니다.</p>
<p class="event-help"><b>공개 데이터 정책:</b> 이 검색 화면은 한국어 이벤트 정보와 직접 작성한 분석 데이터를 표시합니다. 사이트에는 ROM·일본어 원문·원본 그래픽·세이브 파일을 포함하지 않습니다.</p>

<div class="event-controls">
  <label>검색 <input id="event-search" type="search" placeholder="한국어 이벤트명, 조건, UID"></label>
  <label>분류 <select id="event-category"><option value="">전체</option></select></label>
  <label>검증 <select id="event-status"><option value="">전체</option></select></label>
  <label>ROM 조건 <select id="condition-evidence">
    <option value="">전체</option>
    <option value="secondary_outcome">상위 결과 상속</option>
    <option value="range_confirmed">속성 범위 확인</option>
    <option value="selector_found">전용 선별 루틴 확인</option>
  </select></label>
</div>

<p id="event-summary" aria-live="polite">데이터를 읽는 중…</p>
<div id="event-list" class="event-list"></div>
<noscript>이벤트 검색에는 JavaScript가 필요합니다.</noscript>

<script>window.EVENT_DATA_URL = "{{ '/assets/data/events-ko.json' | relative_url }}";</script>
<script src="{{ '/assets/js/event-search-ko.js' | relative_url }}"></script>

<section class="publication-notice">
  <strong>비공식 팬 공략</strong>
  <p>게임과 관련 명칭의 권리는 각 권리자에게 있습니다. 공개 내용에 관한 권리자의 요청은 공개 저장소의 Issues를 통해 접수하며, 확인 후 수정 또는 공개 중단을 검토합니다.</p>
</section>
