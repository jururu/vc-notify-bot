require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,   // テキストメッセージを見る
    GatewayIntentBits.MessageContent   // メッセージ内容を読む（!setvc 用）
  ],
});

// 環境変数（自分のサーバー用のデフォルト値としても使える）
const TOKEN = process.env.DISCORD_TOKEN;
const DEFAULT_NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID;

// サーバーごとの「通知チャンネル設定」を持っておく（メモリ上）
const guildChannelMap = new Map();

// 起動時ログ
client.once('ready', () => {
  console.log(`ログイン完了：${client.user.tag}`);
});

// ★ 各サーバーで通知チャンネルを設定するコマンド
// 例）通知させたいテキストチャンネルで「!setvc」と発言
client.on('messageCreate', (message) => {
  // Bot自身やDMは無視
  if (!message.guild) return;
  if (message.author.bot) return;

  // コマンド部分はお好みで変えてOK
  if (message.content === '!setvc') {
    guildChannelMap.set(message.guild.id, message.channel.id);
    message.reply('このチャンネルをVC参加通知先に設定しました。');
    console.log(`ギルド ${message.guild.id} の通知先を ${message.channel.id} に設定`);
  }
});

// ★ ボイスチャンネルへの参加を検知して通知
client.on('voiceStateUpdate', (oldState, newState) => {
  const before = oldState.channelId;
  const after = newState.channelId;

  // 「何も入ってない状態 → VCに入った」ときだけ
  if (!before && after) {
    const guildId = newState.guild.id;

    // ① そのサーバー専用に設定されたチャンネルIDを探す
    let notifyChannelId = guildChannelMap.get(guildId);

    // ② なければデフォルト（環境変数のNOTIFY_CHANNEL_ID）を使う
    if (!notifyChannelId) {
      notifyChannelId = DEFAULT_NOTIFY_CHANNEL_ID;
    }

    if (!notifyChannelId) {
      console.error(`通知チャンネルが設定されていません（ギルドID: ${guildId}）`);
      return;
    }

    const notifyChannel = client.channels.cache.get(notifyChannelId);
    if (!notifyChannel) {
      console.error(`通知チャンネルが見つかりません（チャンネルID: ${notifyChannelId}）`);
      return;
    }

    const member = newState.member;
    const userName = member?.displayName || member?.user?.username || '誰か';

    notifyChannel.send(
      `${userName} さんが「${newState.channel?.name}」に参加しました。`
    );
  }
});

// ログイン
if (!TOKEN) {
  console.error('DISCORD_TOKEN が設定されていません');
} else {
  client.login(TOKEN);
}
