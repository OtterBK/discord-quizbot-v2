#!/bin/bash

# systemd의 cgroup 기반 종료(SIGTERM → 타임아웃 후 SIGKILL)가 놓칠 수 있는 프로세스까지 확실히
# 정리하는 방어 스크립트. quizbot3.service의 ExecStopPost(중지 직후 청소)/ExecStartPre(시작 직전
# 잔여 프로세스 청소, 즉 이전에 완전히 안 죽은 인스턴스가 새 인스턴스와 중복 실행되는 걸 방지)에서
# 둘 다 호출됨 - systemctl start/stop/restart quizbot3를 직접 쳐도 항상 같이 실행된다.
#
# ExecStart가 상대경로(dist/index.js, WorkingDirectory 기준)로 실행되기 때문에 실제 프로세스의
# 커맨드라인에도 절대경로가 아니라 상대경로만 남는다 - QUIZBOT_PATH를 접두사로 붙여 매칭하면 오히려
# 못 잡으므로, drop_ffmpeg.sh와 동일하게 경로 접두사 없이 매칭한다.
#
# ExecStartPre에서 이 스크립트가 실패(0이 아닌 종료 코드)로 끝나면 systemd가 start 자체를 막아버리므로,
# 무엇을 죽였든 안 죽였든 항상 exit 0으로 끝난다.

echo "Cleaning up leftover quizbot-related processes (node/ffmpeg/yt-dlp)..."

pkill -9 -f "node dist/index.js" 2>/dev/null
pkill -9 -f "/ffmpeg-static/ffmpeg" 2>/dev/null
pkill -9 -f "/youtube-dl-exec/bin/yt-dlp" 2>/dev/null

echo "Done."
exit 0
