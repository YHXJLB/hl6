import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateRecord, useUpdateRecord } from "@/hooks/use-dns-records";
import type { DNSRecord } from "@/types";

// SRV 结构化字段解析与拼接
const SRV_PROTOCOLS = ["_tcp", "_udp", "_sctp"] as const;
type SRVProtocol = (typeof SRV_PROTOCOLS)[number] | "";

interface SRVFields {
  priority: string;
  weight: string;
  port: string;
  service: string;
  protocol: SRVProtocol;
  target: string;
}

function parseSRVContent(content: string): SRVFields {
  const parts = content.trim().split(/\s+/);
  if (parts.length >= 4) {
    const [priority, weight, port, ...rest] = parts;
    const target = rest.join(" ");
    // 尝试从 target 中提取 _service.protocol 前缀
    const srvMatch = target.match(/^(_[a-zA-Z0-9_-]+)\.(_[a-zA-Z0-9]+)\.(.+)$/);
    if (srvMatch) {
      return { priority, weight, port, service: srvMatch[1], protocol: srvMatch[2] as SRVProtocol, target: srvMatch[3] };
    }
    return { priority, weight, port, service: "", protocol: "", target: "" };
  }
  return { priority: "", weight: "", port: "", service: "", protocol: "", target: "" };
}

function buildSRVContent(srv: SRVFields): string {
  // SRV 标准 content 格式：priority weight port target
  // target 是纯主机名（如 x17.ungc.com.cn），不含 _service._protocol 前缀
  // _service._protocol 应拼到记录名（name/subdomain）前面，不是这里
  return `${srv.priority} ${srv.weight} ${srv.port} ${srv.target}`.replace(/\s+/g, " ").trim();
}

/** 从 SRV 字段构建记录名前缀（_service._protocol），用于拼到子域前面 */
function buildSRVNamePrefix(srv: SRVFields): string {
  const svc = srv.service.startsWith("_") ? srv.service : (srv.service ? `_${srv.service}` : "");
  if (svc && srv.protocol) return `${srv.protocol}.${svc}`;
  return "";
}

function validateRecordContent(type: string, content: string): string {
  if (!content.trim()) return "";
  switch (type) {
    case "A": {
      const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipv4.test(content)) return "recordForm.invalidIPv4";
      const parts = content.split(".").map(Number);
      if (parts.some(p => p > 255)) return "recordForm.invalidIPv4";
      return "";
    }
    case "AAAA": {
      const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/;
      if (!ipv6.test(content)) return "recordForm.invalidIPv6";
      return "";
    }
    case "CNAME": {
      const hostname = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\.?$/;
      if (!hostname.test(content)) return "recordForm.invalidHostname";
      return "";
    }
    case "NS": {
      const hostname = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\.?$/;
      if (!hostname.test(content)) return "recordForm.invalidHostname";
      return "";
    }
    case "MX": {
      const mxParts = content.trim().split(/\s+/);
      if (mxParts.length !== 2) return "recordForm.invalidMXFormat";
      const priority = mxParts[0];
      const host = mxParts[1];
      if (!/^\d{1,5}$/.test(priority) || parseInt(priority, 10) > 65535) return "recordForm.invalidMXPriority";
      const mxHost = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\.?$/;
      if (!mxHost.test(host)) return "recordForm.invalidHostname";
      return "";
    }
    case "SRV": {
      const srvParts = content.trim().split(/\s+/);
      if (srvParts.length !== 4) return "recordForm.invalidSRVFormat";
      const [priority, weight, port, target] = srvParts;
      if (!/^\d{1,5}$/.test(priority) || parseInt(priority, 10) > 65535) return "recordForm.invalidSRVPriority";
      if (!/^\d{1,5}$/.test(weight) || parseInt(weight, 10) > 65535) return "recordForm.invalidSRVPriority";
      if (!/^\d{1,5}$/.test(port) || parseInt(port, 10) > 65535) return "recordForm.invalidSRVPriority";
      // SRV 目标格式为 _service._protocol.hostname（含下划线前缀），不能用普通主机名正则
      const srvHost = /^(_?[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?\.)*_?[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;
      if (!srvHost.test(target)) return "recordForm.invalidSRVTarget";
      return "";
    }
    default:
      return "";
  }
}

interface RecordFormProps {
  subdomainId: number;
  record?: DNSRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前域名 FQDN（如 test-test.yhxjlb.xyz），用于 SRV 目标域名默认值 */
  domainName?: string;
}

export function RecordForm({ subdomainId, record, open, onOpenChange, domainName }: RecordFormProps) {
  const [type, setType] = useState<string>(record?.type || "A");
  const [content, setContent] = useState(record?.content || "");
  const [proxied, setProxied] = useState(record?.proxied || false);
  const [validationError, setValidationError] = useState("");
  const { t } = useTranslation();

  // SRV 结构化字段
  const [srvFields, setSrvFields] = useState<SRVFields>(() =>
    record?.type === "SRV" && record?.content ? parseSRVContent(record.content) : { priority: "", weight: "", port: "", service: "", protocol: "", target: "" }
  );

  // 当 type 切换到 SRV 时，从 content 解析字段；切换走时同步 content
  useEffect(() => {
    if (type === "SRV" && !record) {
      // 新建 SRV：如果 content 已有值（手动输入过），解析它；否则全部留空由用户填写
      if (content.trim()) {
        setSrvFields(parseSRVContent(content));
      }
    } else if (type !== "SRV") {
      // 非 SRV 类型时保持 content 原样
    }
  }, [type, domainName]);

  // SRV 字段变更时同步更新 content
  const updateSRVField = useCallback(<K extends keyof SRVFields>(key: K, value: SRVFields[K]) => {
    setSrvFields(prev => {
      const next = { ...prev, [key]: value };
      setContent(buildSRVContent(next));
      setValidationError(validateRecordContent("SRV", buildSRVContent(next)));
      return next;
    });
  }, []);

  const create = useCreateRecord(subdomainId);
  const update = useUpdateRecord(subdomainId);
  const isEdit = !!record;
  const isSaving = create.isPending || update.isPending || create.isRetrying || update.isRetrying;

  const handleSubmit = () => {
    if (!content.trim()) return;
    const baseData = {
      content: content.trim(),
      proxied: type === "TXT" || type === "NS" || type === "MX" || type === "SRV" ? false : proxied,
    };

    // SRV 记录：_service._protocol 需要拼到记录名（子域）前面，不是 content 里
    if (type === "SRV") {
      const prefix = buildSRVNamePrefix(srvFields);
      if (prefix) {
        (baseData as Record<string, unknown>).srvNamePrefix = prefix;
      }
    }

    if (isEdit && record) {
      update.mutate(
        { recordId: record.id, ...baseData },
        {
          onSuccess: () => {
            onOpenChange(false);
          },
        }
      );
    } else {
      create.mutate(
        { type, ...baseData },
        {
          onSuccess: () => {
            setContent("");
            onOpenChange(false);
          },
        }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("recordForm.editTitle") : t("recordForm.addTitle")}</DialogTitle>
          <DialogDescription>
            {isEdit ? t("recordForm.editDesc") : t("recordForm.addDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {!isEdit && (
            <div className="space-y-2">
              <Label>{t("recordForm.type")}</Label>
              <Select value={type} onValueChange={(v) => {
                setType(v);
                setValidationError(validateRecordContent(v, content));
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">{t("recordForm.typeA")}</SelectItem>
                  <SelectItem value="AAAA">{t("recordForm.typeAAAA")}</SelectItem>
                  <SelectItem value="CNAME">{t("recordForm.typeCNAME")}</SelectItem>
                  <SelectItem value="TXT">{t("recordForm.typeTXT")}</SelectItem>
                  <SelectItem value="NS">{t("recordForm.typeNS")}</SelectItem>
                  <SelectItem value="MX">{t("recordForm.typeMX")}</SelectItem>
                  <SelectItem value="SRV">{t("recordForm.typeSRV")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>{t("recordForm.content")}</Label>
            {type === "SRV" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("recordForm.srvPriority") || "Priority"}</Label>
                  <Input type="number" min="0" max="65535" value={srvFields.priority} onChange={e => updateSRVField("priority", e.target.value)} placeholder="10" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("recordForm.srvWeight") || "Weight"}</Label>
                  <Input type="number" min="0" max="65535" value={srvFields.weight} onChange={e => updateSRVField("weight", e.target.value)} placeholder="5" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("recordForm.srvPort") || "Port"}</Label>
                  <Input type="number" min="0" max="65535" value={srvFields.port} onChange={e => updateSRVField("port", e.target.value)} placeholder="5060" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("recordForm.srvService") || "Service"}</Label>
                  <Input value={srvFields.service} onChange={e => updateSRVField("service", e.target.value)} placeholder="minecraft / sip" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("recordForm.srvProtocol") || "Protocol"}</Label>
                  <Select value={srvFields.protocol} onValueChange={(v) => updateSRVField("protocol", v as SRVProtocol)}>
                    <SelectTrigger><SelectValue placeholder={t("recordForm.srvProtocolPlaceholder") || "Protocol"} /></SelectTrigger>
                    <SelectContent>
                      {SRV_PROTOCOLS.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs text-muted-foreground">{t("recordForm.srvTarget") || "Target Domain"}</Label>
                  <Input value={srvFields.target} onChange={e => updateSRVField("target", e.target.value)} placeholder={domainName || "目标域名"} />
                </div>
              </div>
            ) : (
              <Input
                placeholder={type === "A" ? "1.2.3.4" : type === "AAAA" ? "2001:db8::1" : type === "TXT" ? "v=spf1 include:example.com ~all" : type === "NS" ? "ns1.example.com" : type === "MX" ? "10 mail.example.com" : "example.com"}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setValidationError(validateRecordContent(isEdit ? record!.type : type, e.target.value));
                }}
                required
              />
            )}
            {validationError && (
              <p className="text-sm text-destructive">{t(validationError)}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("recordForm.proxied")}</Label>
            <div className="flex items-center h-9">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={type === "TXT" || type === "NS" || type === "MX" || type === "SRV" ? false : proxied}
                  onChange={(e) => setProxied(e.target.checked)}
                  disabled={type === "TXT" || type === "NS" || type === "MX" || type === "SRV"}
                  className="rounded"
                />
                <span className="text-sm">{proxied ? t("common.on") : t("common.off")}</span>
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!content.trim() || !!validationError || isSaving} data-dialog-primary="true">
            {create.isRetrying || update.isRetrying
              ? `${t("common.retry")}...`
              : create.isPending || update.isPending
                ? t("common.saving")
                : isEdit
                  ? t("recordForm.update")
                  : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
