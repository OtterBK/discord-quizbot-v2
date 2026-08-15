#!/bin/bash
. /etc/profile.d/quizbot_path.sh

# Get the INSTALL_PATH environment variable (QUIZBOT_PATH)
if [ -z "$QUIZBOT_PATH" ]; then
    echo "QUIZBOT_PATH is not set. Please set it before running the script."
    exit 1
fi

# Define the target path using QUIZBOT_PATH
TARGET_PATH="$QUIZBOT_PATH/node_modules/youtube-dl-exec/bin"

# Check if the directory exists, create if it doesn't
if [ ! -d "$TARGET_PATH" ]; then
  echo "Creating target directory: $TARGET_PATH"
  mkdir -p $TARGET_PATH
fi

# If yt-dlp already exists, back it up as yt-dlp-prev
if [ -f "$TARGET_PATH/yt-dlp" ]; then
  echo "Backing up existing yt-dlp as yt-dlp-prev"
  cp "$TARGET_PATH/yt-dlp" "$TARGET_PATH/yt-dlp-prev"
fi

# yt-dlp_linux(PyInstaller로 만든 standalone 바이너리, 자체 Python 런타임 내장)를 받는다 - 원래
# 받던 자산 이름 "yt-dlp"는 시스템 python3를 shebang으로 호출하는 zipapp이라, yt-dlp가 요구하는
# Python 버전(2026-08-15 기준 3.11+)이 OS 기본 python3보다 낮으면(Ubuntu 22.04는 기본 3.10) 실행
# 자체가 안 됨 - standalone 바이너리는 시스템 python3 버전과 완전히 무관해서 이 문제를 원천 차단한다.
# 저장 파일명은 그대로 "yt-dlp"로 유지(youtube-dl-exec/audio_cache_manager.ts가 이 경로를 그대로
# 참조하므로 다른 코드 변경 불필요 - 내용물만 바뀔 뿐 경로는 그대로).
echo "Downloading the latest version of yt-dlp (standalone binary)..."
curl -Lo "$TARGET_PATH/yt-dlp" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux

# Grant 777 permissions to the yt-dlp file
echo "Granting 777 permissions to yt-dlp"
chmod 777 $TARGET_PATH/yt-dlp

echo "yt-dlp installation completed, previous version saved as yt-dlp-prev."
