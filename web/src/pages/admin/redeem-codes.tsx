import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "@/lib/api";
import {
  useAdminBatchRedeemCodes,
  useAdminCreateRedeemCode,
  useAdminDelistRedeemCode,
  useAdminRedeemCodeRedemptions,
  useAdminRedeemCodes,
  useAdminRelistRedeemCode,
} from "@/hooks/use-redeem-codes";
import type { RedeemAudienceType, RedeemCode, RedeemRewardType } from "@/types";

const MAX_CREDIT_AMOUNT = 100000;

function parseCreditInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_CREDIT_AMOUNT) return null;
  if (Math.abs(value * 10 - Math.round(value * 10)) > 1e-9) return null;
  return Math.round(value * 10) / 10;
}

function statusBadges(code: RedeemCode, t: (k: string) => string) {
  const badges: { key: string; label: string; variant: "default" | "secondary" | "destructive" | "outline" }[] = [];
  if (!code.listed) {
    badges.push({ key: "delisted", label: t("adminRedeemCodes.statusDelisted"), variant: "secondary" });
  }
  if (code.is_expired) {
    badges.push({ key: "expired", label: t("adminRedeemCodes.statusExpired"), variant: "outline" });
  }
  if (code.is_exhausted) {
    badges.push({ key: "exhausted", label: t("adminRedeemCodes.statusExhausted"), variant: "destructive" });
  }
  if (code.is_redeemable) {
    badges.push({ key: "active", label: t("adminRedeemCodes.statusActive"), variant: "default" });
  }
  return badges;
}

export function RedeemCodesContent() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [listedFilter, setListedFilter] = useState<"all" | "true" | "false">("all");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = {
    q: debouncedQ || undefined,
    listed: listedFilter === "all" ? undefined : listedFilter === "true",
  };

  const { data, isLoading } = useAdminRedeemCodes(page, 20, filters);
  const createMutation = useAdminCreateRedeemCode();
  const batchMutation = useAdminBatchRedeemCodes();
  const delistMutation = useAdminDelistRedeemCode();
  const relistMutation = useAdminRelistRedeemCode();

  const [createOpen, setCreateOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [recordsCode, setRecordsCode] = useState<RedeemCode | null>(null);
  const [recordsPage, setRecordsPage] = useState(1);

  // Create form state
  const [code, setCode] = useState("");
  const [rewardType, setRewardType] = useState<RedeemRewardType>("credits");
  const [creditAmount, setCreditAmount] = useState("");
  const [targetGroupId, setTargetGroupId] = useState<string>("");
  const [audienceType, setAudienceType] = useState<RedeemAudienceType>("all");
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [debouncedUserSearch, setDebouncedUserSearch] = useState("");
  const [maxPerUser, setMaxPerUser] = useState("");
  const [maxTotal, setMaxTotal] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [batchCount, setBatchCount] = useState("10");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedUserSearch(userSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [userSearch]);

  const { data: usersData } = useQuery({
    queryKey: ["admin-users-search", debouncedUserSearch],
    queryFn: async () => {
      const res = await api.adminListUsers(1, 20, debouncedUserSearch);
      return res.data;
    },
    enabled: audienceType === "users" && (createOpen || batchOpen),
    staleTime: 15_000,
  });

  const { data: groupsData } = useQuery({
    queryKey: ["admin-groups"],
    queryFn: async () => {
      const res = await api.adminListGroups();
      return res.data;
    },
    enabled: createOpen || batchOpen || rewardType === "group",
    staleTime: 30_000,
  });

  const { data: redemptionsData, isLoading: redemptionsLoading } = useAdminRedeemCodeRedemptions(
    recordsCode?.id ?? null,
    recordsPage,
    20
  );

  const resetForm = () => {
    setCode("");
    setRewardType("credits");
    setCreditAmount("");
    setTargetGroupId("");
    setAudienceType("all");
    setSelectedUserIds([]);
    setSelectedGroupIds([]);
    setUserSearch("");
    setMaxPerUser("");
    setMaxTotal("");
    setExpiresAt("");
    setBatchCount("10");
  };

  const audienceIds =
    audienceType === "users" ? selectedUserIds : audienceType === "groups" ? selectedGroupIds : [];

  const buildRewardPayload = () => {
    if (rewardType === "credits") {
      const amount = parseCreditInput(creditAmount);
      if (amount == null) return null;
      return { reward_type: "credits" as const, credit_amount: amount };
    }
    const gid = Number(targetGroupId);
    if (!Number.isInteger(gid) || gid <= 0) return null;
    return { reward_type: "group" as const, target_group_id: gid };
  };

  const parseOptionalInt = (raw: string): number | null | undefined => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1) return undefined;
    return n;
  };

  const canSubmitAudience =
    audienceType === "all" ||
    (audienceType === "users" && selectedUserIds.length > 0) ||
    (audienceType === "groups" && selectedGroupIds.length > 0);

  const handleCreate = async () => {
    const reward = buildRewardPayload();
    if (!reward || !code.trim() || !canSubmitAudience) return;
    const mpu = parseOptionalInt(maxPerUser);
    const mt = parseOptionalInt(maxTotal);
    if (mpu === undefined || mt === undefined) return;

    await createMutation.mutateAsync({
      code: code.trim(),
      ...reward,
      audience_type: audienceType,
      audience_ids: audienceIds,
      max_per_user: mpu,
      max_total: mt,
      expires_at: expiresAt.trim() ? new Date(expiresAt).toISOString() : null,
    });
    setCreateOpen(false);
    resetForm();
  };

  const handleBatch = async () => {
    const reward = buildRewardPayload();
    const count = Number(batchCount);
    if (!reward || !canSubmitAudience || !Number.isInteger(count) || count < 1 || count > 200) return;
    const mpu = parseOptionalInt(maxPerUser);
    if (mpu === undefined) return;

    await batchMutation.mutateAsync({
      count,
      ...reward,
      audience_type: audienceType,
      audience_ids: audienceIds,
      max_per_user: mpu,
      expires_at: expiresAt.trim() ? new Date(expiresAt).toISOString() : null,
    });
    setBatchOpen(false);
    resetForm();
  };

  const audienceForm = (
    <>
      <div className="space-y-2">
        <Label>{t("adminRedeemCodes.audienceType")}</Label>
        <Select
          value={audienceType}
          onValueChange={(v) => {
            setAudienceType(v as RedeemAudienceType);
            setSelectedUserIds([]);
            setSelectedGroupIds([]);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("adminNotifications.target_all")}</SelectItem>
            <SelectItem value="users">{t("adminNotifications.target_users")}</SelectItem>
            <SelectItem value="groups">{t("adminNotifications.target_groups")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {audienceType === "users" && (
        <div className="space-y-2">
          <Label>{t("adminNotifications.selectUsers")}</Label>
          <Input
            placeholder={t("adminUsers.searchPlaceholder")}
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
          <div className="max-h-32 overflow-y-auto border rounded-md">
            {usersData?.map((user) => (
              <label key={user.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selectedUserIds.includes(user.id)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedUserIds((prev) => [...prev, user.id]);
                    else setSelectedUserIds((prev) => prev.filter((id) => id !== user.id));
                  }}
                />
                <span>{user.name}</span>
                <span className="text-muted-foreground text-xs">{user.email}</span>
              </label>
            ))}
          </div>
          {selectedUserIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("adminNotifications.selectedCount", { count: selectedUserIds.length })}
            </p>
          )}
        </div>
      )}

      {audienceType === "groups" && (
        <div className="space-y-2">
          <Label>{t("adminNotifications.selectGroups")}</Label>
          <div className="max-h-32 overflow-y-auto border rounded-md">
            {groupsData?.map((group) => (
              <label key={group.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selectedGroupIds.includes(group.id)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedGroupIds((prev) => [...prev, group.id]);
                    else setSelectedGroupIds((prev) => prev.filter((id) => id !== group.id));
                  }}
                />
                <span>{group.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const rewardForm = (
    <>
      <div className="space-y-2">
        <Label>{t("adminRedeemCodes.rewardType")}</Label>
        <Select value={rewardType} onValueChange={(v) => setRewardType(v as RedeemRewardType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="credits">{t("adminRedeemCodes.rewardCredits")}</SelectItem>
            <SelectItem value="group">{t("adminRedeemCodes.rewardGroup")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {rewardType === "credits" ? (
        <div className="space-y-2">
          <Label>{t("adminRedeemCodes.creditAmount")}</Label>
          <Input value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="10" />
        </div>
      ) : (
        <div className="space-y-2">
          <Label>{t("adminRedeemCodes.targetGroup")}</Label>
          <Select value={targetGroupId} onValueChange={setTargetGroupId}>
            <SelectTrigger>
              <SelectValue placeholder={t("adminRedeemCodes.selectGroup")} />
            </SelectTrigger>
            <SelectContent>
              {groupsData?.map((g) => (
                <SelectItem key={g.id} value={String(g.id)}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );

  const limitsForm = (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>{t("adminRedeemCodes.maxPerUser")}</Label>
          <Input value={maxPerUser} onChange={(e) => setMaxPerUser(e.target.value)} placeholder={t("adminRedeemCodes.unlimited")} />
        </div>
        <div className="space-y-2">
          <Label>{t("adminRedeemCodes.maxTotal")}</Label>
          <Input value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)} placeholder={t("adminRedeemCodes.unlimited")} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>{t("adminRedeemCodes.expiresAt")}</Label>
        <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </div>
    </>
  );

  const items = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          {isLoading ? (
            <Skeleton className="h-4 w-28" />
          ) : (
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("adminRedeemCodes.totalEntries", { count: total })}
            </CardTitle>
          )}
          <div className="flex gap-2">
            <Dialog
              open={batchOpen}
              onOpenChange={(open) => {
                setBatchOpen(open);
                if (!open) resetForm();
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  {t("adminRedeemCodes.batchCreate")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t("adminRedeemCodes.batchCreateTitle")}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("adminRedeemCodes.batchCount")}</Label>
                    <Input value={batchCount} onChange={(e) => setBatchCount(e.target.value)} />
                    <p className="text-xs text-muted-foreground">{t("adminRedeemCodes.batchHint")}</p>
                  </div>
                  {rewardForm}
                  {audienceForm}
                  <div className="space-y-2">
                    <Label>{t("adminRedeemCodes.maxPerUser")}</Label>
                    <Input value={maxPerUser} onChange={(e) => setMaxPerUser(e.target.value)} placeholder="1" />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("adminRedeemCodes.expiresAt")}</Label>
                    <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => { setBatchOpen(false); resetForm(); }}>
                      {t("common.cancel")}
                    </Button>
                    <Button onClick={handleBatch} disabled={batchMutation.isPending || !canSubmitAudience}>
                      {batchMutation.isPending ? t("common.creating") : t("common.create")}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog
              open={createOpen}
              onOpenChange={(open) => {
                setCreateOpen(open);
                if (!open) resetForm();
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm">{t("adminRedeemCodes.create")}</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t("adminRedeemCodes.createTitle")}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("adminRedeemCodes.code")}</Label>
                    <Input
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      className="font-mono tracking-wider"
                      placeholder="TEST10"
                    />
                  </div>
                  {rewardForm}
                  {audienceForm}
                  {limitsForm}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      onClick={handleCreate}
                      disabled={createMutation.isPending || !code.trim() || !canSubmitAudience}
                    >
                      {createMutation.isPending ? t("common.creating") : t("common.create")}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("adminRedeemCodes.searchPlaceholder")}
              className="sm:max-w-xs"
            />
            <Select
              value={listedFilter}
              onValueChange={(v) => {
                setListedFilter(v as "all" | "true" | "false");
                setPage(1);
              }}
            >
              <SelectTrigger className="sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("adminRedeemCodes.filterAll")}</SelectItem>
                <SelectItem value="true">{t("adminRedeemCodes.filterListed")}</SelectItem>
                <SelectItem value="false">{t("adminRedeemCodes.filterDelisted")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t("adminRedeemCodes.empty")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminRedeemCodes.colCode")}</TableHead>
                    <TableHead>{t("adminRedeemCodes.colReward")}</TableHead>
                    <TableHead>{t("adminRedeemCodes.colAudience")}</TableHead>
                    <TableHead>{t("adminRedeemCodes.colUsage")}</TableHead>
                    <TableHead>{t("adminRedeemCodes.colStatus")}</TableHead>
                    <TableHead>{t("adminRedeemCodes.colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.code_display}</TableCell>
                      <TableCell className="text-sm">
                        {item.reward_type === "credits"
                          ? t("adminRedeemCodes.rewardCreditsValue", { amount: item.credit_amount })
                          : t("adminRedeemCodes.rewardGroupValue", {
                              group: item.target_group_name ?? item.target_group_id,
                            })}
                      </TableCell>
                      <TableCell className="text-sm">
                        {t(`adminNotifications.target_${item.audience_type}`)}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {item.redeemed_count}
                        {item.max_total != null ? ` / ${item.max_total}` : ""}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {statusBadges(item, t).map((b) => (
                            <Badge key={b.key} variant={b.variant}>
                              {b.label}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {item.listed ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={delistMutation.isPending}
                              onClick={() => delistMutation.mutate(item.id)}
                            >
                              {t("adminRedeemCodes.delist")}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={relistMutation.isPending}
                              onClick={() => relistMutation.mutate(item.id)}
                            >
                              {t("adminRedeemCodes.relist")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setRecordsCode(item);
                              setRecordsPage(1);
                            }}
                          >
                            {t("adminRedeemCodes.viewRedemptions")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {total > 20 && (
                <div className="flex justify-center gap-2 pt-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    {t("common.previous")}
                  </Button>
                  <span className="flex items-center text-sm text-muted-foreground">
                    {t("common.pageOf", { page, total: totalPages })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={recordsCode != null}
        onOpenChange={(open) => {
          if (!open) setRecordsCode(null);
        }}
      >
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {t("adminRedeemCodes.redemptionsTitle", { code: recordsCode?.code_display ?? "" })}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {redemptionsLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !redemptionsData?.data?.length ? (
              <p className="text-sm text-muted-foreground">{t("adminRedeemCodes.noRedemptions")}</p>
            ) : (
              <>
                {redemptionsData.data.map((row) => (
                  <div key={row.id} className="rounded-md border p-3 text-sm space-y-1">
                    <p className="font-medium">{row.user_email || `#${row.user_id}`}</p>
                    <p className="text-muted-foreground">
                      {row.reward_type === "credits"
                        ? t("adminRedeemCodes.rewardCreditsValue", { amount: row.credit_amount })
                        : t("adminRedeemCodes.redemptionGroup", {
                            changed: row.group_changed
                              ? t("adminRedeemCodes.groupChanged")
                              : t("adminRedeemCodes.groupUnchanged"),
                          })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
                {(redemptionsData.total ?? 0) > 20 && (
                  <div className="flex justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={recordsPage <= 1}
                      onClick={() => setRecordsPage((p) => p - 1)}
                    >
                      {t("common.previous")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={recordsPage >= Math.ceil((redemptionsData.total ?? 0) / 20)}
                      onClick={() => setRecordsPage((p) => p + 1)}
                    >
                      {t("common.next")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
