#!/bin/bash
. /etc/profile.d/quizbot_path.sh

# yt-dlp PO Token(Proof-of-Origin) provider(bgutil-ytdlp-pot-provider) 설치 - install_quizbot3.sh(신규
# 설치)/quizbot_update.sh(기존 서버, 없으면 설치) 양쪽이 공유 호출한다. 유튜브가 봇 탐지를 강화하면서
# web/android 등 일부 클라이언트가 PO Token 없이는 403/format 없음으로 막히는 경우가 생겨(2026-08-18
# 확인) 도입 - yt-dlp는 필요할 때만 이 서버를 호출하고, 서버가 없거나 응답이 없어도 경고만 찍고 다른
# 클라이언트로 넘어가므로(fail-soft) 기존 동작을 해치지 않는 순수 보강 수단이다.
# 이미 설치돼 있으면(플러그인+서버 빌드 산출물 존재) 아무 것도 안 하고 조용히 종료 - 두 스크립트
# 어디서 호출해도 안전하게 매번 실행할 수 있음.
set -e

if [ -z "$QUIZBOT_PATH" ]; then
    echo "QUIZBOT_PATH is not set. Please set it before running the script."
    exit 1
fi

# 플러그인(.py)/서버(.js) 버전이 서로 짝이 맞아야 해서(release tag 기준) 고정 버전으로 받는다 -
# yt-dlp 최신 nightly 채널처럼 항상 최신을 자동 추종하지 않음(플러그인 쪽만 새 버전이 나와도 서버
# 쪽과 프로토콜이 안 맞으면 깨질 수 있어서, 버전을 올릴 땐 이 값을 손으로 갱신할 것).
POT_VERSION="1.3.1"
POT_USER="ubuntu"
POT_HOME="/home/$POT_USER"
PLUGIN_DIR="$POT_HOME/.config/yt-dlp/plugins/bgutil-ytdlp-pot-provider"
SERVER_ROOT="$POT_HOME/bgutil-ytdlp-pot-provider"
SERVER_DIR="$SERVER_ROOT/server"

if [ -d "$PLUGIN_DIR" ] && [ -d "$SERVER_DIR/build" ]; then
    echo "✅ PO Token provider(bgutil-ytdlp-pot-provider)가 이미 설치되어 있습니다. 건너뜁니다."
    exit 0
fi

echo "🔑 Installing yt-dlp PO Token provider (bgutil-ytdlp-pot-provider $POT_VERSION)..."

echo "📦 Installing build dependencies (unzip, canvas native module deps)..."
sudo apt install -y unzip build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

# yt-dlp 쪽 플러그인(파이썬) - PO Token이 필요한 요청이 왔을 때 이 서버를 호출하도록 yt-dlp에 알려주는
# 역할. node_modules/youtube-dl-exec/bin/ 밑이 아니라 홈 디렉터리 설정 경로(XDG plugin 디렉터리)에
# 둬야 npm install/git reset --hard(quizbot_update.sh)에 안 휩쓸림 - update_yt-dlp.sh가 yt-dlp
# 바이너리를 node_modules 밖으로 못 빼는 것과 반대로, 이건 애초에 node_modules 밖에 심는 방식.
echo "📥 Installing yt-dlp plugin to $PLUGIN_DIR ..."
sudo mkdir -p "$PLUGIN_DIR"
TMP_ZIP="/tmp/bgutil-ytdlp-pot-provider.zip"
sudo curl -Lo "$TMP_ZIP" "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/$POT_VERSION/bgutil-ytdlp-pot-provider.zip"
sudo unzip -o "$TMP_ZIP" -d "$PLUGIN_DIR"
sudo rm -f "$TMP_ZIP"

# 토큰 생성 서버(Node.js, HTTP 모드) - 플러그인의 server_home 기본 탐색 경로가 홈 디렉터리 바로
# 밑이라 그대로 맞춰서 클론한다.
echo "🛠  Cloning and building PO Token server..."
if [ ! -d "$SERVER_ROOT" ]; then
    sudo git clone --single-branch --branch "$POT_VERSION" https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$SERVER_ROOT"
fi
cd "$SERVER_DIR"
sudo npm ci
sudo npx tsc

# systemd 서비스 등록 (quizbot3.service와 동일 패턴 - User=ubuntu, Restart=on-failure). 경로에
# QUIZBOT_PATH 치환이 필요 없는 고정 유닛이라 sed 없이 그대로 복사.
echo "⚙️  Installing systemd service (bgutil-pot-provider)..."
SERVICE_SRC="$QUIZBOT_PATH/auto_script/systemd/bgutil-pot-provider.service"
SERVICE_TARGET="/etc/systemd/system/bgutil-pot-provider.service"
if [ -f "$SERVICE_SRC" ]; then
    sudo cp "$SERVICE_SRC" "$SERVICE_TARGET"
    sudo systemctl daemon-reload
    sudo systemctl enable --now bgutil-pot-provider
    echo "✅ bgutil-pot-provider.service installed, enabled and started (default port 4416)"
else
    echo "❌ systemd unit not found at $SERVICE_SRC. PO Token provider files are installed but the server is not running - install it manually."
fi

echo "🔧 Fixing ownership to $POT_USER..."
sudo chown -R "$POT_USER:$POT_USER" "$POT_HOME/.config/yt-dlp" "$SERVER_ROOT"

echo "✅ PO Token provider setup complete."
