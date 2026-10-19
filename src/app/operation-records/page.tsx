"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APP_ROLES, ROLE_LABELS } from "@/types/auth";
import { fetchAuditLogs, type AuditAction, type AuditLogEntry } from "@/lib/auth/audit";
import {
  AUDIT_ACTION_FILTER_OPTIONS,
  describeAuditLog,
  getAuditActionLabel,
  getAuditDetailFields,
  getAuditResourceLabel,
} from "@/lib/auth/auditDisplay";
import { cn, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";
import {
  ScrollText,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Shield,
  Lock,
} from "lucide-react";


export default function OperationRecordsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [actionFilter, setActionFilter] = useState<"__ALL__" | AuditAction>("__ALL__");
  const [detailOpen, setDetailOpen] = useState<AuditLogEntry | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const rows = await fetchAuditLogs({ limit: 1000 });
      setLogs(rows);
    } catch {
      setLogs([]);
      toast.error("操作记录加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  useEffect(() => {
    const onAudit = () => void loadLogs();
    window.addEventListener("risk-control:audit-updated", onAudit);
    return () => window.removeEventListener("risk-control:audit-updated", onAudit);
  }, []);

  const filteredLogs = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return logs.filter((log) => {
      if (actionFilter !== "__ALL__" && log.action !== actionFilter) return false;
      if (!kw) return true;
      const haystack = [
        log.actorEmail ?? "",
        getAuditResourceLabel(log.resource),
        getAuditActionLabel(log.action),
        describeAuditLog(log),
      ].join(" ").toLowerCase();
      return haystack.includes(kw);
    });
  }, [actionFilter, keyword, logs]);

  return (
    <AuthGuard route="/operation-records" allowed={[APP_ROLES.ADMIN, APP_ROLES.RISK_MANAGER]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ScrollText className="h-6 w-6 text-primary" />
              操作记录
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              全员页面访问与关键业务操作的完整记录，供审计追溯。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 px-3 py-1 text-[11px]">
              <Lock className="h-3.5 w-3.5" />
              不可删除
            </Badge>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void loadLogs()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              刷新
            </Button>
          </div>
        </div>

        <Card className="border-primary/25 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Shield className="mt-0.5 h-4 w-4 text-primary shrink-0" />
              <p className="text-xs leading-5 text-muted-foreground">
                操作记录由系统统一写入，仅系统管理员与风控总监可查看，不支持修改或删除。
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold">全员操作留痕</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                共 {logs.length} 条记录，按时间倒序排列
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border bg-muted/30 p-1">
                <Search className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="h-7 w-52 border-0 bg-transparent text-xs shadow-none"
                  placeholder="搜索操作人、行为或模块"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as "__ALL__" | AuditAction)}>
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue placeholder="过滤行为" />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIT_ACTION_FILTER_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value} className="text-xs">
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-md border">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">时间</th>
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">操作行为</th>
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">操作人</th>
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">涉及模块</th>
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">操作详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-muted-foreground">加载中…</td>
                      </tr>
                    ) : filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-muted-foreground">暂无匹配的操作记录</td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id} className="border-t border-border/50 align-top">
                          <td className="px-3 py-2 whitespace-nowrap font-mono text-muted-foreground">
                            {formatDateTime(log.createdAt)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[11px]",
                                /failed|denied|delete/.test(log.action) && "border-danger/60 text-danger",
                                /success|create|update|topup|settle|notify|view|mutation/.test(log.action) &&
                                  "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {getAuditActionLabel(log.action)}
                            </Badge>
                            {log.role ? (
                              <span className="ml-2 text-[10px] text-muted-foreground">
                                {ROLE_LABELS[log.role] ?? log.role}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {log.actorEmail ?? <span className="italic text-muted-foreground">匿名/未登录</span>}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            {getAuditResourceLabel(log.resource)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="max-w-[46ch] flex-1 truncate text-[11px] text-muted-foreground">
                                {describeAuditLog(log)}
                              </div>
                              <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setDetailOpen(log)}>
                                <Eye className="mr-1 h-3 w-3" />
                                展开
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={!!detailOpen} onOpenChange={(open) => { if (!open) setDetailOpen(null); }}>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-bold">
                <ScrollText className="h-4 w-4 text-primary" />
                操作详情
              </DialogTitle>
            </DialogHeader>
            {detailOpen && (
              <div className="space-y-4 text-xs">
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">{getAuditActionLabel(detailOpen.action)}</Badge>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-6 text-foreground">{describeAuditLog(detailOpen)}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-muted-foreground">操作时间</p>
                    <p>{formatDateTime(detailOpen.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">操作人</p>
                    <p>
                      {detailOpen.actorEmail ?? "匿名/未登录"}
                      {detailOpen.role ? ` · ${ROLE_LABELS[detailOpen.role] ?? detailOpen.role}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">涉及模块</p>
                    <p>{getAuditResourceLabel(detailOpen.resource)}</p>
                  </div>
                </div>

                {(() => {
                  const fields = getAuditDetailFields(detailOpen);
                  if (fields.length === 0) return null;
                  return (
                    <div>
                      <p className="mb-2 text-muted-foreground">操作内容</p>
                      <div className="divide-y divide-border/50 rounded-md border">
                        {fields.map((field, idx) => (
                          <div key={`${field.label}-${idx}`} className="flex items-start justify-between gap-4 px-3 py-2">
                            <span className="shrink-0 text-muted-foreground">{field.label}</span>
                            <span className="text-right font-medium break-all">{field.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AuthGuard>
  );
}
