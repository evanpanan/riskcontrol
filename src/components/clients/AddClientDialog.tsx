"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatCurrency,
  cn,
} from "@/lib/utils";
import {
  calculateProfitSplitRatio,
  addClientPosition,
  HIGH_INVESTMENT_THRESHOLD,
} from "@/lib/riskEngine";
import { triggerClientAddedAlert } from "@/lib/notifier";
import { getMockData, commitBatchFinance } from "@/lib/mockData";
import { ClientStatus } from "@prisma/client";
import {
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Info,
  Building2,
  Calendar,
  DollarSign,
  Users,
  Sparkles,
  Shield,
} from "lucide-react";

interface AddClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchPriorityAmount: number;
  batchId: string;
  /** 若有值：BD 字段 disabled 锁定为该经理 */
  lockedBdManager?: string;
}

const BD_OPTIONS = [
  "李晓明 (Evan Li)",
  "王思远 (Sylvia Wang)",
  "张志强 (Jack Zhang)",
  "刘佳 (Jennifer Liu)",
  "陈志远 (Daniel Chen)",
  "林晓雯 (Sharon Lin)",
];

export function AddClientDialog({
  open,
  onOpenChange,
  batchPriorityAmount,
  batchId,
  lockedBdManager,
}: AddClientDialogProps) {
  const [name, setName] = useState("");
  const [investmentAmount, setInvestmentAmount] = useState<string>("");
  const [bdManager, setBdManager] = useState<string>(lockedBdManager || "");
  const [signDate, setSignDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const numAmount = useMemo(
    () => parseFloat(investmentAmount.replace(/[^\d.]/g, "")) || 0,
    [investmentAmount]
  );

  const split = useMemo(() => calculateProfitSplitRatio(numAmount), [numAmount]);

  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setName("");
        setInvestmentAmount("");
        setBdManager(lockedBdManager || "");
        setSignDate(new Date().toISOString().split("T")[0]);
        setErrors({});
      }, 200);
    } else {
      if (lockedBdManager && bdManager !== lockedBdManager) {
        setBdManager(lockedBdManager);
      }
    }
  }, [open, lockedBdManager]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "请输入客户姓名";
    if (name.trim().length < 2) e.name = "客户姓名至少 2 个字符";
    if (!numAmount || numAmount <= 0) e.investmentAmount = "请输入有效的投资金额";
    if (numAmount > batchPriorityAmount * 0.5) {
      e.investmentAmount = `单笔投资不可超过优先池 50%（${formatCurrency(batchPriorityAmount * 0.5)}）`;
    }
    if (!bdManager) e.bdManager = "请选择负责的 商务经理（必填）";
    if (!signDate) e.signDate = "请选择签约日期";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    const mock = getMockData();
    const batch = mock.batches.find((b) => b.id === batchId);
    const splitRatio = calculateProfitSplitRatio(numAmount);
    const newClient = {
      id: `client-${Date.now()}`,
      name,
      investmentAmount: numAmount,
      bdManager,
      signDate: new Date(signDate),
      status: ClientStatus.ACTIVE,
      profitSplitClient: splitRatio.client * 100,
      profitSplitInstitution: splitRatio.institution * 100,
      signedVipThreshold: splitRatio.vipThreshold,
      realtimePnL: 0,
      estimatedExitAmount: numAmount,
      createdAt: new Date(),
      updatedAt: new Date(),
      batchId: batchId,
      settledAt: null as any,
    } as any;
    if (batch && batch.clients) {
      try {
        commitBatchFinance(batch, (draft) => addClientPosition(draft, newClient));
      } catch (err) {
        setErrors({ investmentAmount: err instanceof Error ? err.message : "新增客户失败" });
        return;
      }
    }
    if (batch) {
      try {
        await triggerClientAddedAlert(batch as any, {
          name,
          investmentAmount: numAmount,
          bdManager,
        });
      } catch (e) {
        console.warn("通知发送失败:", e);
      }
    }
    onOpenChange(false);
    window.dispatchEvent(new CustomEvent("risk-control:client-added", {
      detail: { batchId, client: newClient },
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-xl gradient-primary flex items-center justify-center shrink-0 shadow-md shadow-primary/30">
              <UserPlus className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                新增客户
                <Badge variant="secondary" className="text-[10px] font-mono ml-1">
                  批次 {batchId.slice(-6)}
                </Badge>
              </DialogTitle>
              <DialogDescription className="mt-1">
                录入客户信息后，系统将根据投资金额自动判定分成比例
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* NAME */}
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              客户姓名 <span className="text-danger">*</span>
            </Label>
            <Input
              id="name"
              placeholder="例如：张伟 / 王芳"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(errors.name && "border-destructive focus-visible:ring-destructive")}
            />
            {errors.name && (
              <p className="text-[11px] text-danger flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.name}
              </p>
            )}
          </div>

          {/* AMOUNT */}
          <div className="space-y-1.5">
            <Label htmlFor="amount" className="text-xs flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              投资金额 (USD) <span className="text-danger">*</span>
            </Label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground font-mono font-semibold text-sm z-10">
                $
              </span>
              <Input
                id="amount"
                type="text"
                inputMode="decimal"
                placeholder="100,000"
                value={investmentAmount}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d.]/g, "");
                  const parts = raw.split(".");
                  const formatted =
                    parts[0]?.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
                    (parts.length > 1 ? "." + parts[1] : "");
                  setInvestmentAmount(formatted);
                }}
                className={cn(
                  "pl-8 font-mono font-semibold tracking-wide",
                  errors.investmentAmount && "border-destructive focus-visible:ring-destructive"
                )}
              />
            </div>
            {errors.investmentAmount ? (
              <p className="text-[11px] text-danger flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.investmentAmount}
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground flex items-center gap-1 cursor-help">
                      <Info className="h-3 w-3" />
                      优先池可用：
                      <span className="font-mono text-foreground font-semibold">
                        {formatCurrency(batchPriorityAmount)}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="w-[200px] text-xs">
                      本批次优先总资 70% = {formatCurrency(batchPriorityAmount)}，每位客户从该池中分配额度
                    </p>
                  </TooltipContent>
                </Tooltip>
                {numAmount > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">
                      占优先池 {((numAmount / batchPriorityAmount) * 100).toFixed(1)}%
                    </span>
                    {numAmount >= HIGH_INVESTMENT_THRESHOLD ? (
                      <Badge variant="primary" className="gap-1 text-[10px]">
                        <Sparkles className="h-2.5 w-2.5" />
                        VIP 档位 (≥$100K)
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        普通档位 ({'<'}${HIGH_INVESTMENT_THRESHOLD.toLocaleString()})
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SPLIT PREVIEW */}
          {numAmount > 0 && (
            <div className={cn(
              "rounded-xl p-4 border space-y-3",
              numAmount >= HIGH_INVESTMENT_THRESHOLD
                ? "bg-primary/5 border-primary/30"
                : "bg-secondary/40 border-border/60"
            )}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className={cn(
                    "h-3.5 w-3.5",
                    numAmount >= HIGH_INVESTMENT_THRESHOLD ? "text-primary" : "text-success"
                  )} />
                  自动判定分成比例
                </span>
                <Badge
                  variant={numAmount >= HIGH_INVESTMENT_THRESHOLD ? "primary" : "secondary"}
                  className="text-[10px] font-mono"
                >
                  投入 ${numAmount.toLocaleString()}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-background/50 p-3 border border-border/60">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    客户分成
                  </p>
                  <p className="text-2xl font-bold font-mono text-success">
                    {Number((split.client * 100).toFixed(2))}%
                  </p>
                </div>
                <div className="rounded-lg bg-background/50 p-3 border border-border/60">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    机构分成
                  </p>
                  <p className="text-2xl font-bold font-mono text-primary">
                    {Number((split.institution * 100).toFixed(2))}%
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p>
                    <span className="text-success font-semibold">✓ 亏损保底：</span>
                    客户本金 100% 由机构劣后资金全额承担
                  </p>
                  <p>
                    <span className="text-primary font-semibold">✓ 盈利分成：</span>
                    仅对初始投资盈利部分按比例分配
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* BD & DATE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bd" className="text-xs flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                商务经理 <span className="text-danger">*</span>
              </Label>
              <Select
                value={bdManager}
                onValueChange={setBdManager}
                disabled={!!lockedBdManager}
              >
                <SelectTrigger
                  className={cn(
                    errors.bdManager && "border-destructive focus-visible:ring-destructive",
                    lockedBdManager && "border-success/40 ring-1 ring-success/30 focus-visible:ring-success/50 cursor-not-allowed"
                  )}
                >
                  <SelectValue placeholder={lockedBdManager ? lockedBdManager : "请选择 商务经理"} />
                </SelectTrigger>
                <SelectContent>
                  {BD_OPTIONS.map((bd) => {
                    const disabled = lockedBdManager ? bd !== lockedBdManager : false;
                    return (
                      <SelectItem key={bd} value={bd} disabled={disabled} className="text-xs">
                        {bd}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {lockedBdManager ? (
                <p className="text-[11px] text-success flex items-center gap-1 font-medium">
                  <Shield className="h-3 w-3" />
                  已自动锁定为当前登录账号：{lockedBdManager}
                </p>
              ) : errors.bdManager ? (
                <p className="text-[11px] text-danger flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.bdManager}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="date" className="text-xs flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                签约日期 <span className="text-danger">*</span>
              </Label>
              <Input
                id="date"
                type="date"
                value={signDate}
                onChange={(e) => setSignDate(e.target.value)}
                className={cn(
                  errors.signDate && "border-destructive focus-visible:ring-destructive"
                )}
              />
              {errors.signDate && (
                <p className="text-[11px] text-danger flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.signDate}
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={handleSubmit} className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            确认录入客户
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
