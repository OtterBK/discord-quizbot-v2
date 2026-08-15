#!/bin/bash
. /etc/profile.d/quizbot_path.sh

if [ -z "$QUIZBOT_PATH" ]; then
    echo "QUIZBOT_PATH is not set. Please set it before running the script."
    exit 1
fi

cd "$QUIZBOT_PATH" || { echo "❌ Failed to cd into $QUIZBOT_PATH"; exit 1; }

# 운영 업데이트는 develop/master에서만 - develop-claude 등 작업용 브랜치에서 실수로 돌리는 것 방지
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "develop" ] && [ "$CURRENT_BRANCH" != "master" ]; then
    echo "⚠️  현재 브랜치가 '$CURRENT_BRANCH' 입니다. 운영 업데이트는 develop 또는 master 브랜치에서만 실행하세요."
    exit 1
fi

# develop에서 검증 끝난 뒤 master로 전환해서 운영하는 시나리오 지원(2026-08-15 추가) - 기본값은 현재
# 브랜치 유지(Enter만 치면 됨), develop/master 중 다른 쪽을 입력하면 그쪽으로 전환 후 업데이트.
read -p "🌿 업데이트할 브랜치를 입력하세요 (develop/master, 기본값: 현재 브랜치 '$CURRENT_BRANCH'): " TARGET_BRANCH
TARGET_BRANCH="${TARGET_BRANCH:-$CURRENT_BRANCH}"

if [ "$TARGET_BRANCH" != "develop" ] && [ "$TARGET_BRANCH" != "master" ]; then
    echo "❌ '$TARGET_BRANCH'는 지원하지 않는 브랜치입니다. develop 또는 master만 입력하세요."
    exit 1
fi

echo "🔄 Updating quizbot3 (branch: $TARGET_BRANCH)..."

echo "⏹  Stopping quizbot3 service..."
sudo systemctl stop quizbot3

echo "⬇️  Fetching latest changes..."
sudo git fetch origin
if [ $? -ne 0 ]; then
    echo "❌ git fetch failed. Aborting without touching the running code."
    exit 1
fi

if [ "$TARGET_BRANCH" != "$CURRENT_BRANCH" ]; then
    echo "🔀 Switching branch: $CURRENT_BRANCH → $TARGET_BRANCH..."
    sudo git checkout "$TARGET_BRANCH"
    if [ $? -ne 0 ]; then
        echo "❌ git checkout failed. Aborting without touching the running code."
        exit 1
    fi
fi

# config/system_setting.js는 private_config.json과 달리 .gitignore 대상이 아니라서 git reset --hard가
# 그대로 덮어씀 - 서버별로 로컬에서 직접 고친 값(예: WEB_SERVER_PORT)이 있으면 업데이트할 때마다
# 조용히 원복될 뻔했음(2026-08-15 발견). private_config.json과 동일하게 "서버의 현재 값이 항상 우선"
# 취급 - reset 전에 백업해뒀다가 reset 후 그대로 복원. 주의: 이 방식이면 코드 쪽에서 새로 추가한
# SYSTEM_CONFIG 필드는 이 파일에 자동으로 안 들어옴 - 새 필드가 필요하면 origin의 최신 파일과 비교해서
# 수동으로 병합할 것.
CONFIG_BACKUP="/tmp/quizbot_system_setting_backup_$$.js"
cp "config/system_setting.js" "$CONFIG_BACKUP"

# private_config.json/resources/log/dist/node_modules는 전부 .gitignore 대상이라
# reset --hard로 건드리지 않음 (설정 값/캐시/빌드산출물은 그대로 유지됨)
echo "♻️  Resetting to origin/$TARGET_BRANCH..."
sudo git reset --hard "origin/$TARGET_BRANCH"
if [ $? -ne 0 ]; then
    echo "❌ git reset failed. Aborting without restarting the service."
    rm -f "$CONFIG_BACKUP"
    exit 1
fi

echo "🔒 Restoring local config/system_setting.js (로컬 커스터마이징 값 유지)..."
sudo cp "$CONFIG_BACKUP" "config/system_setting.js"
rm -f "$CONFIG_BACKUP"

echo "📦 Installing dependencies..."
sudo npm install
if [ $? -ne 0 ]; then
    echo "❌ npm install failed. Aborting without restarting the service."
    exit 1
fi

echo "🩹 Reapplying custom_node_modules patches..."
sudo cp -R custom_node_modules/* node_modules/

# TS로 전환된 소스는 dist/ 로 빌드해야 node가 바로 require할 수 있음(.ts는 직접 못 읽음) - 이 단계를
# 건너뛰면 낡은 dist/가 그대로 남아 업데이트가 반영 안 된 것처럼 보이거나, 최악의 경우 require 시점에
# 크래시할 수 있음(전환된 매니저는 원본 .js가 이미 삭제돼 있음)
echo "🔨 Building TypeScript sources (npm run build)..."
sudo npm run build
if [ $? -ne 0 ]; then
    echo "❌ npm run build failed. 서비스를 시작하지 않고 종료합니다 - dist/는 이전 빌드 상태로 남아있으니, 빌드 에러를 고친 뒤 이 스크립트를 다시 실행하세요."
    exit 1
fi

# web-frontend/는 루트와 별개의 독립 프로젝트(React+Vite, 별도 package.json)라 위 루트 npm run build로는
# 안 만들어짐 - 건너뛰면 웹 UI가 이전 빌드 그대로 남거나(신규 설치 직후엔 아예 없어서) "Cannot GET /"만
# 뜨게 됨(2026-08-15 발견)
echo "🔨 Building web-frontend (React+Vite)..."
cd "$QUIZBOT_PATH/web-frontend" || { echo "❌ Failed to cd into web-frontend"; exit 1; }
sudo npm install
if [ $? -ne 0 ]; then
    echo "❌ web-frontend npm install failed. 서비스를 시작하지 않고 종료합니다."
    exit 1
fi
sudo npm run build
if [ $? -ne 0 ]; then
    echo "❌ web-frontend npm run build failed. 서비스를 시작하지 않고 종료합니다 - web-frontend/dist/는 이전 빌드 상태로 남아있으니, 빌드 에러를 고친 뒤 이 스크립트를 다시 실행하세요."
    exit 1
fi
cd "$QUIZBOT_PATH" || { echo "❌ Failed to cd back into $QUIZBOT_PATH"; exit 1; }

# git fetch/reset/npm install/npm run build를 전부 sudo로 실행해서 여기까지 손댄 파일이 root 소유로
# 남아있음 - quizbot3.service는 User=ubuntu로 도는데, 파일이 root 소유면 그 파일을 쓰거나 지우는
# 동작(예: /quizmgr 공지 삭제)이 EACCES로 실패함(2026-08-15 발견 - resources/notices/의 git 추적
# 파일을 봇이 못 지우던 문제). install_quizbot3.sh 설치 시점에도 같은 문제가 있어 같이 고침.
echo "🔧 Fixing ownership back to ubuntu:ubuntu..."
sudo chown -R ubuntu:ubuntu "$QUIZBOT_PATH"

# 업데이트 직후 자동 재시작하지 않음(2026-08-15 변경) - 빌드/설정에 문제가 없는지 확인할 시간 없이
# 바로 재시작되던 게 위험하다는 피드백. 확인 후 quizbot_start.sh로 직접 시작할 것.
echo "✅ Update complete (branch: $TARGET_BRANCH)."
echo "   서비스는 자동으로 시작되지 않습니다 - 확인 후 아래 명령으로 직접 시작하세요:"
echo "   sh $QUIZBOT_PATH/auto_script/server_script/quizbot_start.sh"
echo "   (또는: sudo systemctl start quizbot3)"
echo "   로그 확인: journalctl -u quizbot3 -f"
