require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

// 環境変数
const TOKEN = process.env.DISCORD_TOKEN;
const DEFAULT_NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID;

// サーバーごとの通知チャンネル設定（!setvc で更新）
const guildChannelMap = new Map();

// 時報の二重送信防止用キー
let lastTimeSignalKey = null;

// JSTオフセット（RailwayなどがUTCでも、日本時間に合わせる）
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 起動時
client.once('ready', () => {
  console.log(`ログイン完了：${client.user.tag}`);
  startTimeSignalJob();
});

// ----------------------
//  コマンド: !setvc
// ----------------------
client.on('messageCreate', (message) => {
  // DM・Bot・ギルド外は無視
  if (!message.guild) return;
  if (message.author.bot) return;

  if (message.content === '!setvc') {
    guildChannelMap.set(message.guild.id, message.channel.id);
    message.reply('このチャンネルをVC参加通知＆時報の送信先に設定したよ！');
    console.log(`ギルド ${message.guild.id} の通知先を ${message.channel.id} に設定`);
  }
});

// ----------------------
//  VC参加通知
// ----------------------
client.on('voiceStateUpdate', (oldState, newState) => {
  const before = oldState.channelId;
  const after = newState.channelId;

  // 「何も入ってなかった → VC参加」のときだけ
  if (!before && after) {
    const guildId = newState.guild.id;

    let notifyChannelId = guildChannelMap.get(guildId);
    if (!notifyChannelId) {
      notifyChannelId = DEFAULT_NOTIFY_CHANNEL_ID;
    }

    if (!notifyChannelId) {
      console.error(`通知チャンネルが設定されていません（ギルドID: ${guildId}）`);
      return;
    }

    const notifyChannel = client.channels.cache.get(notifyChannelId);
    if (!notifyChannel || !notifyChannel.isTextBased()) {
      console.error(`通知チャンネルが見つからない or テキストチャンネルではありません（ID: ${notifyChannelId}）`);
      return;
    }

    const member = newState.member;
    const userName = member?.displayName || member?.user?.username || '誰か';

    notifyChannel.send(
      `${userName} さんが「${newState.channel?.name}」に参加しました。`
    );
  }
});

// ----------------------
//  時報ジョブ
//  ・JSTの22:00と0:00に
//    各サーバーの通知チャンネルへ
//    VC参加者一覧付きでメッセージ送信
// ----------------------
function startTimeSignalJob() {
  // 30秒ごとにチェック
  setInterval(() => {
    const now = new Date();
    const jst = new Date(now.getTime() + JST_OFFSET_MS);

    const h = jst.getHours();   // 0〜23
    const m = jst.getMinutes(); // 0〜59

    // JST 22:00 / 0:00 以外は何もしない
    if (!(m === 0 && (h === 22 || h === 0 || h === 14))) return;

    // 同じ日付・同じ時間帯には一回だけ送る
    const key = `${jst.getFullYear()}-${jst.getMonth()}-${jst.getDate()}-${h}`;
    if (lastTimeSignalKey === key) return;
    lastTimeSignalKey = key;

    sendTimeSignal(jst, h);
  }, 30 * 1000);
}

function sendTimeSignal(jstDate, hourJST) {
  const hh = hourJST === 0 ? '24:00（正確には0:00）' : `${String(hourJST).padStart(2, '0')}:00`;
  console.log(`時報送信処理を開始します（JST ${hh}）`);

  client.guilds.cache.forEach((guild) => {
    // そのギルドでVCに入っているメンバーを取得
    const voiceStates = guild.voiceStates.cache.filter(vs => vs.channelId);

    if (voiceStates.size === 0) {
      // 誰もVCにいないサーバーには送らない
      return;
    }

    // 通知先チャンネルを決定（!setvc 優先、なければデフォルト）
    let notifyChannelId = guildChannelMap.get(guild.id) || DEFAULT_NOTIFY_CHANNEL_ID;
    if (!notifyChannelId) {
      console.error(`時報用の通知チャンネルが設定されていません（ギルドID: ${guild.id}）`);
      return;
    }

    const notifyChannel = guild.channels.cache.get(notifyChannelId);
    if (!notifyChannel || !notifyChannel.isTextBased()) {
      console.error(`時報通知チャンネルが見つからない or テキストチャンネルではありません（ID: ${notifyChannelId}）`);
      return;
    }

    // チャンネルごとに参加者をまとめる
    const channelUserMap = new Map();

    voiceStates.forEach((vs) => {
      const chId = vs.channelId;
      if (!chId) return;

      const member = vs.member;
      const userName = member?.displayName || member?.user?.username || '誰か';

      if (!channelUserMap.has(chId)) {
        channelUserMap.set(chId, []);
      }
      channelUserMap.get(chId).push(userName);
    });

    // メッセージ本文を組み立て
    const lines = [];
    lines.push(`⏰ 時報です。現在の時刻は JST ${hh} です。そろそろ寝ようね！`);
    lines.push(`このサーバーで、いまボイスチャンネルにいる人たちです：`);

    channelUserMap.forEach((names, chId) => {
      const vc = guild.channels.cache.get(chId);
      const chName = vc ? vc.name : '不明なチャンネル';
      lines.push(`・${chName}：${names.join('、')}`);
    });

    notifyChannel.send(lines.join('\n')).catch(err => {
      console.error('時報メッセージ送信に失敗しました:', err);
    });
  });
}

// ----------------------
//  ログイン
// ----------------------
if (!TOKEN) {
  console.error('DISCORD_TOKEN が設定されていません');
} else {
  client.login(TOKEN);
}

