# UI 컴포넌트 중복/죽은 코드 후보 목록

> REFACTOR_PLAN.md Phase 4(`quiz_ui/components.js` 분리) 진행 중 발견한, "중복 UI 생성 로직 통합" 대상 후보와 죽은 export를 기록한다.
> 사용자 결정(2026-08-04): Phase 4는 **구조 분리만** 먼저 진행하고, 아래 통합/삭제 작업은 이 문서에 기록만 해두고 별도 논의 후 처리한다.
> 대상 파일(분리 후): `quizbot/quiz_ui/components/base_components.js`, `custom_quiz_components.js`, `omakase_components.js`, `multiplayer_components.js`, `report_components.js`.

## 죽은 export (사용처 없음)

- `note_ui_component` (`base_components.js`) — 저장소 전체에서 이 이름을 import/구조분해하는 곳이 없음. 삭제 후보지만, `@Deprecated` 표기 없이 조용히 죽은 코드라 실수로 빠진 건지 의도적으로 남겨둔 건지 불분명 — 삭제 전 원 개발자(사용자) 확인 필요.
- `createOptionValueComponents` (`base_components.js`) — 외부에서 import하는 곳 없음, `option_value_components` 객체를 만들 때 파일 내부에서만 쓰임. 함수 자체를 export할 필요가 없어 보이지만, export를 없애면 소비하는 곳이 20개 파일 중 어딘가 구조분해로 끌어다 쓰고 있을 가능성을 다시 한번 grep으로 재확인 후 처리.

## 중복 UI 생성 로직 후보 (통합 대상)

1. **번호 버튼 로우** — `select_btn_component`(1~5)와 `select_btn_component2`(6~10)가 거의 동일한 구조(커스텀 아이디만 다름)로 두 번 하드코딩됨. 반복문으로 생성하는 헬퍼로 통합 가능.
2. **컨트롤 버튼 그룹(태그/장바구니 변형)** — "시작/퀴즈 설정/서버 설정/뒤로가기" 패턴의 버튼 그룹이 태그 모드·장바구니 모드 등 변형까지 포함해 5곳에서 반복(`quiz_info_comp`, `omakase_quiz_info_tag_comp`, `omakase_quiz_info_basket_comp` 등).
3. **동적 태그 select menu 생성 루프** — `Object.entries(QUIZ_TAG)`/`DEV_QUIZ_TAG`를 순회하며 옵션을 채우는 동일 패턴의 for문이 5곳에서 반복(`quiz_tags_select_menu`, `quiz_search_tags_select_menu`, `omakase_dev_quiz_tags_select_menu`, `omakase_custom_quiz_type_tags_select_menu`, `omakase_custom_quiz_tags_select_menu`).
4. **로딩 placeholder select row 패턴** — "계산/불러오는 중..." 같은 임시 옵션 하나만 있는 select row가 3곳에서 반복(`page_select_row`, `omakase_basket_select_row` 등).
5. **`omakase_basket_select_menu` / `omakase_basket_readonly_select_menu`** — customId만 다르고 나머지가 거의 동일한 쌍.
6. **"인증된 퀴즈 필터를 끌까요?" 텍스트 입력** — 동일한 라벨/설정의 TextInput이 3곳에서 반복.
7. **"방 제목을 입력해주세요." 텍스트 입력** — 동일한 라벨/설정의 TextInput이 2곳에서 반복.
8. **`selected_question_count` 필드** — "몇 개의 문제를 제출할까요?" TextInput이 거의 동일한 설정으로 4곳에서 반복(`modal_quiz_setting`, `modal_omakase_quiz_setting`, `modal_multiplayer_quiz_setting` 등).
9. **모달 보일러플레이트** — "ActionRow 하나에 TextInput 하나"만 감싸는 패턴이 12개 모달 전체에서 반복. 공통 헬퍼(`wrapTextInput(customId, label, ...)` 등)로 줄일 수 있어 보임.
10. **`//#region OMAKASE QUIZ` 미스매치** — `omakase_components.js`(원본 components.js 기준 725~918줄 구간)에 `//#region OMAKASE QUIZ`가 있는데 대응하는 `//#endregion`이 없음(바깥쪽 `//#region 오마카세 퀴즈 관련 컴포넌트`의 `//#endregion`만 있음). 리전 중첩이 깨진 상태로, 실제 동작에는 영향 없지만 정리 대상.

## 비고

- 위 항목 대부분은 discord.js 빌더가 **롱리브드 싱글턴 인스턴스**로 선언되고 소비 측에서 `cloneDeep()` 후 사용하는 기존 패턴과 맞물려 있어, 통합 시 "공유 인스턴스를 헬퍼가 매번 새로 만들어도 되는지" 확인이 필요함 (기존 패턴을 깨뜨리지 않도록 주의).
- `modal_quiz_setting` / `modal_omakase_quiz_setting` / `modal_multiplayer_quiz_setting`은 항목 8과 겹치지만, 세 모달이 의도적으로 같은 `customId: 'modal_quiz_setting'`을 공유해 동일 핸들러(`applyQuizSetting`)로 라우팅되는 부분(원본 주석 "modal_quiz_setting으로 해둬야. applyQuizSetting이 호출됨")은 통합 시 절대 깨지면 안 되는 제약으로 별도 유의.
