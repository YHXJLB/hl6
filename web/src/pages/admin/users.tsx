import { useState, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, createIdempotencyKey, getErrorMessage, isRetryableMutationError } from "@/lib/api";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyableEmail } from "@/components/ui/copyable-email";
import type { UserWithInviter } from "@/types";
import { GroupsContent } from "./groups";
import { NotificationsContent } from "./notifications";
import { BrandContent } from "./brand";
import { CreditsSettingsContent } from "./credits-settings";
import { RedeemCodesContent } from "./redeem-codes";
import { useAuth } from "@/hooks/use-auth";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { handleDnsBulkJobError } from "@/lib/dns-bulk-job-error";

const PAGE_SIZE = 30;
const MAX_CREDIT_AMOUNT = 100000;

function formatCredits(value?: number): string {
  const safe = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return safe.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function parseCreditInput(raw: string, allowNegative: boolean): number | null {
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) return null;
  if (!allowNegative && value < 0) return null;
  if (Math.abs(value) > MAX_CREDIT_AMOUNT) return null;
  if (Math.abs(value * 10 - Math.round(value * 10)) > 1e-9) return null;
  return value;
}

function formatDate(value?: string, withTime = false): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return withTime ? date.toLocaleString() : date.toLocaleDateString();
}

function UsersContent() {
  const { user: currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [inviterSearch, setInviterSearch] = useState("");
  const [debouncedInviterSearch, setDebouncedInviterSearch] = useState("");
  const [banStatus, setBanStatus] = useState<"all" | "active" | "banned">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "user" | "admin">("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [detailUser, setDetailUser] = useState<UserWithInviter | null>(null);
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedInviterSearch(inviterSearch);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [inviterSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", page, debouncedSearch, debouncedInviterSearch, banStatus, roleFilter, groupFilter],
    queryFn: async () => {
      const res = await api.adminListUsers(
        page,
        PAGE_SIZE,
        debouncedSearch,
        banStatus,
        roleFilter,
        groupFilter === "all" ? undefined : Number(groupFilter),
        debouncedInviterSearch
      );
      return { users: res.data, total: res.total };
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

  const [grantUserId, setGrantUserId] = useState<number | null>(null);
  const [grantAmount, setGrantAmount] = useState("10");
  const [grantDesc, setGrantDesc] = useState("");

  const [changeGroupUserId, setChangeGroupUserId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [banUserId, setBanUserId] = useState<number | null>(null);
  const [banReason, setBanReason] = useState("");
  const [isBanRetrying, setIsBanRetrying] = useState(false);

  const submitGrant = () => {
    if (!grantUserId) return;
    const amount = parseCreditInput(grantAmount, true);
    if (amount === null || amount === 0) {
      toast.error(t("error.invalidCreditAmount"));
      return;
    }
    grantMutation.mutate({
      user_id: grantUserId,
      amount,
      description: grantDesc || t("adminUsers.adminGrant"),
    });
  };

  const grantMutation = useMutation({
    mutationFn: api.adminGrantCredits,
    onSuccess: (res) => {
      toast.success(t("adminUsers.grantSuccess", { amount: res.data.granted, balance: res.data.balance }));
      setGrantUserId(null);
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  const changeGroupMutation = useMutation({
    mutationFn: ({ userId, groupId }: { userId: number; groupId: number }) =>
      api.adminUpdateUserGroup(userId, groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-groups"] });
      toast.success(t("adminUsers.groupChanged"));
      setChangeGroupUserId(null);
      setSelectedGroupId("");
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  const banMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: number; reason: string }) => {
      const idempotencyKey = createIdempotencyKey();
      try {
        return await api.adminBanUser(userId, { reason }, { idempotencyKey, timeoutMs: 3000 });
      } catch (err) {
        if (!isRetryableMutationError(err)) {
          throw err;
        }
        setIsBanRetrying(true);
        return api.adminBanUser(userId, { reason }, { idempotencyKey, timeoutMs: 3000 });
      } finally {
        setIsBanRetrying(false);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(t("adminUsers.banSuccess"));
      setBanUserId(null);
      setBanReason("");
    },
    onError: (err) => {
      handleDnsBulkJobError(err, t, "ban", (e) => toast.error(getErrorMessage(e, t)));
    },
  });

  const unbanMutation = useMutation({
    mutationFn: (userId: number) => api.adminUnbanUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(t("adminUsers.unbanSuccess"));
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          {isLoading ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("adminUsers.totalUsers", { count: data?.total ?? 0 })}
            </CardTitle>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={banStatus}
              onValueChange={(v) => {
                setBanStatus(v as "all" | "active" | "banned");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("adminUsers.filterAllStatus")}</SelectItem>
                <SelectItem value="active">{t("adminUsers.filterActive")}</SelectItem>
                <SelectItem value="banned">{t("adminUsers.filterBanned")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={roleFilter}
              onValueChange={(v) => {
                setRoleFilter(v as "all" | "user" | "admin");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t("adminUsers.filterByRole")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("adminUsers.filterAllRoles")}</SelectItem>
                <SelectItem value="user">{t("adminUsers.filterRoleUser")}</SelectItem>
                <SelectItem value="admin">{t("adminUsers.filterRoleAdmin")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={groupFilter}
              onValueChange={(v) => {
                setGroupFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("adminUsers.filterByGroup")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("adminUsers.filterAllGroups")}</SelectItem>
                {groups?.map((group) => (
                  <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder={t("adminUsers.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-[220px]"
            />
            <Input
              placeholder={t("adminUsers.filterByInviter")}
              value={inviterSearch}
              onChange={(e) => setInviterSearch(e.target.value)}
              className="w-[220px]"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminUsers.email")}</TableHead>
                <TableHead>{t("adminUsers.credits")}</TableHead>
                <TableHead>{t("adminUsers.group")}</TableHead>
                <TableHead>{t("adminUsers.joined")}</TableHead>
                <TableHead>{t("adminUsers.invitedBy")}</TableHead>
                <TableHead className="text-right">{t("adminUsers.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="ml-auto h-8 w-32" /></TableCell>
                  </TableRow>
                ))
              ) : (
                data?.users?.map((user) => (
                  <TableRow key={user.id} className="cursor-pointer" onClick={() => setDetailUser(user)}>
                    <TableCell className="max-w-[240px]">
                      <CopyableEmail
                        email={user.email}
                        stopPropagation
                        className="text-muted-foreground w-full"
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatCredits(user.credits)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{user.group?.name ?? "-"}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.created_at)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {user.invited_by?.email ? (
                        <CopyableEmail
                          email={user.invited_by.email}
                          stopPropagation
                          className="text-muted-foreground max-w-[220px]"
                        />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="space-x-1 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setChangeGroupUserId(user.id);
                          setSelectedGroupId(user.group_id ? String(user.group_id) : "");
                        }}
                        disabled={user.is_banned}
                      >
                        {t("adminUsers.changeGroup")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setGrantUserId(user.id)} disabled={user.is_banned}>
                        {t("adminUsers.grantCredits")}
                      </Button>
                      {user.is_banned ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => unbanMutation.mutate(user.id)}
                          disabled={unbanMutation.isPending}
                        >
                          {t("adminUsers.unbanUser")}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setBanUserId(user.id);
                            setBanReason("");
                          }}
                          disabled={banMutation.isPending || isBanRetrying || user.id === currentUser?.id}
                        >
                          {t("adminUsers.banUser")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <UserDetailDialog user={detailUser} onClose={() => setDetailUser(null)} />

      {data && data.total > PAGE_SIZE && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("common.previous")}</Button>
          <span className="flex items-center text-sm text-muted-foreground">{t("common.pageOf", { page, total: Math.ceil(data.total / PAGE_SIZE) })}</span>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / PAGE_SIZE)} onClick={() => setPage((p) => p + 1)}>{t("common.next")}</Button>
        </div>
      )}

      <Dialog open={banUserId !== null} onOpenChange={(open) => {
        if (!open) {
          setBanUserId(null);
          setBanReason("");
        }
      }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{t("adminUsers.banUser")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("adminUsers.banReasonOptional")}</Label>
              <Input
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder={t("adminUsers.banReasonPlaceholder")}
              />
            </div>
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">{t("adminUsers.deleteAllResources")}</p>
              <p className="text-xs text-muted-foreground">{t("adminUsers.deleteAllResourcesHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBanUserId(null)} disabled={banMutation.isPending || isBanRetrying}>{t("common.cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => banUserId && banMutation.mutate({
                userId: banUserId,
                reason: banReason.trim(),
              })}
              disabled={banMutation.isPending || isBanRetrying}
              data-dialog-primary="true"
            >
              {isBanRetrying ? `${t("common.retry")}...` : banMutation.isPending ? t("common.saving") : t("adminUsers.banUser")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={grantUserId !== null} onOpenChange={(open) => !open && setGrantUserId(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{t("adminUsers.grantCredits")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("adminUsers.amount")}</Label>
              <Input
                type="number"
                min={-MAX_CREDIT_AMOUNT}
                max={MAX_CREDIT_AMOUNT}
                step="0.1"
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("adminUsers.descriptionOptional")}</Label>
              <Input value={grantDesc} onChange={(e) => setGrantDesc(e.target.value)} placeholder={t("adminUsers.adminGrant")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantUserId(null)}>{t("common.cancel")}</Button>
            <Button
              onClick={submitGrant}
              disabled={grantMutation.isPending}
              data-dialog-primary="true"
            >
              {grantMutation.isPending ? t("adminUsers.granting") : t("credits.grant")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={changeGroupUserId !== null} onOpenChange={(open) => {
        if (!open) {
          setChangeGroupUserId(null);
          setSelectedGroupId("");
        }
      }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{t("adminUsers.changeGroup")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("adminUsers.selectGroup")}</Label>
              <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                <SelectTrigger
                  data-hotkey-required="true"
                  data-hotkey-filled={selectedGroupId ? "true" : "false"}
                >
                  <SelectValue placeholder={t("adminUsers.selectGroup")} />
                </SelectTrigger>
                <SelectContent>
                  {groups?.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeGroupUserId(null)}>{t("common.cancel")}</Button>
            <Button
              onClick={() => changeGroupUserId && selectedGroupId && changeGroupMutation.mutate({
                userId: changeGroupUserId,
                groupId: parseInt(selectedGroupId),
              })}
              disabled={!selectedGroupId || changeGroupMutation.isPending}
              data-dialog-primary="true"
            >
              {changeGroupMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserDetailDialog({ user, onClose }: { user: UserWithInviter | null; onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("adminUsers.userDetail")}</DialogTitle>
        </DialogHeader>
        {user && (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <p className="text-sm font-semibold">{t("adminUsers.basicInfo")}</p>
              <UserDetailRow label={t("adminUsers.name")} value={user.name || "-"} />
              <UserDetailRow
                label={t("adminUsers.email")}
                value={<CopyableEmail email={user.email} truncate={false} className="text-sm text-foreground" />}
              />
              <UserDetailRow label={t("adminUsers.role")} value={user.role || "-"} />
              <UserDetailRow label={t("adminUsers.group")} value={user.group?.name ?? "-"} />
              <UserDetailRow label={t("adminUsers.groupId")} value={user.group_id ? String(user.group_id) : "-"} mono />
              <UserDetailRow
                label={t("adminUsers.status")}
                value={user.is_banned ? t("adminUsers.statusBanned") : t("adminUsers.statusActive")}
              />
              <UserDetailRow label={t("adminUsers.credits")} value={formatCredits(user.credits)} mono />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">{t("adminUsers.accountMeta")}</p>
              <UserDetailRow label={t("adminUsers.id")} value={String(user.id)} mono />
              <UserDetailRow label={t("adminUsers.externalId")} value={user.external_id || "-"} mono breakAll />
              <UserDetailRow label={t("adminUsers.referralCode")} value={user.referral_code || "-"} mono />
              <UserDetailRow label={t("adminUsers.avatarUrl")} value={user.avatar_url || "-"} breakAll />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">{t("adminUsers.banInfo")}</p>
              <UserDetailRow label={t("adminUsers.bannedReason")} value={user.banned_reason || "-"} />
              <UserDetailRow label={t("adminUsers.bannedAt")} value={formatDate(user.banned_at, true)} />
              <UserDetailRow label={t("adminUsers.bannedBy")} value={user.banned_by ? String(user.banned_by) : "-"} mono />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">{t("adminUsers.relationInfo")}</p>
              <UserDetailRow
                label={t("adminUsers.invitedBy")}
                value={user.invited_by ? (
                  <span className="flex items-center gap-1">
                    <CopyableEmail email={user.invited_by.email} truncate={false} className="text-sm text-foreground" />
                    <span className="text-sm text-muted-foreground">#{user.invited_by.id}</span>
                  </span>
                ) : "-"}
              />
              <UserDetailRow label={t("adminUsers.joined")} value={formatDate(user.created_at, true)} />
              <UserDetailRow label={t("adminUsers.updatedAt")} value={formatDate(user.updated_at, true)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose} data-dialog-primary="true">{t("common.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserDetailRow({
  label,
  value,
  mono,
  breakAll,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  breakAll?: boolean;
}) {
  return (
    <div className="flex items-start gap-4">
      <span className="text-muted-foreground min-w-28 shrink-0 text-sm">{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : ""} ${breakAll ? "break-all" : "break-words"}`}>{value}</span>
    </div>
  );
}

export default function AdminUsersPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("adminUsers.pageTitle"));
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  const currentTab = tab && ["users", "groups", "notifications", "brand", "credits", "redeem-codes"].includes(tab)
    ? tab
    : "users";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("adminUsers.pageTitle")}</h1>
        <p className="text-muted-foreground">{t("adminUsers.pageSubtitle")}</p>
      </div>

      <Tabs
        value={currentTab}
        onValueChange={(value) => {
          if (value === "users") {
            setSearchParams({});
          } else {
            setSearchParams({ tab: value });
          }
        }}
      >
        <TabsList variant="line">
          <TabsTrigger value="users">{t("adminUsers.tabUsers")}</TabsTrigger>
          <TabsTrigger value="groups">{t("adminUsers.tabGroups")}</TabsTrigger>
          <TabsTrigger value="notifications">{t("adminUsers.tabNotifications")}</TabsTrigger>
          <TabsTrigger value="brand">{t("adminUsers.tabBrand")}</TabsTrigger>
          <TabsTrigger value="credits">{t("adminUsers.tabCredits")}</TabsTrigger>
          <TabsTrigger value="redeem-codes">{t("adminUsers.tabRedeemCodes")}</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4 space-y-6">
          <UsersContent />
        </TabsContent>
        <TabsContent value="groups" className="mt-4">
          <GroupsContent />
        </TabsContent>
        <TabsContent value="notifications" className="mt-4">
          <NotificationsContent />
        </TabsContent>
        <TabsContent value="brand" className="mt-4">
          <BrandContent />
        </TabsContent>
        <TabsContent value="credits" className="mt-4">
          <CreditsSettingsContent />
        </TabsContent>
        <TabsContent value="redeem-codes" className="mt-4">
          <RedeemCodesContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}
