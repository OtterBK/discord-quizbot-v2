'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const { QuizLifeCycleWithUtility } = require('./quiz_lifecycle');
const { CYCLE_TYPE } = require('../constants');
const { SYSTEM_CONFIG, BGM_TYPE } = require('../../../config/system_setting.js');
const text_contents = require('../../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const utility = require('../../../utility/utility.js');
const logger = require('../../../utility/logger.js')('QuizSystem');
const feedback_manager = require('../../managers/feedback_manager');

//#region Ending Cycle
/** 점수 공개 **/
class Ending extends QuizLifeCycleWithUtility
{
  static cycle_type = CYCLE_TYPE.ENDING;
  constructor(quiz_session)
  {
    super(quiz_session);
    this.next_cycle = CYCLE_TYPE.FINISH;
  }

  async act()
  {
    const quiz_data = this.quiz_session.quiz_data;
    let quiz_ui = this.quiz_session.quiz_ui;
    const channel = this.quiz_session.channel;

    if(this.quiz_session.already_liked == false)
    {
      const channel = this.quiz_session.channel;
      channel.send({
        embeds: 
            [{ 
              color: 0x05f1f1, 
              title: `**${quiz_data['title']}**`,
              description:  "퀴즈를 재밌게 플레이하셨나요? 😀\n방금 플레이하신 퀴즈가 마음에 드셨다면 **[추천하기]**를 눌러주세요!\n\n`일정 수 이상의 추천을 받은 퀴즈는 [오마카세/멀티플레이] 퀴즈에서 사용됩니다.`"
            }], 
        components: [ feedback_manager.quiz_feedback_comp ]});
    }

    quiz_ui.embed.color = 0xFED049,

    quiz_ui.embed.title = text_contents.ending_ui.title;
    quiz_ui.embed.description = `${quiz_data['icon']} ${quiz_data['title']}\n \n \n`;
    quiz_ui.embed.footer = undefined; //footer 없앰

    quiz_ui.embed.fields = [ //페이크 필드
      {
        name: ' \n',
        value: ' \n',
      },
    ];

    quiz_ui.setImage(undefined);

    this.sendBGM(BGM_TYPE.BELL);

    await quiz_ui.send(false);

    
    await utility.sleep(SYSTEM_CONFIG.ENDING_WAIT);
    let scoreboard = this.quiz_session.scoreboard;
    if(scoreboard.size == 0) //정답자가 없다면
    {
      quiz_ui.embed.description += text_contents.ending_ui.nobody_answer;
      this.sendBGM(BGM_TYPE.FAIL);
      quiz_ui.update();
      await utility.sleep(SYSTEM_CONFIG.ENDING_WAIT); 
    }
    else
    {
      scoreboard = utility.sortMapByProperty(scoreboard, 'score'); //정렬 해주고
      let iter = scoreboard.entries();
            
      let winner_name = undefined;
      for(let i = 0; i < scoreboard.size; ++i)
      {
        const [answerer_id, answerer_info] = iter.next().value;

        let medal = '🧐';
        switch(i)
        {
        case 0: {
          winner_name = answerer_info.name;
          medal = text_contents.icon.ICON_MEDAL_GOLD; 
          break;
        }
        case 1: medal = text_contents.icon.ICON_MEDAL_SILVER; break;
        case 2: medal = text_contents.icon.ICON_MEDAL_BRONZE; break;
        }

        if(i == 3) //3등과 간격 벌려서
        {
          quiz_ui.embed.description += ` \n \n`;
        }

        let ranker_name = answerer_info.name;
        if(this.quiz_session.isMultiplayerSession())
        {
          ranker_name = this.quiz_session.getParticipant(answerer_id)?.guild_name;
        }

        quiz_ui.embed.description += `${medal} ${ranker_name}    ${answerer_info.score}${text_contents.scoreboard.point_name}\n`;
        if(i < 3) //3등까지는 하나씩 보여줌
        {
          quiz_ui.embed.description += ` \n`; //3등까지는 간격도 늘려줌
          this.sendBGM(BGM_TYPE.SCORE_ALARM);
          quiz_ui.update();
          await utility.sleep(SYSTEM_CONFIG.ENDING_WAIT);
          continue;
        }
      }

      if(scoreboard.size > 3) //나머지 더 보여줄 사람 있다면
      {
        this.sendBGM(BGM_TYPE.SCORE_ALARM);
        quiz_ui.update();
        await utility.sleep(SYSTEM_CONFIG.ENDING_WAIT);
      }

      //1등 칭호 보여줌
      quiz_ui.embed.description += ` \n \n`;

      let top_score_description_message = '';

      if(this.quiz_session.isMultiplayerSession()) //멀티면 mvp 를 보여준다.
      {
        const mvp_info = this.quiz_session.mvp_info;
        if(mvp_info !== undefined)
        {
          top_score_description_message = `**🏆 MVP __${mvp_info.name}__ ${mvp_info.score}점!** \n`;
        }
        else
        {
          logger.warn(`The mvp info is undefined on Multiplayer Ending cycle`);
        }
      }
      else 
      {
        top_score_description_message = text_contents.ending_ui.winner_user_message;
        top_score_description_message = top_score_description_message.replace('${winner_nickname}', quiz_data['winner_nickname']);
        top_score_description_message = top_score_description_message.replace('${winner_username}', winner_name);
      }
      quiz_ui.embed.description += top_score_description_message;

    }
        
    this.sendBGM(BGM_TYPE.ENDING);
    quiz_ui.update();
    await utility.sleep(SYSTEM_CONFIG.ENDING_WAIT); 

    if(this.quiz_session.isMultiplayerSession()) //멀티면 3초 더 기다린다. 여운? 을 위해 ㅎ...
    {
      await utility.sleep(3000); 
    }

    logger.info(`End Quiz Session, guild_id:${this.quiz_session.guild_id}`);
  }
}

//#endregion

module.exports = Ending;
