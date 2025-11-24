// .env からトークンを読み込む
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

// Botが監視する内容（インテント設定）
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,          // サーバー情報
    GatewayIntentBits.GuildVoiceStates // ボイスチャンネルの出入り
  ],
});

// 通知を送りたいテキストチャンネルのID
const NOTIFY_CHANNEL_ID = '895218068299587599';

client.once('ready', () => {
  console.log(`ログイン完了：${client.user.tag}`);
});

// ボイスチャンネルの状態が変化したときに呼ばれるイベント
client.on('voiceStateUpdate', (oldState, newState) => {
  const before = oldState.channelId;
  const after = newState.channelId;

  // 「何もいなかった → どこかのVCに入った」パターンだけ拾う
  if (!before && after) {
    const notifyChannel = client.channels.cache.get(NOTIFY_CHANNEL_ID);
    if (!notifyChannel) return;

    const member = newState.member;
    const userName = member?.displayName || member?.user?.username || '誰か';

    notifyChannel.send(
      `${userName} さんが「${newState.channel?.name}」に参加しました。`
    );
  }
});

// Botログイン
client.login(process.env.DISCORD_TOKEN);
