'use strict';

//#region 필요한 외부 모듈
const { MessageFlags } = require('discord.js');
const cloneDeep = require("lodash/cloneDeep.js");
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG, } = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE]; 
const {  loadUserQuizListFromDB } = require('../managers/user_quiz_info_manager');
const {
  sort_by_select_menu,
  quiz_search_tags_select_menu,
  modal_complex_page_jump,
  btn_search,
  btn_done,
} = require("./components");

const { 
  QuizBotControlComponentUI
} = require("./common-ui.js");

const { UserQuizInfoUI } = require("./user-quiz-info.ui.js");
const { QuizInfoUI } = require("./quiz-info-ui.js");
//#endregion

/** 유저 퀴즈 선택 UI */
class UserQuizSelectUI extends QuizBotControlComponentUI  
{
  constructor(basket_items=undefined)
  {
    super();

    this.all_user_quiz_contents = undefined;
    this.selected_tags_value = 0;
    this.selected_keyword_value = undefined;
    this.selected_sort_by_value = 'modified_time';

    this.basket_items = basket_items;
    this.use_basket_mode = this.basket_items !== undefined;
    this.max_basket_size = 25;
    
    this.initializeEmbed();
    this.initializeComponents();
    this.initializeUserQuizSelectUIEventHandler();
  }

  initializeEmbed() 
  {
    this.embed = {
      color: 0x05f1f1,
      title: text_contents.user_select_category.title,
      url: text_contents.user_select_category.url,
      description: '퀴즈 목록을 불러오는 중...\n잠시만 기다려주세요.🙂',
    };
  }

  initializeComponents() 
  {
    this.sort_by_select_menu = cloneDeep(sort_by_select_menu); //아예 deep copy해야함
    this.search_tag_select_menu = cloneDeep(quiz_search_tags_select_menu); //아예 deep copy해야함

    this.components[2].components[2] = btn_search; //점프 버튼을 검색 버튼으로 대체, this.components는 clonedeep이라 그냥 바꿔도 된다.
    this.components.push(this.sort_by_select_menu);
    this.components.push(this.search_tag_select_menu);

    if(this.use_basket_mode)
    {
      //꼼수...
      this.components[2].components[1] = btn_done; //뒤로 버튼을 완료 버튼으로 대체, this.components는 clonedeep이라 그냥 바꿔도 된다.
    }
  }

  initializeUserQuizSelectUIEventHandler()
  {
    this.user_quiz_select_ui_handler = 
    {
      'sort_by_select': this.handleRequestSort.bind(this),
      'quiz_search_tags_select_menu': this.handleRequestTagSearch.bind(this),
      'request_modal_complex_page_jump': this.handleRequestModalComplexPageJump.bind(this),
    };
  }

  onReady() //ui 등록 됐을 때
  {
    this.loadAllUserQuizList(undefined); //여기서 ui 업데이트함
  }

  async loadAllUserQuizList()
  {
    const user_quiz_list = await loadUserQuizListFromDB(undefined); //전체 조회

    for(let user_quiz_info of user_quiz_list) 
    {
      user_quiz_info.name = `**${user_quiz_info.data.quiz_title}**\n🔸) ${user_quiz_info.data.simple_description ?? ''}`;
    }

    this.all_user_quiz_contents = user_quiz_list ?? [];
    this.cur_contents = this.all_user_quiz_contents;
    this.main_description = text_contents.user_select_category.description;

    this.displayContents(0);
    this.update();
  }

  onInteractionCreate(interaction)
  {
    if(this.isUnsupportedInteraction(interaction))  
    {
      return;
    }

    if(this.isUserQuizSelectUIEvent(interaction))
    {
      return this.handleUserQuizSelectUIEvent(interaction);
    }
    
    if(this.isPageMoveEvent(interaction))
    {
      if(interaction.customId === 'modal_complex_page_jump') //키워드 검색을 먼저 본다.
      {
        this.handleRequestKeywordSearch(interaction); //이것만은 어쩔 수 없는 예외
      }

      return this.handlePageMoveEvent(interaction);
    }

    if(this.isSelectedIndexEvent(interaction))
    {
      return this.handleSelectedIndexEvent(interaction);
    }
  }

  isUserQuizSelectUIEvent(interaction)
  {
    return this.user_quiz_select_ui_handler[interaction.customId] !== undefined;
  }

  handleUserQuizSelectUIEvent(interaction)
  {
    const handler = this.user_quiz_select_ui_handler[interaction.customId];
    return handler(interaction);
  }

  handleRequestSort(interaction)
  {
    this.reorderQuizInfoList(interaction.values[0]); //재정렬 ㄱㄱ
    this.displayContents(this.cur_page);
    return this;
  }

  handleRequestTagSearch(interaction)
  {
    const selected_tags_value = interaction.values[0];
    this.filterByTag(selected_tags_value);

    this.cur_page = 0;
    this.displayContents(this.cur_page);
    return this;
  }

  handleRequestModalComplexPageJump(interaction)
  {
    interaction.explicit_replied = true;
    interaction.showModal(modal_complex_page_jump); //페이지 점프 입력 모달 전달
    return undefined;
  }

  handleRequestKeywordSearch(interaction)
  {
    const input_keyword_value = interaction.fields.getTextInputValue('txt_input_keyword');

    this.filterByKeyword(input_keyword_value);

    this.cur_page = 0;
    this.displayContents(this.cur_page); 

    if(input_keyword_value === undefined || input_keyword_value === '')
    {
      interaction.channel.send({content: `\`\`\`🔸 모든 퀴즈를 표시합니다.\`\`\``});
    }
    else
    {
      interaction.channel.send({content: `\`\`\`🔸 ${input_keyword_value} 에 대한 검색 결과입니다.\`\`\``});
    }
  }

  reorderQuizInfoList(selected_sort_by_value)
  {
    if(this.selected_sort_by_value === selected_sort_by_value) return; //바뀐게 없다면 return
    
    this.selected_sort_by_value = selected_sort_by_value;

    this.selectDefaultOptionByValue(this.sort_by_select_menu.components[0], selected_sort_by_value);

    if(this.selected_sort_by_value.endsWith("_reverse")) //거꾸로 정렬이면
    {
      const selected_sort_by_value = this.selected_sort_by_value.substring(0, this.selected_sort_by_value.length - "_reverse".length);
      this.cur_contents.sort((a, b) => a.data[selected_sort_by_value] - b.data[selected_sort_by_value]); //오름차순(오래된 퀴즈순)
    }
    else
    {
      this.cur_contents.sort((a, b) => b.data[this.selected_sort_by_value] - a.data[this.selected_sort_by_value]); //내림차순(최근 퀴즈순)
    }

    this.displayContents(this.current_question_index);
  }

  filterByTag(selected_tags_value) //태그로
  {
    if(this.selected_tags_value === selected_tags_value) //같으면 패스
    {
      return;
    }

    this.selected_tags_value = selected_tags_value;

    this.selectDefaultOptionByValue(this.search_tag_select_menu.components[0], selected_tags_value);

    let filtered_contents = [];
    for(const quiz_info of this.all_user_quiz_contents)
    {
      const quiz_tags_value = quiz_info.data.tags_value;
      if((quiz_tags_value & selected_tags_value) != selected_tags_value) //비트 마스킹
      {
        continue;
      }

      filtered_contents.push(quiz_info);
    }

    this.cur_contents = filtered_contents;
  }


  filterByKeyword(selected_keyword_value) //검색어로
  {
    if(this.selected_keyword_value === selected_keyword_value) //같으면 패스
    {
      return;
    }

    if(selected_keyword_value === undefined || selected_keyword_value === "") //아무것도 입력 안 입력했다면 전체로 설정하고 패스
    {
      this.cur_contents = this.all_user_quiz_contents;
    }

    this.selected_keyword_value = selected_keyword_value;

    let filtered_contents = [];
    for(const quiz_info of this.all_user_quiz_contents)
    {
      if(
        quiz_info.data.quiz_title?.includes(selected_keyword_value)
        || quiz_info.data.simple_description?.includes(selected_keyword_value)
        || quiz_info.data.description?.includes(selected_keyword_value)
        || quiz_info.data.creator_name?.includes(selected_keyword_value)
      ) 
      {
        filtered_contents.push(quiz_info);
        continue;
      }
    }

    this.cur_contents = filtered_contents;
  }

  handleSelectedIndexEvent(interaction)
  {
    const select_index = this.convertToSelectedIndex(interaction.customId);

    // 그냥 페이지 계산해서 content 가져오자
    const index = (this.count_per_page * this.cur_page) + select_index - 1; //실제로 1번을 선택했으면 0번 인덱스를 뜻함
    if(index >= this.cur_contents.length) //범위 넘어선걸 골랐다면
    {
      return;
    }

    const user_quiz_info = this.cur_contents[index]; //퀴즈를 선택했을 경우

    if(this.use_basket_mode)
    {
      interaction.explicit_replied = true;

      const quiz_id = user_quiz_info.quiz_id;
      const quiz_title = user_quiz_info.data.quiz_title;
      if(quiz_id === undefined)
      {
        interaction.reply({content: `\`\`\`🔸 [${user_quiz_info.data.quiz_title}] 퀴즈에서 Quiz id 값을 찾을 수 없습니다.\`\`\``, flags: MessageFlags.Ephemeral});
        return; 
      }

      if(this.basket_items[quiz_id] !== undefined)
      {
        interaction.reply({content: `\`\`\`🔸 [${quiz_title}] 퀴즈는 이미 담겼습니다.\`\`\``, flags: MessageFlags.Ephemeral});
        return;
      }

      if(Object.keys(this.basket_items ?? []).length >= this.max_basket_size)
      {
        interaction.reply({content: `\`\`\`🔸 장바구니가 가득 찼습니다. 더 이상 퀴즈를 담을 수 없어요.\`\`\``, flags: MessageFlags.Ephemeral});
        return; 
      }

      this.basket_items[quiz_id] = 
      {
        quiz_id: quiz_id,
        title: quiz_title,
      };
   
      interaction.reply({content: `\`\`\`🔸 [${user_quiz_info.data.quiz_title}] 퀴즈를 장바구니에 담았습니다. (${Object.keys(this.basket_items).length}개 / ${this.max_basket_size}개)\`\`\``});

      const guild_id = interaction.guild.id;
      QuizInfoUI.BASKET_CACHE[guild_id] = this.basket_items;

      return;
    }

    return new UserQuizInfoUI(user_quiz_info, true); //readonly true로 넘겨야함
  }
}

module.exports = { UserQuizSelectUI };