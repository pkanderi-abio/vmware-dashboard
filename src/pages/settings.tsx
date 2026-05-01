/**
 * Settings Page - vCenter Connection Management
 * Features: Add, Reconnect, Disconnect, Remove cached connections
 *           Dark/Light theme toggle, API base URL config, Backend health status
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Settings,
  Server,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  X,
  Database,
  Shield,
  Loader2,
  Lock,
  User,
  Globe,
  Info,
  Monitor,
  HardDrive,
  PlugZap,
  Unplug,
  Sun,
  Moon,
  Activity,
  Wifi,
  WifiOff,
  Link,
  Cpu,
  MemoryStick,
  Camera,
  Network,
  Palette,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { getApiOrigin, setApiOrigin, getApiBase } from '@/config/api';

interface VCenterConnection {
  id: string;
  hostname: string;
  name?: string;
  username?: string;
  port?: number;
  enabled?: boolean;
  status?: 'connected' | 'disconnected' | 'error' | 'testing';
  vmCount?: string;
  hostCount?: string;
  hasCredentials?: boolean;
}

interface ConnectionFormData {
  hostname: string;
  username: string;
  password: string;
}

const DEFAULT_FORM_DATA: ConnectionFormData = {
  hostname: '',
  username: '',
  password: '',
};

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const [connections, setConnections] = useState<VCenterConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // API Config state
  const [apiOriginInput, setApiOriginInput] = useState(() => getApiOrigin());
  const [apiTesting, setApiTesting] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Backend health state
  const [fullHealth, setFullHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'reconnect'>('add');
  const [editingConnection, setEditingConnection] = useState<VCenterConnection | null>(null);
  const [formData, setFormData] = useState<ConnectionFormData>(DEFAULT_FORM_DATA);
  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Toast/notification
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Health status
  const [healthStatus, setHealthStatus] = useState<any>(null);

  const normalizeHost = (s: unknown) => String(s || '').trim().toLowerCase();

  const connectedSet = useMemo(() => {
    const list = (healthStatus?.vcenters_list || []) as string[];
    return new Set(list.map((h) => normalizeHost(h)));
  }, [healthStatus]);

  useEffect(() => {
    void loadConnections();
    void loadFullHealth();
  }, []);

  const loadFullHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/health`);
      const data = await res.json();
      setFullHealth(data);
    } catch {
      setFullHealth(null);
    }
    setHealthLoading(false);
  };

  const handleTestApi = async () => {
    setApiTesting(true);
    setApiTestResult(null);
    const origin = apiOriginInput.trim().replace(/\/+$/, '');
    const testUrl = `${origin}/api/health`;
    try {
      const res = await fetch(testUrl);
      if (res.ok) {
        const data = await res.json();
        setApiTestResult({ ok: true, msg: `Connected — ${data.vcenters_connected ?? '?'} vCenter(s) online` });
      } else {
        setApiTestResult({ ok: false, msg: `HTTP ${res.status} ${res.statusText}` });
      }
    } catch (err: any) {
      setApiTestResult({ ok: false, msg: err?.message || 'Connection failed' });
    }
    setApiTesting(false);
  };

  const handleSaveApiOrigin = () => {
    setApiOrigin(apiOriginInput);
    showNotificationMessage('success', 'API URL saved — reloading page to apply…');
    setTimeout(() => window.location.reload(), 1200);
  };

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timer);
  }, [notification]);

  const showNotificationMessage = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
  };

  const loadConnections = async () => {
    setLoading(true);
    try {
      const [res, health] = await Promise.all([api.getVCenterConnections(), api.getHealth()]);
      setHealthStatus(health);

      if (res.success && Array.isArray(res.data)) {
        const mapped = res.data.map((vc: any, index: number) => {
          const hostRaw = vc.hostname || vc.name || '';
          return {
            id: vc.id || `vc-${index}-${normalizeHost(hostRaw)}`,
            hostname: hostRaw,
            name: vc.name || hostRaw,
            username: vc.username || '',
            port: Number(vc.port ?? 443),
            enabled: Boolean(vc.enabled ?? true),
            status: (vc.status || 'disconnected') as VCenterConnection['status'],
            vmCount: String(vc.vmCount ?? '0'),
            hostCount: String(vc.hostCount ?? '0'),
            hasCredentials: Boolean(vc.hasPassword ?? vc.hasCredentials),
          } satisfies VCenterConnection;
        });
        setConnections(mapped);
      } else {
        setConnections([]);
      }
    } catch (err) {
      console.error('Failed to load connections:', err);
      showNotificationMessage('error', 'Failed to load vCenter connections');
      setConnections([]);
    } finally {
      setLoading(false);
    }
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.hostname.trim()) {
      errors.hostname = 'Hostname is required';
    } else if (!/^[a-zA-Z0-9.-]+$/.test(formData.hostname.trim())) {
      errors.hostname = 'Invalid hostname format';
    }

    if (!formData.username.trim()) {
      errors.username = 'Username is required';
    }

    if (!formData.password.trim()) {
      errors.password = 'Password is required';
    }

    // Duplicate check for add only
    if (modalMode === 'add') {
      const target = normalizeHost(formData.hostname);
      const isDuplicate = connections.some((c) => normalizeHost(c.hostname) === target);
      if (isDuplicate) {
        errors.hostname = 'This vCenter already exists. Use "Reconnect" to update credentials.';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleOpenAddModal = () => {
    setModalMode('add');
    setEditingConnection(null);
    setFormData(DEFAULT_FORM_DATA);
    setFormErrors({});
    setShowPassword(false);
    setShowModal(true);
  };

  const handleOpenReconnectModal = (connection: VCenterConnection) => {
    setModalMode('reconnect');
    setEditingConnection(connection);
    setFormData({
      hostname: connection.hostname,
      username: connection.username || '',
      password: '',
    });
    setFormErrors({});
    setShowPassword(false);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingConnection(null);
    setFormData(DEFAULT_FORM_DATA);
    setFormErrors({});
    setShowPassword(false);
  };

  const handleSaveConnection = async () => {
    if (!validateForm()) return;

    setSaving(true);
    try {
      const hostname = formData.hostname.trim();
      const username = formData.username.trim();
      const password = formData.password;

      const res = await api.connectVCenter(hostname, username, password);
      if (res.success) {
        showNotificationMessage('success', `Successfully connected to ${hostname}`);
        handleCloseModal();
        await loadConnections();
      } else {
        showNotificationMessage('error', res.message || `Failed to connect to ${hostname}`);
      }
    } catch (err: any) {
      showNotificationMessage('error', err?.message || 'Failed to connect');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (hostname: string) => {
    setSaving(true);
    try {
      const res = await api.disconnectVCenter(hostname);
      if (res.success) {
        showNotificationMessage('success', `Disconnected from ${hostname}`);
        setDeleteConfirm(null);
        await loadConnections();
      } else {
        showNotificationMessage('error', res.message || `Failed to disconnect from ${hostname}`);
      }
    } catch (err: any) {
      showNotificationMessage('error', err?.message || 'Failed to disconnect');
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshData = async () => {
    setSaving(true);
    try {
      const res = await api.refreshData();
      if (res.success) {
        showNotificationMessage('success', 'Data refresh started. This may take a few minutes.');
      } else {
        showNotificationMessage('error', res.message || 'Failed to start refresh');
      }
    } catch {
      showNotificationMessage('error', 'Failed to trigger refresh');
    } finally {
      setSaving(false);
    }
  };

  const handleClearCache = async () => {
    setSaving(true);
    try {
      const res = await api.clearCache();
      if (res.success) {
        showNotificationMessage('success', 'Cache cleared. Data will be refreshed.');
        await loadConnections();
      } else {
        showNotificationMessage('error', res.message || 'Failed to clear cache');
      }
    } catch {
      showNotificationMessage('error', 'Failed to clear cache');
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (isConnected: boolean) => {
    if (isConnected) {
      return (
        <Badge className="bg-success/20 text-success border-success/30">
          <CheckCircle className="w-3 h-3 mr-1" /> Connected
        </Badge>
      );
    }

    return (
      <Badge className="bg-warning/20 text-warning border-warning/30">
        <AlertTriangle className="w-3 h-3 mr-1" /> Needs Reconnection
      </Badge>
    );
  };

  const totalVMs = connections.reduce((sum, c) => sum + parseInt(c.vmCount || '0', 10), 0);
  const totalHosts = connections.reduce((sum, c) => sum + parseInt(c.hostCount || '0', 10), 0);
  const connectedCount = healthStatus?.vcenters_connected || 0;
  const cachedCount = connections.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-lg">Loading Settings...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Notification Toast */}
      {notification && (
        <div
          className={cn(
            'fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center gap-3 animate-in slide-in-from-top-2 max-w-md',
            notification.type === 'success'
              ? 'bg-success text-success-foreground'
              : 'bg-destructive text-destructive-foreground'
          )}
        >
          {notification.type === 'success' ? (
            <CheckCircle className="w-5 h-5 shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 shrink-0" />
          )}
          <span className="text-sm">{notification.message}</span>
          <Button variant="ghost" size="sm" className="ml-2 h-6 w-6 p-0 shrink-0" onClick={() => setNotification(null)}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground">
            <Settings className="w-6 h-6 text-primary" />
            Settings
          </h1>
          <p className="text-muted-foreground text-sm">Manage vCenter connections and application settings</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={handleClearCache} variant="outline" size="sm" disabled={saving}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Cache
          </Button>
          <Button onClick={handleRefreshData} variant="outline" size="sm" disabled={saving || connectedCount === 0}>
            <RefreshCw className={cn('w-4 h-4 mr-2', saving && 'animate-spin')} />
            Refresh Data
          </Button>
          <Button onClick={() => void loadConnections()} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            Reload
          </Button>
          <Button onClick={handleOpenAddModal} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Add vCenter
          </Button>
        </div>
      </div>

      {/* Connection Status Alert */}
      {cachedCount > 0 && connectedCount === 0 && (
        <Card className="border-2 border-warning/50 bg-warning/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <AlertTriangle className="w-8 h-8 text-warning shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">vCenters Need Reconnection</h3>
                <p className="text-sm text-muted-foreground">
                  {cachedCount} vCenter(s) found in saved connections but none are currently connected.
                  Click <strong>Reconnect</strong> on each vCenter below.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/20">
                <Server className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-bold">{cachedCount}</div>
                <div className="text-xs text-muted-foreground">vCenters (Saved)</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={cn('p-2 rounded-lg', connectedCount > 0 ? 'bg-success/20' : 'bg-warning/20')}>
                {connectedCount > 0 ? (
                  <CheckCircle className="w-5 h-5 text-success" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-warning" />
                )}
              </div>
              <div>
                <div className={cn('text-2xl font-bold', connectedCount > 0 ? 'text-success' : 'text-warning')}>
                  {connectedCount}
                </div>
                <div className="text-xs text-muted-foreground">Connected</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-2/20">
                <Monitor className="w-5 h-5 text-chart-2" />
              </div>
              <div>
                <div className="text-2xl font-bold">{totalVMs.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total VMs (Cached)</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/20">
                <HardDrive className="w-5 h-5 text-accent-foreground" />
              </div>
              <div>
                <div className="text-2xl font-bold">{totalHosts.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total Hosts (Cached)</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* vCenter Connections Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            vCenter Connections
          </CardTitle>
          <CardDescription>
            Manage your vCenter Server connections. Click <strong>Reconnect</strong> to provide credentials for disconnected vCenters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <div className="text-center py-12">
              <Database className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No vCenter Connections</h3>
              <p className="text-muted-foreground mb-4">Add your first vCenter connection to start collecting infrastructure data.</p>
              <Button onClick={handleOpenAddModal}>
                <Plus className="w-4 h-4 mr-2" />
                Add vCenter Connection
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {connections.map((connection) => {
                const isConnected =
                  connectedSet.has(normalizeHost(connection.hostname)) || connection.status === 'connected';

                return (
                  <div
                    key={connection.id}
                    className={cn(
                      'p-4 border rounded-lg transition-colors',
                      isConnected ? 'border-success/50 bg-success/5' : 'border-warning/50 bg-warning/5'
                    )}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Connection Info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <Server className={cn('w-5 h-5', isConnected ? 'text-success' : 'text-warning')} />
                          <h3 className="font-semibold text-lg text-foreground">{connection.hostname}</h3>
                          {getStatusBadge(isConnected)}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Monitor className="w-4 h-4" />
                            <span>{connection.vmCount || '0'} VMs</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <HardDrive className="w-4 h-4" />
                            <span>{connection.hostCount || '0'} Hosts</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Globe className="w-4 h-4" />
                            <span>Port: {connection.port || 443}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            {isConnected ? (
                              <>
                                <Shield className="w-4 h-4 text-success" />
                                <span className="text-success">Credentials Active</span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="w-4 h-4 text-warning" />
                                <span className="text-warning">Needs Credentials</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {isConnected ? (
                          <>
                            {deleteConfirm === connection.hostname ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => void handleDisconnect(connection.hostname)}
                                  disabled={saving}
                                >
                                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Disconnect'}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-warning hover:text-warning hover:bg-warning/10"
                                onClick={() => setDeleteConfirm(connection.hostname)}
                                title="Disconnect from vCenter"
                              >
                                <Unplug className="w-4 h-4 mr-2" />
                                Disconnect
                              </Button>
                            )}
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleOpenReconnectModal(connection)}
                              className="bg-primary hover:bg-primary/90"
                            >
                              <PlugZap className="w-4 h-4 mr-2" />
                              Reconnect
                            </Button>

                            {deleteConfirm === connection.hostname ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => void handleDisconnect(connection.hostname)}
                                  disabled={saving}
                                >
                                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Remove'}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteConfirm(connection.hostname)}
                                title="Remove from list"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk Reconnect Helper */}
      {cachedCount > 0 && connectedCount < cachedCount && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlugZap className="w-5 h-5 text-primary" />
              Quick Reconnect
            </CardTitle>
            <CardDescription>
              {cachedCount - connectedCount} vCenter(s) need reconnection.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {connections
                .filter((c) => !connectedSet.has(normalizeHost(c.hostname)))
                .map((c) => (
                  <Button
                    key={c.id}
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenReconnectModal(c)}
                    className="text-warning border-warning/50 hover:bg-warning/10"
                  >
                    <PlugZap className="w-4 h-4 mr-2" />
                    {c.hostname.split('.')[0]}
                  </Button>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="w-5 h-5 text-primary" />
            Connection Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-2">Requirements</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• vCenter Server 6.5 or later</li>
                <li>• User account with read permissions</li>
                <li>• Network access to vCenter on port 443</li>
                <li>• Valid SSL certificate (or allow insecure connections)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Recommended Permissions</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Read-only role on root folder</li>
                <li>• Propagate to children enabled</li>
                <li>• System.View privilege</li>
                <li>• Global.Licenses privilege (optional)</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── APPEARANCE ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            Appearance
          </CardTitle>
          <CardDescription>Choose between light and dark interface theme.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className={cn(
                'flex items-center gap-3 px-5 py-3 rounded-xl border-2 transition-all font-medium text-sm',
                theme === 'light'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-muted/50 text-muted-foreground hover:border-primary/50'
              )}
            >
              <Sun className="w-5 h-5" /> Light Mode
            </button>
            <button
              onClick={toggleTheme}
              className={cn(
                'flex items-center gap-3 px-5 py-3 rounded-xl border-2 transition-all font-medium text-sm',
                theme === 'dark'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-muted/50 text-muted-foreground hover:border-primary/50'
              )}
            >
              <Moon className="w-5 h-5" /> Dark Mode
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Preference is saved in your browser and persists across sessions.
          </p>
        </CardContent>
      </Card>

      {/* ── BACKEND HEALTH STATUS ───────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Backend Health Status
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => void loadFullHealth()} disabled={healthLoading}>
              <RefreshCw className={cn('w-4 h-4 mr-2', healthLoading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
          <CardDescription>Live status of the API service and data cache.</CardDescription>
        </CardHeader>
        <CardContent>
          {healthLoading && !fullHealth ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading health data…
            </div>
          ) : fullHealth ? (
            <div className="space-y-4">
              {/* Overall status */}
              <div className="flex items-center gap-3">
                {fullHealth.status === 'ok' ? (
                  <Badge className="bg-success/20 text-success border-success/30 text-sm px-3 py-1">
                    <CheckCircle className="w-4 h-4 mr-1" /> API Online
                  </Badge>
                ) : (
                  <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-sm px-3 py-1">
                    <XCircle className="w-4 h-4 mr-1" /> API Error
                  </Badge>
                )}
                {fullHealth.refresh_in_progress && (
                  <Badge className="bg-warning/20 text-warning border-warning/30 text-sm px-3 py-1">
                    <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Refreshing
                  </Badge>
                )}
                <Badge className={cn(
                  'text-sm px-3 py-1',
                  (fullHealth.vcenters_connected ?? 0) > 0
                    ? 'bg-success/20 text-success border-success/30'
                    : 'bg-warning/20 text-warning border-warning/30'
                )}>
                  {(fullHealth.vcenters_connected ?? 0) > 0 ? (
                    <><Wifi className="w-3 h-3 mr-1" /> {fullHealth.vcenters_connected} vCenter(s)</>
                  ) : (
                    <><WifiOff className="w-3 h-3 mr-1" /> No vCenters</>
                  )}
                </Badge>
              </div>

              {/* Cache age grid */}
              {fullHealth.cache_status && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {(['vms', 'hosts', 'datastores', 'networks', 'snapshots'] as const).map((key) => {
                    const entry = fullHealth.cache_status?.[key];
                    const age = entry?.age_seconds ?? null;
                    const Icon = { vms: Monitor, hosts: Cpu, datastores: HardDrive, networks: Network, snapshots: Camera }[key];
                    const label = { vms: 'VMs', hosts: 'Hosts', datastores: 'Datastores', networks: 'Networks', snapshots: 'Snapshots' }[key];
                    return (
                      <div key={key} className="p-3 rounded-lg border bg-muted/30">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium">{label}</span>
                        </div>
                        <div className={cn(
                          'text-xs',
                          age === null ? 'text-muted-foreground' :
                          age < 300 ? 'text-success' :
                          age < 1800 ? 'text-warning' : 'text-destructive'
                        )}>
                          {age === null ? '—' :
                           age < 60 ? 'Fresh' :
                           age < 3600 ? `${Math.floor(age / 60)}m ago` :
                           `${Math.floor(age / 3600)}h ago`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* vCenter list */}
              {(fullHealth.vcenters_list?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Connected vCenters</p>
                  <div className="flex flex-wrap gap-2">
                    {fullHealth.vcenters_list.map((vc: string) => (
                      <Badge key={vc} variant="outline" className="text-xs bg-success/5 border-success/30 text-success">
                        <Wifi className="w-2.5 h-2.5 mr-1" />
                        {vc.split('.')[0]}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-destructive py-4">
              <XCircle className="w-5 h-5" /> Could not reach the backend API.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── API CONFIGURATION ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link className="w-5 h-5 text-primary" />
            API Configuration
          </CardTitle>
          <CardDescription>
            Override the backend API URL. Leave blank to use the built-in proxy (default).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-10 font-mono text-sm"
                placeholder="http://your-api-host:8000  (blank = use proxy)"
                value={apiOriginInput}
                onChange={(e) => { setApiOriginInput(e.target.value); setApiTestResult(null); }}
              />
            </div>
            <Button variant="outline" onClick={handleTestApi} disabled={apiTesting}>
              {apiTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test'}
            </Button>
            <Button onClick={handleSaveApiOrigin}>
              Apply
            </Button>
          </div>

          {apiTestResult && (
            <div className={cn(
              'flex items-center gap-2 text-sm p-3 rounded-lg',
              apiTestResult.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
            )}>
              {apiTestResult.ok
                ? <CheckCircle className="w-4 h-4 shrink-0" />
                : <XCircle className="w-4 h-4 shrink-0" />}
              {apiTestResult.msg}
            </div>
          )}

          <div className="text-xs text-muted-foreground space-y-1 border rounded-lg p-3 bg-muted/30">
            <p className="font-medium">How this works:</p>
            <p>• <strong>Blank (default):</strong> All API calls go to <code className="bg-muted px-1 rounded">/api/…</code> — Vite routes them to the backend via the built-in proxy.</p>
            <p>• <strong>Custom URL:</strong> Calls go directly to <code className="bg-muted px-1 rounded">http://host:port/api/…</code>. Use this if the frontend is hosted on a different server. The backend must allow CORS from this origin.</p>
            <p>• Current active origin: <code className="bg-muted px-1 rounded">{getApiOrigin() || '(proxy mode)'}</code></p>
          </div>
        </CardContent>
      </Card>

      {/* Add/Reconnect Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={handleCloseModal} />

          <div className="relative bg-background border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                {modalMode === 'add' ? (
                  <>
                    <Plus className="w-5 h-5 text-primary" /> Add vCenter
                  </>
                ) : (
                  <>
                    <PlugZap className="w-5 h-5 text-primary" /> Reconnect vCenter
                  </>
                )}
              </h2>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleCloseModal}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {modalMode === 'reconnect' && editingConnection && (
              <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  Reconnecting to <strong>{editingConnection.hostname}</strong>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Enter credentials to re-establish the connection.
                </p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Hostname / IP Address *</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="vcenter.example.com"
                    value={formData.hostname}
                    onChange={(e) => setFormData((f) => ({ ...f, hostname: e.target.value }))}
                    className={cn('pl-10', formErrors.hostname && 'border-destructive')}
                    disabled={modalMode === 'reconnect'}
                  />
                </div>
                {formErrors.hostname && <p className="text-sm text-destructive mt-1">{formErrors.hostname}</p>}
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Username *</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="administrator@vsphere.local"
                    value={formData.username}
                    onChange={(e) => setFormData((f) => ({ ...f, username: e.target.value }))}
                    className={cn('pl-10', formErrors.username && 'border-destructive')}
                  />
                </div>
                {formErrors.username && <p className="text-sm text-destructive mt-1">{formErrors.username}</p>}
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Password *</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter password"
                    value={formData.password}
                    onChange={(e) => setFormData((f) => ({ ...f, password: e.target.value }))}
                    className={cn('pl-10 pr-10', formErrors.password && 'border-destructive')}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                {formErrors.password && <p className="text-sm text-destructive mt-1">{formErrors.password}</p>}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t">
              <Button variant="outline" onClick={handleCloseModal} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void handleSaveConnection()} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting...
                  </>
                ) : (
                  <>
                    <PlugZap className="w-4 h-4 mr-2" /> Connect
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}