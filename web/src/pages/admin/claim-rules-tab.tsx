import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useClaimRules, useCreateClaimRule, useDeleteClaimRule, useToggleClaimRule, useUpdateClaimRule, useTestClaimRule } from "@/hooks/use-claim-rules";
import { ClaimRuleDialog } from "./claim-rule-dialog";
import type { SubdomainClaimRule, Domain } from "@/types";
import { Pencil, Trash2, Plus } from "lucide-react";

interface ClaimRulesTabProps {
  domains: Domain[];
}

export function ClaimRulesTab({ domains }: ClaimRulesTabProps) {
  const { t } = useTranslation();
  const { data: rules = [], isLoading } = useClaimRules();
  const createMutation = useCreateClaimRule();
  const updateMutation = useUpdateClaimRule();
  const deleteMutation = useDeleteClaimRule();
  const toggleMutation = useToggleClaimRule();
  const testMutation = useTestClaimRule();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<SubdomainClaimRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubdomainClaimRule | null>(null);
  const [testResult, setTestResult] = useState<{ matched: boolean; matched_rule: { rule_id: number; rule_name: string; action: string; message: string } | null } | null>(null);

  const handleCreate = (data: Record<string, unknown>) => {
    createMutation.mutate(data, {
      onSuccess: () => { setDialogOpen(false); },
    });
  };

  const handleUpdate = (id: number, data: Record<string, unknown>) => {
    updateMutation.mutate({ id, data }, {
      onSuccess: () => { setDialogOpen(false); setEditingRule(null); },
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const handleToggle = (id: number) => {
    toggleMutation.mutate(id);
  };

  const handleTest = (params: { subdomain_name: string; domain_id: number; domain_name: string; rule?: SubdomainClaimRule }) => {
    testMutation.mutate(params as Parameters<typeof testMutation.mutate>[0], {
      onSuccess: (data) => setTestResult(data as unknown as { matched: boolean; matched_rule: { rule_id: number; rule_name: string; action: string; message: string } | null }),
    });
  };

  const matchTypeLabel = (mt: string) => {
    switch (mt) {
      case "keyword": return t("claimRule.typeKeyword");
      case "regex": return t("claimRule.typeRegex");
      default: return mt;
    }
  };

  const actionBadge = (action: string) => {
    switch (action) {
      case "reject":
        return <Badge variant="destructive">{t("claimRule.actionReject")}</Badge>;
      case "reject_notify":
        return <Badge variant="outline">{t("claimRule.actionRejectNotify")}</Badge>;
      default:
        return <Badge>{action}</Badge>;
    }
  };

  const matchSummary = (rule: SubdomainClaimRule): string => {
    if (rule.match_type === "keyword") {
      if (rule.keywords.length === 0) return "-";
      const display = rule.keywords.slice(0, 3).join(", ");
      return rule.keywords.length > 3 ? `${display}...` : display;
    }
    return rule.pattern || "-";
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">{t("common.loading")}...</div>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t("claimRule.tabTitle")}</h3>
        <Button size="sm" onClick={() => { setEditingRule(null); setTestResult(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" />{t("claimRule.createBtn")}
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
          <p>{t("claimRule.noRules")}</p>
          <p className="text-xs mt-1">{t("claimRule.noRulesHelp")}</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t("claimRule.colName")}</TableHead>
                <TableHead className="w-20">{t("claimRule.colType")}</TableHead>
                <TableHead>{t("claimRule.colMatch")}</TableHead>
                <TableHead className="w-24">{t("claimRule.colAction")}</TableHead>
                <TableHead className="w-16">{t("claimRule.colHits")}</TableHead>
                <TableHead className="w-20">{t("claimRule.colStatus")}</TableHead>
                <TableHead className="w-28 text-right">{t("claimRule.colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">{rule.name}</TableCell>
                  <TableCell>
                    <Badge variant={rule.match_type === "regex" ? "default" : "secondary"}>
                      {matchTypeLabel(rule.match_type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[200px] truncate" title={matchSummary(rule)}>
                    {matchSummary(rule)}
                  </TableCell>
                  <TableCell>{actionBadge(rule.action)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{rule.hit_count}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${rule.enabled ? "bg-primary" : "bg-input"}`}
                      onClick={() => handleToggle(rule.id)}
                    >
                      <span
                        className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${rule.enabled ? "translate-x-5" : "translate-x-0"}`}
                      />
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEditingRule(rule); setTestResult(null); setDialogOpen(true); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDeleteTarget(rule)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 编辑/创建弹窗 */}
      <ClaimRuleDialog
        key={editingRule?.id ?? "new"}
        rule={editingRule}
        domains={domains}
        open={dialogOpen}
        onOpenChange={(open) => { if (!open) { setDialogOpen(false); setEditingRule(null); } }}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        testResult={testResult}
        isTesting={testMutation.isPending}
        onTest={handleTest}
      />

      {/* 删除确认弹窗 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("claimRule.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("claimRule.deleteDesc", { name: deleteTarget?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? `${t("common.deleting")}...` : t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
