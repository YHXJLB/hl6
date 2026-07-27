import { useState } from "react";
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
    default:
      return "";
  }
}

interface RecordFormProps {
  subdomainId: number;
  record?: DNSRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecordForm({ subdomainId, record, open, onOpenChange }: RecordFormProps) {
  const [type, setType] = useState<string>(record?.type || "A");
  const [content, setContent] = useState(record?.content || "");
  const [proxied, setProxied] = useState(record?.proxied || false);
  const [validationError, setValidationError] = useState("");
  const { t } = useTranslation();

  const create = useCreateRecord(subdomainId);
  const update = useUpdateRecord(subdomainId);
  const isEdit = !!record;
  const isSaving = create.isPending || update.isPending || create.isRetrying || update.isRetrying;

  const handleSubmit = () => {
    if (!content.trim()) return;
    const data = {
      content: content.trim(),
      proxied: type === "TXT" || type === "NS" || type === "MX" ? false : proxied,
    };

    if (isEdit && record) {
      update.mutate(
        { recordId: record.id, ...data },
        {
          onSuccess: () => {
            onOpenChange(false);
          },
        }
      );
    } else {
      create.mutate(
        { type, ...data },
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
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>{t("recordForm.content")}</Label>
            <Input
              placeholder={type === "A" ? "1.2.3.4" : type === "AAAA" ? "2001:db8::1" : type === "TXT" ? "v=spf1 include:example.com ~all" : type === "NS" ? "ns1.example.com" : type === "MX" ? "10 mail.example.com" : "example.com"}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setValidationError(validateRecordContent(isEdit ? record!.type : type, e.target.value));
              }}
              required
            />
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
                  checked={type === "TXT" || type === "NS" || type === "MX" ? false : proxied}
                  onChange={(e) => setProxied(e.target.checked)}
                  disabled={type === "TXT" || type === "NS" || type === "MX"}
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
