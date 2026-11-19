"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  Download,
  Mail,
  Loader2,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  previousStatementMonth,
  type MonthlyStatementReport,
} from "@/lib/monthlyStatement";
import { formatCurrency } from "@/lib/utils";

type Row = {
  key: string;
  name: string;
  bdManager: string;
  email: string;
  accounts: number;
  statement: null | {
    id: string;
    emailStatus: string;
    emailAddress: string | null;
    lastError: string | null;
    generatedAt: string;
    sentAt: string | null;
  };
};
const statusLabel: Record<string, string> = {
  DRAFT: "待发送",
  PENDING: "排队中",
  SENDING: "发送中",
  SENT: "发送成功",
  FAILED: "发送失败",
  UNKNOWN: "结果待核查",
};
async function api(url: string, body?: object, method = "POST") {
  const res = await fetch(
    url,
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        }
      : { cache: "no-store" },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "操作失败");
  return data;
}
export default function StatementsPage() {
  const loadVersion = useRef(0);
  const [month, setMonth] = useState(previousStatementMonth);
  const [rows, setRows] = useState<Row[]>([]);
  const [manage, setManage] = useState(false);
  const [emailReady, setEmailReady] = useState(false);
  const [savingEmails, setSavingEmails] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{
    id: string;
    report: MonthlyStatementReport;
  } | null>(null);
  const [sendConfirm, setSendConfirm] = useState(false);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const d = await api(`/api/statements?month=${encodeURIComponent(month)}`);
      if (version !== loadVersion.current) return;
      setRows(d.rows);
      setManage(d.canManage);
      setEmailReady(d.emailReady);
      setError("");
    } catch (e) {
      if (version === loadVersion.current) {
        setError(e instanceof Error ? e.message : "无法加载月结单");
        setRows([]);
      }
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    setRowErrors({});
    setRows([]);
    void load();
    return () => {
      loadVersion.current++;
    };
  }, [load]);
  const generate = async (keys: string[]) => {
    setBusy("正在生成");
    let completed = 0;
    const errors: Record<string, string> = {};
    try {
      for (let i = 0; i < keys.length; i += 2) {
        setBusy(`正在生成 ${completed}/${keys.length}`);
        const d = await api("/api/statements/generate", {
          month,
          keys: keys.slice(i, i + 2),
        });
        for (const r of d.results) {
          if (r.error) errors[r.key] = r.error;
          completed++;
        }
      }
      setRowErrors(errors);
      toast[Object.keys(errors).length ? "error" : "success"](
        Object.keys(errors).length
          ? `已完成，${Object.keys(errors).length} 位客户生成失败`
          : "月结单生成完成",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
      await load();
    } finally {
      setBusy("");
    }
  };
  const saveEmail = async (
    row: Row,
    email: string,
    field: HTMLInputElement,
  ) => {
    if (email === row.email) return;
    setSavingEmails((n) => n + 1);
    try {
      await api(
        "/api/statements/contact",
        { month, key: row.key, email },
        "PUT",
      );
      setRows((prev) =>
        prev.map((r) =>
          r.key === row.key ? { ...r, email: email.trim() } : r,
        ),
      );
      toast.success("收件邮箱已保存");
    } catch (e) {
      field.value = row.email;
      toast.error(e instanceof Error ? e.message : "邮箱保存失败");
    } finally {
      setSavingEmails((n) => n - 1);
    }
  };
  const pending = rows.filter(
    (r) =>
      r.statement && ["PENDING", "SENDING"].includes(r.statement.emailStatus),
  ).length;
  const eligible = rows.filter(
    (r) =>
      r.email &&
      r.statement &&
      ["DRAFT", "FAILED"].includes(r.statement.emailStatus),
  ).length;
  const missing = rows.filter((r) => !r.email).length;
  const drain = async () => {
    setBusy("正在发送");
    try {
      let remaining = 1;
      while (remaining) {
        const d = await api("/api/statements/send", { month, mode: "drain" });
        remaining = d.pending;
        await load();
        if (!d.processed) break;
      }
      toast.success("发送处理完成，请查看每位客户的发送结果");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "发送中断，已入队的邮件可继续处理",
      );
      await load();
    } finally {
      setBusy("");
    }
  };
  const sendAll = async () => {
    setBusy("正在加入发送队列");
    try {
      await api("/api/statements/send", { month, mode: "queue" });
      await drain();
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            批次&客户管理
          </Link>
          <h1 className="text-2xl font-semibold">客户月结单</h1>
          <p className="text-sm text-muted-foreground">
            按月汇总客户各批次仓位，在线查看、下载 PDF 或分别发送至客户邮箱。
          </p>
        </div>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">结算月份</span>
          <Input
            aria-label="结算月份"
            type="month"
            max={previousStatementMonth()}
            value={month}
            disabled={!!busy || savingEmails > 0}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            {rows.length} 位客户 · 已生成{" "}
            {rows.filter((r) => r.statement).length} 份 · 已发送{" "}
            {rows.filter((r) => r.statement?.emailStatus === "SENT").length} 份
          </p>
          <div className="flex flex-wrap gap-2">
            {manage && (
              <>
                <Button
                  variant="outline"
                  disabled={
                    !!busy || loading || !rows.some((r) => !r.statement)
                  }
                  onClick={() =>
                    generate(rows.filter((r) => !r.statement).map((r) => r.key))
                  }
                >
                  <FileText className="mr-1.5 h-4 w-4" />
                  生成全部月结单
                </Button>
                <Button
                  disabled={
                    !!busy || savingEmails > 0 || !eligible || !emailReady
                  }
                  onClick={() => setSendConfirm(true)}
                >
                  <Mail className="mr-1.5 h-4 w-4" />
                  一键发送邮件
                </Button>
                {pending > 0 && (
                  <Button
                    variant="outline"
                    disabled={!!busy || !emailReady}
                    onClick={drain}
                  >
                    继续发送（{pending}）
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
      {!!busy && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-primary"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          {busy}，请保持页面打开
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {manage && !emailReady && (
        <p className="text-xs text-warning">
          邮件服务尚未配置，请在系统设置中完成邮件配置后发送。
        </p>
      )}
      {!!missing && (
        <p className="text-xs text-muted-foreground">
          {missing}{" "}
          位客户尚未填写邮箱，群发时会跳过；不会向系统账号或风控收件人发送客户月结单。
        </p>
      )}
      {loading && !rows.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          正在加载月结单…
        </p>
      ) : !rows.length && !error ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          所选月份没有客户仓位或交易记录
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.key}>
              <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(130px,1fr)_minmax(180px,1.4fr)_minmax(110px,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{row.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.accounts} 个批次账户 ·{" "}
                    {row.bdManager || "未分配商务经理"}
                  </p>
                </div>
                <label className="min-w-0 space-y-1 text-xs">
                  <span className="text-muted-foreground">收件邮箱</span>
                  <Input
                    key={row.email}
                    aria-label={`${row.name} 收件邮箱`}
                    type="email"
                    placeholder="填写客户邮箱"
                    defaultValue={row.email}
                    disabled={!manage || !!busy}
                    onBlur={(e) =>
                      void saveEmail(
                        row,
                        e.currentTarget.value,
                        e.currentTarget,
                      )
                    }
                  />
                </label>
                <div className="min-w-0 space-y-1 text-xs">
                  <p
                    className={
                      row.statement?.emailStatus === "SENT"
                        ? "text-success"
                        : row.statement?.emailStatus === "UNKNOWN" ||
                            row.statement?.emailStatus === "FAILED"
                          ? "text-warning"
                          : "text-muted-foreground"
                    }
                  >
                    {row.statement
                      ? statusLabel[row.statement.emailStatus] ||
                        row.statement.emailStatus
                      : "尚未生成"}
                  </p>
                  {rowErrors[row.key] && (
                    <p className="text-danger break-words">
                      {rowErrors[row.key]}
                    </p>
                  )}
                  {row.statement?.lastError && (
                    <p className="text-warning break-words">
                      {row.statement.lastError}
                    </p>
                  )}
                  {row.statement?.emailAddress && (
                    <p className="break-all text-muted-foreground">
                      {row.statement.emailAddress}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.statement ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy}
                        onClick={async () => {
                          try {
                            const d = await api(
                              `/api/statements/${row.statement!.id}`,
                            );
                            setPreview({ id: d.id, report: d.report });
                          } catch (e) {
                            toast.error(
                              e instanceof Error ? e.message : "预览失败",
                            );
                          }
                        }}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" />
                        预览
                      </Button>
                      <a
                        href={`/api/statements/${row.statement.id}/pdf?download=1`}
                      >
                        <Button size="sm" variant="outline">
                          <Download className="mr-1 h-3.5 w-3.5" />
                          PDF
                        </Button>
                      </a>
                    </>
                  ) : (
                    manage && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => generate([row.key])}
                      >
                        生成
                      </Button>
                    )
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={sendConfirm}
        onOpenChange={setSendConfirm}
        title="发送客户月结单"
        description="每位客户会分别收到自己的 PDF 附件；已发送成功或结果待核查的月结单不会重复发送。"
        summary={[
          { label: "结算月份", value: month },
          { label: "本次发送", value: `${eligible} 位客户` },
          { label: "缺少邮箱", value: `${missing} 位（跳过）` },
        ]}
        confirmDisabled={savingEmails > 0 || !eligible}
        confirmText={`发送给 ${eligible} 位客户`}
        onConfirm={async () => {
          setSendConfirm(false);
          await sendAll();
        }}
      />
      <Dialog
        open={!!preview}
        onOpenChange={(v) => {
          if (!v) setPreview(null);
        }}
      >
        <DialogContent className="w-[calc(100%-1rem)] sm:max-w-[1000px] max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {preview?.report.customerName} · {month} 月结单
            </DialogTitle>
            <DialogDescription>
              生成后保存的月度快照 · 金额为 USD
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <>
              <div className="flex justify-end">
                <a href={`/api/statements/${preview.id}/pdf?download=1`}>
                  <Button size="sm" variant="outline">
                    <Download className="mr-1 h-4 w-4" />
                    下载 PDF
                  </Button>
                </a>
              </div>
              <StatementPreview report={preview.report} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function StatementPreview({ report: r }: { report: MonthlyStatementReport }) {
  return (
    <div className="space-y-5 text-sm">
      <div className="rounded-xl border p-4">
        <p className="font-semibold">Win100 / RiskControl</p>
        <p className="mt-1 text-xs text-muted-foreground">
          账期 {r.start} 至 {r.end} · 月末估值日 {r.closingDate}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          ["月初权益", r.openingEquity],
          ["月末权益", r.closingEquity],
          ["本月入金", r.deposits],
          ["本月退出回款", r.withdrawals],
          ["本月净损益", r.monthlyPnL],
          ["累计净损益", r.cumulativePnL],
        ].map(([k, v]) => (
          <div
            key={String(k)}
            className="min-w-0 rounded-lg bg-secondary/40 p-3"
          >
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="mt-1 font-mono font-semibold break-words">
              {formatCurrency(Number(v))}
            </dd>
          </div>
        ))}
      </dl>
      <h3 className="font-semibold">仓位与收益明细</h3>
      {r.positions.map((p, i) => (
        <div key={i} className="rounded-xl border p-4">
          <p className="font-semibold break-words">
            {p.batchNumber} · {p.symbol} · {p.status}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {[
              ["客户编号", p.clientNo || "—"],
              ["客户本金", formatCurrency(p.investment)],
              [
                "客户股数",
                p.shares.toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                }),
              ],
              ["入场价格", `$${p.entryPrice.toFixed(4)}`],
              ["估值价格", `$${p.closePrice.toFixed(4)}`],
              ["股票市值", formatCurrency(p.stockValue)],
              ["预计结算权益", formatCurrency(p.equity)],
              ["客户净损益", formatCurrency(p.pnl)],
              [
                "分成比例",
                `客户 ${p.clientSplit}% / WIN100 ${p.institutionSplit}%`,
              ],
              [
                "机构股票补仓",
                `${p.institutionTopupShares.toLocaleString(undefined, { maximumFractionDigits: 6 })} 股`,
              ],
              ["机构现金补仓", formatCurrency(p.institutionTopupCash)],
              ["机构担保本金", formatCurrency(p.institutionCapital)],
              [
                "机构初始股数",
                p.institutionShares.toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                }),
              ],
              [
                "账户总股数",
                p.accountShares.toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                }),
              ],
              ["账户总市值", formatCurrency(p.accountValue)],
              ["估值日期", p.valuationDate],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-1 break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {!!r.events.length && (
        <>
          <h3 className="font-semibold">本月资金与补仓记录</h3>
          {r.events.map((e, i) => (
            <div key={i} className="rounded-lg border p-3 text-xs space-y-1">
              <p>
                {e.date} · {e.batchNumber} · {e.type}
              </p>
              <p className="font-mono">
                {formatCurrency(e.amount)}
                {e.shares
                  ? ` · ${e.shares.toLocaleString(undefined, { maximumFractionDigits: 6 })} 股`
                  : ""}
                {e.price ? ` · $${e.price.toFixed(4)}/股` : ""}
              </p>
              <p className="text-muted-foreground">归属：{e.owner}</p>
            </div>
          ))}
        </>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        预计结算权益按客户签约分成及保本规则计算，与股票市值不同，最终以实际结算为准。WIN100
        补仓本金及收益归机构，不计入客户入金或个人股数。本月净损益 = 月末权益 +
        本月退出回款 - 月初权益 - 本月入金；退出回款已扣实际费用。
      </p>
    </div>
  );
}
