import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RedeemCodeBox } from "@/components/credits/redeem-code-box";
import { api, getErrorMessage } from "@/lib/api";
import { useCredits, useDailyCheckinStatus, useTransactions } from "@/hooks/use-credits";
import { useReferrals } from "@/hooks/use-referrals";
import { toast } from "sonner";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Coins, CalendarCheck, CheckCircle2, Copy } from "lucide-react";

export default function CreditsPage() {
  const queryClient = useQueryClient();
  const { data: creditData, isLoading: creditLoading } = useCredits();
  const { data: checkinStatus } = useDailyCheckinStatus();
  const [page, setPage] = useState(1);
  const { data: txnData, isLoading: txnLoading } = useTransactions(page, 10);
  const [refPage, setRefPage] = useState(1);
  const { data: refData, isLoading: refLoading } = useReferrals(refPage, 10);
  const { t } = useTranslation();
  useDocumentTitle(t("credits.title"));

  const claimMutation = useMutation({
    mutationFn: api.claimDailyCheckin,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["daily-checkin-status"] });
      toast.success(t("credits.dailyCheckinSuccess", { amount: res.data.granted }));
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  const txTypeColor: Record<string, string> = {
    grant: "bg-green-500",
    deduct: "bg-red-500",
    refund: "bg-brand",
  };

  const referralEnabled = refData?.referral_enabled ?? false;
  const referralCode = refData?.referral_code ?? "";
  const referralLink = referralCode ? `${window.location.origin}/?ref=${referralCode}` : "";

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast.success(t("common.copied"));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("credits.title")}</h1>
        <p className="text-muted-foreground">{t("credits.subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="px-6 py-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">{t("credits.currentBalance")}</p>
                {creditLoading ? (
                  <Skeleton className="h-14 w-24" />
                ) : (
                  <div className="text-6xl font-bold tabular-nums leading-none">{creditData?.balance ?? 0}</div>
                )}
                <p className="text-sm text-muted-foreground mt-2">{t("credits.creditsAvailable")}</p>
              </div>
              <div className="rounded-xl bg-brand-muted p-3">
                <Coins className="h-6 w-6 text-brand" />
              </div>
            </div>
          </CardContent>
        </Card>

        {checkinStatus?.enabled && (
          <Card className={checkinStatus.claimed_today ? "opacity-75" : ""}>
            <CardContent className="px-6 py-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">{t("credits.dailyCheckinTitle")}</p>
                  <p className="text-lg font-semibold mt-0.5">
                    {checkinStatus.claimed_today
                      ? t("credits.dailyCheckinClaimed")
                      : t("credits.dailyCheckinReward", { amount: checkinStatus.reward })}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">{t("credits.dailyCheckinDesc")}</p>
                  <Button
                    className={`mt-4 ${!checkinStatus.claimed_today ? "bg-brand hover:bg-brand/90 text-brand-foreground" : ""}`}
                    variant={checkinStatus.claimed_today ? "outline" : "default"}
                    onClick={() => claimMutation.mutate()}
                    disabled={checkinStatus.claimed_today || claimMutation.isPending}
                    size="sm"
                  >
                    {checkinStatus.claimed_today ? (
                      <>
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        {t("credits.dailyCheckinClaimed")}
                      </>
                    ) : claimMutation.isPending ? (
                      t("credits.dailyCheckingIn")
                    ) : (
                      <>
                        <CalendarCheck className="mr-1.5 h-3.5 w-3.5" />
                        {t("credits.dailyCheckinNow")}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <RedeemCodeBox />

      {referralEnabled && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">{t("referral.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("referral.subtitle")}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {refLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs truncate font-mono">
                  {referralLink}
                </code>
                <Button variant="outline" size="sm" onClick={copyLink} className="shrink-0 gap-1.5">
                  <Copy className="h-3.5 w-3.5" />
                  {t("referral.copy")}
                </Button>
              </div>
            )}

            {!refLoading && refData && refData.records.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t("referral.records")}</h4>
                <div className="divide-y">
                  {refData.records.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium">{r.invitee_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.invitee_created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        {r.inviter_credits > 0 && (
                          <p className="text-sm font-medium text-green-600 dark:text-green-400">+{r.inviter_credits}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {refData.total > 10 && (
                  <div className="flex justify-center gap-2 pt-2">
                    <Button variant="outline" size="sm" disabled={refPage <= 1} onClick={() => setRefPage((p) => p - 1)}>
                      {t("common.previous")}
                    </Button>
                    <span className="flex items-center text-sm text-muted-foreground">
                      {t("common.pageOf", { page: refPage, total: Math.ceil(refData.total / 10) })}
                    </span>
                    <Button variant="outline" size="sm" disabled={refPage >= Math.ceil(refData.total / 10)} onClick={() => setRefPage((p) => p + 1)}>
                      {t("common.next")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {!refLoading && refData && refData.records.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("referral.noRecords")}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">{t("credits.transactionHistory")}</CardTitle>
        </CardHeader>
        <CardContent>
          {txnLoading ? (
            <div className="divide-y">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-2 w-2 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    <Skeleton className="h-4 w-10 ml-auto" />
                    <Skeleton className="h-3 w-16 ml-auto" />
                  </div>
                </div>
              ))}
            </div>
          ) : !txnData?.data || txnData.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t("credits.noTransactions")}</p>
          ) : (
            <div className="divide-y">
              {txnData.data.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${txTypeColor[tx.type] ?? "bg-muted-foreground"}`} />
                    <div>
                      <p className="font-medium leading-none">{t(tx.description_key, tx.description_params ?? {})}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(tx.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className={`font-medium tabular-nums ${tx.amount > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                      {tx.amount > 0 ? "+" : ""}{tx.amount}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("credits.balance", { balance: tx.balance_after })}</p>
                  </div>
                </div>
              ))}
              {txnData.total > 10 && (
                <div className="flex justify-center gap-2 pt-4">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    {t("common.previous")}
                  </Button>
                  <span className="flex items-center text-sm text-muted-foreground">
                    {t("common.pageOf", { page, total: Math.ceil(txnData.total / 10) })}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= Math.ceil(txnData.total / 10)} onClick={() => setPage((p) => p + 1)}>
                    {t("common.next")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
