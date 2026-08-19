#!/bin/bash

# Auto-switch to bash if not already running in bash
if [ -z "$BASH_VERSION" ]; then
    echo "🔁 This script requires bash. Re-running with bash..."
    exec bash "$0" "$@"
    exit
fi

# Emphasized output
print_emphasized() {
    echo -e "\e[1;32m$1\e[0m"
}

# Prompt for install path (Added -e for Tab completion)
while [ -z "$INSTALL_PATH" ]; do
    read -e -p "📁 Enter installation path (required): " INSTALL_PATH
    if [ ! -d "$INSTALL_PATH" ]; then
        echo "📂 Directory does not exist. Creating it now..."
        mkdir -p "$INSTALL_PATH"
        if [ $? -ne 0 ]; then
            echo "❌ Failed to create directory. Please check permissions or path."
            INSTALL_PATH=""
        else
            echo "✅ Directory created: $INSTALL_PATH"
        fi
    fi
done

# Node.js version (Default changed to 22)
read -p "🧩 Enter Node.js version (default: 22): " NODE_VERSION
NODE_VERSION="${NODE_VERSION:-22}"

# Branch selection (TS 마이그레이션이 반영된 branch를 골라 받을 수 있도록)
read -p "🌿 Enter branch to install (default: master): " BRANCH
BRANCH="${BRANCH:-master}"

# Cron registration
read -p "🔁 Do you want to register cron jobs? (y/N): " REGISTER_CRON_INPUT
if [[ "$REGISTER_CRON_INPUT" =~ ^[Yy]$ ]]; then
    REGISTER_CRON=true
else
    REGISTER_CRON=false
fi

# Database dump (Added -e for Tab completion)
read -e -p "🗄 If you have a database backup file (.sql), enter full path (or press Enter to use default base.sql): " BACKUP_FILE
if [ -n "$BACKUP_FILE" ] && [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ File not found. Will try to use default base.sql later."
    BACKUP_FILE=""
fi

# Swap memory
read -p "💾 Enter swap memory size (e.g., 8G, or leave empty to skip): " SWAP_MEM

# Start installation
print_emphasized "Updating package list..."
sudo apt update -y

# GCP 등 일부 클라우드 기본 이미지가 UTF-8이 아닌 locale(C/POSIX)로 떠 있는 경우가 있음 - 이 상태에서는
# resources/notices/ 등 한글 파일명이 `ls`에 물음표(?)로 깨져 보임(실제 파일 데이터는 UTF-8 그대로라
# 봇 동작 자체엔 영향 없지만, 관리자가 서버에서 직접 확인/조작할 때 혼란스러움 - 2026-08-15 발견).
print_emphasized "Ensuring UTF-8 locale (en_US.UTF-8)..."
sudo apt install -y locales
sudo locale-gen en_US.UTF-8
sudo update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

print_emphasized "Installing Net tools..."
sudo apt install net-tools -y 

print_emphasized "Installing PostgreSQL 14..."
sudo apt install postgresql-14 -y

print_emphasized "Creating user 'quizbot' with password 'changepasswd'..."
sudo -u postgres psql -c "CREATE USER quizbot WITH PASSWORD 'changepasswd';"

print_emphasized "Creating database 'quizbot3' owned by user 'quizbot'..."
sudo -u postgres psql -c "CREATE DATABASE quizbot3 WITH OWNER quizbot;"

print_emphasized "Allowing PostgreSQL to be accessed from outside..."
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/g" /etc/postgresql/14/main/postgresql.conf

print_emphasized "Restarting PostgreSQL..."
sudo service postgresql restart

print_emphasized "Installing Git..."
sudo apt install git -y

# Node.js install (Moved up)
print_emphasized "Installing Node.js $NODE_VERSION.x..."
curl -sL https://deb.nodesource.com/setup_$NODE_VERSION.x | sudo bash -
sudo apt remove libnode-dev -y
sudo apt remove libnode72:amd64 -y
sudo apt install nodejs -y

# 아래 git clone/npm install/npm run build 4곳은 실패해도 스크립트가 그냥 다음 줄로 넘어가던 곳들 -
# 끝까지 다 돌고 나서 맨 아래 "✅ Auto Setup Finished!"가 뜨는 바람에, 사실 절반쯤 깨진 설치인데도
# 성공한 것처럼 보일 수 있었음(2026-08-19 로깅 보강, quizbot_update.sh가 동일 단계들에 이미 적용해둔
# exit code 체크 관례를 여기도 맞춤). 실패하면 그 자리에서 바로 중단.
print_emphasized "Cloning Quizbot3 repository (branch: $BRANCH)..."
sudo git clone -b "$BRANCH" https://github.com/OtterBK/discord-quizbot-v2.git "$INSTALL_PATH"
if [ $? -ne 0 ]; then
    echo "❌ git clone failed. 설치를 중단합니다 - 브랜치 이름/네트워크 상태를 확인한 뒤 다시 실행하세요."
    exit 1
fi
cd "$INSTALL_PATH" || { echo "❌ Failed to cd into $INSTALL_PATH"; exit 1; }
sudo npm install
if [ $? -ne 0 ]; then
    echo "❌ npm install failed. 설치를 중단합니다."
    exit 1
fi
echo "   → npm install ✅"
sudo cp -R custom_node_modules/* node_modules/

# TS로 전환된 소스는 dist/ 로 빌드해야 node가 바로 require할 수 있음(.ts는 직접 못 읽음)
print_emphasized "Building TypeScript sources (npm run build)..."
sudo npm run build
if [ $? -ne 0 ]; then
    echo "❌ npm run build failed. 설치를 중단합니다 - 빌드 에러를 고친 뒤 다시 실행하세요."
    exit 1
fi
echo "   → TypeScript build ✅"

# web-frontend/는 루트와 별개의 독립 프로젝트(React+Vite, 별도 package.json)라 위 루트 npm run build로는
# 안 만들어짐 - 빌드 산출물(web-frontend/dist/)이 없으면 웹 UI 접속 시 "Cannot GET /"만 뜸(2026-08-15 발견)
print_emphasized "Building web-frontend (React+Vite)..."
cd "$INSTALL_PATH/web-frontend" || { echo "❌ Failed to cd into web-frontend"; exit 1; }
sudo npm install
if [ $? -ne 0 ]; then
    echo "❌ web-frontend npm install failed. 설치를 중단합니다."
    exit 1
fi
sudo npm run build
if [ $? -ne 0 ]; then
    echo "❌ web-frontend npm run build failed. 설치를 중단합니다 - 빌드 에러를 고친 뒤 다시 실행하세요."
    exit 1
fi
echo "   → web-frontend build ✅"
cd "$INSTALL_PATH" || { echo "❌ Failed to cd back into $INSTALL_PATH"; exit 1; }

# git clone/npm install/npm run build를 전부 sudo로 실행해서 여기까지는 디렉터리 전체가 root 소유임 -
# quizbot3.service는 User=ubuntu로 도는데(systemd 템플릿 참고) 파일이 root 소유로 남으면 나중에
# 그 파일을 쓰거나 지우는 동작(예: /quizmgr 공지 삭제)이 EACCES로 실패함(2026-08-15 발견). 이 스크립트
# 자체가 `sudo bash install_quizbot3.sh`로 통째로 실행되는 걸 전제하므로(정석 사용법.txt 참고)
# "$(id -u):$(id -g)"는 이미 root(0:0)라 되돌리기가 안 됨 - cron 등록(-u ubuntu)/systemd
# 템플릿(User=ubuntu)과 동일하게 ubuntu로 고정.
print_emphasized "Fixing ownership of $INSTALL_PATH to ubuntu..."
sudo chown -R ubuntu:ubuntu "$INSTALL_PATH"

print_emphasized "Quizbot3 has been installed!"

# Set environment variable
print_emphasized "Setting QUIZBOT_PATH globally..."

PROFILE_SCRIPT="/etc/profile.d/quizbot_path.sh"
sudo sh -c "echo 'export QUIZBOT_PATH=\"$INSTALL_PATH\"' > $PROFILE_SCRIPT"
sudo chmod 644 $PROFILE_SCRIPT

# 현재 터미널 세션에도 즉시 적용
export QUIZBOT_PATH="$INSTALL_PATH"
print_emphasized "QUIZBOT_PATH is set to: $QUIZBOT_PATH (system-wide)"

# npm install로 받은 youtube-dl-exec 번들 yt-dlp는 오래된 버전일 수 있음 - cron을 등록해도 다음 스케줄
# (9시/21시)까지 기다려야 하므로, 설치 직후 한 번 바로 최신으로 갱신해둔다(2026-08-15 추가).
# update_yt-dlp.sh가 QUIZBOT_PATH를 요구하므로 반드시 위 export 이후에 실행해야 함.
print_emphasized "Fetching latest yt-dlp..."
bash "$INSTALL_PATH/auto_script/server_script/update_yt-dlp.sh"
# 바이너리가 실제로 실행 가능한 상태인지까지 확인(quizbot_update.sh와 동일 패턴, 2026-08-19 로깅
# 보강) - curl 다운로드가 조용히 깨진 파일을 받아도 이전엔 "완료했다"는 echo만 믿고 넘어갔음.
YT_DLP_BIN="$INSTALL_PATH/node_modules/youtube-dl-exec/bin/yt-dlp"
if [ -x "$YT_DLP_BIN" ]; then
    YT_DLP_STATUS="✅ $("$YT_DLP_BIN" --version 2>/dev/null || echo '설치는 됐지만 --version 실행 실패')"
else
    YT_DLP_STATUS="❌ 바이너리를 찾을 수 없음 ($YT_DLP_BIN)"
fi
echo "   → yt-dlp: $YT_DLP_STATUS"

# yt-dlp가 봇 탐지에 막힌 클라이언트를 만났을 때만 보조로 쓰는 PO Token provider(2026-08-18 도입) -
# 없어도 기존 다운로드 동작엔 영향 없는 순수 보강 수단이라 설치 실패해도 스크립트를 중단하진 않는다.
print_emphasized "Installing yt-dlp PO Token provider..."
bash "$INSTALL_PATH/auto_script/server_script/setup_pot_provider.sh" || echo "⚠️  PO Token provider setup failed - yt-dlp will still work without it, just without this fallback."
# 설치 스크립트 자체 출력이 길어서(빌드 로그 등) 실제로 서비스가 떴는지 맨 마지막에 한 줄로 다시
# 확인해줌(2026-08-19 로깅 보강, quizbot_update.sh와 동일 패턴).
if systemctl is-active --quiet bgutil-pot-provider 2>/dev/null; then
    PO_TOKEN_STATUS="✅ bgutil-pot-provider.service active"
else
    PO_TOKEN_STATUS="⚠️  bgutil-pot-provider.service가 active 상태가 아님 (sudo systemctl status bgutil-pot-provider로 확인)"
fi
echo "   → PO Token provider: $PO_TOKEN_STATUS"

# Restore DB after Git clone
if [ -z "$BACKUP_FILE" ]; then
    DEFAULT_BACKUP="$INSTALL_PATH/auto_script/db_backup/base.sql"
    if [ -f "$DEFAULT_BACKUP" ]; then
        echo "📄 No backup file specified. Using default: $DEFAULT_BACKUP"
        BACKUP_FILE="$DEFAULT_BACKUP"
    else
        echo "❌ No backup file and default base.sql not found. Skipping DB restore."
        BACKUP_FILE=""
    fi
fi

if [ -n "$BACKUP_FILE" ]; then
    print_emphasized "Restoring database from backup: $BACKUP_FILE"
    TMP_FILE="/tmp/$(basename "$BACKUP_FILE")"
    cp "$BACKUP_FILE" "$TMP_FILE"
    sudo -u postgres psql -d quizbot3 -f "$TMP_FILE"
    if [ $? -ne 0 ]; then
        # psql -f는 SQL 중간에 에러가 나도 나머지 문장은 계속 실행하는 경우가 많아 exit code만으로
        # "완전 실패"인지 "일부만 실패"인지 구분은 안 되지만, 최소한 뭔가 문제가 있었다는 신호는
        # 남겨야 함(2026-08-19 로깅 보강 - 이전엔 실패해도 아무 표시 없이 다음 단계로 넘어갔음).
        DB_RESTORE_STATUS="⚠️  일부 에러 발생 - 위 psql 출력을 확인하세요"
        echo "⚠️  DB restore에서 에러가 발생했습니다. 위 psql 출력을 확인하세요 (일부 문장만 실패했을 수도 있음)."
    else
        DB_RESTORE_STATUS="✅ $(basename "$BACKUP_FILE")"
    fi
    rm "$TMP_FILE"
else
    DB_RESTORE_STATUS="⏭️  건너뜀 (백업 파일 없음)"
fi

# systemd service setup (start/stop 스크립트가 이 유닛을 systemctl로 제어함)
print_emphasized "Installing systemd service (quizbot3)..."
SERVICE_TEMPLATE="$INSTALL_PATH/auto_script/systemd/quizbot3.service.template"
SERVICE_TARGET="/etc/systemd/system/quizbot3.service"
if [ -f "$SERVICE_TEMPLATE" ]; then
    sudo sh -c "sed 's|__QUIZBOT_PATH__|$INSTALL_PATH|g' '$SERVICE_TEMPLATE' > '$SERVICE_TARGET'"
    sudo systemctl daemon-reload
    sudo systemctl enable quizbot3
    print_emphasized "quizbot3.service installed and enabled (run quizbot_start.sh to start it)"
    SERVICE_STATUS="✅ enabled (아직 시작은 안 함)"
else
    echo "❌ systemd template not found at $SERVICE_TEMPLATE. Skipping service setup."
    SERVICE_STATUS="❌ 템플릿을 못 찾아 건너뜀 ($SERVICE_TEMPLATE)"
fi

# Cron setup
if [ "$REGISTER_CRON" = true ]; then
    print_emphasized "Installing and starting cron service..."
    sudo timedatectl set-timezone Asia/Seoul
    sudo apt install cron -y
    sudo service cron start

    SCRIPT_PATH="$QUIZBOT_PATH/auto_script"

    print_emphasized "Registering cron jobs..."
    (crontab -l -u ubuntu 2>/dev/null; echo "CRON_TZ=Asia/Seoul") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 * * * * sudo -E bash $SCRIPT_PATH/server_script/drop_ffmpeg.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 9,21 * * * bash $SCRIPT_PATH/server_script/quizbot_stop.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 9,21 * * * bash $SCRIPT_PATH/server_script/update_yt-dlp.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "1 9,21 * * * bash $SCRIPT_PATH/server_script/quizbot_start.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 0 * * 1 sudo -E bash $SCRIPT_PATH/db_script/reset_played_count_of_week.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 8,20 * * * sudo -E bash $SCRIPT_PATH/db_script/backup_script.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 */3 * * * sudo sync && sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'") | sudo crontab -u ubuntu -
    # 방금 등록한 줄 수를 세어 "정말 등록됐는지"를 한 줄로 확인(2026-08-19 로깅 보강) - crontab 파이프
    # 체인 중간에 하나라도 조용히 실패하면 이전엔 알 방법이 없었음.
    CRON_JOB_COUNT=$(crontab -l -u ubuntu 2>/dev/null | grep -c "server_script\|db_script\|drop_caches")
    CRON_STATUS="✅ ${CRON_JOB_COUNT}개 작업 등록됨 (crontab -l -u ubuntu로 확인 가능)"
    echo "   → cron: $CRON_STATUS"
else
    CRON_STATUS="⏭️  건너뜀 (등록 안 함)"
fi

# Swap setup
if [ -n "$SWAP_MEM" ]; then
    print_emphasized "Setting up swap memory: $SWAP_MEM"
    SWAPFILE="/swapfile"
    if [ -e "$SWAPFILE" ]; then
        echo "Swapfile already exists. Skipping..."
    else
        sudo fallocate -l "$SWAP_MEM" "$SWAPFILE"
        sudo chmod 600 "$SWAPFILE"
        sudo mkswap "$SWAPFILE"
        sudo swapon "$SWAPFILE"
        echo "$SWAPFILE none swap sw 0 0" | sudo tee -a /etc/fstab
        sudo swapon --show
    fi
fi

# 설치 과정에서 확인한 핵심 상태를 한 번에 요약 - 스크립트가 워낙 길어서(패키지 설치/DB/빌드/yt-dlp/
# PO Token/systemd/cron 등) 전체 로그를 다시 스크롤하지 않아도 뭐가 됐는지 한눈에 확인 가능하게 함
# (2026-08-19 로깅 보강, quizbot_update.sh와 동일 패턴).
echo ""
echo "======================================================"
print_emphasized "✅ Quizbot3 Auto Setup Finished!"
echo "------------------------------------------------------"
echo "   install path   : $INSTALL_PATH"
echo "   branch         : $BRANCH"
echo "   node version   : $(node -v 2>/dev/null || echo '확인 실패')"
echo "   yt-dlp         : $YT_DLP_STATUS"
echo "   PO Token       : $PO_TOKEN_STATUS"
echo "   DB restore     : $DB_RESTORE_STATUS"
echo "   systemd service: $SERVICE_STATUS"
echo "   cron jobs      : $CRON_STATUS"
echo "======================================================"
echo ""
echo "   다음 단계: private_config.json 복원 후 아래 명령으로 봇 시작"
echo "   bash $INSTALL_PATH/auto_script/server_script/quizbot_start.sh"