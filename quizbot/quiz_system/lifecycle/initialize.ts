'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const fs = require('fs');

const { QuizLifeCycle } = require('./quiz_lifecycle');
const { CYCLE_TYPE, MULTIPLAYER_COMMON_OPTION } = require('../constants');
const QuizPlayUI = require('../quiz_play_ui');
const option_system = require('../../quiz_option/quiz_option.js');
const OPTION_TYPE = option_system.OPTION_TYPE;
const { SYSTEM_CONFIG, QUIZ_TYPE, ANSWER_TYPE } = require('../../../config/system_setting.js');
const text_contents = require('../../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const utility = require('../../../utility/utility.js');
const logger = require('../../../utility/logger.js')('QuizSystem');
const tagged_dev_quiz_manager = require('../../managers/tagged_dev_quiz_manager');
const { loadQuestionListFromDBByTags, loadQuestionListByBasket, addPlayedCountByQuiz } = require('../../managers/user_quiz_info_manager');

//#region Initialize Cycle
/** 처음 초기화 시 동작하는 Initialize Cycle들 **/
class Initialize extends QuizLifeCycle
{
  static cycle_type = CYCLE_TYPE.INITIALIZING;
  constructor(quiz_session: any)
  {
    super(quiz_session);
    this.next_cycle = CYCLE_TYPE.EXPLAIN;
    this.initialize_success = true;
  }

  async enter() //모든 Initialize 단계에서 공통
  {
    try
    {
      await this.basicInitialize();
    }
    catch(err: any)
    {
      this.initialize_success = false;
      logger.error(`Failed to basic initialize of quiz session, guild_id:${this.quiz_session.guild_id}, cycle_info:${this.cycle_info}, quiz_info: ${JSON.stringify(this.quiz_session.quiz_info)}, err: ${err.stack}`);
    }
  }

  async act() //quiz_maker_type 별로 다르게 동작
  {

  }

  async exit()
  {
    if(this.initialize_success == false)
    {
      const channel = this.quiz_session.channel;
      let fail_message = text_contents.quiz_play_ui.initialize_fail;
      fail_message = fail_message.replace("${quiz_title}", this.quiz_session.quiz_info['title']);
      channel.send({content: fail_message});
      this.forceStop(false);
      return false;
    }

    if(this.quiz_session.isMultiplayerSession() === false) //멀티면 question list 받고 할거다
    {
      this.asyncCallCycle(CYCLE_TYPE.PREPARE); //미리 문제 준비
    }
  }

  async basicInitialize()
  {
    logger.info(`Start basic initialize of quiz session, guild_id:${this.quiz_session.guild_id}`);

    const guild = this.quiz_session.guild;
    const voice_channel = this.quiz_session.voice_channel;

    //보이스 커넥션
    this.quiz_session.createVoiceConnection();

    if(this.quiz_session.isMultiplayerSession())
    {
      //멀티는 공용 옵션
      this.quiz_session.option_data = MULTIPLAYER_COMMON_OPTION;
    }
    else
    {
      //옵션 로드
      this.loadOptionData().then((option_data: any) =>
      {
        this.quiz_session.option_data = option_data;
      });
    }

    //UI생성
    const quiz_ui = new QuizPlayUI(this.quiz_session.channel);
    await quiz_ui.send(true); //처음에는 기다려줘야한다. 안그러면 explain 단계에서 update할 ui가 없어서 안됨
    this.quiz_session.quiz_ui = quiz_ui;

    //우선 quiz_info 에서 필요한 내용만 좀 뽑아보자
    const quiz_info = this.quiz_session.quiz_info;

    const quiz_data: any = {};
    quiz_data['title'] = quiz_info['title'];
    quiz_data['icon'] = quiz_info['icon'];
    quiz_data['quiz_maker_type'] = quiz_info['quiz_maker_type'];
    quiz_data['description'] = quiz_info['description'];
    quiz_data['author'] = quiz_info['author'];
    quiz_data['quiz_type'] = quiz_info['quiz_type'];
    quiz_data['quiz_size'] = quiz_info['quiz_size'];
    quiz_data['thumbnail'] = quiz_info['thumbnail'];
    quiz_data['winner_nickname'] = quiz_info['winner_nickname'];
    quiz_data['question_list'] = [];

    const game_data = {
      'question_num': -1, //현재 내야하는 문제번호
      'scoreboard': {}, //점수표
      'ranking_list': [], //순위표
      'prepared_question_queue': [], //PREPARE Cycle을 거친 퀴즈 큐
      'processing_question': undefined, //Clearing 단계에서 정리할 이전 quiz
      'audio_stream_for_close': [], //Clearing 단계에서 정리할 stream
    };
    this.quiz_session.game_data = game_data;
    this.quiz_session.quiz_data = quiz_data;
  }

  async loadOptionData()
  {
    const guild_id = this.quiz_session.guild_id;
    const option_data = option_system.getOptionData(guild_id);

    return option_data;
  }

  //정답 인정 목록 뽑아내기
  generateAnswers(answers_row: any)
  {
    if(answers_row == undefined)
    {
      return [];
    }

    const option_data = this.quiz_session.option_data;

    const answers: string[] = [];
    const similar_answers: string[] = []; //유사 정답은 마지막에 넣어주자
    answers_row.forEach((answer_row: string) =>
    {

      answer_row = answer_row.trim();

      //유사 정답 추측
      let similar_answer = '';
      const words = answer_row.split(" ");
      if(words.length > 1)
      {
        words.forEach((split_answer) =>
        {
          if(split_answer.length == 0 || split_answer == ' ')
            return;
          similar_answer += split_answer.substring(0,1);
        });

        similar_answer = similar_answer.toLowerCase();
      }

      if(similar_answer != '')
      {
        if(answers.includes(similar_answer) == false && similar_answers.includes(similar_answer) == false)
          similar_answers.push(similar_answer);
      }

      const answer = answer_row.replace(/ /g,"").toLowerCase(); // /문자/gi 로 replace하면 replaceAll 로 동작, g = 전역검색 i = 대소문자 미구분
      if(answers.includes(answer) == false)
        answers.push(answer);
    });

    if(option_data.quiz.use_similar_answer == OPTION_TYPE.ENABLED) //유사 정답 사용 시
    {
      similar_answers.forEach((similar_answer) =>
      { //유사 정답도 넣어주자
        answers.push(similar_answer);
      });
    }

    if(answers.length == 0)
    {
      logger.error(`Failed to make answer, guild_id:${this.quiz_session.guild_id}, answers_row:${JSON.stringify(answers_row)}`);
    }

    return answers;
  }

  //힌트 뽑아내기
  generateHint(base_answer: string)
  {
    base_answer = base_answer.trim();

    let hint: string | undefined = undefined;
    const letter_len = base_answer.replace(/ /g, "").length;

    if(letter_len == 1) //? 정답이 1글자?
    {
      return '◼'; //그럼 그냥 1글자 가려서 줘
    }

    const hintLen = Math.ceil(letter_len / SYSTEM_CONFIG.HINT_PERCENTAGE); //표시할 힌트 글자 수
    const hint_index: number[] = [];
    let success_count = 0;
    for(let i = 0; i < SYSTEM_CONFIG.HINT_MAX_TRY; ++i)
    {
      const rd_index = utility.getRandom(0, base_answer.length - 1); //자 랜덤 index를 가져와보자
      if(hint_index.includes(rd_index) == true || (base_answer.indexOf(String(rd_index)) as any) === ' ') //원래 단어의 맨 앞글자는 hint에서 제외하려 했는데 그냥 해도 될 것 같다.
      {
        continue;
      }
      hint_index.push(rd_index);
      if(++success_count >= hintLen) break;
    }

    const hint_row = base_answer;
    hint = '';
    for(let i = 0; i < hint_row.length; ++i)
    {
      const chr = hint_row[i];
      if(hint_index.includes(i) == true || chr === ' ')
      {
        hint += chr;
        continue;
      }
      hint += '◼';
    }

    if(hint == undefined)
    {
      logger.error(`Failed to make hint, guild_id:${this.quiz_session.guild_id}, base_answer:${base_answer}`);
    }

    return hint;
  }

  parseFromQuizTXT(txt_path: string)
  {
    const quiz_info = this.quiz_session.quiz_info;
    const quiz_data = this.quiz_session.quiz_data;

    //quiz.txt를 찾았다... 이제 이걸 파싱... 난 왜 이런 방식을 사용했던걸까..?
    const info_txt_path = `${txt_path}`;
    const info_data = fs.readFileSync(info_txt_path, 'utf8');

    const question_list: any[] = [];
    let parsed_question: any = {};

    info_data.split('\n').forEach((line: string) =>
    {
      if(line.trim() == '')  //공백 line 만나면 다음 퀴즈다.
      {
        if(parsed_question['question'] != undefined) //질문 파싱에 성공했다면
        {
          question_list.push(parsed_question); //파싱한 퀴즈 넣어주자
          parsed_question = {}; //파싱 퀴즈 초기화 ㄱㄱ
        }
        return;
      }

      if(line.startsWith('quiz_answer:')) //이게 정답이다
      {
        parsed_question['answer_string'] = line.replace('quiz_answer:', "").trim();
        return;
      }

      if(line.startsWith('desc:'))
      {
        parsed_question['author'] = [ line.replace('desc:', "").trim() ]; //author 로 바로 넣자
        return;
      }

      if(parsed_question['question'] == undefined)
      {
        parsed_question['question'] = line + "\n";
        return;
      }
      parsed_question['question'] += line + "\n"; //그 외에는 다 질문으로

    }); //한 줄씩 일어오자

    //이제 파싱한 퀴즈에 추가 설정을 진행한다.
    question_list.forEach((question) =>
    {
      const quiz_type = quiz_data['quiz_type'];
      question['type'] = quiz_type;

      question['hint_used'] = false;
      question['skip_used'] = false;
      question['play_bgm_on_question_finish'] = true; //Question cycle 종료 후 bgm 플레이 여부, 텍스트 기반 퀴즈는 true다.

      //정답 키워드 파싱
      const answer_string = question['answer_string'] ?? '';
      const answers_row = answer_string.split("&#"); //정답은 &#으로 끊었다.
      const answers = this.generateAnswers(answers_row);
      question['answers'] = answers;

      if(quiz_type != QUIZ_TYPE.OX) //ox 퀴즈는 힌트가 없다
      {
        //힌트 만들기
        let hint = undefined;
        if(answers_row.length > 0)
        {
          hint = this.generateHint(answers_row[0]) ?? undefined;
        }
        question['hint'] = hint;
      }

    });

    return question_list;
  }

  buildCustomQuestion(question_row: any)
  {
    const question: any = {};
    question['type']  = QUIZ_TYPE.CUSTOM;
    question['hint_used'] = false;
    question['skip_used'] = false;
    question['play_bgm_on_question_finish'] = false; //custom 퀴즈에서는 상황에 따라 다르다

    Object.keys(question_row).forEach((key) =>
    {
      const value = question_row[key];
      question[key] = value;
    });

    const question_data = question_row.data;

    /** 문제용 이벤트 */
    //정답 값 처리
    const answer_string = question_data['answers'];
    const answers_row = answer_string.split(","); //custom quiz는 ,로 끊는다
    const answers = this.generateAnswers(answers_row);
    question['answers'] = answers;

    //퀴즈용 오디오 url 처리
    //prepare 단계에서함

    //퀴즈용 음악 구간 처리
    //prepare 단계에서함

    //퀴즈용 이미지 url 처리
    question['image_resource'] = question_data['question_image_url'];

    //퀴즈용 텍스트 처리
    question['question_text'] = question_data['question_text'];


    /** 추가 정보 이벤트 */
    //힌트 값 처리
    const hint = question_data['hint'];
    if((hint == undefined || hint === '') && answers.length > 0)
    {
      question['hint'] = this.generateHint(answers[0]); //힌트 없으면 알아서 만들기
    }
    else
    {
      question['hint'] = question_data['hint']; //지정된 값 있으면 그대로
    }

    //힌트 이미지 처리
    question['hint_image_url'] = (question_data['hint_image_url'] ?? '').length == 0 ? undefined : question_data['hint_image_url'];

    //타임 오버 됐을 때 10초의 여유 시간 줄지 여부
    question['use_answer_timer'] = question_data['use_answer_timer'];


    /** 정답 공개 이벤트 */
    //정답용 오디오
    // prepare 단계에서함

    //정답용 음악 구간
    // prepare 단계에서함

    //정답 공개용 이미지 url
    question['answer_image_resource'] = question_data['answer_image_url'];

    //정답 공개용 텍스트
    question['author'] = [ question_data['answer_text'] ];

    //문제 유형(답변 유형)
    question['answer_type'] = question_data['answer_type'] ?? ANSWER_TYPE.SHORT_ANSWER; //지정된 값 있으면 그대로

    //문제용 오디오 반복
    question['question_audio_repeat'] = question_data['question_audio_repeat'];

    return question;
  }

  buildDevQuestion(quiz_path: string, question_folder_name: string)
  {
    const quiz_data = this.quiz_session.quiz_data;

    const question_folder_path = quiz_path + "/" + question_folder_name;
    const question_type = quiz_data['quiz_type'];

    //우선 퀴즈 1개 생성
    const question: any = {};
    question['type'] = question_type;
    question['hint_used'] = false;
    question['skip_used'] = false;
    question['play_bgm_on_question_finish'] = false; //Question cycle 종료 후 bgm 플레이 여부

    //작곡가 파싱
    let author_string = undefined;
    const try_parse_author =  question_folder_name.split("&^"); //가수는 &^로 끊었다.

    if(try_parse_author.length > 1) //가수 데이터가 있다면 넣어주기
    {
      author_string = try_parse_author[1];

      const authors: string[] = [];
      author_string.split("&^").forEach((author_row: string) =>
      {
        const author = author_row.trim();
        authors.push(author);
      });

      question['author'] = authors;
    }

    //정답 키워드 파싱
    let answer_string = try_parse_author[0];
    answer_string = question_folder_name.split("&^")[0];
    const answers_row = answer_string.split("&#"); //정답은 &#으로 끊었다.
    const answers = this.generateAnswers(answers_row);
    question['answers'] = answers;


    //힌트 만들기
    let hint = undefined;
    if(answers_row.length > 0)
    {
      hint = this.generateHint(answers_row[0]) ?? undefined;
    }
    question['hint'] = hint;

    //실제 문제로 낼 퀴즈 파일

    const question_file_list = fs.readdirSync(question_folder_path);
    question_file_list.forEach((question_folder_filename: string) =>
    {
      const file_path = question_folder_path + "/" + question_folder_filename;

      // const stat = fs.lstatSync(file_path); //이것도 성능 잡아먹는다. 어차피 개발자 퀴즈니깐 할 필요 없음
      // if(stat.isDirectory()) return; //폴더는 건너뛰고

      if(question_type == QUIZ_TYPE.SONG || question_type == QUIZ_TYPE.IMAGE || question_type == QUIZ_TYPE.SCRIPT || question_type == QUIZ_TYPE.IMAGE_LONG || question_type == QUIZ_TYPE.OMAKASE)
      {
        question['question'] = file_path; //SONG, IMAGE 타입은 그냥 손에 잡히는게 question 이다.
      }
      else if(question_type == QUIZ_TYPE.INTRO) //인트로 타입의 경우
      {
        if(utility.isImageFile(question_folder_filename)) //이미지 파일이면
        {
          question['answer_image'] = file_path; //answer 썸네일이다.
        }
        else if(question_folder_filename.startsWith('q')) //이게 question이다.
        {
          question['question'] = file_path;
          question['ignore_option_audio_play_time'] = true; //인트로의 노래 재생시간은 서버 영향을 받지 않음
          question['use_random_start'] = false; //인트로는 랜덤 스타트 안씀
          return;
        }
        else if(question_folder_filename.startsWith('a')) //이게 answer_audio이다.
        {
          question['answer_audio'] = file_path;
          question['answer_audio_play_time'] = undefined;  //TODO 이거 지정 가능
        }
      }

    });

    return question;
  }

  extractIpAddresses(quiz_session: any)
  {
    //Set Ipv4 info
    const ipv4 = utility.getIPv4Address()[0];
    if(ipv4 == undefined)
    {
      logger.info(`This session has no ipv4!, use default... wtf, guild_id:${quiz_session?.guild_id}`);
    }
    else
    {
      logger.info(`This session's selected ipv4 is ${ipv4} guild_id:${quiz_session?.guild_id}`);
      quiz_session.ipv4 = ipv4;
    }

    //Set Ipv6 info
    if(SYSTEM_CONFIG.YTDL_IPV6_USE)
    {
      const ipv6 = utility.getIPv6Address()[0];
      if(ipv6 == undefined)
      {
        logger.info(`This session is using ipv6, but cannot find ipv6... use default ip address..., guild_id:${quiz_session?.guild_id}`);
      }
      else
      {
        logger.info(`This session is using ipv6, selected ipv6 is ${ipv6}, guild_id:${quiz_session?.guild_id}`);
        quiz_session.ipv6 = ipv6;
      }
    }
  }
}

class InitializeDevQuiz extends Initialize
{
  constructor(quiz_session: any)
  {
    super(quiz_session);
  }

  async act() //dev 퀴즈 파싱
  {
    try
    {
      await this.devQuizInitialize();
    }
    catch(err: any)
    {
      this.initialize_success = false;
      logger.error(`Failed to dev quiz initialize of quiz session, guild_id:${this.quiz_session.guild_id}, cycle_info:${this.cycle_info}, quiz_data: ${JSON.stringify(this.quiz_session.quiz_data)}, err: ${err.stack}`);
    }
  }

  async devQuizInitialize()
  {
    logger.info(`Start dev quiz initialize of quiz session, guild_id:${this.quiz_session.guild_id}`);

    const quiz_info = this.quiz_session.quiz_info;
    const quiz_data = this.quiz_session.quiz_data;
    const quiz_path = quiz_info['quiz_path'];
    //실제 퀴즈들 로드
    let question_list: any[] = [];

    const quiz_folder_list = fs.readdirSync(quiz_path);

    const question_type = quiz_data['quiz_type'];
    quiz_folder_list.forEach((question_folder_name: string) =>
    {

      if(question_folder_name.includes("info.txt")) return;

      if(question_folder_name.includes("quiz.txt")) //엇 quiz.txt 파일이다.
      {
        if(question_type != QUIZ_TYPE.TEXT && question_type != QUIZ_TYPE.TEXT && question_type != QUIZ_TYPE.OX) //그런데 텍스트 기반 퀴즈가 아니다?
        {
          return; //그럼 그냥 return
        }

        const question_folder_path = quiz_path + "/" + question_folder_name;
        question_list = this.parseFromQuizTXT(question_folder_path); //quiz.txt 에서 파싱하는 걸로...
        return;
      }

      const question = this.buildDevQuestion(quiz_path, question_folder_name);

      //question_list에 넣어주기
      if(question != undefined)
      {
        question_list.push(question);
      }
    });

    if(question_list?.length != 0 && (question_type == QUIZ_TYPE.OX || question_type == QUIZ_TYPE.OX_LONG))
    {
      question_list.forEach((question) =>
      {
        question['answer_type'] = ANSWER_TYPE.OX;
      });
    }

    question_list.sort(() => Math.random() - 0.5); //퀴즈 목록 무작위로 섞기
    quiz_data['question_list'] = question_list;

    let selected_question_count = quiz_info['selected_question_count'] ?? quiz_info['quiz_size'];
    if(selected_question_count > question_list.length)
    {
      selected_question_count = question_list.length;
    }

    quiz_data['quiz_size'] = selected_question_count; //퀴즈 수 재정의 하자
  }
}

class InitializeCustomQuiz extends Initialize
{
  constructor(quiz_session: any)
  {
    super(quiz_session);
  }

  async act() //dev 퀴즈 파싱
  {
    try
    {
      await this.CustomQuizInitialize();
    }
    catch(err: any)
    {
      this.initialize_success = false;
      logger.error(`Failed to custom quiz initialize of quiz session, guild_id:${this.quiz_session.guild_id}, cycle_info:${this.cycle_info}, quiz_data: ${JSON.stringify(this.quiz_session.quiz_data)}, err: ${err.stack ?? err}`);
    }
  }

  async CustomQuizInitialize()
  {
    const guild_id = this.quiz_session.guild_id;
    logger.info(`Start custom quiz initialize of quiz session, guild_id:${guild_id}`);

    const quiz_session = this.quiz_session;
    const quiz_info = this.quiz_session.quiz_info;
    const quiz_data = this.quiz_session.quiz_data;
    //실제 퀴즈들 로드
    const question_list: any[] = [];

    const quiz_id = quiz_info['quiz_id']; //커스텀 퀴즈는 quiz_id가 있다.
    const question_row_list = quiz_info.question_list;

    if(question_row_list == undefined || question_row_list.length == 0)
    {
      throw 'question row list is empty, quiz_id: ' + quiz_id;
    }

    question_row_list.forEach((question_row: any) =>
    {

      const question = this.buildCustomQuestion(question_row);

      /**완성했으면 넣자 */
      question_list.push(question);

    });

    this.extractIpAddresses(quiz_session);

    question_list.sort(() => Math.random() - 0.5); //퀴즈 목록 무작위로 섞기
    quiz_data['question_list'] = question_list;

    let selected_question_count = quiz_info['selected_question_count'] ?? quiz_info['quiz_size'];
    if(selected_question_count > question_list.length)
    {
      selected_question_count = question_list.length;
    }

    quiz_data['quiz_size'] = selected_question_count; //퀴즈 수 재정의 하자

    // 서버별이 아닌 유저별로 변경되면서 필요 없어짐. 무조건 추천하기 띄움
    // feedback_manager.checkAlreadyLike(quiz_id, guild_id)
    // .then((result) =>
    // {
    //     if(this.quiz_session == undefined)
    //     {
    //         return;
    //     }

    //     this.quiz_session.already_liked = result;

    //     logger.info(`this guild's already liked value = ${this.quiz_session.already_liked}, guild_id:${this.quiz_session.guild_id}`);
    // });

    this.quiz_session.already_liked = false; //무조건 띄운다.
  }
}

class InitializeOmakaseQuiz extends Initialize
{
  constructor(quiz_session: any)
  {
    super(quiz_session);
  }

  async act() //dev 퀴즈 파싱
  {
    try
    {
      const is_multiplayer = this.quiz_session.isMultiplayerSession();

      if (is_multiplayer)
      {
        this.quiz_session.waitForQuestionList();

        if(this.quiz_session.isHostSession()) // 멀티플레이어일 때만 호스트 확인
        {
          await this.OmakaseQuizInitialize();
          this.quiz_session.sendQuestionListInfo();
        }
      }
      else
      {
        await this.OmakaseQuizInitialize(); // 멀티플레이어가 아닐 때 초기화
      }
    }
    catch(err: any)
    {
      this.initialize_success = false;
      logger.error(`Failed to omakase quiz initialize of quiz session, guild_id:${this.quiz_session.guild_id}, cycle_info:${this.cycle_info}, quiz_data: ${JSON.stringify(this.quiz_session.quiz_data)}, err: ${err.stack}`);
    }
  }

  async OmakaseQuizInitialize()
  {
    const guild_id = this.quiz_session.guild_id;
    logger.info(`Start omakase quiz initialize of quiz session, guild_id:${guild_id}`);

    const quiz_session = this.quiz_session;
    const quiz_info = this.quiz_session.quiz_info;
    const quiz_data = this.quiz_session.quiz_data;
    //실제 퀴즈들 로드
    const question_list: any[] = [];

    //오마카세 퀴즈 설정 값
    const use_basket_mode = quiz_info['basket_mode'] ?? true;

    //인증된 퀴즈에서만 뽑을지 필터
    const certified_filter = quiz_info['certified_filter'] ?? true;

    let total_dev_question_count: any = undefined;
    let dev_question_list: any = undefined;
    let total_custom_question_count: any = undefined;
    let custom_question_list: any = undefined;
    let selected_question_count = quiz_info['selected_question_count']; //최대 문제 개수도 있다.
    const limit = selected_question_count * 2; //question prepare 에서 오류 발생 시, failover 용으로 넉넉하게 2배 잡는다.

    let dev_quiz_count = 0;
    let custom_quiz_count = 0;

    if(use_basket_mode === false) //장르 선택 모드
    {
      const dev_quiz_tags = quiz_info['dev_quiz_tags']; //오마카세 퀴즈는 quiz_tags 가 있다.
      const custom_quiz_type_tags = quiz_info['custom_quiz_type_tags']; //오마카세 퀴즈는 quiz_type_tags 가 있다.
      const custom_quiz_tags = quiz_info['custom_quiz_tags']; //오마카세 퀴즈는 quiz_tags 도 있다.

      //무작위로 question들 뽑아내자. 각각 넉넉하게 limit 만큼 뽑는다.
      [total_dev_question_count, dev_question_list] = tagged_dev_quiz_manager.getQuestionListByTags(dev_quiz_tags, limit);
      [total_custom_question_count, custom_question_list] = await loadQuestionListFromDBByTags(custom_quiz_type_tags, custom_quiz_tags, limit, certified_filter);

      //장르 선택 모드는 각각 문제 수 비율로 limit을 나눠 가진다.
      const total_all_question_count = total_dev_question_count + total_custom_question_count; //둘 합치고
      dev_quiz_count = Math.round(total_dev_question_count / total_all_question_count * limit);
      custom_quiz_count = Math.round(total_custom_question_count / total_all_question_count * limit);
    }
    else //장바구니 모드
    {
      const dev_quiz_tags = quiz_info['dev_quiz_tags']; //오마카세 퀴즈는 quiz_tags 가 있다.
      [total_dev_question_count, dev_question_list] = tagged_dev_quiz_manager.getQuestionListByTags(dev_quiz_tags, limit);

      const basket_items = quiz_info['basket_items'];

      const basket_items_value: any[] = Object.values(basket_items);
      if(basket_items_value.length > 0)
      {
        const basket_condition_query = '(' + basket_items_value
          .map((basket_item: any) => basket_item.quiz_id)
          .join(',') + ')';

        [total_custom_question_count, custom_question_list] = await loadQuestionListByBasket(basket_condition_query, limit);
      }
      else
      {
        [total_custom_question_count, custom_question_list] = [0, []];
      }

      //장바구니 모드는 각각 반반씩 문제를 limit을 나눠 갖는다.
      dev_quiz_count = Math.round(limit / 2);
      custom_quiz_count = Math.round(limit / 2);

      for(const basket_item of basket_items_value) //장바구니 모드에서 선택된 퀴즈들도 플레이된 횟수 +1
      {
        addPlayedCountByQuiz(basket_item.quiz_id);
      }

      // this.quiz_session.already_liked = false; //장바구니 모드면 추천하기를 무조건 띄운다. -> 안띄운다 우선
    }

    logger.info(`Omakase Question count of this session. use_basket_mode=${use_basket_mode}, certified_filter=${certified_filter}, dev=${dev_quiz_count}, custom=${custom_quiz_count}, limit=${limit}`);


    //build dev questions
    dev_question_list.slice(0, dev_quiz_count).forEach((question_row: any) =>
    {
      const quiz_path = question_row['quiz_path'];
      const question_path = question_row['path'];
      const question = this.buildDevQuestion(quiz_path, question_path);

      //question_list에 넣어주기
      if(question != undefined)
      {
        question['question_title'] = question_row['title'];

        let additional_text = '```';

        const tags_string = "🔹 퀴즈 태그: " + question_row['tag'] + '\n';
        additional_text += tags_string;

        additional_text += "🔹 퀴즈 제작: 공식 퀴즈\n";

        additional_text += '```';

        question['question_text'] = additional_text + "\n\n" + (question['question_text'] ?? '');

        question['prepare_type'] = "DEV";
        question_list.push(question);
      }
    });

    //build custom questions
    custom_question_list.slice(0, custom_quiz_count).forEach((question_row: any) =>
    {

      const question = this.buildCustomQuestion(question_row);

      question['question_title'] = question.data['quiz_title'];

      let additional_text = '```';

      const tags_value = question.data['tags_value'];
      const tags_string = "🔹 퀴즈 태그: " + utility.convertTagsValueToString(tags_value) + '\n';
      additional_text += tags_string;

      const creator_name = question.data['creator_name'] ?? '';
      if(creator_name != undefined)
      {
        additional_text += "🔹 퀴즈 제작: " + creator_name + '\n';
      }

      const simple_description = question.data['simple_description'] ?? '';
      if(simple_description != undefined)
      {
        additional_text += "🔹 한줄 설명: " + simple_description + '\n';
      }

      additional_text += '```';

      question['question_text'] = additional_text + "\n\n" + (question['question_text'] ?? '');

      question['prepare_type'] = "CUSTOM";
      question_list.push(question);

    });

    this.extractIpAddresses(quiz_session); //IP는 언제나 준비

    question_list.sort(() => Math.random() - 0.5); //퀴즈 목록 무작위로 섞기
    quiz_data['question_list'] = question_list;

    if(selected_question_count > question_list.length)
    {
      selected_question_count = question_list.length;
    }

    quiz_data['quiz_size'] = selected_question_count; //퀴즈 수 재정의 하자
  }
}

class InitializeUnknownQuiz extends Initialize
{
  constructor(quiz_session: any)
  {
    super(quiz_session);
    this.next_cycle = CYCLE_TYPE.FINISH;
  }

  async enter() //에러
  {
    const channel = this.quiz_session.channel;
    channel.send({content: text_contents.quiz_play_ui.unknown_quiz_type});
    logger.info(`this quiz session entered Unknown initialize, guild_id:${this.quiz_session.guild_id}, quiz_info: ${JSON.stringify(this.quiz_session.quiz_info)}`);
    this.forceStop();
  }
}

//#endregion

module.exports = { Initialize, InitializeDevQuiz, InitializeCustomQuiz, InitializeOmakaseQuiz, InitializeUnknownQuiz };
