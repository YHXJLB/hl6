import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SubdomainClaimRule } from "@/types";

export function useClaimRules() {
  return useQuery({
    queryKey: ["admin-claim-rules"],
    queryFn: () => api.adminListClaimRules().then((r) => r.data),
  });
}

export function useCreateClaimRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.adminCreateClaimRule(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-claim-rules"] });
    },
  });
}

export function useUpdateClaimRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      api.adminUpdateClaimRule(id, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-claim-rules"] });
    },
  });
}

export function useDeleteClaimRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.adminDeleteClaimRule(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-claim-rules"] });
    },
  });
}

export function useToggleClaimRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.adminToggleClaimRule(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-claim-rules"] });
    },
  });
}

export function useTestClaimRule() {
  return useMutation({
    mutationFn: (params: { subdomain_name: string; domain_id: number; domain_name: string; rule?: SubdomainClaimRule; rule_id?: number }) =>
      api.adminTestClaimRule(params).then((r) => r.data),
  });
}
