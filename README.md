# 천년가족 한국어 공략 HTML

이 폴더는 GitHub Pages에 공개할 수 있는 정적 HTML/Jekyll 자료입니다. ROM 파일,
일본어 원문, 원본 그래픽, 세이브 및 상태저장 파일은 포함하지 않습니다. 공개 화면은
직접 작성한 한국어 조건 분석과 한국어 번역 데이터를 사용합니다. 번역 이벤트 읽기
기능을 위해 `assets/data/event-scripts-ko.json`에는 한국어 이벤트 대사와 표시 제어
토큰이 포함되어 있습니다.

이 저장소는 비공식·비영리 팬 공략이며 Nintendo 및 게임의 권리자와 관계가 없습니다.
저작권·상표권 등 권리는 각 권리자에게 있습니다. 공개 내용에 관한 권리자의 요청이
접수되면 해당 자료를 검토하고 필요하면 수정하거나 공개를 중단합니다. 자세한 공개
범위와 요청 방법은 `COPYRIGHT.md`를 확인하십시오.

## 페이지

- `preview.html`: 5,393개 이벤트를 한국어 제목·조건·UID로 검색하는 로컬 페이지
- `events/index.md`: GitHub Pages용 이벤트 검색 페이지
- `predictor.html`: 실행 직전 값과 아이템·화살 선택에 따른 이벤트 결과 예측 페이지
- `family-predictor.html`: 사용자가 선택한 세이브를 브라우저 안에서만 해석하고 인물별 아이템 사용 전후를 비교하는 가족 예측 페이지
- `assets/data/predictor-events.json`: 예측 이벤트·입력 필드·화살 효과·분기 정의
- `assets/data/item-effects.json`: 능력치 고리 등 예정 이벤트 판정에 영향을 줄 수 있는 아이템의 한국어 파생 데이터

예측기는 입력칸과 계산 대상을 JSON 정의에서 생성합니다. 나중에 운·체력 등 새 능력치가
판정에 관여하는 것으로 확인되면 `field_catalog`와 해당 이벤트의 `fields` 및 판정 정의를
추가하는 방식으로 확장할 수 있습니다. 화면 마크업을 이벤트마다 다시 만들 필요가 없습니다.

## 한국어 공개 데이터 다시 만들기

프로젝트 루트에서 아래 명령을 실행합니다.

```powershell
python analysis/build_public_korean_guide.py
```

이 명령은 이미 생성된 내부 분석 JSON과 한국어 번역 결과를 읽어
`guide_wiki/assets/data/events-ko.json`을 만듭니다. ROM은 읽거나 변경하지 않습니다.
원문과 제어코드를 포함한 기존 내부 자료는 프로젝트의 `analysis/event_wiki/`에 보관하여
공개 HTML 폴더와 물리적으로 분리합니다.

아이템 효과 데이터는 다음 명령으로 별도 갱신합니다.

```powershell
python analysis/build_item_effect_data.py
```

고리류는 해당 능력치를 한 등급(+800, 최대 5000) 올린 뒤 확률을 다시 계산합니다.
하트 열매나 사랑의 고리처럼 효과는 확인됐지만 현재 공개 입력에 대응하는 내부값이 없는
아이템은 효과 설명과 미반영 사유를 함께 표시합니다.

## 로컬에서 보기

`run_preview.bat`을 실행하고 `http://127.0.0.1:8765/preview.html`을 엽니다. 예측기는
`http://127.0.0.1:8765/predictor.html`에서 볼 수 있습니다.

## GitHub Pages에 올리기

1. 이 폴더의 공개 파일을 저장소 루트에 복사합니다.
2. 저장소 Settings → Pages에서 `Deploy from a branch`를 선택합니다.
3. 공개 브랜치의 `/ (root)`를 선택합니다.

`analysis/event_wiki/events_with_source_legacy.json`은 내부 참고 파일이며 공개 폴더에
복사하지 않습니다.

공개 저장소에는 `*.gba`, `*.sav`, `*.ss0~*.ss9`, 원본 그래픽과 로컬 미리보기 로그를
추가하지 마십시오. GBA 업로드나 ROM 추출 기능도 이 공개 사이트에 포함하지 않습니다.
