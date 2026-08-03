# 구조 개편 작업 컨벤션

> `REFACTOR_PLAN.md`의 실행 세칙. 브랜치 전략과 커밋 컨벤션을 정의한다.

## 1. 브랜치 전략

```
master                 실제 운영 배포 브랜치
└─ develop             다음 배포를 위해 통합되는 브랜치
   └─ refactor/<name>  Phase(또는 서브 Phase) 단위 작업 브랜치
```

- 모든 리팩토링 작업은 `develop`에서 분기한 `refactor/<module-name>` 브랜치에서 진행한다.
- `<module-name>`은 대상 모듈/Phase를 짧게 나타내는 kebab-case. 예:
  - `refactor/phase0-setup` (현재 브랜치)
  - `refactor/tagged-dev-quiz-manager` (Phase 1)
  - `refactor/quiz-system-session`, `refactor/quiz-system-question` (Phase 2, 규모가 커서 서브 브랜치로 분할)
- 브랜치가 끝나면 `develop`으로 PR/병합한다. `master`로의 병합은 별도 릴리즈 절차를 따른다 (이 문서 범위 밖).
- 하나의 리팩토링 브랜치가 너무 커지면(리뷰 불가능한 크기) 망설이지 말고 더 작은 단위로 쪼갠다.

## 2. 커밋 컨벤션

기존 저장소 로그에서 관찰되는 관례(`설치 스크립트 수정 및 사소한 버그 수정`, `멘션 버그 수정, ...` 등 한국어 서술형 커밋)를 유지하되, 리팩토링 작업은 아래 prefix를 붙여 성격을 구분한다. **가장 중요한 규칙: 리팩토링(이동/분리) 커밋과 버그 수정 커밋은 절대 섞지 않는다** (REFACTOR_PLAN.md 2.3).

| Prefix | 용도 | 예시 |
|---|---|---|
| `refactor:` | 동작 변경 없는 구조 개편 (파일/함수 분리, 폴더 이동) | `refactor: quiz_system.js에서 QuizSession 계열 분리` |
| `fix:` | 리팩토링 중 발견한 버그의 실제 수정 | `fix: 점수 계산 시 음수 처리 안 되는 버그` |
| `test:` | 유닛테스트 추가/수정 (동작 변경 없음) | `test: MMR 계산 로직 유닛테스트 추가` |
| `docs:` | 문서 추가/수정 (`BUGS_FOUND.md`, `RELOCATED_COMMENTS.md` 갱신 포함) | `docs: Phase 1 버그 로그 기록` |
| `chore:` | 위 어디에도 속하지 않는 잡무 (설정 파일, 스크립트 등) | `chore: eslint.config.js 추가` |

- 커밋 메시지 본문은 기존 관례대로 한국어 사용 가능.
- 버그 수정 커밋은 본문에 **"수정 전 재현 조건 → 수정 내용"** 형태를 남긴다 (REFACTOR_PLAN.md 2.3). 예:
  ```
  fix: 힌트 자동 적용 조건에서 정답자 0명일 때 예외 발생

  재현: 멀티플레이 문제에서 제한시간 내 정답자가 한 명도 없으면
        자동 힌트 로직이 참가자 목록을 0으로 나눠 NaN 반환.
  수정: 참가자 0명인 경우 힌트 스킵하도록 가드 추가.
  ```
- 주석 이동으로 인해 `RELOCATED_COMMENTS.md`에 기록이 추가되는 커밋은 해당 `refactor:` 커밋에 포함하거나, 별도 `docs:` 커밋으로 바로 뒤따르게 한다.

## 3. Phase 단위 워크플로우 요약

`REFACTOR_PLAN.md` 3장의 8단계를 브랜치/커밋 관점에서 다시 정리:

1. `develop`에서 `refactor/<name>` 브랜치 생성
2. (커밋 없음) 대상 파일 책임/의존관계/스타일 관찰
3. `test:` 커밋 — 리팩토링 전 현재 동작 기준 유닛테스트 작성
4. `refactor:` 커밋(들) — 구조 개편, 동작 변경 없이
5. `docs:` 커밋 — `BUGS_FOUND.md` 기록 / `fix:` 커밋 — 국소 버그 즉시 수정
6. 유닛테스트 통과 + 테스트용 디스코드 서버 수동 검증 (커밋 아님)
7. `develop`으로 PR 생성 및 리뷰
8. 병합 후 운영 모니터링

## 4. PR 체크리스트 (develop 병합 전)

- [ ] 기존 주석 100% 보존 확인 (삭제된 경우 `RELOCATED_COMMENTS.md`에 기록됐는지)
- [ ] `npm run lint` 통과 (경고는 허용, 신규 에러 없어야 함)
- [ ] 해당 모듈 유닛테스트 통과
- [ ] `BUGS_FOUND.md`에 이번 작업 중 발견한 버그 기록 여부 확인
- [ ] 리팩토링 커밋과 버그 수정 커밋이 분리되어 있는지 확인
