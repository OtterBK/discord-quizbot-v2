'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const { MessageFlags } = require('discord.js');

const { QuizLifeCycleWithUtility } = require('../quiz_lifecycle.js');
const { CYCLE_TYPE } = require('../../constants.js');
const session_registry = require('../../session_registry.js');
const option_system = require('../../../quiz_option/quiz_option.js');
const OPTION_TYPE = option_system.OPTION_TYPE;
const { SYSTEM_CONFIG, ANSWER_TYPE, BGM_TYPE } = require('../../../../config/system_setting.js');
const text_contents = require('../../../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const utility = require('../../../../utility/utility.js');
const logger = require('../../../../utility/logger.js')('QuizSystem');

//#region Question Cycle
/** 퀴즈 내는 단계인 Question, 여기가 제일 처리할게 많다. **/
class Question extends QuizLifeCycleWithUtility
{
  static cycle_type = CYCLE_TYPE.QUESTIONING;
  constructor(quiz_session)
  {
    super(quiz_session);
    this.next_cycle = CYCLE_TYPE.TIMEOVER;

    this.current_question = undefined; //현재 진행 중인 퀴즈

    this.hint_timer = undefined; //자동 힌트 타이머
    this.timeover_timer = undefined; //타임오버 timer id
    this.timeover_resolve = undefined; //정답 맞췄을 시 강제로 타임오버 대기 취소
    this.fade_out_timer = undefined;
    this.wait_for_answer_timer = undefined; //정답 대기 timer id
    this.already_start_fade_out = false;

    this.skip_prepare_cycle = false; //마지막 문제라면 더 이상 prepare 할 필요없음
    this.progress_bar_timer = undefined; //진행 bar
    this.progress_bar_fixed_text = undefined; //진행 bar 위에 고정할 text, 진행 bar 흐르는 중간에 표시할 수도 있으니 this로 둔다.
    this.answers = undefined; //문제 정답 목록

    this.is_timeover = false;
    this.timeover_wait = undefined; //타임오버 대기 시간
    this.timeover_timer_created = undefined; //타임오버 타이머 시작 시간

    this.answer_type = ANSWER_TYPE.SHORT_ANSWER; //문제 유형
    this.selected_choice_map = undefined; //객관식 퀴즈에서 각자 선택한 답안

    this.hint_voted_user_list = []; //힌트 투표 이미했는지 확인
    this.skip_voted_user_list = []; //스킵 투표 이미했는지 확인
    this.used_chance_map = {}; //정답 제출 몇 번 시도했는지
  }

  async enter()
  {
    let quiz_data = this.quiz_session.quiz_data;
    let game_data = this.quiz_session.game_data;

    if(this.quiz_session.force_stop == true) return false;

    this.current_question = undefined; //현재 진행 중인 퀴즈

    this.hint_timer = undefined; //자동 힌트 타이머
    this.timeover_timer = undefined; //타임오버 timer id
    this.timeover_resolve = undefined; //정답 맞췄을 시 강제로 타임오버 대기 취소
    this.wait_for_answer_timer = undefined; //정답 대기 timer id
    this.fade_out_timer = undefined;
    this.already_start_fade_out = false;

    this.skip_prepare_cycle = false;
    this.progress_bar_timer = undefined; //진행 bar
    this.progress_bar_fixed_text = undefined; //진행 bar 위에 고정할 text
    this.answers = undefined; //문제 정답 목록

    this.is_timeover = false;
    this.timeover_wait = undefined;
    this.timeover_timer_created = undefined;

    this.answer_type = ANSWER_TYPE.SHORT_ANSWER; //문제 유형
    this.selected_choice_map = undefined; //객관식 퀴즈에서 각자 선택한 답안

    this.hint_voted_user_list.length = 0; //힌트 투표 이미했는지 확인
    this.skip_voted_user_list.length = 0; //스킵 투표 이미했는지 확인
    this.used_chance_map = {}; //정답 제출 몇 번 시도했는지

    if(this.quiz_session.hasMoreQuestion() === false) //모든 퀴즈 제출됐음
    {
      this.next_cycle = CYCLE_TYPE.ENDING;
      this.skip_prepare_cycle = true;
      this.current_question = undefined;
      logger.info(`All Question Submitted, guild_id:${this.quiz_session.guild_id}`);
      return; //더 이상 진행할 게 없다.
    }

    this.stopAudioList(); //시작 전엔 audio stop 걸고 가자

    //진행 UI 관련
    this.sendBGM(BGM_TYPE.ROUND_ALARM);
    let quiz_ui = await this.createQuestionUI();
    const essential_term = Date.now() + 2500; //최소 문제 제출까지 2.5초간의 텀은 주자

    //아직 prepared queue에 아무것도 없다면
    let current_check_prepared_queue = 0;
    const max_try = SYSTEM_CONFIG.MAX_CHECK_PREPARED_QUEUE;
    const check_interval = SYSTEM_CONFIG.PREPARED_QUEUE_CHECK_INTERVAL;
    // const max_try = 40; //고정값으로 테스트해보자
    while(game_data.prepared_question_queue.length == 0)
    {
      if(this.quiz_session.force_stop == true) return false;

      if(++current_check_prepared_queue >= max_try) //최대 체크 횟수 초과 시
      {
        this.next_cycle = CYCLE_TYPE.CLEARING; 
        logger.error(`Prepared Queue is Empty, tried ${current_check_prepared_queue} * ${check_interval}..., going to CLEARING cycle, guild_id: ${this.quiz_session.guild_id}`);
        this.quiz_session.sendMessage({content: `\`\`\`🔸 예기치 않은 문제로 오디오 리소스 초기화에 실패했습니다...\n퀴즈가 강제 종료됩니다...\n서버 메모리 부족, 네트워크 연결 등의 문제일 수 있습니다.\`\`\``});

        const memoryUsage = process.memoryUsage();
        logger.error(`Memory Usage:, ${JSON.stringify({
          'Heap Used': `${memoryUsage.heapUsed / 1024 / 1024} MB`,
          'Heap Total': `${memoryUsage.heapTotal / 1024 / 1024} MB`,
          'RSS': `${memoryUsage.rss / 1024 / 1024} MB`,
          'External': `${memoryUsage.external / 1024 / 1024} MB`,
        })}`);

        this.forceStop();

        return false;
      }

      await utility.sleep(check_interval);
      // await utility.sleep(500); //고정값으로 테스트 해보자
    }
        
    this.current_question = game_data.prepared_question_queue.shift(); //하나 꺼내오자

    this.answer_type = this.current_question['answer_type'] ?? ANSWER_TYPE.SHORT_ANSWER;
    this.applyAnswerTypeToUI(); //answer_type 대로 컴포넌트 설정

    if(this.quiz_session.isMultiplayerSession()) //멀티면 참가자 목록 붙여주자
    {
      this.quiz_session.appendParticipantInfoMenu(quiz_ui);
    }

    //이제 문제 준비가 끝났다. 마지막으로 최소 텀 지키고 ㄱㄱ
    const left_term = essential_term - Date.now();
    if(left_term < 0) 
    {
      return;
    }
    await new Promise((resolve, reject) => 
    {
      setTimeout(() => 
      {
        resolve();
      }, left_term);
    });
  }

  async act()
  {
    //Base class라서 아무것도 안한다. Quiz Type 별로 여기에 동작 구현
  }

  exit()
  {
    this.quiz_session.has_current_question = false;
    
    if(this.progress_bar_timer != undefined)
    {
      clearInterval(this.progress_bar_timer);
    }

    if(this.hint_timer != undefined)
    {
      clearTimeout(this.hint_timer);
    }

    if(this.quiz_session.force_stop == true) //강제 종료가 호출됐다.
    {
      this.skip_prepare_cycle = true; //더 이상 prepare는 필요없다.
      this.stopTimeoverTimer(); //타임오버 타이머도 취소한다.
      return false;
    }

    if(this.skip_prepare_cycle == false)
    {
      this.asyncCallCycle(CYCLE_TYPE.PREPARE); //다음 문제 미리 준비
    }
  }

  applyAnswerTypeToUI()
  {
    const answer_type = this.answer_type;
    const quiz_ui = this.quiz_session.quiz_ui;

    if(answer_type == ANSWER_TYPE.OX)
    {
      quiz_ui.components.push(quiz_ui.ox_quiz_comp);
    }
    else if(answer_type == ANSWER_TYPE.MULTIPLE_CHOICE)
    {
      quiz_ui.components.push(quiz_ui.multiple_quiz_comp);
    }
  }

  //UI관련
  async createQuestionUI()
  {
    let quiz_data = this.quiz_session.quiz_data;
    let game_data = this.quiz_session.game_data;
    const option_data = this.quiz_session.option_data;
    const quiz_ui = this.quiz_session.quiz_ui;

    const quiz_type = quiz_data['quiz_type'];

    quiz_ui.embed.color = 0xFED049;

    quiz_ui.embed.title = `[ ${quiz_data['icon']} ${quiz_data['title']} ]`;
        
    let footer_message = text_contents.quiz_play_ui.footer;
    footer_message = footer_message.replace("${quiz_question_num}", `${(game_data['question_num']+1)}`);
    footer_message = footer_message.replace("${quiz_size}", `${quiz_data['quiz_size']}`);
    footer_message = footer_message.replace("${option_hint_type}", `${option_data.quiz.hint_type}`);
    footer_message = footer_message.replace("${option_skip_type}", `${option_data.quiz.skip_type}`);
    footer_message = footer_message.replace("${option_score_type}", `${option_data.quiz.score_type}`);
    quiz_ui.embed.footer = {
      "text": footer_message,
    };
    let description_message = text_contents.quiz_play_ui.description;
    description_message = description_message.replace("${quiz_question_num}", `${(game_data['question_num']+1)}`);

    if(this.quiz_session.isMultiplayerSession())
    {
      description_message += `\n\`\`\`🔖 [Tip]. /챗' 명령어로 전체 대화가 가능합니다.\`\`\``;
    }

    quiz_ui.embed.description = description_message;

    let components = [quiz_ui.quiz_play_comp]; //기본 comp
    quiz_ui.components = components;

    quiz_ui.embed.fields = [];

    quiz_ui.setButtonStatus(0, option_data.quiz.hint_type == OPTION_TYPE.HINT_TYPE.AUTO ? false : true); //버튼 1,2,3 다 활성화
    quiz_ui.setButtonStatus(1, true); 
    quiz_ui.setButtonStatus(2, true);

    quiz_ui.setImage(undefined); //이미지 초기화

    await quiz_ui.send(false);

    return quiz_ui;
  }

  //힌트 표시
  async showHint(question)
  {
    if(question['hint_used'] == true || (question['hint'] == undefined && question['hint_image_url'] == undefined))
    {
      return;    
    }
    question['hint_used'] = true;

    let quiz_ui = this.quiz_session.quiz_ui;
    quiz_ui.setButtonStatus(0, false); //힌트 버튼 비활성화
    quiz_ui.update();

    const hint = question['hint'];
    const channel = this.quiz_session.channel;
    let hint_message = text_contents.quiz_play_ui.show_hint;
    hint_message = hint_message.replace("${hint}", hint);

    if(question['hint_image_url'] != undefined)
    {
      const hint_image_url = question['hint_image_url'];
      const hint_embed = {
        color: 0x05f1f1,
        title: `${text_contents.quiz_play_ui.hint_title}`,
        description: `${hint_message}`,
        image: {
          url: utility.isValidURL(hint_image_url) ? hint_image_url : '',
        }
      };

      channel.send({embeds: [hint_embed]});
    }
    else
    {
      channel.send({content: hint_message});
    }
  }

  //스킵
  async skip(question)
  {
    if(question['skip_used'] == true)
    {
      return;    
    }
    question['skip_used'] = true;

    let quiz_ui = this.quiz_session.quiz_ui;
    quiz_ui.setButtonStatus(1, false); //스킵 버튼 비활성화
    quiz_ui.update();

    const channel = this.quiz_session.channel;
    let skip_message = text_contents.quiz_play_ui.skip;
    channel.send({content: skip_message});
        
    await this.stopTimeoverTimer(); //그리고 다음으로 진행 가능하게 타임오버 타이머를 중지해줌
  }

  //진행 bar 시작
  async startProgressBar(audio_play_time)
  {
    if(audio_play_time < 10000) //10초 미만은 지원하지 말자
    {
      return;
    }

    //진행 상황 bar, 10%마다 호출하자
    const progress_max_percentage = 10;
    const progress_bar_interval = audio_play_time / progress_max_percentage;
    let progress_percentage = 0; //시작은 0부터
        
    let quiz_ui = this.quiz_session.quiz_ui;

    let progress_bar_string = this.getProgressBarString(progress_percentage, progress_max_percentage);
    quiz_ui.embed.description = this.progress_bar_fixed_text ?? '';
    quiz_ui.embed.description += ` \n \n🕛 **${progress_bar_string}**\n \n \n`;
    quiz_ui.update(); // 우선 한 번은 그냥 시작해주고~

    const progress_bar_timer = setInterval(() => 
    {

      ++progress_percentage;

      let progress_bar_string = this.getProgressBarString(progress_percentage, progress_max_percentage);

      quiz_ui.embed.description = this.progress_bar_fixed_text ?? '';
      quiz_ui.embed.description += ` \n \n⏱ **${progress_bar_string}**\n \n \n`;
      quiz_ui.update();

    }, progress_bar_interval);

    this.progress_bar_timer = progress_bar_timer;
  }

  getProgressBarString(progress_percentage, progress_max_percentage)
  {
    if(progress_percentage == progress_max_percentage)
    {
      clearInterval(this.progress_bar_timer);
    }

    let progress_bar_string = '';
    for(let i = 0; i < progress_max_percentage; i++)
    {
      if(i <= progress_percentage)
      {
        progress_bar_string += text_contents.icon.ICON_PROGRESS_PROGRESSED;
      }
      else
      {
        progress_bar_string += text_contents.icon.ICON_PROGRESS_WATING;
      }
    }
    return progress_bar_string;
  }

  //정답 맞췄을 때
  async submittedCorrectAnswer(requester)
  {
    if(this.current_question['answer_requesters'] !== undefined) //이미 맞춘사람 있다면 패스
    {
      return;
    }
    
    if(this.timeover_timer === undefined)
    {
      return;
    }
    
    const score = this.calculateScore();

    if(this.quiz_session.isMultiplayerSession() && this.quiz_session.isMultiplayerSessionExpired() === false)
    {
      this.quiz_session.sendRequestAnswerHit(requester.id, requester.displayName, score);
      return;
    }

    this.applyCorrectAnswer(requester.id, requester.displayName, score);

    this.stopTimeoverTimer(); //맞췄으니 타임오버 타이머 중지!
  }

  applyCorrectAnswer(answerer_id, answerer_name, score)
  {
    if(this.current_question['answer_members'] === undefined)
    {
      this.current_question['answer_members'] = [];
    }

    this.current_question['answer_members'].push(answerer_id);
    
    let scoreboard = this.quiz_session.scoreboard;
    let answerer_info = scoreboard.get(answerer_id);
    
    if(answerer_info === undefined)
    {
      answerer_info = {
        name: answerer_name,
        score: score
      };

      scoreboard.set(answerer_id, answerer_info);
    }
    else
    {
      answerer_info.name = answerer_name;
      answerer_info.score += score;
    }
  }  

  hasAnswerer()
  {
    return this.current_question['answer_members'] !== undefined;
  }

  calculateScore()
  {
    let score = 1;

    const score_type = this.quiz_session.option_data.quiz.score_type;
    if(score_type == OPTION_TYPE.SCORE_TYPE.TIME) //남은 시간 비례 가산점 방식이면
    {
      const max_multiple = 10;
      let multiple = 1;
      const answer_submitted_time = Date.now();
      const timeover_start = this.timeover_timer_created;
      const timeover_wait = this.timeover_wait;

      const time_gap = answer_submitted_time - timeover_start; //맞추기까지 걸린 시간
      if(time_gap < 0) //음수일리가 없는데...음수면 최대!
      { 
        multiple = max_multiple;
      }
      else
      {
        multiple = max_multiple - parseInt(time_gap * max_multiple / timeover_wait);
        if(multiple <= 0) multiple = 1;
      }
      score *= multiple;
    }

    return score;
  }

  isSkipped()
  {
    return this.current_question['skip_used'] === true;
  }

  //타임오버 타이머 중지
  async stopTimeoverTimer()
  {
    if(this.timeover_timer != undefined)
    {
      clearTimeout(this.timeover_timer); //타임오버 타이머 중지
    }
        
    if(this.fade_out_timer != undefined)
    {
      clearTimeout(this.fade_out_timer); //fadeout timer 중지
    }

    if(this.wait_for_answer_timer != undefined)
    {
      clearTimeout(this.wait_for_answer_timer); //fadeout timer 중지
    }

    if(this.timeover_resolve != undefined)
    {
      this.timeover_resolve('force stop timeover timer'); //타임오버 promise await 취소
    }
  }

  //자동 힌트 체크
  async checkAutoHint(audio_play_time) 
  {
    const option_data = this.quiz_session.option_data;
    if(this.quiz_session.isMultiplayerSession() == false && option_data.quiz.hint_type != OPTION_TYPE.HINT_TYPE.AUTO) //싱글 퀴즈에서 자동 힌트 사용 중이 아니라면
    {
      return;
    }   

    //멀티플레이는 자동 힌트도 무조건 되게함

    const hint_timer_wait = audio_play_time / 2; //절반 지나면 힌트 표시할거임
    const hint_timer = setTimeout(() => 
    {
      this.showHint(this.current_question); //현재 퀴즈 hint 표시
    }, hint_timer_wait);
    this.hint_timer = hint_timer;
  }

  //정답 대기 타이머 생성 및 지연 시작
  async createWaitForAnswerTimer(delay_time, wait_time, bgm_type)
  {
    this.wait_for_answer_timer = setTimeout(async () => 
    {

      if(this.progress_bar_timer != undefined)
      {
        clearTimeout(this.progress_bar_timer);
      }
      const audio_player = this.quiz_session.audio_player;
      this.stopAudioList();
      this.sendBGM(bgm_type);
      this.startProgressBar(wait_time);
      this.is_playing_bgm = true;

    }, delay_time);
    return this.wait_for_answer_timer;
  }

  //타임오버 타이머 생성 및 시작
  async createTimeoverTimer(timeover_wait)
  {
    this.timeover_wait = timeover_wait;
    this.timeover_timer_created = Date.now();
    this.is_timeover = false;
    const audio_player = this.quiz_session.audio_player;
    const timeover_promise = new Promise((resolve, reject) => 
    {

      this.timeover_resolve = resolve; //정답 맞췄을 시, 이 resolve를 호출해서 promise 취소할거임
      this.timeover_timer = setTimeout(async () => 
      {

        this.is_timeover = true; 

        let graceful_timeover_try = 0;
        while(audio_player.state.status == 'playing'
                     && graceful_timeover_try++ < SYSTEM_CONFIG.GRACEFUL_TIMEOVER_MAX_TRY) //오디오 완전 종료 대기
        {
          await utility.sleep(SYSTEM_CONFIG.GRACEFUL_TIMEOVER_INTERVAL);
        }

        if(audio_player.state.status == 'playing' && SYSTEM_CONFIG.GRACEFUL_TIMEOVER_MAX_TRY > 0) //아직도 오디오 플레이 중이고 graceful 옵션 사용 중이면
        {
          logger.warn(`Graceful timeover, guild_id:${this.quiz_session.guild_id}, graceful_count: ${graceful_timeover_try}/${SYSTEM_CONFIG.GRACEFUL_TIMEOVER_MAX_TRY}`);
        }

        resolve('done timeover timer');

      }, timeover_wait);
    });
    return timeover_promise;
  }

  //부드러운 오디오 종료
  /** Deprecated */
  /**
  async gracefulAudioExit(audio_player, resource, fade_in_end_time)
  {
    if(this.already_start_fade_out == true) //이미 fadeout 진입했다면 return
    {
      return;
    }

    if(SYSTEM_CONFIG.USE_INLINE_VOLUME)
    {
      if(resource == undefined || resource.volume == undefined) return;

      let fade_out_duration = SYSTEM_CONFIG.FACE_OUT_DURATION;
      const fade_in_left_time = (Date.now() - (fade_in_end_time ?? 0)) * -1;
      if(fade_in_left_time > 0) //아직 fade_in이 안끝났다면
      {
        fade_out_duration = SYSTEM_CONFIG.CORRECT_ANSWER_CYCLE_WAIT - fade_in_left_time - 1000; //fadeout duration 재계산, 1000ms는 padding
        if(fade_out_duration > 1000) //남은 시간이 너무 짧으면 걍 패스
        {
          this.current_question['fade_out_timer'] = setTimeout(() => 
          {
            this.already_start_fade_out = true;
            utility.fade_audio_play(audio_player, resource, resource.volume.volume, 0, fade_out_duration);
          }, fade_in_left_time); //fade_in 끝나면 호출되도록
        }
      }
      else
      {
        this.already_start_fade_out = true;
        utility.fade_audio_play(audio_player, resource, resource.volume.volume, 0, fade_out_duration);
      }
    }
  }
  */

  /** 이벤트 핸들러 **/
  onInteractionCreate(interaction)
  {
    if(interaction.isChatInputCommand())
    {
      this.handleChatInputCommand(interaction);
    }

    if(interaction.isButton())
    {
      this.handleButtonCommand(interaction);
    }
  }

  checkAnswerHit(message_content)
  {
    const submit_answer = message_content.trim().replace(/ /g, '').toLowerCase();

    return this.answers.includes(submit_answer);
  }

  handleSimpleRequest(member, message_content)
  {
    if(message_content === 'ㅎ')
    {
      this.requestHint(member);
      return true;
    }

    if(message_content === 'ㅅ')
    {
      this.requestSkip(member);
      return true;
    }

    return false;
  }

  processChance(member)
  {
    const option_data = this.quiz_session.option_data;
    const max_chance = option_data.quiz.max_chance;

    if(max_chance == OPTION_TYPE.UNLIMITED)
    {
      return 10000;
    }

    const member_id = member.id;
    let used_chance = this.used_chance_map[member_id] || 0;
    this.used_chance_map[member_id] = (++used_chance);

    return max_chance - used_chance;
  }

  onMessageCreate(message)
  {
    const option_data = this.quiz_session.option_data;

    if(message.author == session_registry.bot_client.user) return;

    if(option_data.quiz.use_message_intent == OPTION_TYPE.DISABLED) return; //Message Intent 안쓴다면 return

    if(message.channel != this.quiz_session.channel) return; //퀴즈 진행 중인 채널 아니면 return

    if(this.timeover_timer_created == undefined) return; //아직 timeover 시작도 안했다면 return

    if(this.answer_type != ANSWER_TYPE.SHORT_ANSWER) return; //단답형 아니면 PASS

    if(message.member === undefined) return; //이건 길드 메시지 아니면 pass

    const message_content = message.content ?? '';
    const requester = message.member;

    if(message_content == '') 
    {
      return;
    }

    const is_request_message = this.handleSimpleRequest(requester, message_content);
    const remain_chance = is_request_message ? 10000 : this.processChance(requester);

    if(remain_chance < 0) //no more chance
    {
      return;
    }

    if(this.checkAnswerHit(message_content) == false) //오답
    {
      if(remain_chance == 0) //라스트 찬스였으면
      {
        message.reply({content: `\`\`\`🔸 땡! 이번 문제의 정답 제출 기회를 모두 사용했어요.\`\`\``, flags: MessageFlags.Ephemeral});
      }

      return;
    }

    this.submittedCorrectAnswer(requester);
  }

  async handleChatInputCommand(interaction)
  {
    if(interaction.commandName === '답') 
    {

      if(this.timeover_timer_created == undefined) return; //아직 timeover 시작도 안했다면 return

      if(this.answer_type != ANSWER_TYPE.SHORT_ANSWER) return; // 단답형 아니면 pass
    
      const message_content = interaction.options.getString('답안') ?? '';

      const requester = this.quiz_session.isMultiplayerSession() ? interaction.user : interaction.member;
    
      if(message_content == '') 
      {
        return;
      }

      const is_request_message = this.handleSimpleRequest(requester, message_content);
      const remain_chance = is_request_message ? 10000 : this.processChance(requester);
    
      if(remain_chance < 0) //no more chance
      {
        const reply_message = `이번 문제의 정답 제출 기회를 모두 사용했어요.`;
        interaction.explicit_replied = true;
        interaction.reply({content: reply_message, flags: MessageFlags.Ephemeral})
          .catch(err => 
          {
            logger.error(`Failed to replay to wrong submit, guild_id:${this.quiz_session.guild_id}, err: ${err.stack}`);
          });
        return;
      }
    
      if(this.checkAnswerHit(message_content) == false) //오답
      {
        let reply_message = "```";
        reply_message += `🔸 ${utility.sanitizeName(requester.displayName)}: [ ${message_content} ]... 오답입니다!`;

        if(remain_chance == 0) //라스트 찬스였음
        {
          reply_message += `\n이번 문제의 정답 제출 기회를 모두 사용했어요.`;
        }
        else if(remain_chance > 0)
        {
          reply_message += `\n기회가 ${remain_chance}번 남았어요.`;
        }

        reply_message += "```";
                
        interaction.explicit_replied = true;
        interaction.reply({content: reply_message, flags: MessageFlags.Ephemeral})
          .catch(err => 
          {
            logger.error(`Failed to replay to wrong submit, guild_id:${this.quiz_session.guild_id}, err: ${err.stack}`);
          });
    
        return;
      }
            
      this.submittedCorrectAnswer(requester);

      let message = "```" + `${utility.sanitizeName(requester.displayName)}: [ ${message_content} ]... 정답입니다!` + "```";
      interaction.explicit_replied = true;
      interaction.reply({content: message})
        .catch(err => 
        {
          logger.error(`Failed to replay to correct submit, guild_id:${this.quiz_session.guild_id}, err: ${err.stack}`);
        });
    }
  }

  async handleButtonCommand(interaction)
  {
    if(this.timeover_timer == undefined)
    {
      return; //타임 오버 타이머 시작도 안했는데 누른거면 패스한다.
    }

    if(interaction.customId === 'hint') 
    {
      this.requestHint(interaction.member);
      return;
    }

    if(interaction.customId === 'skip') 
    {
      this.requestSkip(interaction.member);
      return;
    }

    if(interaction.customId.startsWith("choice_")) //버튼형 정답 입력일 경우
    {
      const selected_value = interaction.customId;
      const selected_choice = selected_value.substring(7).toLowerCase(); // "choice_"의 길이는 7

      const member = interaction.member;

      if(this.selected_choice_map == undefined) 
      {
        this.selected_choice_map = new Map();
      }

      this.selected_choice_map.set(member, selected_choice);

      interaction.explicit_replied = true;
      interaction.reply({ content: `\`\`\`🔸 선택한 정답: ${this.choiceAsIcon(selected_choice)}\`\`\``, flags: MessageFlags.Ephemeral });
    }
  }

  choiceAsIcon(choice)
  {
    switch(choice)
    {
    case 'o': return '⭕';
    case 'x': return '❌';
    case '1': return '1️⃣';
    case '2': return '2️⃣';
    case '3': return '3️⃣';
    case '4': return '4️⃣';
    case '5': return '5️⃣';

    default: return choice;
    }
  }

  requestHint(member)
  {
    const option_data = this.quiz_session.option_data;
    const current_question = this.current_question;
    if(current_question == undefined) 
    {
      return;
    }

    //2중 체크의 필요성이 있나?
    // if(current_question['hint_used'] == true 
    //     || (current_question['hint'] == undefined && current_question['hint_image_url'] == undefined)) //2중 체크
    // {
    //     return;
    // }
    const requester_id = this.quiz_session.isMultiplayerSession() ? member.guild.id : member.id;
    if(this.hint_voted_user_list.includes(requester_id))
    {
      return;
    }

    this.hint_voted_user_list.push(requester_id);

    if(this.quiz_session.isMultiplayerSession() && this.quiz_session.isMultiplayerSessionExpired() === false)
    {
      this.quiz_session.sendRequestHint();
      return;
    }

    if(option_data.quiz.hint_type == OPTION_TYPE.HINT_TYPE.OWNER) //주최자만 hint 사용 가능하면
    {
      if(requester_id == this.quiz_session.owner.id)
      {
        this.showHint(current_question);
        return;
      }
      const reject_message = '```' + `${text_contents.quiz_play_ui.only_owner_can_use_hint}` +'```';
      this.quiz_session.sendMessage({content: reject_message});
    }
    else if(option_data.quiz.hint_type == OPTION_TYPE.HINT_TYPE.VOTE)
    {
      const voice_channel = this.quiz_session.voice_channel;
      const vote_criteria = parseInt((voice_channel.members.size - 2) / 2) + 1; 

      current_question['hint_vote_count'] = current_question['hint_vote_count'] == undefined ? 1 : current_question['hint_vote_count'] + 1;

      let hint_vote_message = text_contents.quiz_play_ui.hint_vote;
      hint_vote_message = hint_vote_message.replace("${who_voted}", utility.sanitizeName(member.displayName));
      hint_vote_message = hint_vote_message.replace("${current_vote_count}", current_question['hint_vote_count'] );
      hint_vote_message = hint_vote_message.replace("${vote_criteria}", vote_criteria);
      this.quiz_session.sendMessage({content: hint_vote_message});
      if(current_question['hint_vote_count']  >= vote_criteria)
      {
        this.showHint(current_question);
      }

    }
  }

  requestSkip(member)
  {
    const option_data = this.quiz_session.option_data;
    const current_question = this.current_question;
    if(current_question == undefined) 
    {
      return;
    }

    const requester_id = this.quiz_session.isMultiplayerSession() ? member.guild.id : member.id;
    if(this.skip_voted_user_list.includes(requester_id))
    {
      return;
    }

    this.skip_voted_user_list.push(requester_id);

    if(this.quiz_session.isMultiplayerSession() && this.quiz_session.isMultiplayerSessionExpired() === false)
    {
      this.quiz_session.sendRequestSkip();
      return;
    }

    if(option_data.quiz.skip_type == OPTION_TYPE.SKIP_TYPE.OWNER) //주최자만 skip 사용 가능하면
    {
      if(requester_id == this.quiz_session.owner.id)
      {
        this.skip(this.current_question);
        return;
      }
      const reject_message = '```' + `${text_contents.quiz_play_ui.only_owner_can_use_skip}` +'```';
      this.quiz_session.sendMessage({content: reject_message});
    }
    else if(option_data.quiz.skip_type == OPTION_TYPE.SKIP_TYPE.VOTE)
    {
      const voice_channel = this.quiz_session.voice_channel;
      const vote_criteria = parseInt((voice_channel.members.size - 2) / 2) + 1; 

      current_question['skip_vote_count'] = current_question['skip_vote_count'] == undefined ? 1 : current_question['skip_vote_count'] + 1;

      let skip_vote_message = text_contents.quiz_play_ui.skip_vote;
      skip_vote_message = skip_vote_message.replace("${who_voted}", utility.sanitizeName(member.displayName));
      skip_vote_message = skip_vote_message.replace("${current_vote_count}", current_question['skip_vote_count']);
      skip_vote_message = skip_vote_message.replace("${vote_criteria}", vote_criteria);
      this.quiz_session.sendMessage({content: skip_vote_message});

      if(current_question['skip_vote_count'] >= vote_criteria)
      {
        this.skip(current_question);
      }
    }
  }
}

module.exports = Question;
