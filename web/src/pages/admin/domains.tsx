import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage, ApiError, createIdempotencyKey, isRetryableMutationError } from "@/lib/api";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Plus, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DNSProviderZone, DNSProviderAccount, DomainWithGroupAccess, UserGroup } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { DNSRecordsContent } from "./dns-records";
import { DNSProviderAccountsContent } from "./dns-provider-accounts";
import { ClaimedSubdomainsContent } from "./claimed-subdomains";
import { useCreateMigration } from "@/hooks/use-domain-migrations";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { handleDnsBulkJobError } from "@/lib/dns-bulk-job-error";

interface GroupAccessEntry {
  group_id: number;
  credit_cost: number;
  max_dns_records?: number | null;
}

interface DNSFailureRecord {
  subdomain_fqdn: string;
  record_type: string;
  record_content: string;
  provider_record_id: string;
  error: string;
}

export default function AdminDomainsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("adminDomains.title"));
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const currentTab = rawTab === "cloudflare" ? "dns-providers" : (rawTab || "dns-records");

  return (
    <div className="space-y-6">
      <Tabs
        value={currentTab}
        onValueChange={(value) => {
          if (value === "dns-records") {
            setSearchParams({});
          } else {
            setSearchParams({ tab: value });
          }
        }}
      >
        <TabsList variant="line">
          <TabsTrigger value="dns-records">{t("adminDomains.tabDnsRecords")}</TabsTrigger>
          <TabsTrigger value="claimed">{t("adminDomains.tabClaimed")}</TabsTrigger>
          <TabsTrigger value="domains">{t("adminDomains.tabDomains")}</TabsTrigger>
          <TabsTrigger value="dns-providers">{t("adminDomains.tabDnsProviders")}</TabsTrigger>
        </TabsList>
        <TabsContent value="dns-records" className="space-y-6 mt-4">
          <DNSRecordsContent />
        </TabsContent>
        <TabsContent value="claimed" className="space-y-6 mt-4">
          <ClaimedSubdomainsContent />
        </TabsContent>
        <TabsContent value="domains" className="space-y-6 mt-4">
          <DomainsContent />
        </TabsContent>
        <TabsContent value="dns-providers" className="mt-4">
          <DNSProviderAccountsContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DomainsContent() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { data: domains, isLoading } = useQuery({
    queryKey: ["admin-domains"],
    queryFn: async () => {
      const res = await api.adminListDomainsFull();
      return res.data;
    },
    staleTime: 30_000,
  });

  const { data: groups } = useQuery({
    queryKey: ["admin-groups"],
    queryFn: async () => {
      const res = await api.adminListGroups();
      return res.data;
    },
    staleTime: 30_000,
  });

  const { data: reservedSettings } = useQuery({
    queryKey: ["admin-reserved-subdomain-prefixes"],
    queryFn: async () => {
      const res = await api.adminGetReservedSubdomainPrefixes();
      return res.data;
    },
    staleTime: 30_000,
  });

  const [showAdd, setShowAdd] = useState(false);
  const [showReservedPrefixes, setShowReservedPrefixes] = useState(false);
  const [settingsTab, setSettingsTab] = useState("prefixes");
  const [reservedPrefixesText, setReservedPrefixesText] = useState("");
  const [subdomainMinLength, setSubdomainMinLength] = useState("1");
  const [subdomainMaxLength, setSubdomainMaxLength] = useState("63");
  const [editDomain, setEditDomain] = useState<DomainWithGroupAccess | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<DNSProviderAccount | null>(null);
  const [selectedZone, setSelectedZone] = useState<DNSProviderZone | null>(null);
  const [description, setDescription] = useState("");
  const [groupAccess, setGroupAccess] = useState<GroupAccessEntry[]>([]);

  // 删除域名状态
  const [deleteDomain, setDeleteDomain] = useState<DomainWithGroupAccess | null>(null);
  const [refundCredits, setRefundCredits] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [cfFailures, setCfFailures] = useState<DNSFailureRecord[] | null>(null);
  const [isDeleteRetrying, setIsDeleteRetrying] = useState(false);

  // 迁移状态
  const [migrateDomain, setMigrateDomain] = useState<DomainWithGroupAccess | null>(null);
  const [migrateTargetAccount, setMigrateTargetAccount] = useState<DNSProviderAccount | null>(null);
  const [migrateTargetZone, setMigrateTargetZone] = useState<DNSProviderZone | null>(null);
  const [migrateReason, setMigrateReason] = useState("");

  const { data: cfAccounts } = useQuery({
    queryKey: ["admin-dns-provider-accounts"],
    queryFn: async () => {
      const res = await api.adminListDNSProviderAccounts();
      return res.data;
    },
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: api.adminCreateDomain,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-domains"] });
      toast.success(t("adminDomains.domainCreated"));
      setShowAdd(false);
      setSelectedAccount(null);
      setSelectedZone(null);
      setDescription("");
      setGroupAccess([]);
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; is_active?: boolean; description?: string; group_access?: GroupAccessEntry[] }) =>
      api.adminUpdateDomain(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-domains"] });
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      toast.success(t("adminDomains.domainUpdated"));
      setEditDomain(null);
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, refund }: { id: number; refund: boolean }) => {
      const idempotencyKey = createIdempotencyKey();
      try {
        return await api.adminDeleteDomain(id, { refund, idempotencyKey, timeoutMs: 3000 });
      } catch (err) {
        if (!isRetryableMutationError(err)) {
          throw err;
        }
        setIsDeleteRetrying(true);
        return api.adminDeleteDomain(id, { refund, idempotencyKey, timeoutMs: 3000 });
      } finally {
        setIsDeleteRetrying(false);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-domains"] });
      toast.success(t("adminDomains.domainDeleted"));
      setDeleteDomain(null);
      setCfFailures(null);
      setDeleteInput("");
      setRefundCredits(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.data && typeof err.data === "object" && "failed_records" in err.data) {
        setCfFailures((err.data as { failed_records: DNSFailureRecord[] }).failed_records);
      } else if (err instanceof ApiError && err.data && typeof err.data === "object" && "bulk_job_id" in err.data) {
        handleDnsBulkJobError(err, t, "delete", (e) => toast.error(getErrorMessage(e, t)));
      } else {
        toast.error(getErrorMessage(err, t));
      }
    },
  });

  const createMigration = useCreateMigration();

  const handleStartMigration = () => {
    if (!migrateDomain || !migrateTargetAccount || !migrateTargetZone) return;
    createMigration.mutate(
      {
        domainId: migrateDomain.id,
        data: {
          target_provider_account_id: migrateTargetAccount.id,
          target_provider_zone_id: migrateTargetZone.id,
          reason: migrateReason.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success(t("dnsMigration.migrationTaskCreated"));
          setMigrateDomain(null);
          setMigrateTargetAccount(null);
          setMigrateTargetZone(null);
          setMigrateReason("");
        },
        onError: (err) => toast.error(getErrorMessage(err, t)),
      }
    );
  };

  const updateReservedPrefixesMutation = useMutation({
    mutationFn: ({ prefixes, minLength, maxLength }: { prefixes: string[]; minLength: number; maxLength: number }) =>
      api.adminUpdateReservedSubdomainPrefixes({ prefixes, min_length: minLength, max_length: maxLength }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-reserved-subdomain-prefixes"] });
      setReservedPrefixesText(res.data.prefixes.join("\n"));
      setSubdomainMinLength(String(res.data.min_length));
      setSubdomainMaxLength(String(res.data.max_length));
      setShowReservedPrefixes(false);
      toast.success(t("adminDomains.settingsSaved"));
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Skeleton className="h-9 w-24" />
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminDomains.domain")}</TableHead>
                  <TableHead>{t("adminDomains.zoneId")}</TableHead>
                  <TableHead>{t("adminDomains.groupAccess")}</TableHead>
                  <TableHead>{t("adminDomains.status")}</TableHead>
                  <TableHead className="text-right">{t("adminDomains.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-28 ml-auto" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            setReservedPrefixesText((reservedSettings?.prefixes ?? []).join("\n"));
            setSubdomainMinLength(String(reservedSettings?.min_length ?? 1));
            setSubdomainMaxLength(String(reservedSettings?.max_length ?? 63));
            setSettingsTab("prefixes");
            setShowReservedPrefixes(true);
          }}
          title={t("adminDomains.reservedPrefixes")}
          aria-label={t("adminDomains.reservedPrefixes")}
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button onClick={() => {
          setGroupAccess([]);
          setSelectedAccount(null);
          setShowAdd(true);
        }}>{t("adminDomains.addDomain")}</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminDomains.domain")}</TableHead>
                <TableHead>{t("adminDomains.zoneId")}</TableHead>
                <TableHead>{t("adminDomains.groupAccess")}</TableHead>
                <TableHead>{t("adminDomains.status")}</TableHead>
                <TableHead>{t("dnsMigration.migrationState")}</TableHead>
                <TableHead className="text-right">{t("adminDomains.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains?.map((domain) => (
                <TableRow key={domain.id} className="cursor-pointer" onClick={() => setEditDomain(domain)}>
                  <TableCell className="font-medium">{domain.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{domain.provider_zone_id.slice(0, 12)}...</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {domain.group_access?.map((ga) => (
                        <Badge key={ga.group_id} variant="outline" className="text-xs">
                          {ga.group?.name ?? `#${ga.group_id}`}: {ga.credit_cost}
                        </Badge>
                      ))}
                      {(!domain.group_access || domain.group_access.length === 0) && (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={domain.is_active ? "default" : "secondary"}>
                      {domain.is_active ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {domain.migration_state && domain.migration_state !== "idle" ? (
                      <Badge
                        variant={
                          domain.migration_state === "running"
                            ? "default"
                            : domain.migration_state === "partial_failed" || domain.migration_state === "failed"
                            ? "destructive"
                            : "secondary"
                        }
                        className="text-xs"
                      >
                        {t(`dnsMigration.status${domain.migration_state.charAt(0).toUpperCase() + domain.migration_state.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`, domain.migration_state)}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => updateMutation.mutate({ id: domain.id, is_active: !domain.is_active })}
                    >
                      {domain.is_active ? t("common.disable") : t("common.enable")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={["running", "queued"].includes(domain.migration_state)}
                      onClick={() => {
                        setMigrateDomain(domain);
                        setMigrateTargetAccount(null);
                        setMigrateTargetZone(null);
                        setMigrateReason("");
                      }}
                    >
                      {t("dnsMigration.createMigrationShort")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setDeleteDomain(domain);
                        setDeleteInput("");
                        setRefundCredits(false);
                        setCfFailures(null);
                      }}
                    >
                      {t("common.delete")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={(open) => {
        setShowAdd(open);
        if (!open) {
          setSelectedAccount(null);
          setSelectedZone(null);
          setDescription("");
          setGroupAccess([]);
        }
      }}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{t("adminDomains.addDomain")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("adminCloudflare.selectAccount")}</Label>
              <AccountCombobox
                accounts={cfAccounts ?? []}
                value={selectedAccount}
                required
                onSelect={(account) => {
                  setSelectedAccount(account);
                  setSelectedZone(null);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("adminDomains.domain")}</Label>
              <ZoneCombobox
                value={selectedZone}
                onSelect={setSelectedZone}
                accountId={selectedAccount?.id ?? null}
                accountProvider={selectedAccount?.provider ?? null}
                existingDomains={domains ?? []}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t("adminDomains.description")}</Label>
              <Textarea placeholder={t("adminDomains.optionalDescription")} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <GroupAccessEditor
              groups={groups ?? []}
              value={groupAccess}
              onChange={setGroupAccess}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={() => {
                if (!selectedZone || !selectedAccount) return;
                createMutation.mutate({
                  name: selectedZone.name,
                  provider_zone_id: selectedZone.id,
                  provider_account_id: selectedAccount.id,
                  description,
                  group_access: groupAccess,
                });
              }}
              disabled={!selectedZone || !selectedAccount || createMutation.isPending}
              data-dialog-primary="true"
            >
              {createMutation.isPending ? t("common.creating") : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reserved Prefixes Dialog */}
      <Dialog open={showReservedPrefixes} onOpenChange={(open) => {
        setShowReservedPrefixes(open);
        if (open) {
          setReservedPrefixesText((reservedSettings?.prefixes ?? []).join("\n"));
          setSubdomainMinLength(String(reservedSettings?.min_length ?? 1));
          setSubdomainMaxLength(String(reservedSettings?.max_length ?? 63));
          setSettingsTab("prefixes");
        }
      }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" aria-describedby="reserved-prefixes-desc">
          <DialogHeader>
            <DialogTitle>{t("adminDomains.settingsTitle")}</DialogTitle>
            <DialogDescription id="reserved-prefixes-desc">
              {t("adminDomains.settingsDescription")}
            </DialogDescription>
          </DialogHeader>
          <Tabs value={settingsTab} onValueChange={setSettingsTab}>
            <TabsList variant="line" className="w-full">
              <TabsTrigger value="prefixes">{t("adminDomains.reservedPrefixes")}</TabsTrigger>
              <TabsTrigger value="length">{t("adminDomains.subdomainLength")}</TabsTrigger>
            </TabsList>
            <TabsContent value="prefixes" className="space-y-2 py-2">
              <Textarea
                value={reservedPrefixesText}
                onChange={(e) => setReservedPrefixesText(e.target.value)}
                placeholder={t("adminDomains.reservedPrefixesPlaceholder")}
                className="min-h-44 max-h-[40vh] overflow-y-auto font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t("adminDomains.reservedPrefixesHint")}
              </p>
            </TabsContent>
            <TabsContent value="length" className="space-y-3 py-2">
              <div className="space-y-2">
                <Label htmlFor="subdomain-min-length">{t("adminDomains.subdomainMinLength")}</Label>
                <Input
                  id="subdomain-min-length"
                  type="number"
                  min={1}
                  max={63}
                  value={subdomainMinLength}
                  onChange={(e) => setSubdomainMinLength(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subdomain-max-length">{t("adminDomains.subdomainMaxLength")}</Label>
                <Input
                  id="subdomain-max-length"
                  type="number"
                  min={1}
                  max={63}
                  value={subdomainMaxLength}
                  onChange={(e) => setSubdomainMaxLength(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("adminDomains.subdomainLengthHint")}</p>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowReservedPrefixes(false)}
              disabled={updateReservedPrefixesMutation.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                const minLength = parseInt(subdomainMinLength, 10);
                const maxLength = parseInt(subdomainMaxLength, 10);
                if (
                  Number.isNaN(minLength) ||
                  Number.isNaN(maxLength) ||
                  minLength < 1 ||
                  maxLength > 63 ||
                  minLength > maxLength
                ) {
                  toast.error(t("adminDomains.invalidSubdomainLengthRange"));
                  return;
                }
                const prefixes = reservedPrefixesText
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean);
                updateReservedPrefixesMutation.mutate({ prefixes, minLength, maxLength });
              }}
              disabled={updateReservedPrefixesMutation.isPending}
              data-dialog-primary="true"
            >
              {updateReservedPrefixesMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editDomain} onOpenChange={(open) => !open && setEditDomain(null)}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{t("adminDomains.editDomain", { name: editDomain?.name })}</DialogTitle></DialogHeader>
          {editDomain && (
            <EditDomainForm
              domain={editDomain}
              groups={groups ?? []}
              onSave={(data) => updateMutation.mutate({ id: editDomain.id, ...data })}
              isPending={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteDomain && !cfFailures} onOpenChange={(open) => {
        if (!open) { setDeleteDomain(null); setDeleteInput(""); setRefundCredits(false); }
      }}>
        <DialogContent aria-describedby="delete-domain-desc">
          <DialogHeader>
            <DialogTitle>{t("adminDomains.deleteDomain")}</DialogTitle>
            <DialogDescription id="delete-domain-desc">
              {t("adminDomains.deleteConfirm", { name: deleteDomain?.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">
                {t("adminDomains.typeToConfirm", { name: deleteDomain?.name })}
              </label>
              <Input
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={deleteDomain?.name}
                required
                autoFocus
              />
            </div>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="refund-toggle"
                checked={refundCredits}
                onChange={(e) => setRefundCredits(e.target.checked)}
                className="mt-0.5 cursor-pointer"
              />
              <div>
                <label htmlFor="refund-toggle" className="text-sm font-medium cursor-pointer">
                  {t("adminDomains.refundCredits")}
                </label>
                <p className="text-xs text-muted-foreground">{t("adminDomains.refundCreditsHint")}</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteDomain(null); setDeleteInput(""); setRefundCredits(false); }} disabled={deleteMutation.isPending || isDeleteRetrying}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteInput !== deleteDomain?.name || deleteMutation.isPending || isDeleteRetrying}
              onClick={() => deleteDomain && deleteMutation.mutate({ id: deleteDomain.id, refund: refundCredits })}
              data-dialog-primary="true"
            >
              {isDeleteRetrying ? `${t("common.retry")}...` : deleteMutation.isPending ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CF Failures Dialog */}
      <Dialog open={!!cfFailures} onOpenChange={(open) => { if (!open) setCfFailures(null); }}>
        <DialogContent className="max-w-2xl" aria-describedby="cf-failures-desc">
          <DialogHeader>
            <DialogTitle>{t("adminDomains.cfDeleteFailures")}</DialogTitle>
            <DialogDescription id="cf-failures-desc">
              {t("adminDomains.cfDeleteFailuresDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminDomains.cfFailureSubdomain")}</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>{t("adminDomains.cfFailureError")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cfFailures?.map((f, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{f.subdomain_fqdn}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{f.record_type}</Badge></TableCell>
                    <TableCell className="text-xs text-destructive">{f.error}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCfFailures(null)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Migration Dialog */}
      <Dialog
        open={!!migrateDomain}
        onOpenChange={(open) => {
          if (!open) {
            setMigrateDomain(null);
            setMigrateTargetAccount(null);
            setMigrateTargetZone(null);
            setMigrateReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg" aria-describedby="migrate-domain-desc">
          <DialogHeader>
            <DialogTitle>{t("dnsMigration.createMigrationTitle")}</DialogTitle>
            <DialogDescription id="migrate-domain-desc">
              {t("dnsMigration.createMigrationDescription", { name: migrateDomain?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("dnsMigration.targetAccount")}</Label>
              <AccountCombobox
                accounts={(cfAccounts ?? []).filter((a) => a.id !== migrateDomain?.provider_account_id)}
                value={migrateTargetAccount}
                onSelect={(account) => {
                  setMigrateTargetAccount(account);
                  setMigrateTargetZone(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("dnsMigration.targetZone")}</Label>
              <ZoneCombobox
                value={migrateTargetZone}
                onSelect={setMigrateTargetZone}
                accountId={migrateTargetAccount?.id ?? null}
                accountProvider={migrateTargetAccount?.provider ?? null}
                existingDomains={[]}
              />
              {migrateTargetAccount && !migrateTargetZone && (
                <p className="text-xs text-muted-foreground">
                  {t("dnsMigration.selectTargetZoneFirst")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t("dnsMigration.reason")}</Label>
              <Input
                value={migrateReason}
                onChange={(e) => setMigrateReason(e.target.value)}
                placeholder={t("dnsMigration.reason")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMigrateDomain(null)}
              disabled={createMigration.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!migrateTargetAccount || !migrateTargetZone || createMigration.isPending}
              onClick={handleStartMigration}
            >
              {createMigration.isPending
                ? t("common.saving")
                : t("dnsMigration.createMigration")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupAccessEditor({ groups, value, onChange }: {
  groups: UserGroup[];
  value: GroupAccessEntry[];
  onChange: (v: GroupAccessEntry[]) => void;
}) {
  const { t } = useTranslation();
  const [bulkCost, setBulkCost] = useState("1");
  // 用字符串 state 管理每个用户组的 credit_cost 输入，避免输入 "-" 时被立即重置为 0
  const [creditInputs, setCreditInputs] = useState<Record<number, string>>({});
  const usedGroupIds = new Set(value.map((v) => v.group_id));

  // 当外部 value 变化（如统一定价更新、新增/删除条目）时同步 creditInputs
  useEffect(() => {
    setCreditInputs((prev) => {
      const next: Record<number, string> = {};
      value.forEach((e) => {
        const prevInput = prev[e.group_id];
        const prevParsed = parseFloat(prevInput ?? "");
        // 若当前输入处于中间状态（NaN，如只输了"-"），保留用户的输入
        if (prevInput !== undefined && isNaN(prevParsed)) {
          next[e.group_id] = prevInput;
        } else {
          next[e.group_id] = String(e.credit_cost);
        }
      });
      return next;
    });
  }, [value]);
  const availableGroups = groups.filter((g) => !usedGroupIds.has(g.id));

  return (
    <div className="space-y-2">
      <Label>{t("adminDomains.groupAccess")}</Label>
      {/* Bulk price row */}
      <div className="flex items-center gap-2 rounded-md border border-dashed p-2">
        <span className="text-sm min-w-24 font-medium">{t("adminDomains.allGroups")}</span>
        <Input
          type="number"
          step="any"
          className="w-24"
          value={bulkCost}
          onChange={(e) => {
            setBulkCost(e.target.value);
            const cost = parseFloat(e.target.value) || 0;
            if (value.length > 0) {
              onChange(value.map((entry) => ({ ...entry, credit_cost: cost })));
            }
          }}
        />
        <span className="text-xs text-muted-foreground">{t("adminDomains.creditCost")}</span>
        {availableGroups.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => {
              const cost = parseFloat(bulkCost) || 1;
              const newEntries = availableGroups.map((g) => ({ group_id: g.id, credit_cost: cost }));
              onChange([...value, ...newEntries]);
            }}
          >
            <Plus className="h-3 w-3 mr-1" />
            {t("adminDomains.addAllGroups")}
          </Button>
        )}
      </div>
      {/* Per-group rows */}
      <div className="space-y-2">
        {value.map((entry, idx) => {
          const group = groups.find((g) => g.id === entry.group_id);
          return (
            <div key={entry.group_id} className="flex items-center gap-2 flex-wrap">
              <span className="text-sm min-w-24 truncate">{group?.name ?? `#${entry.group_id}`}</span>
              <Input
                type="number"
                step="any"
                className="w-24"
                value={creditInputs[entry.group_id] ?? String(entry.credit_cost)}
                onChange={(e) => {
                  const raw = e.target.value;
                  setCreditInputs((prev) => ({ ...prev, [entry.group_id]: raw }));
                  const parsed = parseFloat(raw);
                  if (!isNaN(parsed)) {
                    const next = [...value];
                    next[idx] = { ...entry, credit_cost: parsed };
                    onChange(next);
                  }
                }}
              />
              <span className="text-xs text-muted-foreground">{t("adminDomains.creditCost")}</span>
              <Input
                type="number"
                min={1}
                className="w-20"
                value={entry.max_dns_records ?? ""}
                placeholder={t("adminDomains.maxDnsRecordsHint")}
                onChange={(e) => {
                  const next = [...value];
                  next[idx] = { ...entry, max_dns_records: e.target.value ? parseInt(e.target.value) : null };
                  onChange(next);
                }}
              />
              <span className="text-xs text-muted-foreground">{t("adminDomains.maxDnsRecords")}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                onChange(value.filter((_, i) => i !== idx));
              }}>
                <X className="h-4 w-4" />
              </Button>
              {entry.credit_cost < 0 && (
                <p className="text-xs text-green-600 basis-full">{t("adminDomains.negativeCostHint")}</p>
              )}
            </div>
          );
        })}
      </div>
      {availableGroups.length > 0 && (
        <Select onValueChange={(v) => {
          const groupId = parseInt(v);
          const cost = parseFloat(bulkCost) || 1;
          onChange([...value, { group_id: groupId, credit_cost: cost }]);
        }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("adminDomains.addGroupAccess")} />
          </SelectTrigger>
          <SelectContent>
            {availableGroups.map((g) => (
              <SelectItem key={g.id} value={String(g.id)}>
                <div className="flex items-center gap-2">
                  <Plus className="h-3 w-3" />
                  {g.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("adminDomains.noGroupAccess")}</p>
      )}
    </div>
  );
}

function AccountCombobox({ accounts, value, onSelect, required = false }: {
  accounts: DNSProviderAccount[];
  value: DNSProviderAccount | null;
  onSelect: (account: DNSProviderAccount | null) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-value={value?.name ?? ""}
          data-hotkey-required={required ? "true" : undefined}
          data-hotkey-filled={required ? (value ? "true" : "false") : undefined}
          className="w-full justify-between font-normal"
        >
          {value ? `${value.name} (${value.provider})` : t("adminCloudflare.selectAccount")}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={t("adminCloudflare.selectAccount")} />
          <CommandList>
            <CommandEmpty>{t("adminCloudflare.noAccounts")}</CommandEmpty>
            <CommandGroup>
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={account.name}
                  onSelect={() => {
                    onSelect(value?.id === account.id ? null : account);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value?.id === account.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1">{account.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{account.provider}</Badge>
                  <span className="text-xs text-muted-foreground ml-2">{account.credential_hint}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ZoneCombobox({ value, onSelect, accountId, accountProvider, existingDomains, required = false }: {
  value: DNSProviderZone | null;
  onSelect: (zone: DNSProviderZone | null) => void;
  accountId: number | null;
  accountProvider: string | null;
  existingDomains: DomainWithGroupAccess[];
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  const { data: zones, isLoading } = useQuery({
    queryKey: ["admin-dns-provider-zones", accountId],
    queryFn: async () => {
      const res = await api.adminListDNSProviderZones(accountId!);
      return res.data;
    },
    enabled: !!accountId,
    staleTime: 30_000,
  });

  const filteredZones = useMemo(() => {
    if (!zones || zones.length === 0) {
      return [];
    }

    const existingZoneIds = new Set(
      existingDomains
        .filter((d) => !accountProvider || d.provider === accountProvider)
        .map((d) => d.provider_zone_id),
    );
    const existingNamesLower = new Set(existingDomains.map((d) => d.name.trim().toLowerCase()));

    return zones.filter((zone) => {
      if (existingZoneIds.has(zone.id)) {
        return false;
      }
      if (existingNamesLower.has(zone.name.trim().toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [zones, existingDomains, accountProvider]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={!accountId}
          data-value={value?.name ?? ""}
          data-hotkey-required={required ? "true" : undefined}
          data-hotkey-filled={required ? (value ? "true" : "false") : undefined}
          className="w-full justify-between font-normal"
        >
          {value ? value.name : (accountId ? t("adminDomains.selectDomain") : t("adminCloudflare.selectAccountFirst"))}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder={t("adminDomains.searchDomains")} />
          <CommandList>
            <CommandEmpty>
              {isLoading ? t("common.loading") : t("adminDomains.noDomainsFound")}
            </CommandEmpty>
            <CommandGroup>
              {filteredZones.map((zone) => (
                <CommandItem
                  key={zone.id}
                  value={zone.name}
                  onSelect={() => {
                    onSelect(value?.id === zone.id ? null : zone);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value?.id === zone.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1">{zone.name}</span>
                  <Badge variant="secondary" className="ml-2 text-xs">{zone.status}</Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function EditDomainForm({ domain, groups, onSave, isPending }: {
  domain: DomainWithGroupAccess;
  groups: UserGroup[];
  onSave: (data: { description: string; group_access: GroupAccessEntry[] }) => void;
  isPending: boolean;
}) {
  const [desc, setDesc] = useState(domain.description);
  const [access, setAccess] = useState<GroupAccessEntry[]>(
    domain.group_access?.map((ga) => ({ group_id: ga.group_id, credit_cost: ga.credit_cost, max_dns_records: ga.max_dns_records ?? null })) ?? []
  );
  const { t } = useTranslation();

  return (
    <>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>{t("adminDomains.description")}</Label>
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <GroupAccessEditor
          groups={groups}
          value={access}
          onChange={setAccess}
        />
      </div>
      <DialogFooter>
        <Button onClick={() => onSave({ description: desc, group_access: access })} disabled={isPending} data-dialog-primary="true">
          {isPending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
