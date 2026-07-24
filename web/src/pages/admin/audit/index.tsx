import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditSummaryBar } from "./audit-summary-bar";
import { SubdomainsTab } from "./subdomains-tab";
import { RulesTab } from "./rules-tab";
import { HistoryTab } from "./history-tab";

const TABS = ["domains", "rules", "history"] as const;
type AuditTab = (typeof TABS)[number];

function parseTab(raw: string | null): AuditTab {
  if (raw === "violations" || raw === "sites") return "domains";
  if (raw && TABS.includes(raw as AuditTab)) return raw as AuditTab;
  return "domains";
}

export default function AdminAuditPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("audit.title"));
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = parseTab(searchParams.get("tab"));

  return (
    <div className="space-y-6">
      <AuditSummaryBar />

      <Tabs
        value={currentTab}
        onValueChange={(value) => setSearchParams({ tab: value })}
      >
        <TabsList variant="line">
          <TabsTrigger value="domains">{t("audit.tabs.domains")}</TabsTrigger>
          <TabsTrigger value="rules">{t("audit.tabs.rules")}</TabsTrigger>
          <TabsTrigger value="history">{t("audit.tabs.history")}</TabsTrigger>
        </TabsList>

        <TabsContent value="domains" className="mt-4 space-y-4">
          <SubdomainsTab />
        </TabsContent>
        <TabsContent value="rules" className="mt-4 space-y-4">
          <RulesTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4 space-y-4">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
