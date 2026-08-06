'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const fs = require('fs');
const { createAudioResource, StreamType } = require('@discordjs/voice');

const { QuizLifeCycle } = require('./quiz_lifecycle.js');
const { CYCLE_TYPE } = require('../constants.js');
const option_system = require('../../quiz_option/quiz_option.js');
const OPTION_TYPE = option_system.OPTION_TYPE;
const { SYSTEM_CONFIG, QUIZ_TYPE } = require('../../../config/system_setting.js');
const utility = require('../../../utility/utility.js');
const logger = require('../../../utility/logger.js')('QuizSystem');
const { SeekStream } = require('../../../utility/SeekStream/SeekStream.js');
const audio_cache_manager = require('../../managers/audio_cache_manager');

//#region Prepare Cycle
/** 퀴즈 내기 전, 퀴즈 준비하는 단계인 Prepare **/
class Prepare extends QuizLifeCycle
{
  static cycle_type = CYCLE_TYPE.PREPARE;
  constructor(quiz_session)
  {
    super(quiz_session);
    this.next_cycle = CYCLE_TYPE.UNDEFINED;
    this.skip_prepare = false;
    this.prepared_question = undefined;
    this.target_question = undefined;
  }

  async enter()
  {
    if(this.quiz_session == undefined)
    {
      return false;
    }

    //다음에 문제낼 퀴즈 꺼내기
    let game_data = this.quiz_session.game_data;

    this.quiz_session.game_data['question_num'] += 1;

    if(this.quiz_session.hasMoreQuestion() === false
      || this.quiz_session.quiz_data['question_list'].length === 0) //모든 퀴즈 제출됐음
    {
      this.skip_prepare = true;
      return; //더 이상 준비할 게 없으니 return
    }
  }

  async act()
  {
    if(this.skip_prepare == true || this.quiz_session?.force_stop == true)
    {
      return;
    }

    this.quiz_session.has_current_question = true;

    //다음에 문제낼 퀴즈 꺼내기
    let quiz_data = this.quiz_session.quiz_data;
    let game_data = this.quiz_session.game_data;

    const question_num = game_data['question_num'];
    let target_question = quiz_data['question_list'].pop(); //어차피 앞에서부터 꺼내든, 뒤에서부터 꺼내든 랜덤인건 똑같다.

    if(this.quiz_session.isMultiplayerSession()) //멀티플레이 참가자 입장이라면 prepare 할 필요 없다.
    {
      this.quiz_session.waitForNextQuestionData();
    
      if(this.quiz_session.isHostSession() === false)
      {
        return false;
      }
    }

    this.target_question = target_question;

    const question_type = target_question['type'];
        
    try
    {
      if(question_type == QUIZ_TYPE.CUSTOM) //유저 제작 퀴즈 준비
      {
        await this.prepareCustom(target_question);
        //정답 표시 정보도 prepareCustom에서 한번에 한다
      }
      else if(question_type == QUIZ_TYPE.OMAKASE) //오마카세 퀴즈 준비
      {
        const prepare_type = target_question['prepare_type'];

        if(prepare_type === 'DEV')
        {
          await this.prepareLocalAudio(target_question);
        }
        else if(prepare_type === 'CUSTOM')
        {
          await this.prepareCustom(target_question);   
        }
        else
        {
          logger.error(`Unknown Prepare Type for OMAKASE Quiz! target_question: ${JSON.stringify(target_question)}`);
        }
      }
      else //개발자 퀴즈 준비
      {
        if(question_type == QUIZ_TYPE.SONG || question_type == QUIZ_TYPE.INTRO || question_type == QUIZ_TYPE.SCRIPT)
        {
          await this.prepareLocalAudio(target_question);
        }
        else if(question_type == QUIZ_TYPE.IMAGE || question_type == QUIZ_TYPE.IMAGE_LONG)
        {
          await this.prepareImage(target_question);
        }
        else if(question_type == QUIZ_TYPE.TEXT || question_type == QUIZ_TYPE.OX)
        {
          await this.prepareText(target_question);
        }
        await this.prepareAnswerAdditionalInfo(target_question); //정답 표시 시, 사용할 추가 정보 Dev퀴즈 전용이다.
      }

      if(this.quiz_session.isMultiplayerSession() === false) //멀티 퀴즈 아니면 문제용 오디오 리소스는 바로 생성 ㄱㄱ
      {
        Prepare.fillQuestionAudioResource(target_question);
      }

    }
    catch(err)
    {
      if(this.quiz_session == undefined)
      {
        logger.error(`Failed prepare step by quiz_session undefined, guess force stop`);
        this.skip_prepare = true;
        return;
      }
      logger.error(`Failed prepare enter step quiz, guild_id:${this.quiz_session?.guild_id}, target_question: ${target_question?.question ?? target_question.question_audio_url}, question_id: ${target_question?.question_id ?? "no id"} err: ${err.stack ?? err.message}`);
      target_question['question_text'] += "\n\nAUDIO_ERROR: " + err.message; //에러나면 UI에도 표시해주자

      if(err.message.includes("bind") && this.quiz_session.ipv6 != undefined && SYSTEM_CONFIG.YTDL_IPV6_USE) //ip bind error면
      {
        const current_ip = this.quiz_session.ipv6;
        const new_ip = utility.getIPv6Address()[0];

        if(current_ip != new_ip) //다시 한번 찾아본다.
        {
          logger.info(`Detected IPv6 Address has been changed! recreating ytdl agent...[${current_ip} -> ${new_ip}]`);
          this.quiz_session.ipv6 = new_ip;
        }
      }
    }

    this.prepared_question = target_question;

    if(this.quiz_session.isMultiplayerSession() && this.quiz_session.isHostSession())
    {
      this.quiz_session.sendPreparedQuestion(this.prepared_question);
      return false; //만들고 실제로 prepared queue에 넣으면 안됨.
    }
  }

  async exit()
  {
    if(this.skip_prepare == true) return;

    if(this.quiz_session.force_stop == true) return;

    let game_data = this.quiz_session.game_data;

    if(this.prepared_question == undefined) //prepare 시도했는데 실패했다면
    {
      logger.error(`No Prepared quiz, ignore exit step, guild_id:${this.quiz_session?.guild_id}, target_question: ${JSON.stringify(this.target_question?.question)}`);
    }

    game_data.prepared_question_queue.push(this.prepared_question);
    delete this.target_question;
        
    return;
  }

  async prepareAnswerAdditionalInfo(target_question) //dev퀴즈용으로만 사용
  {
    const option_data = this.quiz_session.option_data;
    const game_data = this.quiz_session.game_data;

    if(target_question.hasOwnProperty('answer_audio'))
    {
      const question = target_question['answer_audio'];

      const audio_stream = fs.createReadStream(question, {flags:'r'});
    
      let audio_resource = undefined;
      audio_resource = createAudioResource(audio_stream, {
        inputType: StreamType.WebmOpus,
        inlineVolume: SYSTEM_CONFIG.USE_INLINE_VOLUME,
      });

      if(SYSTEM_CONFIG.USE_INLINE_VOLUME)
      {
        audio_resource.volume.setVolume(0);
      }

      target_question['answer_audio_resource'] = [ audio_resource ];
      //오디오 재생 길이 가져오기
      let audio_play_time = target_question['answer_audio_play_time'];
      if(audio_play_time == -1) //-1은 그냥 서버 설정 사용하는 것
      {
        audio_play_time = undefined;
      }
      else if(audio_play_time == undefined) //딱히 지정된게 없다면
      {
        const audio_info = await utility.getAudioInfoFromPath(question);
        audio_play_time = ((audio_info.format.duration) ?? SYSTEM_CONFIG.MAX_ANSWER_AUDIO_PLAY_TIME) * 1000; //오디오 길이 값 있으면 무조건 오디오 길이 쓰도록 //TODO 이게 맞나? 재고해보셈
      }
      target_question['answer_audio_play_time'] = audio_play_time;

    }

    if(target_question.hasOwnProperty('answer_image'))
    {
      const image_resource = target_question['answer_image'];
      target_question['answer_image_resource'] = image_resource;
    }
  }

  /** 오디오 파일 경로와, 오디오 파일의 전체 재싱길이, 시작 지점을 기준으로 스트림 반환 */
  static generateAudioFileStream(audio_path, audio_duration, audio_start_point, audio_length)
  {
    let audio_stream = undefined;
    let inputType = StreamType.WebmOpus;
 
    const stats = fs.statSync(audio_path);
    const size_in_bytes = stats.size;
    const bitrate = Math.ceil(size_in_bytes / audio_duration * 8);

    if(audio_path.endsWith('.webm') == false) //webm 아니면 그냥 재생하자
    {
      const bytes_of_start_point = Math.ceil((size_in_bytes / audio_duration) * audio_start_point);
      audio_stream = fs.createReadStream(audio_path, { 
        flags: 'r',
        // start: bytes_of_start_point //이거 안 먹는다...
      });
      inputType = StreamType.Arbitrary;
    
      return [audio_stream, inputType];
    }
    
    if (audio_start_point != undefined && audio_start_point !== 0) 
    {

      //SeekStream 가져다 쓰는 방식, 열심히 커스텀했다
      //23.11.08 대충 예상컨데 아마 파일은 ReadStream으로만 읽어올 수 있는데 유튜브용 SeekStream을 파일로도 쓸 수 있게 바꿨던 것 같다
      const seek_stream = new SeekStream(
        audio_path,
        (audio_length + 10), //duration, 10는 패딩
        0, //header length 안넘겨도됨
        size_in_bytes,
        bitrate, //TODO BITRATE 값인데, undefined로 넘기면 알아서 계산함
        undefined,
        {
          file: true,
          seek: parseInt(audio_start_point),
        }
      );

      audio_stream = seek_stream.stream;
      inputType = seek_stream.type;
    } 
    else 
    {
      audio_stream = fs.createReadStream(audio_path, { flags: 'r' });
    }
    
    return [audio_stream, inputType];
  }
    
  static generateAudioResource(audio_stream, inputType) 
  {
    let resource = createAudioResource(audio_stream, 
      {
        inputType: inputType,
        inlineVolume: SYSTEM_CONFIG.USE_INLINE_VOLUME,
      });
    
    if (SYSTEM_CONFIG.USE_INLINE_VOLUME) 
    {
      resource.volume.setVolume(0);
    }
    
    return resource;
  }

  /** question 에서 audio_file_stream_info 값 기반으로 audio resource 들을 생성해줌*/
  static fillAudioResource(question)
  {
    Prepare.fillQuestionAudioResource(question);
    Prepare.fillAnswerAudioResource(question); 
  }

  static fillQuestionAudioResource(question)
  {
    const question_audio_file_stream_info = question['audio_file_stream_info'];

    if(!question_audio_file_stream_info)
    {
      return;
    }

    const file_path = question_audio_file_stream_info.file_path;
    const audio_duration_sec = question_audio_file_stream_info.audio_duration_sec;
    const audio_start_point = question_audio_file_stream_info.audio_start_point;
    const audio_length_sec = question_audio_file_stream_info.audio_length_sec;

    const question_audio_repeat = question['question_audio_repeat'] ?? 1;

    question['audio_resource'] = [];

    for(let i = 0; i < question_audio_repeat && i < SYSTEM_CONFIG.MAX_QUESTION_AUDIO_REPEAT; ++i) //오디오 반복 재생용, STREAM을 개별로 만들어줘야 재생이 된다.
    {
      const [audio_stream, inputType] = Prepare.generateAudioFileStream(file_path, audio_duration_sec, audio_start_point, audio_length_sec);
      const resource = Prepare.generateAudioResource(audio_stream, inputType);
  
      question['audio_resource'].push(resource);
    }

  }

  static fillAnswerAudioResource(question)
  {
    const answer_audio_file_stream_info = question['answer_audio_file_stream_info'];

    //Dev퀴즈는 어차피 이게 없음. prepareAnswerAdditionalInfo 에서 따로 처리함
    //멀티에서 문제되지 않는가? -> 어차피 멀티에서는 Dev퀴즈는 Song 타입 밖에 없음
    if(!answer_audio_file_stream_info) 
    {
      return;
    }

    const file_path = answer_audio_file_stream_info.file_path;
    const audio_duration_sec = answer_audio_file_stream_info.audio_duration_sec;
    const audio_start_point = answer_audio_file_stream_info.audio_start_point;
    const audio_length_sec = answer_audio_file_stream_info.audio_length_sec;

    const [audio_stream, inputType] = Prepare.generateAudioFileStream(file_path, audio_duration_sec, audio_start_point, audio_length_sec);
    const resource = Prepare.generateAudioResource(audio_stream, inputType);

    question['answer_audio_resource'] = [ resource ];
  }

  getRandomAudioStartPoint(audio_min_start_point, audio_max_start_point, audio_length_sec, use_improved_audio_cut) 
  {
    if (audio_max_start_point <= audio_min_start_point)  // 충분히 재생할 수 있는 start point가 없다면
    {
      return parseInt(audio_min_start_point);
    }

    if (use_improved_audio_cut) // 최대한 중간 범위로 좁힌다.
    { 
      const refinedPoints = this.refineAudioPoints(audio_min_start_point, audio_max_start_point, audio_length_sec);
      audio_min_start_point = refinedPoints.audio_min_start_point;
      audio_max_start_point = refinedPoints.audio_max_start_point;
    }

    const audio_start_point = parseInt(utility.getRandom(audio_min_start_point, audio_max_start_point));
    return audio_start_point;
  }
    
  refineAudioPoints(audio_min_start_point, audio_max_start_point, audio_length_sec) 
  {
    const audio_length_sec_half = audio_length_sec / 2;
    const audio_mid_point = (audio_min_start_point + audio_max_start_point) / 2;
    const refined_audio_min_start_point = audio_mid_point - audio_length_sec_half;
    const refined_audio_max_start_point = audio_mid_point + audio_length_sec_half;
    
    if (audio_min_start_point < refined_audio_min_start_point 
            && refined_audio_max_start_point < audio_max_start_point) // 좁히기 성공이면
    { 
      logger.debug(`Refined audio point, min: ${audio_min_start_point} -> ${refined_audio_min_start_point}, max: ${audio_max_start_point} -> ${refined_audio_max_start_point}`);
      return { audio_min_start_point: refined_audio_min_start_point, audio_max_start_point: refined_audio_max_start_point };
    }
    
    return { audio_min_start_point, audio_max_start_point };
  }

  async prepareLocalAudio(target_question)
  {
    const { option_data, game_data } = this.quiz_session;
    const question = target_question['question'];
    const ignore_option_audio_play_time = target_question['ignore_option_audio_play_time'] ?? false; // 노래 전체 재생 여부
    let use_random_start = target_question['use_random_start'] ?? true; // 노래 어디서부터 시작할 지 랜덤으로 설정 여부
        
    // 오디오 정보 가져오기
    const audio_info = await utility.getAudioInfoFromPath(question); // TODO: 상당한 리소스를 먹는 것 같은데 확인필요
    const audio_duration_sec = parseInt(audio_info.format.duration) ?? SYSTEM_CONFIG.MAX_QUESTION_AUDIO_PLAY_TIME; // duration 없으면 무조건 서버 설정 값 따르게 할거임
        
    // 오디오 길이 먼저 넣어주고
    const audio_play_time_sec = option_data.quiz.audio_play_time / 1000; 
    let audio_length_sec = Math.min(audio_play_time_sec, audio_duration_sec); // 오디오 길이와 재생할 시간 중 작은 값을 사용
    use_random_start = audio_duration_sec >= audio_length_sec && use_random_start;
    target_question['audio_length'] = audio_length_sec * 1000;
        
    let audio_start_point;
        
    if (ignore_option_audio_play_time == false && use_random_start) 
    {
      const audio_max_start_point = audio_duration_sec - (audio_length_sec + 2.5);  // 우선 이 지점 이후로는 시작 지점이 될 수 없음, +2.5 하는 이유는 padding임
      const audio_min_start_point = 2.5;  // 앞에도 2.5초 정도 자르고 싶음
      const use_improved_audio_cut = (option_data.quiz.improved_audio_cut === OPTION_TYPE.ENABLED);
            
      audio_start_point = this.getRandomAudioStartPoint(audio_min_start_point, audio_max_start_point, audio_length_sec, use_improved_audio_cut);
      logger.debug(`cut audio, question: ${question}, point: ${audio_start_point} ~ ${(audio_start_point + audio_length_sec)}`);
    }
        
    const audio_file_stream_info = { //멀티에서 쓰려고 있는거임
      file_path: question,
      audio_duration_sec: audio_duration_sec,
      audio_start_point: audio_start_point,
      audio_length_sec: audio_length_sec,
    };

    target_question['audio_file_stream_info'] = audio_file_stream_info;

    return [undefined, audio_length_sec * 1000, undefined, audio_file_stream_info];
  }

  async prepareImage(target_question)
  {
    const question = target_question['question'];
    target_question['image_resource'] = question;
    const question_type = target_question['type'];
    target_question['is_long'] = (question_type == QUIZ_TYPE.IMAGE_LONG ? true : false);
  }

  async prepareText(target_question)
  {
    const question = target_question['question'];
    target_question['question'] = " \n" + question + " \n";
    const question_type = target_question['type'];
    target_question['is_long'] = ((question_type == QUIZ_TYPE.TEXT_LONG || question_type == QUIZ_TYPE.OX_LONG) ? true : false);
  }

  async prepareCustom(target_question) //TODO 나중에 Dev quiz랑 중복 코드 처리하자...어우 귀찮아
  {
    const { option_data, game_data, ipv4, ipv6 } = this.quiz_session;
    const target_question_data = target_question.data;
        
    /**
         * question_audio_url, 문제용 오디오 url
         * audio_start, 최소 시작 구간
         * audio_end, 최대 재생
         * audio_play_time. 재생 시간
         */
    const question_audio_url = target_question_data['question_audio_url'];
        
    const { audio_play_time, audio_start, audio_end } = target_question_data;
    
    const [question_audio_resource, question_audio_play_time_ms, question_error_message, question_audio_file_stream_info] = 
            await this.generateAudioResourceFromWeb(
              question_audio_url, 
              audio_start, 
              audio_end, 
              SYSTEM_CONFIG.MAX_QUESTION_AUDIO_PLAY_TIME, 
              [ipv4, ipv6]
            );
    
    // target_question['audio_resource'] = question_audio_resource; -> 일괄 생성하도록 변경했음
    target_question['audio_length'] = question_audio_play_time_ms;
    
    if (question_error_message) 
    {
      target_question['question_text'] += `\n\nAUDIO_ERROR: ${question_error_message}`;
    }
    else
    {
      target_question['audio_file_stream_info'] = question_audio_file_stream_info;
    }
        
    /**
         * question_image_url, 문제용 이미지 url
         */
    //Initial 할 때 이미 처리됨 target_question_data['question_image_url'];
        
    /**
         * question_answers. 문제 정답
         */
    //Initial 할 때 이미 처리됨 target_question_data['answers'];
        
    /**
         * question_text, 문제용 텍스트
         */
    //Initial 할 때 이미 처리됨 target_question_data['question_text'];
        
    /**
         * hint, 문제 힌트
         */
    //Initial 할 때 이미 처리됨 target_question_data['hint'];
        
    /**
         * hint_image_url, 문제 힌트용 이미지
         */
    //Initial 할 때 이미 처리됨 target_question_data['hint_image_url'];
        
    /**
         * use_answer_timer, 타임 오버 됐을 때 10초의 여유 시간 줄지 여부
         */
    //Initial 할 때 이미 처리됨 target_question_data['use_answer_timer'];
        
    /**
         * answer_audio_url, 정답 공개용 오디오 url
         * answer_audio_start, 
         * answer_audio_end
         * answer_audio_play_time
         */

    if(this.quiz_session.isMultiplayerSession()) //멀티면 동기로
    {
      await this.prepareCustomAnswer(target_question, target_question_data, [ipv4, ipv6]);
    }
    else //멀티 아니면 비동기로
    {
      setTimeout(() => 
      {
        this.prepareCustomAnswer(target_question, target_question_data, [ipv4, ipv6])
          .then(() => 
          {
            Prepare.fillAnswerAudioResource(target_question); //info 파싱 됐으면 리소스생성 ㄱㄱ
          });
      }
      , 0);    
    }
        
    /**
         * answer_image_url, 정답 공개용 이미지 url
         */
    //Initial 할 때 이미 처리됨 target_question_data['answer_image_url'];
        
    /**
         * answer_text, 정답 공개용 텍스트
         */
    //Initial 할 때 이미 처리됨 target_question_data['answer_text'];

    /**
         * answer_type, 문제 정답 작성 유형
         */
    //Initial 할 때 이미 처리됨 target_question_data['answer_type'];

    /**
         * question_audio_repeat, 오디오 반복 횟수
         */
    //Initial 할 때 이미 처리됨 target_question_data['question_audio_repeat'];
  }

  async prepareCustomAnswer(target_question, target_question_data, ip_data)
  {
    { //정답 오디오 준비는 비동기로 실행한다.
      const before_question_num = this.quiz_session.game_data['question_num'];
            
      const answer_audio_url = target_question_data['answer_audio_url'];

      const { answer_audio_play_time, answer_audio_start, answer_audio_end } = target_question_data;

      const [answer_audio_resource, answer_audio_play_time_ms, answer_error_message, answer_audio_file_stream_info] = 
            await this.generateAudioResourceFromWeb(
              answer_audio_url, 
              answer_audio_start, 
              answer_audio_end, 
              SYSTEM_CONFIG.MAX_ANSWER_AUDIO_PLAY_TIME, 
              ip_data
            );

      const after_question_num = this.quiz_session.game_data['question_num'];

      if(before_question_num != after_question_num)
      {
        return; 
      }
    
      // target_question['answer_audio_resource'] = answer_audio_resource; -> 일괄 생성하도록 변경했음
      target_question['answer_audio_play_time'] = answer_audio_play_time_ms;
        
      if (answer_error_message) 
      {
        target_question['author'].push(`\n\nAUDIO_ERROR: ${answer_error_message}`);
      }
      else
      {
        target_question['answer_audio_file_stream_info'] = answer_audio_file_stream_info;
      }
    }
  }

  /** audio_url_row: 오디오 url, audio_start_point: 오디오 시작 지점(sec), audio_end_point: 오디오 끝 지점(sec), audio_play_time_point: 재생 시간(sec)*/
  async generateAudioResourceFromWeb(audio_url, audio_start_point=undefined, audio_end_point=undefined,  max_play_time=undefined) 
  {
    if(audio_url == undefined)
    {
      return [undefined, undefined, undefined, undefined];
    }

    let error_message;

    const video_id = utility.extractYoutubeVideoID(audio_url);
    if(video_id == undefined || video_id == '')
    {
      logger.warn(`${audio_url} has no video id`);
      error_message = `${audio_url} has no video id`;
      return [undefined, undefined, error_message];
    }

    //캐시 체크 및 다운로드
    const cache_file_name = `${video_id}.webm`;
    let cache_file_path = audio_cache_manager.getAudioCache(video_id);
    if(cache_file_path == undefined) //no cache file
    {
      const cache_info = audio_cache_manager.getAudioCacheInfo(video_id);
      if(cache_info?.cache_result.need_retry == false) //이 경우 어차피 재시도해도 캐싱 안되는건 똑같은거임
      {
        logger.info(`Skip downloading cache reason: ${cache_info.cache_result.causation_message}`);
        return [undefined, undefined, cache_info.cache_result.causation_message];
      }

      logger.info(`No cache file of ${video_id}. downloading cache`);
            
      this.quiz_session.sendMessage({content: `\`\`\`🔸 현재 재생할 오디오에 대한 캐시가 없어 다운로드 중입니다. 시간이 좀 걸릴 수 있습니다... ㅜㅜ 😥\`\`\``});

      const ip_info = {
        ipv4: this.quiz_session.ipv4,    
        ipv6: this.quiz_session.ipv6,
      };
      const result = await audio_cache_manager.downloadAudioCache(audio_url, video_id, ip_info);

      if(result.success == false) //캐시 다운로드 실패...ㅜㅜ
      {
        logger.info(`Failed to downloading cache reason: ${result.causation_message}`);
        return [undefined, undefined, result.causation_message];
      }
      else
      {
        cache_file_path = audio_cache_manager.getAudioCache(video_id);
      }
    }
    else
    {
      logger.debug(`Found cache file of ${video_id}.`);
    }
        
    //캐시 다운로드 성공 또는 이미 캐시 존재!
        
    //재생 길이 구하기, 구간 지정했으면 그래도 재생할 수 있는 최대치는 재생해줄거임
    const audio_info = audio_cache_manager.getAudioCacheInfo(video_id);
    let  audio_duration_sec = audio_info.duration ?? 0;

    if(audio_duration_sec == undefined)
    {
      logger.warn(`no audio duration by getAudioCacheDuration. ${cache_file_name}`);
      const audio_info =  await utility.getAudioInfoFromPath(cache_file_path);
      audio_duration_sec = parseInt(audio_info.format.duration);
    }

    const option_data = this.quiz_session.option_data;
    let audio_length_sec = Math.floor(option_data.quiz.audio_play_time / 1000); //우선 서버 설정값

    if(audio_start_point == undefined || audio_start_point >= audio_duration_sec) //시작 요청 값 없거나, 시작 요청 구간이 오디오 범위 넘어서면
    {
      audio_start_point = 0; //구간 요청값 무시
      audio_end_point = audio_duration_sec;
    }
    else //커스텀 구간이 잘 있다?
    {
      if(audio_end_point == undefined || audio_end_point > audio_duration_sec) //끝 요청 값 없거나, 오디오 길이 초과화면 자동으로 최대치
      {
        audio_end_point = audio_duration_sec;
      }

      audio_length_sec = audio_end_point - audio_start_point; //우선 딱 구간만큼만 재생
    }

    if(audio_length_sec > audio_duration_sec)
    {
      audio_length_sec = audio_duration_sec; //오디오 길이보다 더 재생할 순 없다.
    }

    if(audio_length_sec > max_play_time) 
    {
      audio_length_sec = max_play_time; //최대치를 넘어설 순 없다
    }

    //오디오 시작 지점이 될 수 있는 포인트 범위
    const audio_min_start_point = audio_start_point;
    const audio_max_start_point = audio_end_point - audio_length_sec;
    const use_improved_audio_cut = (option_data.quiz.improved_audio_cut === OPTION_TYPE.ENABLED);

    //오디오 자르기 기능
    audio_start_point = this.getRandomAudioStartPoint(audio_min_start_point, audio_max_start_point, audio_length_sec, use_improved_audio_cut);
    logger.debug(`cut audio: ${audio_url}, point: ${audio_start_point} ~ ${(audio_start_point + audio_length_sec)}`);

    const audio_file_stream_info = { //멀티에서 쓰려고 있는거임 -> 아니다 통일 성을 위해 모두 이걸 기반으로 audio resource 생성 ㄱㄱ
      file_path: cache_file_path,
      audio_duration_sec: audio_duration_sec,
      audio_start_point: audio_start_point,
      audio_length_sec: audio_length_sec,
    };

    return [undefined, audio_length_sec * 1000, undefined, audio_file_stream_info];
  }
}

//#endregion

module.exports = Prepare;
