import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DNSRecord } from "@/types";
import { useDeleteRecord } from "@/hooks/use-dns-records";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RecordForm } from "./record-form";

interface RecordTableProps {
  subdomainId: number;
  records: DNSRecord[];
  readOnly?: boolean;
}

export function RecordTable({ subdomainId, records, readOnly }: RecordTableProps) {
  const [editRecord, setEditRecord] = useState<DNSRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DNSRecord | null>(null);
  const deleteRecord = useDeleteRecord(subdomainId);
  const { t } = useTranslation();

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteRecord.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const typeBadgeVariant = (type: string) => {
    switch (type) {
      case "A": return "default" as const;
      case "AAAA": return "secondary" as const;
      case "CNAME": return "outline" as const;
      case "TXT": return "secondary" as const;
      case "NS": return "outline" as const;
      case "MX": return "outline" as const;
      case "SRV": return "outline" as const;
      default: return "default" as const;
    }
  };

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/50 mb-4"><path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
        <p className="text-muted-foreground">{t("recordTable.noRecords")}</p>
        <p className="text-xs text-muted-foreground mt-1">{t("recordTable.noRecordsHelp")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{t("recordTable.type")}</TableHead>
              <TableHead>{t("recordTable.content")}</TableHead>
              <TableHead className="w-20">{t("recordTable.ttl")}</TableHead>
              <TableHead className="w-20">{t("recordTable.proxied")}</TableHead>
              <TableHead className="w-24 text-right">{t("recordTable.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id}>
                <TableCell>
                  <Badge variant={typeBadgeVariant(record.type)}>{record.type}</Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">{record.content}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {record.ttl === 1 ? t("common.auto") : `${record.ttl}s`}
                </TableCell>
                <TableCell>
                  {record.proxied ? (
                    <span className="text-orange-500 text-sm">{t("common.on")}</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">{t("common.off")}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditRecord(record)} disabled={readOnly}>
                      {t("common.edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDeleteTarget(record)}
                      disabled={deleteRecord.isPending || deleteRecord.isRetrying || readOnly}
                    >
                      {t("common.delete")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RecordForm
        subdomainId={subdomainId}
        record={editRecord}
        open={!!editRecord}
        onOpenChange={(open) => !open && setEditRecord(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("recordTable.deleteTitle")}
        description={t("recordTable.deleteDesc", { type: deleteTarget?.type, content: deleteTarget?.content })}
        confirmText={deleteRecord.isRetrying ? `${t("common.retry")}...` : t("common.confirm")}
        onConfirm={handleDelete}
        destructive
        loading={deleteRecord.isPending || deleteRecord.isRetrying}
      />
    </>
  );
}
