#!/bin/bash
. /etc/profile.d/quizbot_path.sh

# yt-dlp 동작 진단 스크립트 (2026-11-01 추가) - 노래 퀴즈 오디오 다운로드가 실패할 때 원인을 한 번에
# 가려내기 위한 용도. 봇(audio_cache_manager.ts)과 같은 조건(같은 바이너리/포맷/source-address)으로
# IPv4/IPv6 x 쿠키 유무 조합을 전부 시험해서 "IP가 막혔는지 / 쿠키가 유효한지 / IPv6가 라우팅되는지"를
# 표로 보여준다. 실제 파일은 받지 않음(--simulate) - 포맷 선택까지만 확인.
#
# 사용법: bash check_yt-dlp.sh [유튜브 URL]
#   - URL 생략 시 오래 유지되는 공개 영상(Me at the zoo)으로 시험
#   - 쿠키는 운영 쿠키 파일의 "복사본"으로 시험함 - yt-dlp가 실행 후 쿠키 파일을 다시 써서, 진단 때문에
#     운영 쿠키가 바뀌거나 소유권이 root로 넘어가는 걸 막기 위함
#   - 봇은 ubuntu 계정으로 돌고 PO Token 플러그인도 /home/ubuntu/.config 밑에 있어서, root로 실행하면
#     ubuntu 계정으로 다시 실행한다(root로 돌리면 플러그인 경로/포맷 결과가 봇과 달라짐)

BOT_USER="ubuntu"
if [ "$EUID" -eq 0 ]; then
    echo "ℹ️  root로 실행됨 → 봇과 같은 조건을 위해 $BOT_USER 계정으로 다시 실행합니다."
    exec sudo -u "$BOT_USER" -H bash "$0" "$@"
fi

if [ -z "$QUIZBOT_PATH" ]; then
    echo "QUIZBOT_PATH is not set. Please set it before running the script."
    exit 1
fi

TEST_URL="${1:-https://www.youtube.com/watch?v=jNQXAC9IVRw}"
YT_DLP_BIN="$QUIZBOT_PATH/node_modules/youtube-dl-exec/bin/yt-dlp"
FORMAT='bestaudio[ext=webm]/bestaudio' # audio_cache_manager.ts와 동일
TIMEOUT_SEC=60

print_section()
{
    echo ""
    echo "==================== $1 ===================="
}

# ---------------------------------------------------------------- 1. 기본 환경
print_section "1. 기본 환경"

if [ ! -x "$YT_DLP_BIN" ]; then
    echo "❌ yt-dlp 실행 파일 없음/실행 권한 없음: $YT_DLP_BIN"
    echo "   → sudo bash $QUIZBOT_PATH/auto_script/server_script/update_yt-dlp.sh"
    exit 1
fi
echo "✅ yt-dlp 버전: $("$YT_DLP_BIN" --version 2>/dev/null || echo '실행 실패')"

if command -v node > /dev/null 2>&1; then
    echo "✅ node(JS 런타임): $(node -v)"
    HAS_NODE=1
else
    echo "❌ node 없음 - 쿠키(로그인) 추출엔 JS 런타임이 필수라 쿠키 시나리오가 실패함"
    HAS_NODE=0
fi

if systemctl is-active --quiet bgutil-pot-provider 2>/dev/null; then
    echo "✅ PO Token 서버(bgutil-pot-provider): active"
else
    echo "⚠️  PO Token 서버(bgutil-pot-provider): 동작 안 함 (필수는 아니지만 일부 클라이언트가 막힐 수 있음)"
fi

# 이전 진단에서 code: null(시그널 종료)의 유력 원인이 OOM이었으므로 같이 보여줌
if DMESG_OUT=$(sudo -n dmesg 2>/dev/null); then
    OOM_COUNT=$(echo "$DMESG_OUT" | grep -ciE "killed process|out of memory")
    if [ "$OOM_COUNT" -gt 0 ]; then
        echo "⚠️  커널 로그에 OOM kill 기록 ${OOM_COUNT}건 (sudo dmesg -T | grep -iE 'killed process|out of memory')"
    else
        echo "✅ 커널 로그에 OOM kill 기록 없음"
    fi
else
    echo "ℹ️  dmesg 조회 권한 없음 - OOM 여부는 sudo dmesg -T 로 직접 확인"
fi
echo "ℹ️  메모리: $(free -h | awk '/^Mem:/ {print "사용 " $3 " / 전체 " $2 ", 가용 " $7}')"

# ---------------------------------------------------------------- 2. IP
print_section "2. 네트워크 (봇이 고르는 IP)"

# network_utility.ts와 같은 기준: internal 제외, IPv6는 fe80::/10(링크 로컬) 제외, 첫 번째 주소 사용
IPV4=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)
IPV6=$(ip -6 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -viE '^fe[89ab]' | head -1)

if [ -n "$IPV4" ]; then
    echo "✅ IPv4(source-address): $IPV4 / 외부 IP: $(curl -4 -s --max-time 5 https://ifconfig.co || echo '확인 실패')"
else
    echo "⚠️  IPv4 글로벌 주소 없음"
fi

if [ -n "$IPV6" ]; then
    EXT_IPV6=$(curl -6 -s --max-time 5 https://ifconfig.co)
    if [ -n "$EXT_IPV6" ]; then
        echo "✅ IPv6(source-address): $IPV6 / 외부 통신 OK"
    else
        echo "❌ IPv6 주소($IPV6)는 있지만 외부로 안 나감 - 라우팅/방화벽 확인"
    fi
else
    echo "⚠️  IPv6 글로벌 주소 없음 (fe80:: 링크 로컬만 있으면 외부 통신 불가)"
fi

# ---------------------------------------------------------------- 3. 쿠키 파일
print_section "3. 쿠키 파일"

COOKIE_PATH=$(cd "$QUIZBOT_PATH" && node -e 'process.stdout.write(String(require("./config/system_setting.js").SYSTEM_CONFIG.YTDL_COOKIE_PATH ?? ""))' 2>/dev/null)

if [ -z "$COOKIE_PATH" ]; then
    echo "⚠️  system_setting.js에 YTDL_COOKIE_PATH 설정 없음 - 쿠키 재시도 기능 꺼짐"
elif [ ! -f "$COOKIE_PATH" ]; then
    echo "⚠️  쿠키 파일 없음: $COOKIE_PATH - 쿠키 재시도 기능 꺼짐"
else
    echo "ℹ️  경로: $COOKIE_PATH ($(stat -c '%U:%G %a' "$COOKIE_PATH"))"

    if ! head -1 "$COOKIE_PATH" | grep -q "Netscape HTTP Cookie File"; then
        echo "❌ 첫 줄이 '# Netscape HTTP Cookie File'이 아님 - Netscape 형식으로 다시 내보낼 것"
    fi
    if grep -q $'\r' "$COOKIE_PATH"; then
        echo "❌ CRLF 줄바꿈 포함 - sed -i 's/\\r\$//' \"$COOKIE_PATH\" 로 변환할 것"
    fi
    if [ ! -w "$COOKIE_PATH" ]; then
        echo "⚠️  $BOT_USER 계정에 쓰기 권한 없음 - yt-dlp가 갱신된 쿠키를 저장 못 함"
    fi

    # 값은 출력하지 않고 이름/만료일만 확인 (로그에 쿠키 값이 남지 않게)
    for NAME in LOGIN_INFO SAPISID __Secure-3PSID; do
        EXPIRE=$(awk -F'\t' -v n="$NAME" '$1 ~ /youtube\.com$/ && $6 == n {print $5; exit}' "$COOKIE_PATH")
        if [ -z "$EXPIRE" ]; then
            echo "❌ .youtube.com $NAME 없음 - 로그인 상태로 내보낸 쿠키가 아님"
        elif [ "$EXPIRE" != "0" ] && [ "$EXPIRE" -lt "$(date +%s)" ]; then
            echo "❌ $NAME 만료됨 ($(date -d "@$EXPIRE" '+%Y-%m-%d'))"
        else
            echo "✅ $NAME 있음 (만료: $([ "$EXPIRE" = "0" ] && echo '세션' || date -d "@$EXPIRE" '+%Y-%m-%d'))"
        fi
    done
    echo "ℹ️  파일 기준 검사일 뿐, 실제 유효성(로그아웃/폐기 여부)은 아래 4번 쿠키 시나리오 결과로 판단"
fi

# ---------------------------------------------------------------- 4. 다운로드 시나리오
print_section "4. 다운로드 시나리오 (URL: $TEST_URL)"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

# 결과 분류는 audio_cache_manager.ts의 getExpectedErrorType 패턴과 맞춤
classify_output()
{
    local out_file="$1" exit_code="$2"
    if [ "$exit_code" -eq 0 ] && [ -s "$out_file.stdout" ]; then
        echo "✅ 성공 (format: $(tail -1 "$out_file.stdout"))"
    elif [ "$exit_code" -eq 124 ]; then
        echo "❌ 타임아웃(${TIMEOUT_SEC}s)"
    elif [ "$exit_code" -ge 128 ]; then
        echo "❌ 시그널로 강제 종료(exit $exit_code) - OOM 의심"
    elif grep -q "Sign in to confirm" "$out_file.stderr"; then
        echo "❌ 봇 차단 (Sign in to confirm you're not a bot)"
    elif grep -qi "cookies are no longer valid" "$out_file.stderr"; then
        echo "❌ 쿠키 무효 (로그아웃/폐기됨 - 새로 내보낼 것)"
    elif grep -q "Network is unreachable" "$out_file.stderr"; then
        echo "❌ 네트워크 도달 불가 (해당 IP로 외부 통신 안 됨)"
    elif grep -q "Cannot assign requested address" "$out_file.stderr"; then
        echo "❌ source-address 바인드 실패 (서버에 없는 IP)"
    elif grep -qiE "Video unavailable|Private video" "$out_file.stderr"; then
        echo "⚠️  영상 자체 문제 (삭제/비공개) - 다른 URL로 다시 시험할 것"
    elif grep -qi "DRM" "$out_file.stderr"; then
        echo "❌ DRM 포맷만 반환됨 (yt-dlp#17812 실험)"
    else
        echo "❌ 기타 실패: $(grep -m1 'ERROR' "$out_file.stderr" | cut -c1-150)"
    fi
}

run_scenario()
{
    local label="$1"; shift
    local out_file="$TMP_DIR/$(echo "$label" | tr -c 'a-zA-Z0-9' '_')"

    timeout "$TIMEOUT_SEC" "$YT_DLP_BIN" "$TEST_URL" --simulate --print format_id \
        --format-sort +size --format "$FORMAT" --no-playlist --no-check-certificates \
        --add-header referer:youtube.com --add-header user-agent:googlebot \
        "$@" > "$out_file.stdout" 2> "$out_file.stderr"
    local exit_code=$?

    printf "%-22s %s\n" "$label" "$(classify_output "$out_file" "$exit_code")"
}

# 파일 검사(3번)에서 문제가 나와도 실제 결과를 보기 위해 파일만 있으면 시험한다
COOKIE_ARGS=()
if [ -n "$COOKIE_PATH" ] && [ -f "$COOKIE_PATH" ]; then
    cp "$COOKIE_PATH" "$TMP_DIR/cookies.txt"
    COOKIE_ARGS=(--cookies "$TMP_DIR/cookies.txt" --js-runtimes node)
fi

if [ -n "$IPV6" ]; then
    run_scenario "IPv6" --force-ipv6 --source-address "$IPV6"
fi
if [ -n "$IPV4" ]; then
    run_scenario "IPv4" --force-ipv4 --source-address "$IPV4"
fi
if [ -z "$IPV4" ] && [ -z "$IPV6" ]; then
    run_scenario "기본 IP"
fi

if [ "${#COOKIE_ARGS[@]}" -gt 0 ] && [ "$HAS_NODE" -eq 1 ]; then
    if [ -n "$IPV6" ]; then
        run_scenario "IPv6 + 쿠키" --force-ipv6 --source-address "$IPV6" "${COOKIE_ARGS[@]}"
    fi
    if [ -n "$IPV4" ]; then
        run_scenario "IPv4 + 쿠키" --force-ipv4 --source-address "$IPV4" "${COOKIE_ARGS[@]}"
    fi
else
    echo "ℹ️  쿠키 시나리오 건너뜀 (쿠키 파일 또는 node 없음)"
fi

echo ""
echo "해석:"
echo "  - IP 시나리오 중 하나라도 ✅ → 봇은 쿠키 없이 정상 다운로드 (IPv6 → IPv4 순서로 시도)"
echo "  - IP는 전부 봇 차단인데 '+ 쿠키'가 ✅ → 봇은 쿠키 재시도로 다운로드 (계정 사용 중)"
echo "  - 전부 ❌ → IP와 쿠키 모두 막힘: 쿠키 재발급 / IP 교체 / 프록시 검토"
