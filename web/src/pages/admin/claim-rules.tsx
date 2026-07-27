import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ClaimRulesTab } from "./claim-rules-tab";
import type { Domain } from "@/types";

export default function AdminClaimRulesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("claimRule.pageTitle"));

  const { data: domains = [] } = useQuery({
    queryKey: ["admin-domains-for-scope"],
    queryFn: async () => {
      const res = await api.adminListDomainsFull();
      return (res.data as Domain[]) ?? [];
    },
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("claimRule.pageTitle")}</h2>
        <p className="text-muted-foreground mt-1">{t("claimRule.pageDesc")}</p>
      </div>

      <ClaimRulesTab domains={domains} />
    </div>
  );
}
