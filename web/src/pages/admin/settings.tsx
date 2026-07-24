import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, getErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  useDocumentTitle(t("adminSettings.title"));
  const { data: config, isLoading } = useQuery({
    queryKey: ["admin-config"],
    queryFn: async () => {
      const res = await api.adminGetConfig();
      return res.data;
    },
    staleTime: 30_000,
  });

  const [frontendUrls, setFrontendUrls] = useState("");
  const [backendUrls, setBackendUrls] = useState("");
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcClientID, setOidcClientID] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");

  useEffect(() => {
    if (!config) {
      return;
    }

    const values = config.values ?? {};
    const frontendText = values.frontend_urls
      ?? config.url_runtime.frontend_urls?.join("\n")
      ?? values.frontend_url
      ?? config.url_runtime.frontend_url
      ?? "";
    const backendText = values.backend_urls
      ?? config.url_runtime.backend_urls?.join("\n")
      ?? values.backend_url
      ?? config.url_runtime.backend_url
      ?? "";

    setFrontendUrls(frontendText);
    setBackendUrls(backendText);
    setOidcIssuer(config.oidc_runtime?.issuer ?? values.oidc_issuer ?? "");
    setOidcClientID(config.oidc_runtime?.client_id ?? values.oidc_client_id ?? "");
    setOidcClientSecret("");
  }, [config]);

  const updateMutation = useMutation({
    mutationFn: api.adminUpdateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
      toast.success(t("adminSettings.saved"));
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  const confirmUrlMutation = useMutation({
    mutationFn: api.adminConfirmUrlConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
      toast.success(t("adminSettings.urlConfirmed"));
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  const frontendLocked = !!config?.url_runtime?.frontend_env_locked;
  const backendLocked = !!config?.url_runtime?.backend_env_locked;
  const noEditableUrl = frontendLocked && backendLocked;
  const oidcIssuerLocked = !!config?.oidc_runtime?.issuer_env_locked;
  const oidcClientIDLocked = !!config?.oidc_runtime?.client_id_env_locked;
  const oidcClientSecretLocked = !!config?.oidc_runtime?.client_secret_env_locked;
  const noEditableOIDC = oidcIssuerLocked && oidcClientIDLocked && oidcClientSecretLocked;

  const urlSourceLabel = (source?: string) => {
    switch (source) {
      case "env":
        return t("adminSettings.urlSourceEnv");
      case "db":
        return t("adminSettings.urlSourceDb");
      case "auto":
        return t("adminSettings.urlSourceAuto");
      default:
        return t("adminSettings.urlSourceFallback");
    }
  };

  const oidcSourceLabel = (source?: string) => {
    switch (source) {
      case "env":
        return t("adminSettings.urlSourceEnv");
      case "db":
        return t("adminSettings.urlSourceDb");
      default:
        return t("adminSettings.oidcSourceNone");
    }
  };

  const saveUrlConfig = () => {
    const payload: Record<string, string> = {};
    if (!frontendLocked) payload.frontend_urls = frontendUrls.trim();
    if (!backendLocked) payload.backend_urls = backendUrls.trim();
    if (Object.keys(payload).length === 0) return;
    updateMutation.mutate(payload);
  };

  const saveOIDCConfig = () => {
    const payload: Record<string, string> = {};
    if (!oidcIssuerLocked) payload.oidc_issuer = oidcIssuer.trim();
    if (!oidcClientIDLocked) payload.oidc_client_id = oidcClientID.trim();
    if (!oidcClientSecretLocked && oidcClientSecret.trim() !== "") {
      payload.oidc_client_secret = oidcClientSecret.trim();
    }
    if (Object.keys(payload).length === 0) return;
    updateMutation.mutate(payload);
    setOidcClientSecret("");
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-1 h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4">
              <div className="max-w-xs flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-9 w-full" />
              </div>
              <Skeleton className="h-9 w-16" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("adminSettings.oidcTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("adminSettings.oidcDesc")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("adminSettings.oidcIssuer")}</Label>
              <Input
                value={oidcIssuer}
                onChange={(e) => setOidcIssuer(e.target.value)}
                placeholder="https://issuer.example.com"
                disabled={oidcIssuerLocked}
              />
              <p className="text-xs text-muted-foreground">
                {t("adminSettings.currentSource", { source: oidcSourceLabel(config?.oidc_runtime?.issuer_source) })}
              </p>
              {oidcIssuerLocked && (
                <p className="text-xs text-muted-foreground">{t("adminSettings.urlLockedByEnv")}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("adminSettings.oidcClientId")}</Label>
              <Input
                value={oidcClientID}
                onChange={(e) => setOidcClientID(e.target.value)}
                placeholder="client-id"
                disabled={oidcClientIDLocked}
              />
              <p className="text-xs text-muted-foreground">
                {t("adminSettings.currentSource", { source: oidcSourceLabel(config?.oidc_runtime?.client_id_source) })}
              </p>
              {oidcClientIDLocked && (
                <p className="text-xs text-muted-foreground">{t("adminSettings.urlLockedByEnv")}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("adminSettings.oidcClientSecret")}</Label>
            <Input
              type="password"
              value={oidcClientSecret}
              onChange={(e) => setOidcClientSecret(e.target.value)}
              placeholder={t("adminSettings.oidcSecretKeepHint")}
              disabled={oidcClientSecretLocked}
            />
            <p className="text-xs text-muted-foreground">
              {t("adminSettings.currentSource", { source: oidcSourceLabel(config?.oidc_runtime?.client_secret_source) })}
            </p>
            <p className="text-xs text-muted-foreground">
              {config?.oidc_runtime?.client_secret_configured
                ? t("adminSettings.oidcSecretConfigured")
                : t("adminSettings.oidcSecretNotConfigured")}
            </p>
            {!oidcClientSecretLocked && (
              <p className="text-xs text-muted-foreground">{t("adminSettings.oidcSecretKeepHint")}</p>
            )}
            {oidcClientSecretLocked && (
              <p className="text-xs text-muted-foreground">{t("adminSettings.urlLockedByEnv")}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!noEditableOIDC && (
              <Button
                onClick={saveOIDCConfig}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? t("common.saving") : t("adminSettings.saveOidc")}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {config?.oidc_runtime?.configured ? t("adminSettings.oidcConfigured") : t("adminSettings.oidcNotConfigured")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("adminSettings.urlTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("adminSettings.urlDesc")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("adminSettings.frontendUrl")}</Label>
              <Textarea
                value={frontendUrls}
                onChange={(e) => setFrontendUrls(e.target.value)}
                placeholder={"https://example.com\nhttps://mirror.example.com"}
                disabled={frontendLocked}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">{t("adminSettings.urlMultiInputHint")}</p>
              <p className="text-xs text-muted-foreground">
                {t("adminSettings.currentSource", { source: urlSourceLabel(config?.url_runtime.frontend_source) })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("adminSettings.activeUrl", { url: config?.url_runtime.frontend_url ?? "-" })}
              </p>
              {frontendLocked && (
                <p className="text-xs text-muted-foreground">{t("adminSettings.urlLockedByEnv")}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("adminSettings.backendUrl")}</Label>
              <Textarea
                value={backendUrls}
                onChange={(e) => setBackendUrls(e.target.value)}
                placeholder={"https://api.example.com\nhttps://api-b.example.com"}
                disabled={backendLocked}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">{t("adminSettings.urlMultiInputHint")}</p>
              <p className="text-xs text-muted-foreground">
                {t("adminSettings.currentSource", { source: urlSourceLabel(config?.url_runtime.backend_source) })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("adminSettings.activeUrl", { url: config?.url_runtime.backend_url ?? "-" })}
              </p>
              {backendLocked && (
                <p className="text-xs text-muted-foreground">{t("adminSettings.urlLockedByEnv")}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!noEditableUrl && (
              <Button
                onClick={saveUrlConfig}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? t("common.saving") : t("adminSettings.saveUrls")}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => confirmUrlMutation.mutate()}
              disabled={confirmUrlMutation.isPending}
            >
              {confirmUrlMutation.isPending ? t("common.saving") : t("adminSettings.confirmCurrentUrls")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {config?.url_runtime.confirmed ? t("adminSettings.confirmedState") : t("adminSettings.unconfirmedState")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
