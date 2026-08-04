//외부모듈
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

//로컬 모듈
const db_manager = require('./db_manager.js');
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const logger = require('../../utility/logger.js')('FeedbackManager');

const LikeInfoColumn = 
[
  "quiz_id",
  "guild_id",
  "user_id",
];

let like_info_key_fields = '';
LikeInfoColumn.forEach((field) =>
{
  if(like_info_key_fields != '')
  {
    like_info_key_fields += ', ';
  }
  like_info_key_fields += `${field}`;
});

//퀴즈 피드백 Component
exports.quiz_feedback_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('like')
      .setLabel('추천하기')
      .setStyle(ButtonStyle.Primary)
      .setEmoji("👍"),
  );

exports.addQuizLikeAuto = async (interaction, quiz_id, quiz_title) =>
{ 
  const guild = interaction.guild;
  const user = interaction.user;
  const guild_id = guild.id;
  const user_id = user.id;

  interaction.explicit_replied = true;
  if(await exports.checkAlreadyLike(quiz_id, user_id))
  {
    interaction.reply({content: '```' + `💚 이미 [${quiz_title}] 퀴즈를 추천했네요. 감사합니다! 😄` + '```', flags: MessageFlags.Ephemeral});
    return;
  }

  exports.addQuizLike(quiz_id, guild_id, user_id)
    .then((result) => 
    {

      if(result == true)
      {
        interaction.reply({content: '```' + `👍 [${quiz_title}] 퀴즈를 추천했어요! ` + '```', flags: MessageFlags.Ephemeral});
        logger.info(`Custom quiz got liked by ${user.displayName}[${user_id}]. quiz_title: ${quiz_title} quiz_id: ${quiz_id}`);
      }
      else
      {
        interaction.explicit_replied = true;
        interaction.reply({content: '```' + `💚 이미 [${quiz_title}] 퀴즈를 추천했네요. 감사합니다! 😄` + '```', flags: MessageFlags.Ephemeral});
      }
    });
};

exports.addQuizLike = async (quiz_id, guild_id, user_id) =>
{
  if(quiz_id == undefined || guild_id == undefined || user_id == undefined)
  {
    return false;
  }

  const result = await db_manager.insertLikeInfo(like_info_key_fields, [quiz_id, guild_id, user_id]);

  if(result == undefined || result.rowCount == 0) //maybe already exists
  {
    return false;
  }

  db_manager.updateQuizLikeCount(quiz_id)
    .then((like_count_result) => 
    {
    
      const like_count = like_count_result.rows[0].like_count;

      logger.info(`Custom quiz's like updated to ${like_count}. quiz_id: ${quiz_id}`);
      if(like_count >= SYSTEM_CONFIG.CERTIFY_LIKE_CRITERIA) //특정 수 이상이면 인증된 퀴즈 시도
      {
        logger.debug(`Trying Custom quiz has been auto certified. quiz_id: ${quiz_id}`);
        db_manager.certifyQuiz(quiz_id, SYSTEM_CONFIG.CERTIFY_PLAYED_COUNT_CRITERIA);
      }
    });

  return true;
};

exports.checkAlreadyLike = async (quiz_id, user_id) =>
{
  if(quiz_id == undefined || user_id == undefined)
  {
    return false;
  }

  const result = await db_manager.selectLikeInfo([quiz_id, user_id]);

  if(result == undefined || result.rows?.length == 0) //not exists
  {
    return false;
  }

  return true; //exists
};