#!/bin/bash
. /etc/profile.d/quizbot_path.sh

# 자동 더빙 오디오 캐시 정리 스크립트 (2026-11-02 추가).
# 2026-11-02 이전 봇은 포맷을 파일 크기 순(+size)으로만 골라서, 다국어 오디오 트랙이 있는 영상에서 원본보다
# 조금 작은 (자동)더빙 트랙(예: 한국어 영상 -> 영어/인도네시아어 더빙)을 받아 캐시에 저장했음. 봇은 캐시가
# 있으면 다시 받지 않으므로, 이미 더빙으로 받은 캐시를 지워야 다음 재생 때 원본 트랙(lang 우선 정렬)으로
# 다시 받는다.
#
# 판별 기준 (캐시의 <video_id>.info.json에 남아있는, 실제로 받은 포맷 정보의 format_note):
#   - 더빙/해설 트랙: 첫 부분이 언어 이름 ("English (US), low", "Indonesian, low", "Japanese descriptive, low")
#                     이고 "original"이 없음 -> 삭제 대상
#   - 원본 트랙:      "original" 포함 ("Korean original (default), low") -> 유지
#   - 품질만 있음:    첫 부분이 품질/변형 표시 ("low", "low, DRC", "medium, DRC", "Default, high") -> 유지.
#                     단일 트랙 영상이거나 원본 트랙의 DRC(음량 압축) 변형 - DRC 변형엔 "original"이 안 붙음
#                     (2026-11-05 실제 운영 캐시 확인: "[ko] low, DRC"는 한국어 원본 영상의 원본 트랙이었음)
#   - 정보 없음:      예전 버전으로 받아 format_note가 없는 캐시 -> 판단 불가라 유지
#
# 사용법:
#   bash clean_dubbed_cache.sh            # 지울 대상 목록만 출력 (기본, 아무것도 안 지움)
#   bash clean_dubbed_cache.sh --delete   # 실제로 삭제 (<video_id>.* 캐시 파일 전부)
# 봇 실행 중에 지워도 됨 - 재생 중인 파일은 리눅스 특성상 재생이 끝날 때까지 유지되고, 다음 요청 때 다시 받음.

BOT_USER="ubuntu"
if [ "$EUID" -eq 0 ]; then
    echo "ℹ️  root로 실행됨 → 캐시 파일 소유권 유지를 위해 $BOT_USER 계정으로 다시 실행합니다."
    exec sudo -u "$BOT_USER" -H bash "$0" "$@"
fi

if [ -z "$QUIZBOT_PATH" ]; then
    echo "QUIZBOT_PATH is not set. Please set it before running the script."
    exit 1
fi

MODE="dry-run"
if [ "$1" = "--delete" ]; then
    MODE="delete"
fi

cd "$QUIZBOT_PATH" && node - "$MODE" <<'NODE_EOF'
const fs = require('fs');
const path = require('path');
const { SYSTEM_CONFIG } = require('./config/system_setting.js');

const mode = process.argv[2];
const cache_root = SYSTEM_CONFIG.CUSTOM_AUDIO_CACHE_PATH;

//format_note 첫 부분이 품질/변형 표시면 언어 트랙 정보가 없는 것(단일 트랙 or 원본의 DRC 변형)
const NON_LANGUAGE_TOKENS = new Set(['ultralow', 'low', 'medium', 'high', 'default', 'drc']);

//첫 부분이 언어 이름 + original 없음 = 더빙(또는 해설) 트랙
const isDubbedTrack = (info) =>
{
  const note = info.format_note;
  if(typeof note !== 'string' || note.length == 0) return false; //정보 없음 -> 판단 불가, 유지
  if(/original/i.test(note)) return false; //원본 트랙
  const first_part = note.split(',')[0].trim().toLowerCase();
  return NON_LANGUAGE_TOKENS.has(first_part) == false;
};

let scanned = 0;
const targets = [];
for(const sub_dir of fs.readdirSync(cache_root))
{
  const dir = path.join(cache_root, sub_dir);
  if(fs.statSync(dir).isDirectory() == false) continue;

  for(const file of fs.readdirSync(dir))
  {
    if(file.endsWith('.info.json') == false) continue;
    scanned += 1;

    let info;
    try { info = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); }
    catch(err) { continue; } //깨진 info는 이 스크립트 대상 아님

    if(isDubbedTrack(info))
    {
      const video_id = file.slice(0, -'.info.json'.length);
      targets.push({ dir, video_id, note: info.format_note, language: info.language, title: info.title });
    }
  }
}

console.log(`검사한 캐시: ${scanned}개 / 더빙 트랙으로 받은 캐시: ${targets.length}개`);
for(const { video_id, language, note, title } of targets)
{
  console.log(`  ${video_id} [${language}] ${note} - ${title ?? ''}`);
}

if(mode !== 'delete')
{
  if(targets.length > 0) console.log(`\n목록만 출력했습니다. 실제로 지우려면 --delete 옵션을 붙여 다시 실행하세요.`);
  process.exit(0);
}

let deleted_files = 0;
for(const { dir, video_id } of targets)
{
  for(const file of fs.readdirSync(dir).filter((file) => file.startsWith(`${video_id}.`)))
  {
    fs.rmSync(path.join(dir, file), { force: true });
    deleted_files += 1;
  }
}
console.log(`\n✅ ${targets.length}개 영상의 캐시 파일 ${deleted_files}개를 삭제했습니다. 다음 재생 때 원본 트랙으로 다시 받습니다.`);
NODE_EOF
