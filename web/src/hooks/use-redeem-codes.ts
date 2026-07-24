import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api, getErrorMessage } from "@/lib/api";
import type { BatchRedeemCodePayload, CreateRedeemCodePayload, RedeemCodeResult } from "@/types";

export function formatRedeemSuccessMessage(data: RedeemCodeResult, t: TFunction): string {
  if (data.reward_type === "credits") {
    return t("credits.redeemSuccessCredits", { amount: data.credit_amount });
  }
  return data.group_changed
    ? t("credits.redeemSuccessGroup", { group: data.target_group_name })
    : t("credits.redeemSuccessGroupUnchanged", { group: data.target_group_name });
}

export function useRedeemCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => api.redeemCode(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useAdminRedeemCodes(
  page: number,
  perPage = 20,
  filters: { listed?: boolean; batch_id?: string; q?: string } = {}
) {
  return useQuery({
    queryKey: ["admin-redeem-codes", page, perPage, filters],
    queryFn: async () => {
      const res = await api.adminListRedeemCodes(page, perPage, filters);
      return res;
    },
    staleTime: 15_000,
  });
}

export function useAdminCreateRedeemCode() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (data: CreateRedeemCodePayload) => api.adminCreateRedeemCode(data),
    onSuccess: () => {
      toast.success(t("adminRedeemCodes.created"));
      queryClient.invalidateQueries({ queryKey: ["admin-redeem-codes"] });
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });
}

export function useAdminBatchRedeemCodes() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (data: BatchRedeemCodePayload) => api.adminBatchRedeemCodes(data),
    onSuccess: (res) => {
      toast.success(t("adminRedeemCodes.batchCreated", { count: res.data.items.length }));
      queryClient.invalidateQueries({ queryKey: ["admin-redeem-codes"] });
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });
}

export function useAdminDelistRedeemCode() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (id: number) => api.adminDelistRedeemCode(id),
    onSuccess: () => {
      toast.success(t("adminRedeemCodes.delisted"));
      queryClient.invalidateQueries({ queryKey: ["admin-redeem-codes"] });
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });
}

export function useAdminRelistRedeemCode() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (id: number) => api.adminRelistRedeemCode(id),
    onSuccess: () => {
      toast.success(t("adminRedeemCodes.relisted"));
      queryClient.invalidateQueries({ queryKey: ["admin-redeem-codes"] });
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });
}

export function useAdminRedeemCodeRedemptions(codeId: number | null, page = 1, perPage = 20) {
  return useQuery({
    queryKey: ["admin-redeem-code-redemptions", codeId, page, perPage],
    queryFn: async () => {
      const res = await api.adminListRedeemCodeRedemptions(codeId!, page, perPage);
      return res;
    },
    enabled: codeId != null,
    staleTime: 15_000,
  });
}
