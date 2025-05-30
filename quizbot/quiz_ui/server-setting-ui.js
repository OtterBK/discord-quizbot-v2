'use strict';

//#region 필요한 외부 모듈
const cloneDeep = require("lodash/cloneDeep.js");
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG, } = require('../../config/system_setting.js');
const option_system = require("../quiz_option/quiz_option.js");
const OPTION_TYPE = option_system.OPTION_TYPE;
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE]; 
const {
  option_control_btn_component,
  option_component,
  option_value_components,
} = require("./components.js");

const { 
  QuizBotControlComponentUI
} = require("./common-ui.js");  


//#endregion

/** 서버 설정 UI */
class ServerSettingUI extends QuizBotControlComponentUI 
{

  constructor(guild_id)
  {
    super();

    this.guild_id = guild_id;

    this.selected_option = undefined;
    this.selected_value = undefined;

    this.initializeEmbed();
    this.initializeComponents();
    this.initializeServerSettingUIHandler();
  }

  initializeEmbed() 
  {
    

    this.embed = {
      color: 0x87CEEB,
      title: text_contents.server_setting_ui.title,
      description: text_contents.server_setting_ui.pre_description,
    };

    this.option_storage = option_system.getOptionStorage(this.guild_id);
    this.option_data = cloneDeep(this.option_storage.getOptionData());
    this.fillDescription(this.option_data);
  }

  initializeComponents() 
  {
    

    this.option_component = cloneDeep(option_component); //아예 deep copy해야함
    this.option_control_btn_component = cloneDeep(option_control_btn_component);
    this.option_value_components = cloneDeep(option_value_components);
    this.components = [ this.option_component, this.option_control_btn_component ];
  }

  initializeServerSettingUIHandler()
  {
    this.server_setting_ui_handler =
    {
      'option_select': this.handleOptionSelected.bind(this),
      'option_value_select': this.handleOptionValueSelected.bind(this),
      'save_option_data': this.handleSaveOption.bind(this),
    };
  }

  fillDescription(option_data)
  {
    let description_message = text_contents.server_setting_ui.description;
    description_message = description_message.replace("${audio_play_time}", parseInt(option_data.quiz.audio_play_time / 1000));
    description_message = description_message.replace("${hint_type}", option_data.quiz.hint_type);
    description_message = description_message.replace("${skip_type}", option_data.quiz.skip_type);
    description_message = description_message.replace("${use_similar_answer}", (option_data.quiz.use_similar_answer === OPTION_TYPE.ENABLED ? `${text_contents.server_setting_ui.use}` : `${text_contents.server_setting_ui.not_use}`));
    description_message = description_message.replace("${score_type}", option_data.quiz.score_type);
    description_message = description_message.replace("${score_show_max}", (option_data.quiz.score_show_max === OPTION_TYPE.UNLIMITED ? `${text_contents.server_setting_ui.score_infinity}` : `${option_data.quiz.score_show_max}명`));
    description_message = description_message.replace("${improved_audio_cut}", (option_data.quiz.improved_audio_cut === OPTION_TYPE.ENABLED ? `${text_contents.server_setting_ui.use}` : `${text_contents.server_setting_ui.not_use}`));
    description_message = description_message.replace("${use_message_intent}", (option_data.quiz.use_message_intent === OPTION_TYPE.ENABLED ? `${text_contents.server_setting_ui.use}` : `${text_contents.server_setting_ui.not_use}`));
    description_message = description_message.replace("${max_chance}", (option_data.quiz.max_chance === OPTION_TYPE.UNLIMITED ? `${text_contents.server_setting_ui.chance_infinity}` : `${option_data.quiz.max_chance}회`));
    this.embed.description = description_message;
  }

  onInteractionCreate(interaction)
  {
    if(this.isUnsupportedInteraction(interaction))
    {
      return;
    }

    if(this.isServerSettingUIEvent(interaction)) 
    {
      return this.handleServerSettingUIEvent(interaction);
    } 
  }

  isServerSettingUIEvent(interaction)
  {
    return this.server_setting_ui_handler[interaction.customId] !== undefined;
  }

  handleServerSettingUIEvent(interaction)
  {
    const handler = this.server_setting_ui_handler[interaction.customId];
    return handler(interaction);
  }

  handleOptionSelected(interaction)
  {
    const selected_option = interaction.values[0];
    if(this.selected_option === selected_option) return; //바뀐게 없다면 return
            
    this.selected_option = selected_option;

    this.selectDefaultOptionByValue(this.option_component.components[0], selected_option);

    this.option_value_component = this.option_value_components[this.selected_option]; //value 컴포넌트를 보내줌
    this.components = [ this.option_component, this.option_value_component, this.option_control_btn_component];

    this.embed.footer = undefined;

    interaction.explicit_replied = true;
    interaction.reply({content: `해당 옵션을 어떤 값으로 설정할까요?`, ephemeral: true});

    return this;
  }

  handleOptionValueSelected(interaction)
  {
    const selected_value = interaction.values[0];
                
    this.selected_value = selected_value;

    this.selectDefaultOptionByValue(this.option_component.components[0], this.selected_option);

    this.option_data.quiz[this.selected_option] = selected_value;
    this.fillDescription(this.option_data);
    this.option_control_btn_component.components[0].setDisabled(false); //저장 버튼 활성화

    this.embed.footer = undefined;

    interaction.explicit_replied = true;
    interaction.reply({content: `\`\`\`🔸 옵션 값을 ${selected_value}로 설정했습니다.\`\`\``, ephemeral: true});

    return this;
  }

  handleSaveOption(interaction)
  {
    this.option_control_btn_component.components[0].setDisabled(true); //저장 버튼 비활성화

    this.option_storage.option = this.option_data;

    interaction.explicit_replied = true;
    this.option_storage.saveOptionToDB()
      .then((result) => 
      {

        let result_message = text_contents.server_setting_ui.save_fail;
        if(result !== undefined)
        {
          result_message = text_contents.server_setting_ui.save_success;
        }

        this.embed.footer = {
          "text": result_message
        };

        this.update();
        interaction.reply({content: `${result_message}`, ephemeral: true});
      });
  }

}

module.exports = { ServerSettingUI };