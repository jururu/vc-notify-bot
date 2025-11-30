require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 環境変数
const TOKEN = process.env.DISCORD_TOKEN;
const DEFAULT_NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID;

// サーバーごとの通知チャンネル設定（!setvc で更新）
const guildChannelMap = new Map();

// 時報の二重送信防止用キー（「同じ日付＋同じ時間」に一回だけ送る）
let lastTimeSignalKey = null;

// JSTオフセット（RailwayなどがUTCでも、日本時間に合わせる）
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ----------------------------------------
//  @everyone でも入れる「公開VC」かどうか
//  （鍵付きVCは @everyone が Connect を持っていない想定）
// ----------------------------------------
function isPublicVoiceChannel(channel) {
  if (!channel) return false;
  const guild = channel.guild;
  if (!guild) return false;

  const everyone = guild.roles.everyone;
  const perms = channel.permissionsFor(everyone);
  if (!perms) return false;

  // Connect 権限が @everyone にある = 公開VC とみなす
  return perms.has(PermissionsBitField.Flags.Connect);
}

// ----------------------------------------
//  起動時
// ----------------------------------------
client.once('ready', () => {
  console.log(`ログイン完了：${client.user.tag}`);
  startTimeSignalJob();
});

// ----------------------------------------
//  コマンド: !setvc
//  → そのサーバーの通知＆時報送信先チャンネルを設定
// ----------------------------------------
client.on('messageCreate', (message) => {
  // DM・Bot・ギルド外は無視
  if (!message.guild) return;
  if (message.author.bot) return;

  if (message.content === '!setvc') {
    guildChannelMap.set(message.guild.id, message.channel.id);
    message.reply('このチャンネルをVC参加通知＆時報の送信先に設定しました。');
    console.log(
      `ギルド ${message.guild.id} の通知先を ${message.channel.id} に設定`
    );
  }
});

// ----------------------------------------
//  VC参加通知（公開VCのみ）
// ----------------------------------------
client.on('voiceStateUpdate', (oldState, newState) => {
  const before = oldState.channelId;
  const after = newState.channelId;

  // 「何も入ってなかった → VC参加」のときだけ
  if (!before && after) {
    const joinedChannel = newState.channel;

    // 鍵付きVC（@everyone が Connect できないVC）は無視する
    if (!isPublicVoiceChannel(joinedChannel)) {
      return;
    }

    const guildId = newState.guild.id;

    let notifyChannelId = guildChannelMap.get(guildId);
    if (!notifyChannelId) {
      notifyChannelId = DEFAULT_NOTIFY_CHANNEL_ID;
    }

    if (!notifyChannelId) {
      console.error(
        `通知チャンネルが設定されていません（ギルドID: ${guildId}）`
      );
      return;
    }

    const notifyChannel = client.channels.cache.get(notifyChannelId);
    if (!notifyChannel || !notifyChannel.isTextBased()) {
      console.error(
        `通知チャンネルが見つからない or テキストチャンネルではありません（ID: ${notifyChannelId}）`
      );
      return;
    }

    const member = newState.member;
    const userName =
      member?.displayName || member?.user?.username || '誰か';

    notifyChannel
      .send(`${userName} さんが「${joinedChannel?.name}」に参加しました。`)
      .catch((err) => {
        console.error('参加通知の送信に失敗しました:', err);
      });
  }
});

// ----------------------------------------
//  時報ジョブ
//  ・JSTの 14:00 / 22:00 / 0:00 に
//    各サーバーの通知チャンネルへ
//    「公開VCにいる人たち」の一覧付きでメッセージ送信
// ----------------------------------------
function startTimeSignalJob() {
  // 30秒ごとにチェック
  setInterval(() => {
    const now = new Date();
    const jst = new Date(now.getTime() + JST_OFFSET_MS);

    const h = jst.getHours(); // 0〜23
    const m = jst.getMinutes(); // 0〜59

    // JST 14:00 / 22:00 / 0:00 以外は何もしない
    if (!(m === 0 && (h === 22 || h === 0))) return;

    // 同じ日付・同じ時間帯には一回だけ送る
    const key = `${jst.getFullYear()}-${jst.getMonth()}-${jst.getDate()}-${h}`;
    if (lastTimeSignalKey === key) return;
    lastTimeSignalKey = key;

    sendTimeSignal(jst, h);
  }, 30 * 1000);
}

function sendTimeSignal(jstDate, hourJST) {
  let hhLabel;
  if (hourJST === 0) {
    hhLabel = '24:00（正確には0:00）';
  } else {
    hhLabel = `${String(hourJST).padStart(2, '0')}:00`;
  }

  console.log(`時報送信処理を開始します（JST ${hhLabel}）`);

  client.guilds.cache.forEach((guild) => {
    // そのギルドで「公開VC」に入っているメンバーを取得
    const voiceStates = guild.voiceStates.cache.filter((vs) => {
      const ch = vs.channel;
      if (!ch) return false;
      return isPublicVoiceChannel(ch);
    });

    if (voiceStates.size === 0) {
      // 公開VCに誰もいないサーバーには送らない
      return;
    }

    // 通知先チャンネルを決定（!setvc 優先、なければデフォルト）
    let notifyChannelId =
      guildChannelMap.get(guild.id) || DEFAULT_NOTIFY_CHANNEL_ID;

    if (!notifyChannelId) {
      console.error(
        `時報用の通知チャンネルが設定されていません（ギルドID: ${guild.id}）`
      );
      return;
    }

    const notifyChannel = guild.channels.cache.get(notifyChannelId);
    if (!notifyChannel || !notifyChannel.isTextBased()) {
      console.error(
        `時報通知チャンネルが見つからない or テキストチャンネルではありません（ID: ${notifyChannelId}）`
      );
      return;
    }

    // チャンネルごとに参加者をまとめる
    const channelUserMap = new Map();

    voiceStates.forEach((vs) => {
      const ch = vs.channel;
      if (!ch) return;

      const chId = ch.id;
      const member = vs.member;
      const userName =
        member?.displayName || member?.user?.username || '誰か';

      if (!channelUserMap.has(chId)) {
        channelUserMap.set(chId, {
          name: ch.name,
          users: [],
        });
      }
      channelUserMap.get(chId).users.push(userName);
    });

    // メッセージ本文を組み立て
    const lines = [];
    lines.push(`⏰ 時報です。現在の時刻は JST ${hhLabel} です。そろそろ寝ようね！`);
    lines.push('このサーバーで、いま公開ボイスチャンネルにいる人たちです：');

    channelUserMap.forEach((info) => {
      lines.push(`・${info.name}：${info.users.join('、')}`);
    });

    notifyChannel.send(lines.join('\n')).catch((err) => {
      console.error('時報メッセージ送信に失敗しました:', err);
    });
  });
}

// ----------------------------------------
//  ログイン
// ----------------------------------------
if (!TOKEN) {
  console.error('DISCORD_TOKEN が設定されていません');
} else {
  client.login(TOKEN);
}
