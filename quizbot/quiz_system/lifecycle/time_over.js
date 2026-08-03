'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const { QuizLifeCycleWithUtility } = require('./quiz_lifecycle.js');
const { CYCLE_TYPE } = require('../constants.js');
const { SYSTEM_CONFIG, BGM_TYPE } = require('../../../config/system_setting.js');
const text_contents = require('../../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const utility = require('../../../utility/utility.js');

//#region Timeover Cycle
/** 문제 못 맞춰서 Timeover 일 떄 **/
class TimeOver extends QuizLifeCycleWithUtility
{
  static cycle_type = CYCLE_TYPE.TIMEOVER;
  constructor(quiz_session)
  {
    super(quiz_session);
    this.next_cycle = CYCLE_TYPE.CLEARING;
    this.custom_wait = undefined;
  }

  async enter()
  {
    //정답 표시
    const quiz_data = this.quiz_session.quiz_data;
    const game_data = this.quiz_session.game_data;
    const processing_question = game_data['processing_question'];

    let quiz_ui = this.quiz_session.quiz_ui;

    quiz_ui.embed.color = 0X850000;

    quiz_ui.embed.title = text_contents.timeover_ui.title;

    let answer_list_message = '';
    const answers = processing_question['answers'] ?? [];
    if(answers.length > 0)
    {
      answers.forEach((answer) => 
      {
        answer_list_message += answer + "\n";
      });
    }

    let author_list_message = '';
    const author_list = processing_question['author'] ?? [];
    if(author_list.length > 0)
    {
      author_list.forEach((author) => 
      {
        if(author != undefined)
        {
          author_list_message += author + "\n";
        }
      });
    }

    let description_message = text_contents.timeover_ui.description;
    description_message = description_message.replace('${question_answers}', answer_list_message);
    description_message = description_message.replace('${question_author}', author_list_message);
    quiz_ui.embed.description = description_message;

    if(this.quiz_session.hasMoreQuestion() === false)
    {
      quiz_ui.embed.footer =  {
        "text": text_contents.timeover_ui.footer_for_end
      };
    }
    else
    {
      quiz_ui.embed.footer = {
        "text": text_contents.timeover_ui.footer_for_continue
      };
    }

    quiz_ui.components = [];

    const scoreboard_fields = this.getScoreboardFields();

    quiz_ui.embed.fields = scoreboard_fields;

    this.custom_wait = await this.applyAnswerAudioInfo(processing_question);
    const image_exist = this.applyAnswerImageInfo(processing_question);

    quiz_ui.send(false, false);
  }

  async act()
  {
    const game_data = this.quiz_session.game_data;
    const processing_question = game_data['processing_question'];
    if(processing_question['play_bgm_on_question_finish'] == true && this.custom_wait == undefined) //BGM 재생 FLAG가 ON이고 answer_audio가 없다면
    {
      this.sendBGM(BGM_TYPE.FAIL); //bgm 재생
    }
    const wait_time = this.custom_wait ?? SYSTEM_CONFIG.TIMEOVER_CYCLE_WAIT; //정답 얼마동안 들려줄 지
    await utility.sleep(wait_time);
  }

  async exit()
  {

  }
}

//#endregion

module.exports = TimeOver;
