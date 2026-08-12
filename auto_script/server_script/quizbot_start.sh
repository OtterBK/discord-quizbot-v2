#!/bin/bash
. /etc/profile.d/quizbot_path.sh

if [ -z "$QUIZBOT_PATH" ]; then
    echo "QUIZBOT_PATH is not set. Please set it before running the script."
    exit 1
fi

echo "starting quizbot"
sudo systemctl start quizbot3
echo "quizbot3 systemd service started (logs: journalctl -u quizbot3 -f)"
