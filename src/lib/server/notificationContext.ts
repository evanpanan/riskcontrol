import type { NotificationPolicy } from '@/lib/notificationPolicy';
export type DeliveryContext = { kind: 'manual'; channel: 'email' | 'telegram'; actorId: string; actorName: string; actorEmail: string };
export function manualContext(payload: { details?: Record<string, unknown> }): DeliveryContext | null {
  const ctx = payload.details?.deliveryContext as DeliveryContext | undefined;
  return ctx?.kind === 'manual' && ['email', 'telegram'].includes(ctx.channel) && typeof ctx.actorId === 'string' && typeof ctx.actorName === 'string' ? ctx : null;
}
export function scopedDeliveryPolicy(policy: NotificationPolicy, payload: { details?: Record<string, unknown> }): NotificationPolicy {
  const ctx = manualContext(payload);
  return ctx ? { ...policy, telegramEnabled: ctx.channel === 'telegram', criticalEmailEnabled: ctx.channel === 'email', fallbackEmailEnabled: false } : policy;
}
export function notificationMessage(payload: { message: string; details?: Record<string, unknown> }) {
  const ctx = manualContext(payload);
  return ctx ? `【手动发送】\n发起人：${ctx.actorName}\n\n${payload.message}` : `【系统自动提醒】\n\n${payload.message}`;
}
