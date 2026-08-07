const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getQuizSession } = require('../quiz_system/quiz_system');
const utility = require('../../utility/utility.js');
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const db_manager = require('./db_manager.js');
const logger = require('../../utility/logger.js')('MultiplayerChatManager');

const agree_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setLabel('동의하기')
      .setURL('https://koreanbots.dev/bots/788060831660114012')
      .setStyle(ButtonStyle.Link),
  );

let koreanbots = undefined;
const initialize = (client) => 
{
  koreanbots = client;
};

const vote_validation_time = 24 * 60 * 60 * 1000; //1일 유효
let voted_cache = {};
const checkVote = async (user_id) =>
{
  if(koreanbots === undefined || SYSTEM_CONFIG.CHECK_KOREAN_BOT_VOTE === false)
  {
    return true;
  }

  if(voted_cache[user_id] !== undefined)
  {
    return true;
  }

  try
  {
    const voted_info = await koreanbots.mybot.checkVote(user_id);
    if(voted_info)
    {
      const last_vote = voted_info.lastVote;
      if(Date.now() - last_vote > vote_validation_time) //하트 누른지 1일 지났어?
      {
        return false; //안되지 안돼
      }

      logger.info(`Adding vote cache. user_id: ${user_id}`);
      voted_cache[user_id] = true; //캐싱
      return true;
    }
    else
    {
      return false;
    }
  }
  catch(err)
  {
    logger.warn(`Check vote failed. user_id: ${user_id}, err: ${err.message}`);
    return true; //에러나면 걍 true
  }
};

const checkBanned = async (interaction, user_id) => 
{
  try
  {
    const ban_history_result = await db_manager.selectBanHistory(user_id);
    if(!ban_history_result || ban_history_result.rowCount === 0)
    {
      return false;
    }

    const ban_history = ban_history_result.rows[0];
    const ban_expiration_timestamp = ban_history.ban_expiration_timestamp;

    if(ban_expiration_timestamp < Date.now())
    {
      return false;
    }

    const expiration_date = new Date(parseInt(ban_expiration_timestamp));
    interaction.reply({content: `\`\`\`전체 대화 기능 이용이 제한되었습니다. (${expiration_date.toLocaleString()} 까지)\`\`\``, flags: MessageFlags.Ephemeral});   
    return true;
  }
  catch(err)
  {
    logger.error(`Check ban failed. user_id: ${user_id}. err: ${err}. ignore ban check`);
  }

  return false;
};

const sendMultiplayerChat = async (interaction) =>
{
  interaction.explicit_replied = true;

  const user = interaction.user; //맴버로 할까... 유저로 할까... -> 유저다!
  const user_id = user.id;

  if(await checkBanned(interaction, user_id))
  {
    return;
  }

  if(await checkVote(user_id) === false) //동의를 안했어?
  {
    interaction.reply({
      content: 
      `\`\`\`
      [전체 대화 기능 이용 시 동의 사항]\n
      \n
      🔹 전체 대화 기능을 이용하실 때, 다음 사항에 동의해 주셔야 합니다.\n
      \n
      1️⃣ 욕설, 비방 등 부적절한 언어 사용은 엄격히 금지됩니다.\n
      2️⃣ 신고된 메시지는 서버에 기록되며, 필요 시 관리자가 확인할 수 있습니다.\n
      3️⃣ 신고가 누적되면 대화 기능이 일시적 또는 영구적으로 제한될 수 있습니다.\n
      \n
      🔸 동의하시면 [동의하기] 버튼을 누르신 후, [하트 추가]를 눌러 주시기 바랍니다.\n
      🔸 해당 동의는 24시간 동안 유효합니다.
      \`\`\``
      , flags: MessageFlags.Ephemeral
      , components: [agree_comp]
    });

    return;
  }

  const quiz_session = getMultiplayerQuizSession(interaction);
  if(quiz_session === undefined)
  {
    return;
  }

  const channel = quiz_session.channel;
  if(channel?.id !== interaction.channel.id)
  {
    interaction.reply({content: `\`\`\`🔸 퀴즈가 진행 중인 채팅 채널에서만 사용 가능합니다.\`\`\``, flags: MessageFlags.Ephemeral});
    return;
  }

  const message = interaction.options.getString('메시지') ?? '';
  if(message === undefined || message === '')
  {
    interaction.reply({content: `\`\`\`🔸 메시지 값은 필수입니다.\`\`\``, flags: MessageFlags.Ephemeral});
    return;
  }

  const chat_message = `\`\`\`💭 [${interaction.guild.name}] ${user.displayName}: ${message}\`\`\``;

  if(quiz_session.isIgnoreChat())
  {
    interaction.reply({content: `\`\`\`🔸 전체 채팅 기능이 꺼져있습니다.\n'/채팅전환' 명령어로 켜거나 끌 수 있습니다.\`\`\``, flags: MessageFlags.Ephemeral});
    return;
  }

  quiz_session.sendRequestChat(user.id, chat_message);
  interaction.reply({ content: `\`\`\`메시지 전송됨\`\`\`` , flags: MessageFlags.Ephemeral});
};

const toggleMultiplayerChat = (interaction) =>
{
  interaction.explicit_replied = true;

  const quiz_session = getMultiplayerQuizSession(interaction);
  if(quiz_session === undefined)
  {
    return;
  }

  const ignore_chat = quiz_session.toggleIgnoreChat(interaction.user.displayName);
  interaction.reply({content: `\`\`\`🔸 전체 채팅을 ${ignore_chat ? "껐습니다." : "켰습니다."}\`\`\``, flags: MessageFlags.Ephemeral});
};

const getMultiplayerQuizSession = (interaction) =>
{
  if(!interaction.guild)
  {
    interaction.reply({content: `\`\`\`🔸 퀴즈 진행 중인 서버에서만 사용 가능합니다.\`\`\``, flags: MessageFlags.Ephemeral});
    return undefined;
  }

  const quiz_session = getQuizSession(interaction.guild.id);
  if(quiz_session === undefined || quiz_session.isMultiplayerSession() === false)
  {
    interaction.reply({content: `\`\`\`🔸 멀티플레이 퀴즈에 참가 중이지 않습니다.\`\`\``, flags: MessageFlags.Ephemeral});
    return undefined;
  }

  return quiz_session;
};

module.exports = { initialize, sendMultiplayerChat, toggleMultiplayerChat };