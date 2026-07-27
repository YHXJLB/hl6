import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { SubdomainClaimRule, Domain } from "@/types";
import { ChevronDown, Plus, X } from "lucide-react";

// ---- Types ----

type ClaimDraftRule = {
  name: string;
  enabled: boolean;
  description: string;
  match_type: "keyword" | "regex";
  keywords: string[];
  keyword_logic: "any" | "all";
  pattern: string;
  case_sensitive: boolean;
  action: "reject" | "reject_notify";
  reject_message: string;
  scope_domain_ids: number[];
};

const emptyDraft = (): ClaimDraftRule => ({
  name: "",
  enabled: true,
  description: "",
  match_type: "keyword",
  keywords: [""],
  keyword_logic: "any",
  pattern: "",
  case_sensitive: false,
  action: "reject",
  reject_message: "",
  scope_domain_ids: [],
});

function ruleToDraft(rule?: SubdomainClaimRule | null): ClaimDraftRule {
  if (!rule) return emptyDraft();
  return {
    name: rule.name,
    enabled: rule.enabled,
    description: rule.description || "",
    match_type: rule.match_type as "keyword" | "regex",
    keywords: rule.keywords.length > 0 ? [...rule.keywords] : [""],
    keyword_logic: rule.keyword_logic as "any" | "all",
    pattern: rule.pattern,
    case_sensitive: rule.case_sensitive,
    action: rule.action as "reject" | "reject_notify",
    reject_message: rule.reject_message,
    scope_domain_ids: [...rule.scope_domain_ids],
  };
}

function draftToPayload(draft: ClaimDraftRule): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    description: draft.description.trim(),
    match_type: draft.match_type,
    keywords: draft.match_type === "keyword" ? draft.keywords.filter((k) => k.trim() !== "") : [],
    keyword_logic: draft.keyword_logic,
    pattern: draft.pattern,
    case_sensitive: draft.case_sensitive,
    action: draft.action,
    reject_message: draft.reject_message,
    scope_domain_ids: draft.scope_domain_ids,
  };
}

const REJECT_MSG_MAX = 1024;

// ---- Components ----

interface ClaimRuleDialogProps {
  rule?: SubdomainClaimRule | null;
  domains: Domain[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate?: (data: Record<string, unknown>) => void;
  onUpdate?: (id: number, data: Record<string, unknown>) => void;
  testResult?: { matched: boolean; matched_rule: { rule_id: number; rule_name: string; action: string; message: string } | null } | null;
  isTesting?: boolean;
  onTest?: (params: { subdomain_name: string; domain_id: number; domain_name: string; rule?: SubdomainClaimRule }) => void;
}

export function ClaimRuleDialog({
  rule, domains, open, onOpenChange,
  onCreate, onUpdate, testResult, isTesting, onTest,
}: ClaimRuleDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ClaimDraftRule>(emptyDraft());
  const [testName, setTestName] = useState("");
  const [testDomainId, setTestDomainId] = useState<number>(0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isEdit = !!rule;
  const isValid = draft.name.trim() !== "" &&
    (draft.match_type === "regex" ? draft.pattern.trim() !== "" : draft.keywords.some((k) => k.trim() !== "")) &&
    draft.reject_message.length <= REJECT_MSG_MAX;

  useEffect(() => {
    if (open) {
      setDraft(ruleToDraft(rule));
      setTestName("");
      if (domains.length > 0) {
        setTestDomainId(domains[0].id);
      }
      setShowAdvanced(false);
    }
  }, [open, rule, domains]);

  const handleTest = () => {
    if (!onTest || !testName.trim() || !testDomainId) return;
    const domain = domains.find((d) => d.id === testDomainId);
    if (!domain) return;
    // 始终用当前草稿测试，编辑中未保存的修改也能实时预览
    onTest({
      subdomain_name: testName,
      domain_id: testDomainId,
      domain_name: domain.name,
      rule: { ...draftToPayload(draft), id: rule?.id ?? 0 } as unknown as SubdomainClaimRule,
    });
  };

  const handleSubmit = () => {
    if (!isValid) return;
    const payload = draftToPayload(draft);
    if (isEdit && rule && onUpdate) {
      onUpdate(rule.id, payload);
    } else if (onCreate) {
      onCreate(payload);
    }
  };

  const toggleScopeDomain = (domainId: number) => {
    setDraft((prev) => ({
      ...prev,
      scope_domain_ids: prev.scope_domain_ids.includes(domainId)
        ? prev.scope_domain_ids.filter((id) => id !== domainId)
        : [...prev.scope_domain_ids, domainId],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("claimRule.editTitle") : t("claimRule.createTitle")}</DialogTitle>
          <DialogDescription>
            {isEdit ? t("claimRule.editDesc") : t("claimRule.createDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 基本信息 */}
          <div className="space-y-2">
            <Label>{t("claimRule.ruleName")}</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              placeholder={t("claimRule.ruleNamePlaceholder")}
              maxLength={128}
            />
          </div>

          <div className="flex items-center gap-3">
            <Label className="flex items-center gap-2 cursor-pointer">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(v) => setDraft((p) => ({ ...p, enabled: v }))}
              />
              <span className="text-sm">{draft.enabled ? t("claimRule.enabled") : t("claimRule.disabled")}</span>
            </Label>
          </div>

          <div className="space-y-2">
            <Label>{t("claimRule.description")}</Label>
            <Textarea
              value={draft.description}
              onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
              placeholder={t("claimRule.descriptionPlaceholder")}
              rows={2}
            />
          </div>

          <Separator />

          {/* 匹配配置 */}
          <div className="space-y-3">
            <Label>{t("claimRule.matchConfig")}</Label>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">{t("claimRule.matchType")}</Label>
              <Select
                value={draft.match_type}
                onValueChange={(v) => setDraft((p) => ({ ...p, match_type: v as "keyword" | "regex" }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keyword">{t("claimRule.typeKeyword")}</SelectItem>
                  <SelectItem value="regex">{t("claimRule.typeRegex")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {draft.match_type === "keyword" ? (
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">{t("claimRule.keywords")}</Label>
                {draft.keywords.map((kw, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={kw}
                      onChange={(e) => {
                        const next = [...draft.keywords];
                        next[i] = e.target.value;
                        setDraft((p) => ({ ...p, keywords: next }));
                      }}
                      placeholder={t("claimRule.keywordPlaceholder")}
                      maxLength={128}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const next = draft.keywords.filter((_, idx) => idx !== i);
                        setDraft((p) => ({ ...p, keywords: next.length > 0 ? next : [""] }));
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft((p) => ({ ...p, keywords: [...p.keywords, "" ] }))}
                >
                  <Plus className="h-4 w-4 mr-1" />{t("claimRule.addKeyword")}
                </Button>

                <div className="flex items-center gap-3 mt-2">
                  <Label className="text-sm text-muted-foreground">{t("claimRule.keywordLogic")}</Label>
                  <Select
                    value={draft.keyword_logic}
                    onValueChange={(v) => setDraft((p) => ({ ...p, keyword_logic: v as "any" | "all" }))}
                  >
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">{t("claimRule.logicAny")}</SelectItem>
                      <SelectItem value="all">{t("claimRule.logicAll")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-1.5 cursor-pointer ml-2">
                    <input
                      type="checkbox"
                      checked={draft.case_sensitive}
                      onChange={(e) => setDraft((p) => ({ ...p, case_sensitive: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-xs text-muted-foreground">{t("claimRule.caseSensitive")}</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">{t("claimRule.regexPattern")}</Label>
                <Textarea
                  value={draft.pattern}
                  onChange={(e) => setDraft((p) => ({ ...p, pattern: e.target.value }))}
                  placeholder={t("claimRule.regexPlaceholder")}
                  rows={3}
                  maxLength={512}
                  className="font-mono text-sm"
                />
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.case_sensitive}
                    onChange={(e) => setDraft((p) => ({ ...p, case_sensitive: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-xs text-muted-foreground">{t("claimRule.caseSensitive")}</span>
                </label>
              </div>
            )}
          </div>

          <Separator />

          {/* 处置动作 */}
          <div className="space-y-3">
            <Label>{t("claimRule.actionLabel")}</Label>
            <Select
              value={draft.action}
              onValueChange={(v) => setDraft((p) => ({ ...p, action: v as "reject" | "reject_notify" }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reject">{t("claimRule.actionReject")}</SelectItem>
                <SelectItem value="reject_notify">{t("claimRule.actionRejectNotify")}</SelectItem>
              </SelectContent>
            </Select>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{t("claimRule.rejectMessage")}</Label>
                <span className={cn("text-xs", draft.reject_message.length > REJECT_MSG_MAX ? "text-destructive" : "text-muted-foreground")}>
                  {draft.reject_message.length}/{REJECT_MSG_MAX}
                </span>
              </div>
              <Textarea
                value={draft.reject_message}
                onChange={(e) => setDraft((p) => ({ ...p, reject_message: e.target.value }))}
                placeholder={t("claimRule.rejectMessagePlaceholder")}
                rows={2}
                maxLength={REJECT_MSG_MAX}
              />
              <p className="text-xs text-muted-foreground">{t("claimRule.rejectMessageHint")}</p>
            </div>
          </div>

          <Separator />

          {/* 适用范围 */}
          <div className="space-y-3">
            <button
              type="button"
              className="flex items-center gap-1 w-full text-sm font-medium text-left"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", !showAdvanced && "-rotate-90")} />
              {t("claimRule.scopeLabel")}
            </button>
            {showAdvanced && (
              <>
                <p className="text-xs text-muted-foreground">{t("claimRule.scopeHint")}</p>
                <div className="flex flex-wrap gap-2">
                  {domains.map((d) => (
                    <label key={d.id} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <Checkbox
                        checked={draft.scope_domain_ids.includes(d.id)}
                        onCheckedChange={() => toggleScopeDomain(d.id)}
                      />
                      {d.name}
                    </label>
                  ))}
                </div>
                {domains.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t("claimRule.noDomains")}</p>
                )}
              </>
            )}
          </div>

          <Separator />

          {/* 测试面板 */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">{t("claimRule.testPanel")}</Label>
            <div className="flex gap-2">
              <Input
                value={testName}
                onChange={(e) => setTestName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder={t("claimRule.testNamePlaceholder")}
                className="font-mono text-sm"
                maxLength={63}
              />
              <Select value={String(testDomainId)} onValueChange={(v) => setTestDomainId(Number(v))}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {domains.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={handleTest} disabled={!testName.trim() || !testDomainId || isTesting}>
                {isTesting ? t("claimRule.testing") : t("claimRule.testBtn")}
              </Button>
            </div>
            {testResult && (
              <div className={cn(
                "rounded-md border p-3 text-sm",
                testResult.matched ? "border-destructive/50 bg-destructive/5" : "border-green-500/30 bg-green-500/5",
              )}>
                {testResult.matched ? (
                  <div className="space-y-1">
                    <p className="font-medium text-destructive flex items-center gap-2">
                      <Badge variant="destructive">{t("claimRule.testMatched")}</Badge>
                      {testResult.matched_rule?.rule_name}
                    </p>
                    <p className="text-muted-foreground">{testResult.matched_rule?.message}</p>
                  </div>
                ) : (
                  <p className="text-green-700 dark:text-green-400">{t("claimRule.testNoMatch")}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid} data-dialog-primary="true">
            {isEdit ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
