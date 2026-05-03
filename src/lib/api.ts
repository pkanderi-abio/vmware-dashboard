/**
 * API Client for VMware Dashboard
 * Handles all communication with the backend
 */

import { getApiBase } from '@/config/api';

export interface HealthStatus {
  status: string;
  vcenters_connected: number;
  vcenters_list: string[];
  cache_age_seconds?: number;
  cache?: any;
  pyvmomi_available?: boolean;
  refresh_in_progress?: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  count?: number;
}

export interface VCenterConnection {
  id: string;
  hostname: string;
  username: string;
  password?: string;
  port: number;
  enabled: boolean;
  status?: 'connected' | 'disconnected' | 'error' | 'testing';
  lastConnected?: string;
  error?: string;
  hasPassword?: boolean;
  vmCount?: string;
  hostCount?: string;
  name?: string;
}

class ApiClient {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${getApiBase()}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {}),
        },
        ...options,
      });

      if (!response.ok) {
        let body = '';
        try {
          body = await response.text();
        } catch {
          body = '';
        }
        throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
      }

      const payload = await response.json();

      // If backend already returns ApiResponse shape, return as-is.
      if (payload && typeof payload.success === 'boolean') {
        return payload as ApiResponse<T>;
      }

      // Fallback shape.
      return { success: true, data: payload as T };
    } catch (error) {
      console.error(`API Error (${endpoint}):`, error);
      return { success: false, message: String(error) };
    }
  }

  // ============================================
  // Health Check
  // ============================================
  async getHealth(): Promise<HealthStatus> {
    try {
      const response = await fetch(`${getApiBase()}/health`);
      return await response.json();
    } catch {
      return {
        status: 'error',
        vcenters_connected: 0,
        vcenters_list: [],
        cache_age_seconds: 0,
      };
    }
  }

  // ============================================
  // Core Data Endpoints
  // ============================================

  async getHosts(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/hosts');
  }

  async getHost(hostId: string): Promise<ApiResponse<any>> {
    return this.request<any>(`/host/${encodeURIComponent(hostId)}`);
  }

  async getVMs(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/vms');
  }

  async getVM(vmId: string): Promise<ApiResponse<any>> {
    return this.request<any>(`/vm/${encodeURIComponent(vmId)}`);
  }

  async getDatastores(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/datastores');
  }

  async getDatastore(dsId: string): Promise<ApiResponse<any>> {
    return this.request<any>(`/datastore/${encodeURIComponent(dsId)}`);
  }

  async getNetworks(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/networks');
  }

  async getNetwork(netId: string): Promise<ApiResponse<any>> {
    return this.request<any>(`/network/${encodeURIComponent(netId)}`);
  }

  async getSnapshots(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/snapshots');
  }

  async getTags(): Promise<ApiResponse<{ tags: any[]; vm_tags: Record<string, string[]>; tag_names: string[] }>> {
    return this.request('/tags');
  }

  // ============================================
  // vCenter Management
  // ============================================

  async getVCenters(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/vcenters');
  }

  // Settings page source:
  // 1) Prefer /api/vcenters/connections
  // 2) Fallback to /api/vcenters with transform
  async getVCenterConnections(): Promise<ApiResponse<VCenterConnection[]>> {
    const primary = await this.request<VCenterConnection[]>('/vcenters/connections');
    if (primary.success && Array.isArray(primary.data)) {
      return {
        success: true,
        data: primary.data.map((vc: any) => ({
          id: vc.id || `vc-${vc.hostname || vc.name || 'unknown'}`,
          hostname: vc.hostname || vc.name || '',
          name: vc.name || vc.hostname || '',
          username: vc.username || '',
          port: Number(vc.port ?? 443),
          enabled: Boolean(vc.enabled ?? true),
          status: (vc.status || 'disconnected') as VCenterConnection['status'],
          hasPassword: Boolean(vc.hasPassword ?? true),
          vmCount: String(vc.vmCount ?? '0'),
          hostCount: String(vc.hostCount ?? '0'),
          lastConnected: vc.lastConnected || '',
          error: vc.error || '',
        })),
        count: primary.data.length,
      };
    }

    // Fallback
    const fallback = await this.request<any[]>('/vcenters');
    if (fallback.success && Array.isArray(fallback.data)) {
      const connections: VCenterConnection[] = fallback.data.map((vc: any, index: number) => ({
        id: `vc-${index}-${vc.hostname || vc.name || 'unknown'}`,
        hostname: vc.hostname || vc.name || '',
        name: vc.name || vc.hostname || '',
        username: '',
        port: 443,
        enabled: true,
        status:
          vc.status?.Value === 'Connected'
            ? 'connected'
            : vc.status?.Value === 'Error'
            ? 'error'
            : 'disconnected',
        hasPassword: true,
        vmCount: String(vc.vmCount ?? '0'),
        hostCount: String(vc.hostCount ?? '0'),
      }));
      return { success: true, data: connections, count: connections.length };
    }

    return { success: false, data: [], message: primary.message || fallback.message || 'Failed to load vCenter connections' };
  }

  async connectVCenter(hostname: string, username: string, password: string): Promise<ApiResponse<any>> {
    return this.request<any>('/vcenter/connect', {
      method: 'POST',
      body: JSON.stringify({ hostname, username, password }),
    });
  }

  async disconnectVCenter(hostname: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/vcenter/disconnect/${encodeURIComponent(hostname)}`, {
      method: 'POST',
    });
  }

  async testVCenterConnection(hostname: string, username: string, password: string): Promise<ApiResponse<any>> {
    return this.request<any>('/vcenters/test', {
      method: 'POST',
      body: JSON.stringify({ hostname, username, password }),
    });
  }

  async deleteVCenterConnection(hostname: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/vcenters/connections/${encodeURIComponent(hostname)}`, {
      method: 'DELETE',
    });
  }

  async toggleVCenterConnection(hostname: string): Promise<ApiResponse<any>> {
    return this.request<any>(`/vcenters/connections/${encodeURIComponent(hostname)}/toggle`, {
      method: 'PUT',
    });
  }

  async reconnectVCenter(hostname: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/vcenters/connections/${encodeURIComponent(hostname)}/reconnect`, {
      method: 'POST',
    });
  }

  // ============================================
  // Cache Management
  // ============================================

  async refreshData(): Promise<ApiResponse<void>> {
    return this.request<void>('/cache/refresh', { method: 'POST' });
  }

  async clearCache(): Promise<ApiResponse<void>> {
    return this.request<void>('/cache/clear', { method: 'POST' });
  }

  async getCacheStatus(): Promise<ApiResponse<any>> {
    return this.request<any>('/cache/status');
  }

  // ============================================
  // CMDB Endpoints
  // ============================================

  async getCMDBVMs(includeDecommissioned: boolean = true): Promise<ApiResponse<any[]>> {
    return this.request<any[]>(
      `/cmdb/vms?include_decommissioned=${encodeURIComponent(String(includeDecommissioned))}`
    );
  }

  async getCMDBActive(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/cmdb/active');
  }

  async getCMDBDecommissioned(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/cmdb/decommissioned');
  }

  async getCMDBStats(): Promise<ApiResponse<any>> {
    return this.request<any>('/cmdb/stats');
  }

  async searchCMDB(query: string, includeDecommissioned: boolean = true): Promise<ApiResponse<any[]>> {
    return this.request<any[]>(
      `/cmdb/search?q=${encodeURIComponent(query)}&include_decommissioned=${encodeURIComponent(
        String(includeDecommissioned)
      )}`
    );
  }

  async exportCMDB(): Promise<any> {
    try {
      const response = await fetch(`${getApiBase()}/cmdb/export`);
      return await response.json();
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  // Supports both route variants:
  // - /api/cmdb/vm-history/{vmKey} (preferred)
  // - /api/cmdb/vm/{vmKey} (legacy)
  async getCMDBVMHistory(vmKey: string): Promise<ApiResponse<any>> {
    const encoded = encodeURIComponent(vmKey);
    const preferred = await this.request<any>(`/cmdb/vm-history/${encoded}`);
    if (preferred.success) return preferred;
    return this.request<any>(`/cmdb/vm/${encoded}`);
  }
}

export const api = new ApiClient();