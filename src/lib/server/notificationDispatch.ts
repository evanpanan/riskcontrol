import { createHash, randomUUID } from "node:crypto";
import { Prisma, type NotificationDispatch } from "@prisma/client";
import { prisma } from "../prisma";
import {
  DEFAULT_NOTIFICATION_POLICY,
  NOTIFICATION_POLICY_KEY,
  parseNotificationPolicy,
  initialDispatchState,
  criticalNotification,
  dispatchStatus,
  type DispatchState,
  type NotificationPolicy,
  type ChannelAttempt,
} from "../notificationPolicy";
import {
  deliverNotification,
  notificationReadiness,
} from "./notificationDelivery";
import { unknownNotificationOutcome } from "./notificationErrors";

type Env = Record<string, string | undefined>;
type Payload = {
  type: string;
  severity: string;
  title: string;
  message: string;
  batchId?: string;
  batchNumber?: string;
  stockSymbol?: string;
  details?: Record<string, unknown>;
};
const asJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const COOLDOWN_MS = 30 * 60_000;
export async function loadNotificationPolicy(): Promise<NotificationPolicy> {
  const record = await prisma.workspaceRecord.findUnique({
    where: { kind_key: { kind: "config", key: NOTIFICATION_POLICY_KEY } },
  });
  if (record) return parseNotificationPolicy(record.payload);
  const records = await prisma.workspaceRecord.findMany({
    where: {
      kind: "config",
      key: { in: ["risk_control_recipients", "risk_control_settings"] },
    },
  });
  const emails = new Set<string>();
  for (const row of records) {
    try {
      const raw = (row.payload as { value?: string })?.value;
      const value = raw ? JSON.parse(raw) : null;
      if (row.key === "risk_control_recipients" && Array.isArray(value))
        for (const rec of value)
          if (
            rec.enabled !== false &&
            ["ADMIN", "RISK_MANAGER"].includes(rec.role) &&
            typeof rec.email === "string" &&
            /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(rec.email) &&
            !/@(example\.com|institution\.com|bd-team\.com)$/i.test(rec.email)
          )
            emails.add(rec.email.trim().toLowerCase());
      if (
        row.key === "risk_control_settings" &&
        typeof value?.defaultRiskEmail === "string" &&
        /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.defaultRiskEmail) &&
        !/@(example\.com|institution\.com)$/i.test(value.defaultRiskEmail)
      )
        emails.add(value.defaultRiskEmail.trim().toLowerCase());
    } catch {
      /* Invalid legacy settings do not broaden email recipients. */
    }
  }
  return {
    ...DEFAULT_NOTIFICATION_POLICY,
    coreEmails: [...emails].slice(0, 10),
  };
}
export function validateDispatchPayload(raw: any): Payload {
  if (
    !raw ||
    typeof raw.title !== "string" ||
    !raw.title.trim() ||
    raw.title.length > 200 ||
    typeof raw.message !== "string" ||
    raw.message.length > 4000 ||
    !["INFO", "WARNING", "MARGIN_CALL", "SETTLEMENT", "CLIENT_ADDED"].includes(
      raw.type,
    ) ||
    !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(raw.severity)
  )
    throw new Error("通知内容、类型或级别无效");
  if (
    raw.batchId != null &&
    (typeof raw.batchId !== "string" || raw.batchId.length > 200)
  )
    throw new Error("批次参数无效");
  return {
    type: raw.type,
    severity: raw.severity,
    title: raw.title,
    message: raw.message,
    ...(raw.batchId ? { batchId: raw.batchId } : {}),
    ...(raw.batchNumber
      ? { batchNumber: String(raw.batchNumber).slice(0, 100) }
      : {}),
    ...(raw.stockSymbol
      ? { stockSymbol: String(raw.stockSymbol).slice(0, 30) }
      : {}),
    ...(raw.details && typeof raw.details === "object"
      ? { details: raw.details }
      : {}),
  };
}
export function notificationIdentity(payload: Payload): string {
  // Risk upgrades have a separate identity and are never swallowed by a lower-level warning.
  return createHash("sha256")
    .update(
      JSON.stringify([
        payload.batchId || "",
        payload.type,
        payload.severity,
        payload.batchId ? "" : payload.title,
        payload.type === "MARGIN_CALL"
          ? String(
              payload.details?.marginCallId || payload.details?.roundId || "",
            )
          : "",
      ]),
    )
    .digest("hex");
}
export async function enqueueNotification(
  raw: unknown,
  previouslyAccepted: string[] = [],
): Promise<{ dispatch: NotificationDispatch; deduplicated: boolean }> {
  const payload = validateDispatchPayload(raw);
  const policy = await loadNotificationPolicy();
  const identity = notificationIdentity(payload);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity}))`;
    const existing = await tx.notificationDispatch.findFirst({
      where: {
        identity,
        OR: [
          { status: { in: ["PENDING", "REVIEW"] } },
          { updatedAt: { gte: new Date(now.getTime() - COOLDOWN_MS) } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    if (
      existing &&
      !(
        existing.status === "SKIPPED" &&
        JSON.stringify([
          ...(
            [
              "telegramEnabled",
              "criticalEmailEnabled",
              "fallbackEmailEnabled",
            ] as const
          ).map(
            (key) => (existing.policy as unknown as NotificationPolicy)[key],
          ),
          [
            ...(existing.policy as unknown as NotificationPolicy).coreEmails,
          ].sort(),
        ]) !==
          JSON.stringify([
            policy.telegramEnabled,
            policy.criticalEmailEnabled,
            policy.fallbackEmailEnabled,
            [...policy.coreEmails].sort(),
          ])
      )
    )
      return { dispatch: existing, deduplicated: true };
    const state = initialDispatchState(policy, criticalNotification(payload));
    if (previouslyAccepted.includes("telegram"))
      state.telegram = { status: "accepted", sentTo: ["历史记录已受理"] };
    if (previouslyAccepted.includes("email")) {
      // Legacy records only attest to channel acceptance, not to today's recipient list.
      state.emails = {
        历史邮件通道: {
          status: "accepted",
          sentTo: ["历史记录已受理，收件人未逐一核验"],
        },
      };
    }
    if (state.emailReason && !Object.keys(state.emails).length)
      state.emails["未配置核心负责人邮箱"] = {
        status: "unknown",
        sentTo: [],
        error: "请在通知策略中配置核心负责人邮箱，并人工核查此条提醒",
      };
    const dispatch = await tx.notificationDispatch.create({
      data: {
        identity,
        payload: asJson(payload),
        policy: asJson(policy),
        state: asJson(state),
        status: dispatchStatus(state),
      },
    });
    return { dispatch, deduplicated: false };
  });
}
export function dispatchSummary(
  dispatch: Pick<
    NotificationDispatch,
    "id" | "status" | "state" | "nextAttemptAt"
  > &
    Partial<Pick<NotificationDispatch, "leaseToken" | "leaseUntil">>,
) {
  const state = dispatch.state as unknown as DispatchState;
  const emailTo = Object.values(state.emails).flatMap((value) => value.sentTo);
  const accepted = state.telegram.status === "accepted" || emailTo.length > 0;
  const processing =
    !!dispatch.leaseToken &&
    !!dispatch.leaseUntil &&
    dispatch.leaseUntil.getTime() > Date.now();
  const hasUnknown = [state.telegram, ...Object.values(state.emails)].some(
    (value) => value.status === "unknown",
  );
  const emailAttempts = Object.values(state.emails);
  const emailStatus = emailAttempts.some((value) => value.status === "unknown")
    ? "unknown"
    : emailAttempts.some((value) => value.status === "pending")
      ? "pending"
      : emailAttempts.some((value) => value.status === "failed")
        ? "failed"
        : emailTo.length
          ? "accepted"
          : "skipped";
  const text = processing
    ? "通知正在发送，请勿重复点击"
    : dispatch.status === "PENDING" && hasUnknown
      ? "部分渠道结果不明需核查，其余未发送或失败渠道等待自动重试"
      : dispatch.status === "COMPLETE"
        ? state.emailReason === "fallback"
          ? "TG 未受理，邮件兜底已受理"
          : "通知已受理"
        : dispatch.status === "REVIEW"
          ? "部分通知结果不明，需人工核查；不会自动重发未知结果"
          : dispatch.status === "SKIPPED"
            ? "当前策略未启用适用通知渠道"
            : dispatch.status === "ACKNOWLEDGED"
              ? "已人工核查并停止重试"
              : "通知已记录，失败渠道等待自动重试";
  return {
    success: dispatch.status === "COMPLETE",
    status: processing ? "PROCESSING" : dispatch.status,
    dispatchId: dispatch.id,
    summary: text,
    nextAttemptAt: dispatch.nextAttemptAt,
    channels: {
      telegram: {
        status:
          processing && state.telegram.status === "unknown"
            ? "pending"
            : state.telegram.status,
        success: state.telegram.status === "accepted",
        sentTo: state.telegram.sentTo,
        error: state.telegram.error,
      },
      email: {
        status:
          processing && emailStatus === "unknown" ? "pending" : emailStatus,
        success:
          emailTo.length > 0 &&
          Object.values(state.emails).every(
            (value) =>
              value.status === "accepted" || value.status === "skipped",
          ),
        sentTo: emailTo,
        error:
          Object.values(state.emails)
            .filter((value) => value.error && value.status !== "skipped")
            .map((value) => value.error)
            .join("；") || undefined,
      },
    },
    accepted,
  };
}
export async function processNotificationDispatch(
  id: string,
  env: Env = process.env,
): Promise<NotificationDispatch> {
  const now = new Date();
  const token = randomUUID();
  const claimed = await prisma.notificationDispatch.updateMany({
    where: {
      id,
      status: "PENDING",
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    data: {
      leaseToken: token,
      leaseUntil: new Date(now.getTime() + 10 * 60_000),
      attemptCount: { increment: 1 },
    },
  });
  let row = await prisma.notificationDispatch.findUniqueOrThrow({
    where: { id },
  });
  if (!claimed.count) return row;
  const state = row.state as unknown as DispatchState;
  const policy = row.policy as unknown as NotificationPolicy;
  const payload = row.payload as unknown as Payload;
  const checkpoint = async () => {
    const saved = await prisma.notificationDispatch.updateMany({
      where: {
        id,
        leaseToken: token,
        status: "PENDING",
        leaseUntil: { gt: new Date() },
      },
      data: { state: asJson(state) },
    });
    if (!saved.count) throw new Error("通知处理锁已失效，停止发送");
  };
  let calls = 0;
  async function attempt(
    channel: "telegram" | "email",
    target: string | undefined,
    slot: ChannelAttempt,
  ) {
    if (!["pending", "failed"].includes(slot.status) || calls >= 3) return;
    const latest = await loadNotificationPolicy();
    if (channel === "telegram" && !latest.telegramEnabled) {
      Object.assign(slot, {
        status: "skipped",
        sentTo: [],
        error: "TG提醒已关闭",
      });
      await checkpoint();
      return;
    }
    if (channel === "email") {
      if (
        state.emailReason === "critical" &&
        !latest.criticalEmailEnabled &&
        state.telegram.status === "failed" &&
        policy.fallbackEmailEnabled &&
        latest.fallbackEmailEnabled
      )
        state.emailReason = "fallback";
      if (state.emailReason === "fallback" && !latest.fallbackEmailEnabled)
        state.emailReason = undefined;
      if (
        !target ||
        !latest.coreEmails.includes(target) ||
        !state.emailReason ||
        (state.emailReason === "critical" && !latest.criticalEmailEnabled)
      ) {
        Object.assign(slot, {
          status: "skipped",
          sentTo: [],
          error: "邮件提醒已关闭或收件人已移除",
        });
        await checkpoint();
        return;
      }
    }
    calls++;
    // Persist uncertainty BEFORE the external call: a crash will require review, never blind resend.
    slot.status = "unknown";
    slot.error = "投递处理中断或结果未确认，请人工核查";
    await checkpoint();
    let outcome: ChannelAttempt;
    try {
      const response = await deliverNotification(
        {
          channel,
          payload: {
            ...payload,
            recipients: { emails: target ? [target] : [], telegrams: [] },
          },
        },
        env,
      );
      outcome = response.success
        ? { status: "accepted", sentTo: response.sentTo, error: undefined }
        : {
            status:
              "failureKind" in response && response.failureKind === "unknown"
                ? "unknown"
                : "failed",
            sentTo: response.sentTo,
            error: response.error || "服务商未受理",
          };
    } catch (error) {
      outcome = {
        status: unknownNotificationOutcome(error) ? "unknown" : "failed",
        sentTo: [],
        error: error instanceof Error ? error.message : "通知失败",
      };
    }
    Object.assign(slot, outcome);
    await checkpoint();
    try {
      await prisma.notificationLog.create({
        data: {
          channel,
          provider: notificationReadiness(env)[channel].provider,
          title: payload.title,
          recipients: JSON.stringify(target ? [target] : slot.sentTo),
          status:
            outcome.status === "accepted"
              ? "SENT"
              : outcome.sentTo.length
                ? "PARTIAL"
                : "FAILED",
          error:
            outcome.status === "unknown"
              ? `需人工核查：${outcome.error}`
              : outcome.error,
          batchId: payload.batchId,
          type:
            state.emailReason === "fallback" && channel === "email"
              ? "EMAIL_FALLBACK"
              : payload.type,
        },
      });
    } catch {
      /* Dispatch ledger already contains the durable result. */
    }
  }
  try {
    const livePolicy = await loadNotificationPolicy();
    // Turning a channel off or removing a recipient cancels future attempts immediately.
    // Enabling a channel or adding recipients never broadens an already queued notification.
    if (
      !livePolicy.telegramEnabled &&
      ["pending", "failed"].includes(state.telegram.status)
    )
      state.telegram = {
        status: "skipped",
        sentTo: [],
        error: "管理员已关闭TG提醒",
      };
    for (const [email, slot] of Object.entries(state.emails))
      if (
        ["pending", "failed"].includes(slot.status) &&
        (!livePolicy.coreEmails.includes(email) ||
          (state.emailReason === "critical" &&
            !livePolicy.criticalEmailEnabled) ||
          (state.emailReason === "fallback" &&
            !livePolicy.fallbackEmailEnabled))
      )
        state.emails[email] = {
          status: "skipped",
          sentTo: [],
          error: "通知策略已关闭该邮件投递或移除了收件人",
        };
    if (state.emailReason === "fallback" && !livePolicy.fallbackEmailEnabled)
      state.emailReason = undefined;
    await checkpoint();
    if (
      !(state.emailReason === "fallback" && state.telegram.status === "failed")
    )
      await attempt("telegram", undefined, state.telegram);
    if (
      state.telegram.status === "failed" &&
      policy.fallbackEmailEnabled &&
      livePolicy.fallbackEmailEnabled &&
      (!state.emailReason ||
        (state.emailReason === "critical" && !livePolicy.criticalEmailEnabled))
    ) {
      state.emailReason = "fallback";
      state.emails = Object.fromEntries(
        policy.coreEmails
          .filter((email) => livePolicy.coreEmails.includes(email))
          .map((email) => [
            email,
            state.emails[email]?.status === "accepted"
              ? state.emails[email]
              : ({ status: "pending", sentTo: [] } as ChannelAttempt),
          ]),
      );
      if (!Object.keys(state.emails).length)
        state.emails["未配置核心负责人邮箱"] = {
          status: "unknown",
          sentTo: [],
          error: "TG 失败但未配置邮件兜底收件人，请人工核查",
        };
      await checkpoint();
    }
    for (const [target, slot] of Object.entries(state.emails))
      await attempt("email", target, slot);
    const status = dispatchStatus(state);
    const retryMs = [state.telegram, ...Object.values(state.emails)].some(
      (value) => value.status === "pending",
    )
      ? 15_000
      : Math.min(30 * 60_000, 60_000 * 2 ** Math.min(5, row.attemptCount - 1));
    await prisma.notificationDispatch.updateMany({
      where: { id, leaseToken: token },
      data: {
        status,
        state: asJson(state),
        nextAttemptAt: new Date(Date.now() + retryMs),
        leaseToken: null,
        leaseUntil: null,
      },
    });
  } catch (error) {
    // A failed checkpoint must not turn a possibly accepted provider request into a blind retry.
    await prisma.notificationDispatch
      .updateMany({
        where: { id, leaseToken: token },
        data: { status: "REVIEW", leaseToken: null, leaseUntil: null },
      })
      .catch(() => {});
    throw error;
  }
  return prisma.notificationDispatch.findUniqueOrThrow({ where: { id } });
}
export async function dispatchNotification(
  payload: unknown,
  env: Env = process.env,
  previouslyAccepted: string[] = [],
) {
  const { dispatch, deduplicated } = await enqueueNotification(
    payload,
    previouslyAccepted,
  );
  const completed =
    dispatch.status === "PENDING"
      ? await processNotificationDispatch(dispatch.id, env)
      : dispatch;
  return { ...dispatchSummary(completed), deduplicated };
}
export async function retryPendingNotifications(env: Env = process.env) {
  const rows = await prisma.notificationDispatch.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: new Date() },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: 20,
  });
  const started = Date.now();
  let processed = 0;
  for (const row of rows) {
    if (Date.now() - started > 25_000) break;
    try {
      await processNotificationDispatch(row.id, env);
      processed++;
    } catch {
      /* Persisted uncertainty is visible to operators. */
    }
  }
  return processed;
}
