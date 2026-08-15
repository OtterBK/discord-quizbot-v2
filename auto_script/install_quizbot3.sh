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

print_emphasized "Cloning Quizbot3 repository (branch: $BRANCH)..."
sudo git clone -b "$BRANCH" https://github.com/OtterBK/discord-quizbot-v2.git "$INSTALL_PATH"
cd "$INSTALL_PATH"
sudo npm install
sudo cp -R custom_node_modules/* node_modules/

# TS로 전환된 소스는 dist/ 로 빌드해야 node가 바로 require할 수 있음(.ts는 직접 못 읽음)
print_emphasized "Building TypeScript sources (npm run build)..."
sudo npm run build

# web-frontend/는 루트와 별개의 독립 프로젝트(React+Vite, 별도 package.json)라 위 루트 npm run build로는
# 안 만들어짐 - 빌드 산출물(web-frontend/dist/)이 없으면 웹 UI 접속 시 "Cannot GET /"만 뜸(2026-08-15 발견)
print_emphasized "Building web-frontend (React+Vite)..."
cd "$INSTALL_PATH/web-frontend"
sudo npm install
sudo npm run build
cd "$INSTALL_PATH"

# git clone/npm install/npm run build를 전부 sudo로 실행해서 여기까지는 디렉터리 전체가 root 소유임
# 이후 사용자가 직접 npm run build 등을 실행할 수 있도록 실행 유저 소유로 되돌림
print_emphasized "Fixing ownership of $INSTALL_PATH to current user..."
sudo chown -R "$(id -u):$(id -g)" "$INSTALL_PATH"

print_emphasized "Quizbot3 has been installed!"

# Set environment variable
print_emphasized "Setting QUIZBOT_PATH globally..."

PROFILE_SCRIPT="/etc/profile.d/quizbot_path.sh"
sudo sh -c "echo 'export QUIZBOT_PATH=\"$INSTALL_PATH\"' > $PROFILE_SCRIPT"
sudo chmod 644 $PROFILE_SCRIPT

# 현재 터미널 세션에도 즉시 적용
export QUIZBOT_PATH="$INSTALL_PATH"
print_emphasized "QUIZBOT_PATH is set to: $QUIZBOT_PATH (system-wide)"


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
    rm "$TMP_FILE"
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
else
    echo "❌ systemd template not found at $SERVICE_TEMPLATE. Skipping service setup."
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
    (crontab -l -u ubuntu 2>/dev/null; echo "0 * * * * sudo -E sh $SCRIPT_PATH/server_script/drop_ffmpeg.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 9,21 * * * sh $SCRIPT_PATH/server_script/quizbot_stop.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 9,21 * * * sh $SCRIPT_PATH/server_script/update_yt-dlp.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "1 9,21 * * * sh $SCRIPT_PATH/server_script/quizbot_start.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 0 * * 1 sudo -E sh $SCRIPT_PATH/db_script/reset_played_count_of_week.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 8,20 * * * sudo -E sh $SCRIPT_PATH/db_script/backup_script.sh") | sudo crontab -u ubuntu -
    (crontab -l -u ubuntu 2>/dev/null; echo "0 */3 * * * sudo sync && sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'") | sudo crontab -u ubuntu -
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

print_emphasized "✅ Quizbot3 Auto Setup Finished!"