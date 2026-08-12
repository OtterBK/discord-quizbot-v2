#!/bin/bash
# develop-claude(Claude와의 바이브코딩 브랜치)의 변경사항을 develop(실서버 전수 테스트 브랜치)로
# 반영하는 헬퍼. 단순 git merge만 하면 develop에서 지워둔 CLAUDE.md/docs/plans 등이 develop-claude
# 쪽에서 "새로 추가된 파일"로 다시 생길 때 조용히 같이 병합돼버릴 수 있어서(기존 파일 수정은
# modify/delete 충돌로 걸리지만, 신규 파일은 충돌 없이 그냥 들어옴), 병합 후 매번 같은 제외 목록을
# 다시 적용하는 스크립트로 고정해둔다. 제외 목록이 바뀌면 EXCLUDE_PATHS만 갱신하면 됨.
set -e

if [ -z "$BASH_VERSION" ]; then
    exec bash "$0" "$@"
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "develop-claude" ]; then
    echo "❌ develop-claude 브랜치에서 실행하세요 (현재: $CURRENT_BRANCH)"
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "❌ 작업 트리에 커밋 안 된 변경사항이 있습니다. 먼저 커밋하거나 stash 하세요."
    exit 1
fi

# develop에는 있으면 안 되는 경로 목록 (develop 브랜치 정리 커밋과 동일하게 유지할 것)
EXCLUDE_PATHS=(
    "CLAUDE.md"
    "config/CLAUDE.md"
    "quizbot/managers/CLAUDE.md"
    "quizbot/managers/db/CLAUDE.md"
    "quizbot/managers/report/CLAUDE.md"
    "quizbot/quiz_option/CLAUDE.md"
    "quizbot/quiz_system/CLAUDE.md"
    "quizbot/quiz_ui/CLAUDE.md"
    "quizbot/quiz_ui/components/CLAUDE.md"
    "utility/CLAUDE.md"
    "docs/ACTIVE_PLAN.md"
    "docs/COMPLETED_WORK_LOG.md"
    "docs/plans"
    "docs/archive"
    "docs/mockups"
    "dev_tools"
)

echo "🔀 Switching to develop..."
git checkout develop

echo "🔀 Merging develop-claude (--no-commit, so we can re-apply the exclude list before committing)..."
if ! git merge develop-claude --no-commit --no-ff; then
    echo "⚠️  병합 충돌 발생 — 수동으로 해결한 뒤, 아래 제외 목록 제거 단계부터 다시 실행하세요:"
    printf '   git rm -rf --ignore-unmatch %s\n' "${EXCLUDE_PATHS[@]}"
    echo "   git commit"
    exit 1
fi

echo "🧹 Re-applying develop-only exclusions..."
git rm -rf --ignore-unmatch "${EXCLUDE_PATHS[@]}" > /dev/null

if git diff --cached --quiet; then
    echo "ℹ️  변경사항 없음 (이미 최신 상태)."
    git merge --abort 2>/dev/null || true
    git checkout develop-claude
    exit 0
fi

git commit -m "chore: sync from develop-claude (auto-excluded CLAUDE.md/docs)"

echo "✅ develop 갱신 완료. develop-claude로 돌아갑니다..."
git checkout develop-claude

echo "✅ Done."
