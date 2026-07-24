/**
 * Shared react-query hooks over the ApiClient in ./api.ts.
 *
 * Every page in src/pages/ used to hand-roll its own useState + useEffect +
 * setInterval + AbortController fetch loop against api.getX(). Those are all
 * the same shape — this module centralizes them so pages get caching, retry,
 * and background revalidation for free.
 */
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api, ApiResponse, HealthStatus, VCenterConnection } from "./api";

const KEYS = {
  health: ["health"] as const,
  hosts: ["hosts"] as const,
  vms: ["vms"] as const,
  datastores: ["datastores"] as const,
  networks: ["networks"] as const,
  snapshots: ["snapshots"] as const,
  tags: ["tags"] as const,
  vcenters: ["vcenters"] as const,
  vcenterConnections: ["vcenters", "connections"] as const,
  cmdbVMs: (includeDecom: boolean) => ["cmdb", "vms", includeDecom] as const,
  cmdbStats: ["cmdb", "stats"] as const,
  trending: ["trending"] as const,
} as const;

function unwrap<T>(fn: () => Promise<ApiResponse<T>>) {
  return async (): Promise<T> => {
    const r = await fn();
    if (!r.success) throw new Error(r.message || "Request failed");
    return (r.data ?? ([] as unknown as T));
  };
}

// Poll cadence for pages users tend to leave open.
const LIVE_INTERVAL = 60_000;

export function useHealth() {
  return useQuery<HealthStatus>({
    queryKey: KEYS.health,
    queryFn: () => api.getHealth(),
    refetchInterval: LIVE_INTERVAL,
  });
}

export function useHosts() {
  return useQuery({ queryKey: KEYS.hosts, queryFn: unwrap(() => api.getHosts()), refetchInterval: LIVE_INTERVAL });
}

export function useVMs() {
  return useQuery({ queryKey: KEYS.vms, queryFn: unwrap(() => api.getVMs()), refetchInterval: LIVE_INTERVAL });
}

export function useDatastores() {
  return useQuery({ queryKey: KEYS.datastores, queryFn: unwrap(() => api.getDatastores()), refetchInterval: LIVE_INTERVAL });
}

export function useNetworks() {
  return useQuery({ queryKey: KEYS.networks, queryFn: unwrap(() => api.getNetworks()), refetchInterval: LIVE_INTERVAL });
}

export function useSnapshots() {
  return useQuery({ queryKey: KEYS.snapshots, queryFn: unwrap(() => api.getSnapshots()), refetchInterval: LIVE_INTERVAL });
}

export function useTags() {
  return useQuery({ queryKey: KEYS.tags, queryFn: unwrap(() => api.getTags()) });
}

export function useVCenterConnections() {
  return useQuery<VCenterConnection[]>({
    queryKey: KEYS.vcenterConnections,
    queryFn: unwrap<VCenterConnection[]>(() => api.getVCenterConnections()),
  });
}

export function useCMDBVMs(includeDecommissioned = true) {
  return useQuery({
    queryKey: KEYS.cmdbVMs(includeDecommissioned),
    queryFn: unwrap(() => api.getCMDBVMs(includeDecommissioned)),
  });
}

export function useCMDBStats() {
  return useQuery({ queryKey: KEYS.cmdbStats, queryFn: unwrap(() => api.getCMDBStats()) });
}

/**
 * Fire a manual refresh, then invalidate every live-data query so pages
 * revalidate against the freshly refreshed cache.
 */
export function useRefreshAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.refreshData(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.hosts });
      qc.invalidateQueries({ queryKey: KEYS.vms });
      qc.invalidateQueries({ queryKey: KEYS.datastores });
      qc.invalidateQueries({ queryKey: KEYS.networks });
      qc.invalidateQueries({ queryKey: KEYS.snapshots });
      qc.invalidateQueries({ queryKey: KEYS.tags });
      qc.invalidateQueries({ queryKey: KEYS.vcenterConnections });
      qc.invalidateQueries({ queryKey: KEYS.health });
    },
  });
}

export { KEYS as QUERY_KEYS };
