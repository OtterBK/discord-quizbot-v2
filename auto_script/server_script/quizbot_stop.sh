#!/bin/bash
. /etc/profile.d/quizbot_path.sh

if [ -z "$QUIZBOT_PATH" ]; then
    echo "QUIZBOT_PATH is not set. Please set it before running the script."
    exit 1
fi

echo "stopping quizbot"
sudo systemctl stop quizbot3
echo "quizbot3 systemd service stopped (systemd kills child ffmpeg processes in its cgroup automatically)"
