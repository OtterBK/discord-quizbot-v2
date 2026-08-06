//utility.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//BGM/오디오 재생, 오디오 메타데이터 파싱 관련.
//로직/주석은 원본과 동일 (동작 변경 없음).

const fs = require('fs');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const mm = require('music-metadata');

const { SYSTEM_CONFIG, BGM_TYPE } = require('../../config/system_setting.js');
const logger = require('../logger.js')('Utility');
const misc_utility = require('./misc_utility');

//미리 로드해둘 것들
let bgm_long_timers = undefined;
exports.initializeBGM = () => 
{
  const long_timer_path = SYSTEM_CONFIG.BGM_PATH + "/" + BGM_TYPE.COUNTDOWN_LONG;
  bgm_long_timers = [];
  const long_timer_list = fs.readdirSync(long_timer_path);
  long_timer_list.forEach((file_name) => 
  {
    bgm_long_timers.push(long_timer_path + "/" + file_name);
  });
};
exports.fade_audio_play = async (audio_player, audio_resource, from, to, duration) => 
{
  const interval = SYSTEM_CONFIG.FADE_INTERVAL; //ms단위

  let current_time = 0;
  let current_volume = from;

  let gap = to - from; //0 < ? fade_out, 0 > ? fade_in

  const is_fade_in = gap >= 0 ? true : false;

  if (is_fade_in == true) 
  {
    audio_player.play(audio_resource);
    if (audio_resource == undefined || audio_resource.volume == undefined) return;
    audio_resource.volume.setVolume(current_volume);
  }

  const change_per = gap / (duration / interval);
  const timer_id = setInterval(() => 
  {

    if (audio_resource == undefined || audio_resource.volume == undefined) //가드 코드
    {
      clearInterval(timer_id);
    }

    if (current_time >= duration) 
    {
      if (is_fade_in == false && audio_resource.volume.volume == 0) 
      {
        audio_player.stop();
      }
      clearInterval(timer_id);
      return;
    }

    current_time += interval;

    if (current_volume != to) 
    {
      current_volume += change_per;

      if (current_volume < 0) current_volume = 0;

      if (is_fade_in == true && current_volume > to) current_volume = to;
      if (is_fade_in == false && current_volume < to) current_volume = to;

      audio_resource.volume.setVolume(current_volume);
    }

  }, interval);

  return timer_id;
};
exports.getBlobLength = () => 
{
  // https://www.npmjs.com/package/get-blob-duration
  // https://www.npmjs.com/package/ffprobe-duration
};
exports.getAudioInfoFromPath = async (file_path) => 
{
  return await mm.parseFile(file_path, { skipCovers: true, skipPostHeaders: true });
};
exports.getAudioInfoFromStream = async (stream) => 
{
  return await mm.parseStream(stream, { skipCovers: true, skipPostHeaders: true });
};
exports.getAudioInfoFromBuffer = async (buffer) => 
{
  return await mm.parseBuffer(buffer, { skipCovers: true, skipPostHeaders: true });
};
//Deprecated
exports.getSizeOfMetadata = (file_type) => 
{
  //그냥 꼼수로 가져오자... byte 단위다
  switch (file_type) 
  {
  case "mp3":
    return 12288; //AI가 10kb ~ 12kb 정도라 했음
  case "ogg":
    return 144; //보통 142
  case "wav":
    return 44; //44고정

  default: return undefined;
  }
};
exports.playBGM = async (audio_player, bgm_type) => 
{

  if (audio_player == undefined) return;

  let bgm_file_path = undefined;
  if (bgm_type == BGM_TYPE.COUNTDOWN_LONG) 
  {
    if (bgm_long_timers == undefined || bgm_long_timers.length == 0) 
    {
      logger.error("BGM long timer list is empty, check long timer path or InitializeBGM() function has been called");
      return undefined;
    }
    const rd = misc_utility.getRandom(0, bgm_long_timers.length);
    bgm_file_path = bgm_long_timers[rd];
  }
  else 
  {
    bgm_file_path = SYSTEM_CONFIG.BGM_PATH + "/" + bgm_type;
  }

  if (bgm_file_path == undefined) return;

  const bgm_file_stream = fs.createReadStream(bgm_file_path, { flags: 'r' });

  //23.01.23 use_inline_volume 옵션을 끄니, bgm이 안나오는 버그가 있었다.
  //도저히 왜 그런지는 모르겠으나, file 경로를 createAudioResource로 넘기지 않고, 
  //stream을 만들어 넘기고, bgm 유형을 mp3에서 opus로 변경하니 해결됐다.
  //버그 맞다. 로컬 파일 재싱 시에는 항상 스트림을 만들어서 넘겨라 https://github.com/discordjs/discord.js/issues/7232

  let inputType = StreamType.WebmOpus;
  if (bgm_file_path.endsWith(".opus")) inputType = StreamType.OggOpus;
  if (bgm_file_path.endsWith(".mp3")) inputType = StreamType.Arbitrary;

  const bgm_resource = createAudioResource(bgm_file_stream, {
    inputType: inputType,
    inlineVolume: false,
  });
  audio_player.play(bgm_resource);

  return bgm_resource;
};
