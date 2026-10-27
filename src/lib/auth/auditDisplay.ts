import type { AuditAction, AuditLogEntry } from '@/lib/auth/audit';
import { ROLE_LABELS, isAllowedRole } from '@/types/auth';
import { formatCurrency, formatDateTime } from '@/lib/utils';

/** 动作代码 → 业务行为名称（面向业务的展示文案，不出现代码） */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  login_success: '登录成功',
  login_failed: '登录失败',
  logout: '退出登录',
  page_view: '访问页面',
  api_mutation: '提交数据变更',
  threshold_update: '修改风险阈值',
  account_create: '创建账号',
  account_update: '修改账号',
  account_delete: '删除账号',
  client_edit: '编辑客户信息',
  client_delete: '删除客户',
  margin_topup: '风险金补仓',
  client_settle: '客户结算',
  client_exit_request: '客户申请退出',
  client_exit_cancel: '撤销退出申请',
  batch_notify: '批次通知客户',
  ledger_clear: '清空业务数据',
  auth_denied: '权限校验未通过',
};

export type AuditFilterValue = '__ALL__' | AuditAction;

export const AUDIT_ACTION_FILTER_OPTIONS: Array<{ value: AuditFilterValue; label: string }> = [
  { value: '__ALL__', label: '全部行为' },
  ...(Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).map((value) => ({
    value,
    label: AUDIT_ACTION_LABELS[value],
  })),
];

export function getAuditActionLabel(action: string): string {
  return (AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? ({client_add:'新增客户',batch_create:'创建批次',batch_update:'修改批次',client_status:'客户状态变更'} as Record<string,string>)[action] ?? '其他操作';
}

const PAGE_LABELS: Array<{ match: RegExp; label: string }> = [
  { match: /^\/$/, label: '风控大盘' },
  { match: /^\/alerts/, label: '风险警报中心' },
  { match: /^\/operation-records/, label: '操作记录' },
  { match: /^\/margin-calls/, label: '补仓历史' },
  { match: /^\/clients/, label: '客户管理' },
  { match: /^\/market/, label: '数据分析' },
  { match: /^\/stress-test/, label: '压力测试' },
  { match: /^\/win100-ledger/, label: 'WIN100 台账' },
  { match: /^\/settings/, label: '系统设置' },
  { match: /^\/login/, label: '登录页' },
  { match: /^\/api\/audit/, label: '操作记录' },
  { match: /^\/api\/auth/, label: '登录与账号' },
  { match: /^\/api\/clients/, label: '客户数据' },
  { match: /^\/api\/batches/, label: '批次数据' },
  { match: /^\/api\/notifications/, label: '客户通知' },
  { match: /^\/api\/settings/, label: '系统设置' },
  { match: /^\/api\/risk/, label: '风险数据' },
];

/** 将页面路径 / 接口路径翻译为业务名称，无法识别时回退为「其他模块」 */
export function getAuditResourceLabel(resource?: string | null): string {
  if (!resource) return '—';
  const hit = PAGE_LABELS.find((x) => x.match.test(resource));
  return hit ? hit.label : '其他模块';
}


export interface AuditDetailField {
  label: string;
  value: string;
}

const DETAIL_KEY_LABELS: Record<string, string> = {
  source: '来源',
  title: '页面',
  method: '请求方式',
  status: '状态码',
  ok: '结果',
  fromPath: '来源页面',
  kind: '登录方式',
  role: '角色',
  displayName: '用户',
  reason: '原因',
  email: '账号',
  attemptedEmail: '尝试账号',
  batchId: '批次',
  batchNumber: '批次号',
  channel: '通知渠道',
  notificationType: '通知类型',
  sentToCount: '发送人数',
  success: '结果',
  error: '错误信息',
  clientId: '客户',
  clientName: '客户名称',
  exitRequestedAt: '申请时间',
  exitEligibleAt: '可退出时间',
  operatorName: '执行人',
  roundId: '补仓轮次',
  appliedAmount: '补仓金额',
  expectedAmount: '应补金额',
  targetClientId: '目标客户',
  source_type: '补仓形式',
  principal: '客户本金',
  clientReceives: '客户应得',
  earlyExitFee: '提前退出费',
  isEarlyExit: '是否提前退出',
  settlementSnapshotId: '结算快照',
  targetUserId: '目标用户',
  targetEmail: '目标账号',
  targetRole: '目标角色',
  enabled: '账号状态',
  stored: '已落库',
  apiError: '接口错误',
  denyAction: '被拒操作',
  before: '变更前',
  after: '变更后',
  warningDropPercent: '预警跌幅',
  marginDropPercent: '熔断跌幅',
  name: '姓名',
  investmentAmount: '入金金额',
  bdManager: '商务经理',
  status_before: '原状态',
  batchCount: '涉及批次',
  clientCount: '涉及客户',
};

const CURRENCY_KEYS = new Set([
  'appliedAmount',
  'expectedAmount',
  'principal',
  'clientReceives',
  'earlyExitFee',
  'investmentAmount',
  'amount',
]);

const PERCENT_KEYS = new Set(['warningDropPercent', 'marginDropPercent']);

const BOOLEAN_KEYS = new Set(['ok', 'success', 'enabled', 'stored', 'isEarlyExit']);

const TIME_KEYS = new Set(['exitRequestedAt', 'exitEligibleAt', 'createdAt', 'updatedAt']);

const ROLE_KEYS = new Set(['role', 'targetRole']);

const METHOD_LABELS: Record<string, string> = {
  GET: '查询',
  POST: '提交',
  PUT: '更新',
  PATCH: '更新',
  DELETE: '删除',
};

const CHANNEL_LABELS: Record<string, string> = {
  email: '邮件',
  webhook: '通知转发',
  sms: '短信',
  feishu: '飞书',
};

function labelFor(key: string): string {
  return DETAIL_KEY_LABELS[key] ?? key;
}

function roleLabel(v: unknown): string {
  if (typeof v === 'string' && isAllowedRole(v)) return ROLE_LABELS[v];
  return typeof v === 'string' ? v : String(v);
}

function looksLikeDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
}

function formatDetailValue(key: string, raw: unknown): string {
  if (typeof raw === 'boolean') {
    if (BOOLEAN_KEYS.has(key)) return raw ? '成功/是' : '失败/否';
    return raw ? '是' : '否';
  }
  if (typeof raw === 'number') {
    if (CURRENCY_KEYS.has(key)) return formatCurrency(raw);
    if (PERCENT_KEYS.has(key)) return `${raw}%`;
    return String(raw);
  }
  if (typeof raw === 'string') {
    if (ROLE_KEYS.has(key)) return roleLabel(raw);
    if (key === 'method') return METHOD_LABELS[raw.toUpperCase()] ?? raw;
    if (key === 'channel') return CHANNEL_LABELS[raw.toLowerCase()] ?? raw;
    if (key === 'source_type' || key === 'source') {
      if (raw === 'cash') return '现金';
      if (raw === 'stock') return '股票';
    }
    if (key === 'status' && /^\d+$/.test(raw)) return `HTTP ${raw}`;
    if (TIME_KEYS.has(key) || looksLikeDate(raw)) {
      const t = new Date(raw);
      if (!Number.isNaN(t.getTime())) return formatDateTime(t);
    }
    return raw;
  }
  if (Array.isArray(raw)) return raw.map((x) => String(x)).join('、');
  if (raw === null || raw === undefined) return '—';
  return String(raw);
}

/** 将 detail 对象翻译为「字段名 + 可读值」列表，用于详情弹窗 */
export function getAuditDetailFields(log: AuditLogEntry): AuditDetailField[] {
  const detail: unknown = log.detail;
  if (!detail) return [];
  if (typeof detail === 'string') {
    const s = detail.trim();
    return s ? [{ label: '说明', value: s }] : [];
  }
  if (typeof detail !== 'object') {
    return [{ label: '说明', value: String(detail) }];
  }

  const fields: AuditDetailField[] = [];
  for (const [key, raw] of Object.entries(detail as Record<string, unknown>)) {
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [nk, nv] of Object.entries(raw as Record<string, unknown>)) {
        if (nv === null || nv === undefined || nv === '') continue;
        fields.push({ label: `${labelFor(key)}·${labelFor(nk)}`, value: formatDetailValue(nk, nv) });
      }
      continue;
    }
    fields.push({ label: labelFor(key), value: formatDetailValue(key, raw) });
  }
  return fields;
}

/** 将一条操作记录翻译为一行人类可读的行为摘要 */
export function describeAuditLog(log: AuditLogEntry): string {
  const d = (log.detail && typeof log.detail === 'object' ? log.detail : {}) as Record<string, unknown>;
  const s = (key: string): string => {
    const v = d[key];
    return v === null || v === undefined ? '' : String(v);
  };
  const resource = log.resource ?? '';

  switch (log.action) {
    case 'login_success':
      return `${s('displayName') || '用户'} 登录系统${s('role') ? `（${roleLabel(s('role'))}）` : ''}`;
    case 'login_failed':
      return `${s('email') || s('attemptedEmail') || '未知账号'} 登录失败${s('reason') ? `：${s('reason')}` : ''}`;
    case 'logout':
      return '退出登录';
    case 'page_view':
      return `访问页面「${s('title') || resource || '未知页面'}」`;
    case 'api_mutation': {
      const method = METHOD_LABELS[s('method').toUpperCase()] ?? s('method');
      const okText = d.ok === false ? '失败' : '成功';
      return `${method}数据${okText}${resource ? `：${resource}` : ''}${s('status') ? `（HTTP ${s('status')}）` : ''}`;
    }
    case 'threshold_update': {
      const before = (d.before as Record<string, unknown> | undefined) ?? {};
      const after = (d.after as Record<string, unknown> | undefined) ?? {};
      const warn = `${before.warningDropPercent ?? '—'}% → ${after.warningDropPercent ?? '—'}%`;
      const margin = `${before.marginDropPercent ?? '—'}% → ${after.marginDropPercent ?? '—'}%`;
      return `修改风险阈值：预警跌幅 ${warn}，熔断跌幅 ${margin}`;
    }
    case 'account_create':
      return `创建账号 ${s('targetEmail')}${s('targetRole') ? `（${roleLabel(s('targetRole'))}）` : ''}`;
    case 'account_update':
      return `${d.enabled === false ? '停用' : '启用'}账号 ${s('targetEmail')}`;
    case 'account_delete':
      return `删除账号 ${s('targetEmail')}`;
    case 'client_edit': {
      const after = (d.after as Record<string, unknown> | undefined) ?? {};
      const before = (d.before as Record<string, unknown> | undefined) ?? {};
      const name = String(after.name ?? before.name ?? s('clientName') ?? '客户');
      return `编辑客户「${name}」信息`;
    }
    case 'client_delete':
      return `删除客户「${s('clientName') || '客户'}」${s('investmentAmount') ? `，入金 ${formatCurrency(Number(s('investmentAmount')))}` : ''}`;
    case 'margin_topup': {
      const amount = d.appliedAmount;
      return `风险金补仓${typeof amount === 'number' ? ` ${formatCurrency(amount)}` : ''}${s('batchNumber') ? `（批次 ${s('batchNumber')}）` : ''}`;
    }
    case 'client_settle': {
      const amount = d.clientReceives;
      return `结算客户「${s('clientName') || '客户'}」${typeof amount === 'number' ? `，客户应得 ${formatCurrency(amount)}` : ''}${d.isEarlyExit ? '（提前退出）' : ''}`;
    }
    case 'client_exit_request':
      return `客户「${s('clientName') || '客户'}」申请提前退出${s('exitEligibleAt') ? `，可退出时间 ${formatDetailValue('exitEligibleAt', s('exitEligibleAt'))}` : ''}`;
    case 'client_exit_cancel':
      return `撤销客户「${s('clientName') || '客户'}」的退出申请`;
    case 'batch_notify': {
      const channel = CHANNEL_LABELS[s('channel').toLowerCase()] ?? s('channel');
      const sent = d.sentToCount;
      const result = d.success === false ? '发送失败' : '发送成功';
      return `向批次 ${s('batchNumber') || s('batchId') || ''} 客户发送${typeof sent === 'number' ? ` ${sent} 人` : ''}通知（${channel || '通知'}）· ${result}`.replace(/\s+/g, ' ').trim();
    }
    case 'ledger_clear': {
      const batches = d.batchCount;
      const clients = d.clientCount;
      const scope = [
        typeof batches === 'number' ? `${batches} 个批次` : '',
        typeof clients === 'number' ? `${clients} 位客户` : '',
      ].filter(Boolean).join('、');
      return `清空全部业务数据${scope ? `（${scope}）` : ''}`;
    }
    case 'auth_denied':
      return `权限校验未通过：${s('reason') || s('denyAction') || '无权限'}`;
    default: {
      const fields = getAuditDetailFields(log);
      if (fields.length === 0) return getAuditActionLabel(log.action);
      return fields.map((f) => `${f.label}：${f.value}`).join('，');
    }
  }
}
