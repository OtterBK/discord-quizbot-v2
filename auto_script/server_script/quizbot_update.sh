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

echo "🔄 Updating quizbot3 (branch: $CURRENT_BRANCH)..."

echo "⏹  Stopping quizbot3 service..."
sudo systemctl stop quizbot3

echo "⬇️  Fetching latest changes..."
sudo git fetch origin
if [ $? -ne 0 ]; then
    echo "❌ git fetch failed. Aborting without touching the running code."
    exit 1
fi

# private_config.json/resources/log/dist/node_modules는 전부 .gitignore 대상이라
# reset --hard로 건드리지 않음 (설정 값/캐시/빌드산출물은 그대로 유지됨)
echo "♻️  Resetting to origin/$CURRENT_BRANCH..."
sudo git reset --hard "origin/$CURRENT_BRANCH"
if [ $? -ne 0 ]; then
    echo "❌ git reset failed. Aborting without restarting the service."
    exit 1
fi

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

echo "▶️  Starting quizbot3 service..."
sudo systemctl start quizbot3

echo "✅ Update complete (branch: $CURRENT_BRANCH). 로그 확인: journalctl -u quizbot3 -f"
