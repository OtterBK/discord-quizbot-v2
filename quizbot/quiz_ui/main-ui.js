'use strict';

//#region 로컬 modules
const { SYSTEM_CONFIG,} = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE]; 
const { sync_objects, sendMultiplayerSignal } = require('../managers/ipc_manager');
const {
  select_btn_component,
  main_ui_component,
} = require("./components");

const { 
  QuizbotUI,
} = require("./common-ui.js");

const { NotesSelectUI } = require("./note-select-ui.js");
const { QuizToolGuideUI } = require("./quiz-tool-guide-ui.js");
const { SelectQuizTypeUI } = require("./select-quiz-type-ui.js");
const { ServerSettingUI } = require("./server-setting-ui.js");
const { MultiplayerQuizSelectUI } = require("./multiplayer-quiz-select-ui.js");

//#endregion

/** 메인메뉴 */
class MainUI extends QuizbotUI 
{

  static MULTIPLAYER_LOBBY_COUNT = 0;

  constructor()
  {
    super();


    this.initializeEmbed();
    this.initializeComponents();
  }

  initializeEmbed() 
  {
    this.embed = {
      color: 0x87CEEB,
      title: text_contents.main_menu.title,
      // url: text_contents.main_menu.url,
      author: {
        //   name: '📗 메인메뉴',
        //   icon_url: 'https://i.imgur.com/AfFp7pu.png',
        //   url: 'https://user-images.githubusercontent.com/28488288/106536426-c48d4300-653b-11eb-97ee-445ba6bced9b.jpg',
      },
      description: `🔹서버원들과 함께 다양한 퀴즈를 즐겨보세요!\n\n\n1️⃣)  **서버원과 게임하기**\n\n2️⃣)  **다른 서버와 경쟁하기 [대기 중: ${MainUI.MULTIPLAYER_LOBBY_COUNT}]**\n\n3️⃣)  **퀴즈 만들기**\n\n4️⃣)  **서버 옵션 설정**\n\n5️⃣)  **공지/패치노트**\n\n\n`,
      thumbnail: {
        url: 'https://user-images.githubusercontent.com/28488288/106536426-c48d4300-653b-11eb-97ee-445ba6bced9b.jpg',
      },
      fields: [
        // {
        //   name: 'Regular field title',
        //   value: 'Some value here',
        // },
        {
          name: '\u200b',
          value: '\u200b',
          inline: false,
        },
        {
          name: text_contents.main_menu.total_server,
          value: `${text_contents.icon.ICON_GUILD} ${sync_objects.get('guild_count')}`,
          inline: true,
        },
        {
          name: text_contents.main_menu.playing_server,
          value: `${text_contents.icon.ICON_LOCALPLAY} ${sync_objects.get('local_play_count')}`,
          inline: true,
        },
        {
          name: text_contents.main_menu.competitive_server,
          value: `${text_contents.icon.ICON_MULTIPLAY} ${sync_objects.get('multi_play_count')}`,
          inline: true,
        },
      ],
      // image: {
      //   url: undefined,
      // },
      // timestamp: new Date().toISOString(),
      footer: {
        text: `${text_contents.main_menu.footer}`, 
        // icon_url: 'https://user-images.githubusercontent.com/28488288/208116143-24828069-91e7-4a67-ac69-3bf50a8e1a02.png',
      },
    };
  }

  initializeComponents()
  {
    this.components = [select_btn_component, main_ui_component]; //MAIN UI에서는 control component는 필요없다.
  }

  onInteractionCreate(interaction)
  {
    if(!interaction.isButton()) 
    {
      return;
    }

    const guild_id = interaction.guild.id;

    if(interaction.customId === '1') //로컬플레이 눌렀을 때
    {
      return new SelectQuizTypeUI();
    }

    if(interaction.customId === '2') //멀티플레이 눌렀을 때
    {
      return new MultiplayerQuizSelectUI(guild_id);
    }

    if(interaction.customId === '3') //퀴즈만들기 눌렀을 때
    {
      return new QuizToolGuideUI(); //퀴즈만들기 방법 안내
    }

    if(interaction.customId === '4') //서버 설정 눌렀을 때
    {
      return new ServerSettingUI(guild_id);
    }

    if(interaction.customId === '5') //공지/패치노트 눌렀을 때
    {
      return new NotesSelectUI();
    }
  }

  onAwaked()
  {
    this.initializeEmbed();
    this.update();
  }

}

module.exports =  { MainUI };
