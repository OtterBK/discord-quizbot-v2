'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//Initialize 등 lifecycle 클래스들이 퀴즈 진행 중 UI(임베드/버튼)를 보여줄 때 사용.
//로직/주석은 원본과 동일 (동작 변경 없음). 단, exports.getQuizSession(guild_id) 호출은
//session_registry.quiz_session_map[guild_id] 직접 조회로 바꿨다 - quiz_system.js를
//다시 require하지 않아도 되게 해서(레지스트리만 필요) 나중에 클래스들을 파일로
//쪼갤 때 quiz_system.js <-> quiz_play_ui.js 순환참조가 생기지 않도록 함.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, RESTJSONErrorCodes } = require('discord.js');

const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const utility = require('../../utility/utility.js');
const logger = require('../../utility/logger.js')('QuizSystem');
const session_registry = require('./session_registry');

//#region 퀴즈 플레이에 사용될 UI
class QuizPlayUI
{
  //update()/setImage() 등에서 files/embed 등을 자유롭게 갈아끼우는 관행이라
  //user_quiz_info_manager.ts의 UserQuizInfo와 같은 패턴으로 인덱스 시그니처를 둔다.
  [key: string]: any;

  constructor(channel: any)
  {
    this.channel = channel;
    this.ui_instance = undefined;

    this.embed = {
      color: 0xFED049,
      title: '초기화 중입니다.',
      description: '잠시만 기다려주세요...',
      image: {
        url: undefined,
      },
    };

    this.quiz_play_comp = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('hint')
          .setLabel('힌트')
        //   .setEmoji(`${text_contents.icon.ICON_HINT}`) //이모지 없는게 더 낫다
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('skip')
          .setLabel('스킵')
        // .setEmoji(`${text_contents.icon.ICON_SKIP}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('force_stop')
          .setLabel('그만하기')
        // .setEmoji(`${text_contents.icon.ICON_STOP}`)
          .setStyle(ButtonStyle.Danger),
      );

    this.ox_quiz_comp = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('choice_O')
          .setEmoji(`${text_contents.icon.ICON_O}`)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('choice_X')
          .setEmoji(`${text_contents.icon.ICON_X}`)
          .setStyle(ButtonStyle.Secondary),
      );

    this.multiple_quiz_comp = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('choice_1')
          .setLabel('1')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('choice_2')
          .setLabel('2')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('choice_3')
          .setLabel('3')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('choice_4')
          .setLabel('4')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('choice_5')
          .setLabel('5')
          .setStyle(ButtonStyle.Secondary),
      );


    this.components = [ ];
  }

  setImage(image_resource: any)
  {

    if(image_resource == undefined)
    {
      this.embed.image = { url: '' };
      return;
    }

    if(image_resource.includes(SYSTEM_CONFIG.DEV_QUIZ_PATH) == true) //dev path 포함하면 로컬 이미지 취급
    {
      const file_name = image_resource.split('/').pop();
      this.files = [ { attachment: image_resource, name: file_name } ];
      this.embed.image = { url: "attachment://" + file_name };
    }
    else
    {
      this.embed.image = {
        url: utility.isValidURL(image_resource) ? image_resource : '',
      };
    }
  }

  setTitle(title: any)
  {
    this.embed.title = title;
  }

  async send(previous_delete: any, remember_ui = true)
  {
    if(previous_delete == true)
    {
      this.delete(); //이전 UI는 삭제
    }

    const objects = this.createSendObject();
    await this.channel.send(objects) //await로 대기
      .then((ui_instance: any) =>
      {
        if(remember_ui == false)
        {
          return;
        }
        this.ui_instance = ui_instance;
      })
      .catch((err: any) =>
      {
        if(err.code === RESTJSONErrorCodes.UnknownChannel || err.code === RESTJSONErrorCodes.MissingPermissions || err.code === RESTJSONErrorCodes.MissingAccess)
        {
          const guild_id = this.channel.guild.id;
          const quiz_session = session_registry.quiz_session_map[guild_id];
          logger.error(`Unknown channel for ${this.channel.id}, guild_id: ${guild_id}`);
          if(quiz_session != undefined)
          {
            quiz_session.forceStop();
          }

          if(err.code === RESTJSONErrorCodes.MissingPermissions || err.code === RESTJSONErrorCodes.MissingAccess) //권한 부족해서 종료된거면 알려주자
          {
            quiz_session.owner.send({content: `\`\`\`🔸 ${guild_id}에서 진행한 퀴즈가 강제 종료되었습니다.\n이유: 봇에게 메시지 보내기 권한이 부족합니다.\n봇을 추방하고 관리자가 다시 초대하도록 해보세요.\n${err.code}\`\`\``});
            logger.info(`Send Forcestop Reason MissingPermissions to ${quiz_session.owner.id}, guild_id: ${guild_id}, err.code: ${err.code}`);
          }

          return;
        }
        logger.error(`Failed to Send QuizPlayUI, guild_id:${this.guild_id}, embed: ${JSON.stringify(this.embed)}, objects:${JSON.stringify(objects)}, err: ${err.stack}`);
      })
      .finally(() =>
      {

      });
    this.files = undefined; //파일은 1번 send하면 해제
  }

  async delete()
  {
    if(this.ui_instance == undefined)
    {
      return;
    }
    this.ui_instance.delete()
      .catch((err: any) =>
      {
        if(err.code === RESTJSONErrorCodes.UnknownMessage || err.code === RESTJSONErrorCodes.UnknownInteraction) //이미 삭제됐으면 땡큐지~
        {
          return;
        }
        logger.error(`Failed to Delete QuizPlayUI, guild_id:${this.guild_id}, err: ${err.stack}`);
      });
    this.ui_instance = undefined;
  }

  async update()
  {
    if(this.ui_instance != undefined)
    {
      if(this.files != undefined)
      {
        await this.send(true); //첨부 파일 보낼게 있다면 update로 들어와도 send해야한다.
        return;
      }

      const objects = this.createSendObject();
      await this.ui_instance.edit(objects)
        .catch((err: any) =>
        {
          if(err.code === RESTJSONErrorCodes.UnknownMessage || err.code === RESTJSONErrorCodes.UnknownInteraction) //뭔가 이상함
          {
            return;
          }
          logger.error(`Failed to Update QuizPlayUI, guild_id:${this.guild_id}, embed: ${JSON.stringify(this.embed)}, objects:${JSON.stringify(objects)}, err: ${err.stack}`);
        })
        .finally(() =>
        {

        });
    }
  }

  createSendObject()
  {
    if(this.files != undefined)
    {
      return {
        files: this.files,
        embeds: [ this.embed ],
        components: this.components
      };
    }

    return {
      embeds: [ this.embed ],
      components: this.components
    };
  }

  setButtonStatus(button_index: any, status: any)
  {
    const components = this.quiz_play_comp.components;
    if(button_index >= components.length)
    {
      return;
    }
    let button = components[button_index];
    button.setDisabled(!status);
  }

}
//#endregion

module.exports = QuizPlayUI;
