import { NotificationTransportError } from './notificationErrors';
import { prisma } from '../prisma';

export const TELEGRAM_CHANNEL_KEY = 'risk_control_telegram_channel';
type Env = Record<string, string | undefined>;
export interface TelegramChannel { chatId: string; title: string; username?: string; joinUrl?: string }

export async function telegramApi(method: string, payload: unknown, env: Env = process.env): Promise<any> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('Telegram Bot Token 未配置或格式无效');
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      redirect: 'error', signal: AbortSignal.timeout(12000),
    });
  } catch { throw new NotificationTransportError('Telegram 连接失败或超时，是否受理未知，请核查频道后再重试','unknown'); }
  const data = await response.json().catch(() => null);
  if (data?.ok !== true && data?.ok !== false) throw new NotificationTransportError('Telegram 响应不明，请核查频道，暂停自动重发','unknown');
  if (!response.ok || data?.ok !== true) {
    const code = Number(data?.error_code || response.status);
    if (code === 429) throw new Error(`Telegram 发送限流，请在 ${Number(data?.parameters?.retry_after) || 30} 秒后重试`);
    throw new Error(`Telegram 未受理请求（${code}），请核查机器人权限和频道配置`);
  }
  return data.result;
}

export function validChannelId(value: string): boolean { return /^-100\d+$/.test(value) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value); }
export function validateJoinUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.username || url.password || url.port || url.hash) throw new Error('频道加入链接必须为 https://t.me/...');
  return url.toString();
}
export async function loadTelegramChannel(env: Env = process.env): Promise<TelegramChannel | null> {
  const envId = env.TELEGRAM_CHANNEL_ID?.trim();
  if (envId) {
    if (!validChannelId(envId)) throw new Error('TELEGRAM_CHANNEL_ID 格式无效');
    return { chatId: envId, title: 'Telegram 风控频道', joinUrl: validateJoinUrl(env.TELEGRAM_CHANNEL_URL) ?? (envId.startsWith('@') ? `https://t.me/${envId.slice(1)}` : undefined) };
  }
  const record = await prisma.workspaceRecord.findUnique({ where: { kind_key: { kind: 'config', key: TELEGRAM_CHANNEL_KEY } } });
  const channel = record?.payload as unknown as TelegramChannel | undefined;
  return channel && /^-100\d+$/.test(channel.chatId) ? channel : null;
}
export async function verifyTelegramChannel(chatId: string, joinUrl?: string, env: Env = process.env): Promise<TelegramChannel> {
  if (!validChannelId(chatId)) throw new Error('请填写 @频道用户名或 -100 开头的频道 ID');
  const [chat, bot] = await Promise.all([telegramApi('getChat', { chat_id: chatId }, env), telegramApi('getMe', {}, env)]);
  if (chat.type !== 'channel') throw new Error('请选择 Telegram 频道，不支持私聊或群组');
  const member = await telegramApi('getChatMember', { chat_id: chat.id, user_id: bot.id }, env);
  if (member.status !== 'administrator' || member.can_post_messages !== true) throw new Error('请将机器人设为频道管理员，并开启发布消息权限');
  return { chatId: String(chat.id), title: String(chat.title || chatId), username: chat.username,
    joinUrl: chat.username ? `https://t.me/${chat.username}` : validateJoinUrl(joinUrl) };
}
export async function sendTelegramChannel(text: string, env: Env = process.env): Promise<string[]> {
  const channel = await loadTelegramChannel(env);
  if (!channel) throw new Error('尚未配置 Telegram 风控频道，请在系统设置中配置频道');
  // Avoid parse_mode: risk text is sent verbatim, without markup injection.
  const chars = Array.from(text);
  for (let start = 0; start < chars.length; start += 4000) {
    try { await telegramApi('sendMessage', { chat_id: channel.chatId, text: chars.slice(start, start + 4000).join(''), link_preview_options: { is_disabled: true } }, env); }
    catch(error) { if(start>0) throw new NotificationTransportError('Telegram 长消息已有部分受理，请人工核查后处理','unknown'); throw error; }
  }
  return [channel.chatId];
}
