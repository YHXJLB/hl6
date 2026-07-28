import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSubdomain, useReleaseSubdomain } from "@/hooks/use-subdomains";
import { useDNSRecords } from "@/hooks/use-dns-records";
import { RecordTable } from "@/components/dns/record-table";
import { RecordForm } from "@/components/dns/record-form";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function SubdomainDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const subdomainId = parseInt(id || "0");
  const { data: subdomain, isLoading } = useSubdomain(subdomainId);
  useDocumentTitle(subdomain?.fqdn ?? t("subdomains.title"));
  const { data: records } = useDNSRecords(subdomainId);
  const release = useReleaseSubdomain();
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const isSuspended = subdomain?.status === "suspended";
  const readOnly = Boolean(subdomain?.domain.migration_read_only) || isSuspended;

  const handleRelease = () => {
    if (!subdomain) return;
    release.mutate(
      { id: subdomain.id, fqdn: subdomain.fqdn },
      {
        onSuccess: () => {
          setShowRelease(false);
          navigate("/subdomains");
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Breadcrumb skeleton */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-20" />
          <span className="text-muted-foreground">/</span>
          <Skeleton className="h-4 w-32" />
        </div>

        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-52" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-20" />
          </div>
        </div>

        {/* Records card skeleton */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-12" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-8 w-16" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!subdomain) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-muted-foreground">{t("subdomains.notFound")}</p>
        <Button className="mt-4" asChild>
          <Link to="/subdomains">{t("subdomains.backToList")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/subdomains" className="hover:text-foreground">{t("subdomains.title")}</Link>
        <span>/</span>
        <span className="text-foreground">{subdomain.fqdn}</span>
      </div>

      {/* Migration read-only warning */}
      {subdomain.domain.migration_read_only && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200">
          {t("dnsMigration.readOnlyWarning")}
        </div>
      )}
      {isSuspended && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("subdomains.suspendedBanner", {
            reason: subdomain.suspended_reason || "—",
          })}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{subdomain.fqdn}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline">{subdomain.domain.name}</Badge>
            <span className="text-sm text-muted-foreground">
              {t("subdomains.claimed", { date: new Date(subdomain.created_at).toLocaleDateString() })}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowAddRecord(true)}
            disabled={readOnly}
          >
            {t("subdomains.addRecord")}
          </Button>
          <Button variant="destructive" onClick={() => setShowRelease(true)} disabled={release.isPending || release.isRetrying}>
            {t("subdomains.release")}
          </Button>
        </div>
      </div>

      {/* Records */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">{t("subdomains.dnsRecords")}</CardTitle>
          <Badge variant="secondary">{t("subdomains.total", { count: records?.length ?? 0 })}</Badge>
        </CardHeader>
        <CardContent>
          <RecordTable subdomainId={subdomainId} records={records || []} readOnly={readOnly} domainName={subdomain?.fqdn || ""} />
        </CardContent>
      </Card>

      <RecordForm
        subdomainId={subdomainId}
        domainName={subdomain?.fqdn || ""}
        open={showAddRecord && !readOnly}
        onOpenChange={setShowAddRecord}
      />

      <ConfirmDialog
        open={showRelease}
        onOpenChange={setShowRelease}
        title={t("subdomains.releaseTitle")}
        description={t("subdomains.releaseDesc", { fqdn: subdomain.fqdn })}
        confirmText={release.isRetrying ? `${t("common.retry")}...` : t("common.confirm")}
        confirmInput={subdomain.fqdn}
        confirmInputLabel={t("subdomains.releaseInputLabel", { fqdn: subdomain.fqdn })}
        onConfirm={handleRelease}
        destructive
        loading={release.isPending || release.isRetrying}
      />
    </div>
  );
}
