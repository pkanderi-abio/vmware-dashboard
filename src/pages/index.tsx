/**
 * Dashboard Overview Page with Alerts & Monitoring
 * Fixed to use /api/vcenters for vCenter connection status
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Server, Monitor, HardDrive, Network, Camera,
  Activity, RefreshCw, Cpu, MemoryStick, Database,
  CheckCircle, XCircle, AlertTriangle, ArrowRight,
  AlertOctagon, Clock, TrendingUp, Zap, Bell
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { api, HealthStatus } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getThresholds } from '@/lib/thresholds';

interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  type: string;
  resource: string;
  resourceType: string;
  message: string;
  timestamp: Date;
  link: string;
}

interface VCenterInfo {
  hostname: string;
  name: string;
  status: { Value: string };
  vmCount: string;
  hostCount: string;
}

export default function HomePage() {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [vcenters, setVcenters] = useState<VCenterInfo[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState({
    hosts: 0,
    vms: 0,
    datastores: 0,
    networks: 0,
    snapshots: 0,
    hostsConnected: 0,
    hostsDisconnected: 0,
    hostsMaintenance: 0,
    vmsPoweredOn: 0,
    vmsPoweredOff: 0,
    vmsToolsNotRunning: 0,
    totalCores: 0,
    totalMemoryGB: 0,
    totalStorageGB: 0,
    freeStorageGB: 0,
    avgCpuUsage: 0,
    avgMemoryUsage: 0,
    avgStorageUsage: 0,
    datastoresHighUsage: 0,
    snapshotsOld: 0,
    snapshotsVeryOld: 0,
  });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [nextRefreshSecs, setNextRefreshSecs] = useState(300);
  const AUTO_REFRESH_INTERVAL = 300; // 5 minutes

  useEffect(() => {
    loadData();
  }, []);

  // Auto-refresh countdown + trigger
  useEffect(() => {
    if (!autoRefresh) { setNextRefreshSecs(AUTO_REFRESH_INTERVAL); return; }
    const tick = setInterval(() => {
      setNextRefreshSecs(prev => {
        if (prev <= 1) { loadData(); return AUTO_REFRESH_INTERVAL; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [autoRefresh]);

  const loadData = async () => {
    setLoading(true);
    const newAlerts: Alert[] = [];
    const thresholds = getThresholds();
    
    try {
      // Fetch health status
      const healthRes = await api.getHealth();
      setHealth(healthRes);

      // Fetch vCenters from /api/vcenters (this has the actual data!)
      const vcentersRes = await api.getVCenters();
      if (vcentersRes.success && vcentersRes.data) {
        setVcenters(vcentersRes.data);
      }

      // Fetch all resources in parallel
      const [hostsRes, vmsRes, datastoresRes, networksRes, snapshotsRes] = await Promise.all([
        api.getHosts().catch(() => ({ success: false, data: [] })),
        api.getVMs().catch(() => ({ success: false, data: [] })),
        api.getDatastores().catch(() => ({ success: false, data: [] })),
        api.getNetworks().catch(() => ({ success: false, data: [] })),
        api.getSnapshots().catch(() => ({ success: false, data: [] })),
      ]);

      const hosts = hostsRes.success ? hostsRes.data || [] : [];
      const vms = vmsRes.success ? vmsRes.data || [] : [];
      const datastores = datastoresRes.success ? datastoresRes.data || [] : [];
      const networks = networksRes.success ? networksRes.data || [] : [];
      const snapshots = snapshotsRes.success ? snapshotsRes.data || [] : [];

      // Calculate host stats and alerts
      const getHostStatus = (h: any) => h.status?.Value || h.status || '';
      const hostsConnected = hosts.filter((h: any) => getHostStatus(h).toLowerCase().includes('connected')).length;
      const hostsDisconnected = hosts.filter((h: any) => {
        const status = getHostStatus(h).toLowerCase();
        return status.includes('disconnected') || status.includes('not responding');
      });
      const hostsMaintenance = hosts.filter((h: any) => h.inMaintenanceMode === 'Yes');
      
      // Host alerts
      hostsDisconnected.forEach((h: any) => {
        newAlerts.push({
          id: `host-disc-${h.hostId}`,
          severity: 'critical',
          type: 'Host Disconnected',
          resource: h.hostName,
          resourceType: 'host',
          message: `Host ${h.hostName} is disconnected from vCenter`,
          timestamp: new Date(),
          link: '/hosts'
        });
      });
      
      hostsMaintenance.forEach((h: any) => {
        newAlerts.push({
          id: `host-maint-${h.hostId}`,
          severity: 'warning',
          type: 'Maintenance Mode',
          resource: h.hostName,
          resourceType: 'host',
          message: `Host ${h.hostName} is in maintenance mode`,
          timestamp: new Date(),
          link: '/hosts'
        });
      });
      
      // High CPU/Memory hosts
      hosts.forEach((h: any) => {
        const cpuPct = parseInt(h.cpuUsagePct || '0');
        const memPct = parseInt(h.memoryUsagePct || '0');
        if (cpuPct >= thresholds.cpuCritical) {
          newAlerts.push({
            id: `host-cpu-${h.hostId}`,
            severity: 'critical',
            type: 'High CPU Usage',
            resource: h.hostName,
            resourceType: 'host',
            message: `Host ${h.hostName} CPU usage is ${cpuPct}%`,
            timestamp: new Date(),
            link: '/hosts'
          });
        } else if (cpuPct >= thresholds.cpuWarning) {
          newAlerts.push({
            id: `host-cpu-${h.hostId}`,
            severity: 'warning',
            type: 'High CPU Usage',
            resource: h.hostName,
            resourceType: 'host',
            message: `Host ${h.hostName} CPU usage is ${cpuPct}%`,
            timestamp: new Date(),
            link: '/hosts'
          });
        }
        if (memPct >= thresholds.memCritical) {
          newAlerts.push({
            id: `host-mem-${h.hostId}`,
            severity: 'critical',
            type: 'High Memory Usage',
            resource: h.hostName,
            resourceType: 'host',
            message: `Host ${h.hostName} memory usage is ${memPct}%`,
            timestamp: new Date(),
            link: '/hosts'
          });
        } else if (memPct >= thresholds.memWarning) {
          newAlerts.push({
            id: `host-mem-${h.hostId}`,
            severity: 'warning',
            type: 'High Memory Usage',
            resource: h.hostName,
            resourceType: 'host',
            message: `Host ${h.hostName} memory usage is ${memPct}%`,
            timestamp: new Date(),
            link: '/hosts'
          });
        }
      });

      // Calculate VM stats and alerts
      const getVMPowerState = (v: any) => v.powerState?.Value || v.powerState || '';
      
      const getToolsStatus = (v: any) => {
        if (v.toolsStatus) return v.toolsStatus;
        if (v.vmToolsStatus) {
          if (typeof v.vmToolsStatus === 'string') return v.vmToolsStatus;
          return v.vmToolsStatus.Value || '';
        }
        return '';
      };

      const vmsPoweredOn = vms.filter((v: any) => {
        const state = getVMPowerState(v).toLowerCase();
        return state.includes('on') || state === 'poweredon';
      }).length;
      const vmsPoweredOff = vms.filter((v: any) => getVMPowerState(v).toLowerCase().includes('off')).length;
      const vmsToolsNotRunning = vms.filter((v: any) => {
        const power = getVMPowerState(v).toLowerCase();
        const tools = getToolsStatus(v).toLowerCase();
        const isRunning = power.includes('on') || power === 'poweredon';
        const toolsOk = tools.includes('running') || tools.includes('ok') || tools === 'guesttoolsrunning';
        return isRunning && !toolsOk;
      });
      
      // VM Tools alerts (limit to first 10)
      vmsToolsNotRunning.slice(0, 10).forEach((v: any) => {
        newAlerts.push({
          id: `vm-tools-${v.vmId}`,
          severity: 'warning',
          type: 'VMware Tools Issue',
          resource: v.vmName,
          resourceType: 'vm',
          message: `VMware Tools not running on ${v.vmName}`,
          timestamp: new Date(),
          link: '/vms'
        });
      });

      // Calculate datastore stats and alerts
      const getAccessible = (d: any) => d.accessible?.Value || d.accessible || '';
      const totalStorageGB = datastores.reduce((sum: number, d: any) => sum + parseInt(d.capacityGB || '0'), 0);
      const freeStorageGB = datastores.reduce((sum: number, d: any) => sum + parseInt(d.freeSpaceGB || '0'), 0);
      const avgStorageUsage = totalStorageGB > 0 ? Math.round(((totalStorageGB - freeStorageGB) / totalStorageGB) * 100) : 0;
      
      const datastoresHighUsage = datastores.filter((d: any) => {
        const usage = parseInt(d.usagePct || '0');
        return usage >= thresholds.storageWarning;
      });
      
      // Datastore alerts
      datastores.forEach((d: any) => {
        const usage = parseInt(d.usagePct || '0');
        const accessible = getAccessible(d).toLowerCase();
        
        if (accessible === 'no' || accessible === 'false') {
          newAlerts.push({
            id: `ds-access-${d.datastoreId}`,
            severity: 'critical',
            type: 'Datastore Inaccessible',
            resource: d.datastoreName,
            resourceType: 'datastore',
            message: `Datastore ${d.datastoreName} is not accessible`,
            timestamp: new Date(),
            link: '/datastores'
          });
        }
        if (usage >= thresholds.storageCritical) {
          newAlerts.push({
            id: `ds-space-${d.datastoreId}`,
            severity: 'critical',
            type: 'Critical Storage',
            resource: d.datastoreName,
            resourceType: 'datastore',
            message: `Datastore ${d.datastoreName} is ${usage}% full`,
            timestamp: new Date(),
            link: '/datastores'
          });
        } else if (usage >= thresholds.storageWarning) {
          newAlerts.push({
            id: `ds-space-${d.datastoreId}`,
            severity: 'warning',
            type: 'High Storage Usage',
            resource: d.datastoreName,
            resourceType: 'datastore',
            message: `Datastore ${d.datastoreName} is ${usage}% full`,
            timestamp: new Date(),
            link: '/datastores'
          });
        }
      });

      // Calculate snapshot stats and alerts
      const snapshotsOld = snapshots.filter((s: any) => {
        const age = parseInt(s.ageDays || '0');
        return age > thresholds.snapshotOldDays && age <= thresholds.snapshotVeryOldDays;
      });
      const snapshotsVeryOld = snapshots.filter((s: any) => parseInt(s.ageDays || '0') > thresholds.snapshotVeryOldDays);
      
      // Snapshot alerts
      snapshotsVeryOld.forEach((s: any) => {
        newAlerts.push({
          id: `snap-old-${s.snapshotId}`,
          severity: 'critical',
          type: 'Old Snapshot',
          resource: `${s.vmName}: ${s.snapshotName}`,
          resourceType: 'snapshot',
          message: `Snapshot "${s.snapshotName}" on ${s.vmName} is ${s.ageDays} days old`,
          timestamp: new Date(),
          link: '/snapshots'
        });
      });
      
      snapshotsOld.slice(0, 10).forEach((s: any) => {
        newAlerts.push({
          id: `snap-warn-${s.snapshotId}`,
          severity: 'warning',
          type: 'Aging Snapshot',
          resource: `${s.vmName}: ${s.snapshotName}`,
          resourceType: 'snapshot',
          message: `Snapshot "${s.snapshotName}" on ${s.vmName} is ${s.ageDays} days old`,
          timestamp: new Date(),
          link: '/snapshots'
        });
      });

      // Calculate overall stats
      const totalCores = hosts.reduce((sum: number, h: any) => sum + parseInt(h.cpuCores || '0'), 0);
      const totalMemoryGB = hosts.reduce((sum: number, h: any) => sum + parseInt(h.memoryGB || '0'), 0);
      const avgCpuUsage = hosts.length > 0
        ? Math.round(hosts.reduce((sum: number, h: any) => sum + parseInt(h.cpuUsagePct || '0'), 0) / hosts.length)
        : 0;
      const avgMemoryUsage = hosts.length > 0
        ? Math.round(hosts.reduce((sum: number, h: any) => sum + parseInt(h.memoryUsagePct || '0'), 0) / hosts.length)
        : 0;

      setStats({
        hosts: hosts.length,
        vms: vms.length,
        datastores: datastores.length,
        networks: networks.length,
        snapshots: snapshots.length,
        hostsConnected,
        hostsDisconnected: hostsDisconnected.length,
        hostsMaintenance: hostsMaintenance.length,
        vmsPoweredOn,
        vmsPoweredOff,
        vmsToolsNotRunning: vmsToolsNotRunning.length,
        totalCores,
        totalMemoryGB,
        totalStorageGB,
        freeStorageGB,
        avgCpuUsage,
        avgMemoryUsage,
        avgStorageUsage,
        datastoresHighUsage: datastoresHighUsage.length,
        snapshotsOld: snapshotsOld.length,
        snapshotsVeryOld: snapshotsVeryOld.length,
      });
      
      // Sort alerts by severity
      newAlerts.sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
      });
      
      setAlerts(newAlerts);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
    setLoading(false);
  };

  // Calculate connected vCenters from the vcenters data
  const connectedVCenters = vcenters.filter(vc => vc.status?.Value === 'Connected');
  const vcentersConnectedCount = connectedVCenters.length;

  const resourceCards = [
    { label: 'ESXi Hosts', count: stats.hosts, icon: Server, path: '/hosts', color: 'text-primary', bgColor: 'bg-primary/10' },
    { label: 'Virtual Machines', count: stats.vms, icon: Monitor, path: '/vms', color: 'text-chart-2', bgColor: 'bg-chart-2/10' },
    { label: 'Datastores', count: stats.datastores, icon: HardDrive, path: '/datastores', color: 'text-chart-3', bgColor: 'bg-chart-3/10' },
    { label: 'Networks', count: stats.networks, icon: Network, path: '/networks', color: 'text-chart-4', bgColor: 'bg-chart-4/10' },
    { label: 'Snapshots', count: stats.snapshots, icon: Camera, path: '/snapshots', color: 'text-chart-5', bgColor: 'bg-chart-5/10' },
  ];

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const warningAlerts = alerts.filter(a => a.severity === 'warning');

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <AlertOctagon className="w-4 h-4" />;
      case 'warning': return <AlertTriangle className="w-4 h-4" />;
      default: return <Bell className="w-4 h-4" />;
    }
  };

  const getSeverityClass = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-destructive/10 text-destructive border-destructive/30';
      case 'warning': return 'bg-warning/10 text-warning border-warning/30';
      default: return 'bg-primary/10 text-primary border-primary/30';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-lg text-foreground">Loading Dashboard...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Activity className="w-8 h-8 text-primary" />
            VMware Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">Infrastructure monitoring and management</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Fixed: Use vcenters data instead of health.vcenters_connected */}
          <Badge className={cn(
            "text-sm px-3 py-1",
            vcentersConnectedCount > 0
              ? "bg-success/20 text-success border-success/30"
              : "bg-destructive/20 text-destructive border-destructive/30"
          )}>
            {vcentersConnectedCount > 0 ? (
              <><CheckCircle className="w-4 h-4 mr-1" /> {vcentersConnectedCount} vCenter(s) Connected</>
            ) : (
              <><XCircle className="w-4 h-4 mr-1" /> No vCenters Connected</>
            )}
          </Badge>
          <Button onClick={loadData} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? `Auto-refresh in ${nextRefreshSecs}s` : 'Enable auto-refresh every 5 min'}
          >
            <Activity className="w-4 h-4 mr-2" />
            {autoRefresh ? `Auto (${nextRefreshSecs}s)` : 'Auto Off'}
          </Button>
        </div>
      </div>

      {/* Alert Summary Banner */}
      {(criticalAlerts.length > 0 || warningAlerts.length > 0) && (
        <Card className={cn(
          "border-2",
          criticalAlerts.length > 0 ? "border-destructive/50 bg-destructive/5" : "border-warning/50 bg-warning/5"
        )}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {criticalAlerts.length > 0 ? (
                  <AlertOctagon className="w-8 h-8 text-destructive" />
                ) : (
                  <AlertTriangle className="w-8 h-8 text-warning" />
                )}
                <div>
                  <h3 className="font-semibold text-foreground">
                    {criticalAlerts.length > 0 ? 'Critical Issues Detected' : 'Warnings Detected'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {criticalAlerts.length > 0 && <span className="text-destructive font-medium">{criticalAlerts.length} critical</span>}
                    {criticalAlerts.length > 0 && warningAlerts.length > 0 && ' and '}
                    {warningAlerts.length > 0 && <span className="text-warning font-medium">{warningAlerts.length} warnings</span>}
                    {' '}requiring attention
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => document.getElementById('alerts-section')?.scrollIntoView({ behavior: 'smooth' })}>
                View All Alerts
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resource Count Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {resourceCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.path} to={card.path}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer group">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className={cn("p-2 rounded-lg", card.bgColor)}>
                      <Icon className={cn("w-5 h-5", card.color)} />
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="mt-3">
                    <p className="text-2xl font-bold text-foreground">{card.count.toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground">{card.label}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Hosts Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="w-5 h-5 text-primary" />
              Hosts Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Connected</span>
                <span className="text-lg font-bold text-success">{stats.hostsConnected} / {stats.hosts}</span>
              </div>
              <Progress value={stats.hosts > 0 ? (stats.hostsConnected / stats.hosts) * 100 : 0} className="h-2" />
              
              <div className="grid grid-cols-3 gap-2 pt-2">
                <div className="text-center p-2 bg-success/10 rounded-lg">
                  <CheckCircle className="w-4 h-4 mx-auto text-success mb-1" />
                  <p className="text-lg font-bold text-foreground">{stats.hostsConnected}</p>
                  <p className="text-xs text-muted-foreground">Connected</p>
                </div>
                <div className="text-center p-2 bg-destructive/10 rounded-lg">
                  <XCircle className="w-4 h-4 mx-auto text-destructive mb-1" />
                  <p className="text-lg font-bold text-foreground">{stats.hostsDisconnected}</p>
                  <p className="text-xs text-muted-foreground">Disconnected</p>
                </div>
                <div className="text-center p-2 bg-warning/10 rounded-lg">
                  <AlertTriangle className="w-4 h-4 mx-auto text-warning mb-1" />
                  <p className="text-lg font-bold text-foreground">{stats.hostsMaintenance}</p>
                  <p className="text-xs text-muted-foreground">Maintenance</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <Cpu className="w-5 h-5 mx-auto text-primary mb-1" />
                  <p className="text-xl font-bold text-foreground">{stats.totalCores.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Total Cores</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <MemoryStick className="w-5 h-5 mx-auto text-chart-2 mb-1" />
                  <p className="text-xl font-bold text-foreground">{stats.totalMemoryGB.toLocaleString()} GB</p>
                  <p className="text-xs text-muted-foreground">Total Memory</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* VMs Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Monitor className="w-5 h-5 text-chart-2" />
              VMs Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Powered On</span>
                <span className="text-lg font-bold text-success">{stats.vmsPoweredOn} / {stats.vms}</span>
              </div>
              <Progress value={stats.vms > 0 ? (stats.vmsPoweredOn / stats.vms) * 100 : 0} className="h-2" />
              
              <div className="grid grid-cols-3 gap-2 pt-2">
                <div className="text-center p-2 bg-success/10 rounded-lg">
                  <Zap className="w-4 h-4 mx-auto text-success mb-1" />
                  <p className="text-lg font-bold text-foreground">{stats.vmsPoweredOn}</p>
                  <p className="text-xs text-muted-foreground">Running</p>
                </div>
                <div className="text-center p-2 bg-muted/50 rounded-lg">
                  <XCircle className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-lg font-bold text-foreground">{stats.vmsPoweredOff}</p>
                  <p className="text-xs text-muted-foreground">Stopped</p>
                </div>
                <div className="text-center p-2 bg-warning/10 rounded-lg">
                  <AlertTriangle className="w-4 h-4 mx-auto text-warning mb-1" />
                  <p className="text-lg font-bold text-foreground">{stats.vmsToolsNotRunning}</p>
                  <p className="text-xs text-muted-foreground">Tools Issue</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Resource Usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-chart-3" />
              Resource Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-muted-foreground">Avg CPU Usage</span>
                  <span className={cn("text-sm font-medium", stats.avgCpuUsage > 80 ? 'text-destructive' : stats.avgCpuUsage > 60 ? 'text-warning' : 'text-success')}>
                    {stats.avgCpuUsage}%
                  </span>
                </div>
                <Progress value={stats.avgCpuUsage} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-muted-foreground">Avg Memory Usage</span>
                  <span className={cn("text-sm font-medium", stats.avgMemoryUsage > 80 ? 'text-destructive' : stats.avgMemoryUsage > 60 ? 'text-warning' : 'text-success')}>
                    {stats.avgMemoryUsage}%
                  </span>
                </div>
                <Progress value={stats.avgMemoryUsage} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-muted-foreground">Avg Storage Usage</span>
                  <span className={cn("text-sm font-medium", stats.avgStorageUsage > 80 ? 'text-destructive' : stats.avgStorageUsage > 60 ? 'text-warning' : 'text-success')}>
                    {stats.avgStorageUsage}%
                  </span>
                </div>
                <Progress value={stats.avgStorageUsage} className="h-2" />
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg mt-2">
                <Database className="w-5 h-5 mx-auto text-chart-3 mb-1" />
                <p className="text-xl font-bold text-foreground">{(stats.totalStorageGB / 1024).toFixed(1)} TB</p>
                <p className="text-xs text-muted-foreground">Total Storage ({(stats.freeStorageGB / 1024).toFixed(1)} TB Free)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monitoring & Alerts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="alerts-section">
        {/* Active Alerts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-destructive" />
                Active Alerts
              </div>
              <div className="flex gap-2">
                {criticalAlerts.length > 0 && (
                  <Badge className="bg-destructive/20 text-destructive">{criticalAlerts.length} Critical</Badge>
                )}
                {warningAlerts.length > 0 && (
                  <Badge className="bg-warning/20 text-warning">{warningAlerts.length} Warning</Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {alerts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="w-12 h-12 mx-auto mb-2 text-success" />
                  <p>No active alerts</p>
                  <p className="text-sm">All systems operating normally</p>
                </div>
              ) : (
                alerts.slice(0, 15).map((alert) => (
                  <Link key={alert.id} to={alert.link}>
                    <div className={cn(
                      "p-3 rounded-lg border flex items-start gap-3 hover:shadow-md transition-shadow cursor-pointer",
                      getSeverityClass(alert.severity)
                    )}>
                      {getSeverityIcon(alert.severity)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm truncate">{alert.type}</span>
                          <Badge variant="outline" className="text-xs shrink-0">{alert.resourceType}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{alert.message}</p>
                      </div>
                    </div>
                  </Link>
                ))
              )}
              {alerts.length > 15 && (
                <p className="text-center text-sm text-muted-foreground pt-2">
                  And {alerts.length - 15} more alerts...
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Health Check */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Health Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* vCenters Health - NEW */}
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <Database className="w-5 h-5 text-primary" />
                  <span className="font-medium">vCenters</span>
                </div>
                <div className="flex items-center gap-2">
                  {vcentersConnectedCount > 0 ? (
                    <Badge className="bg-success/20 text-success"><CheckCircle className="w-3 h-3 mr-1" /> {vcentersConnectedCount} Connected</Badge>
                  ) : (
                    <Badge className="bg-destructive/20 text-destructive"><XCircle className="w-3 h-3 mr-1" /> Disconnected</Badge>
                  )}
                </div>
              </div>

              {/* Hosts Health */}
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <Server className="w-5 h-5 text-primary" />
                  <span className="font-medium">ESXi Hosts</span>
                </div>
                <div className="flex items-center gap-2">
                  {stats.hostsDisconnected === 0 && stats.hostsMaintenance === 0 ? (
                    <Badge className="bg-success/20 text-success"><CheckCircle className="w-3 h-3 mr-1" /> Healthy</Badge>
                  ) : stats.hostsDisconnected > 0 ? (
                    <Badge className="bg-destructive/20 text-destructive"><AlertOctagon className="w-3 h-3 mr-1" /> {stats.hostsDisconnected} Issues</Badge>
                  ) : (
                    <Badge className="bg-warning/20 text-warning"><AlertTriangle className="w-3 h-3 mr-1" /> {stats.hostsMaintenance} Maintenance</Badge>
                  )}
                </div>
              </div>
              
              {/* VMs Health */}
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <Monitor className="w-5 h-5 text-chart-2" />
                  <span className="font-medium">Virtual Machines</span>
                </div>
                <div className="flex items-center gap-2">
                  {stats.vmsToolsNotRunning === 0 ? (
                    <Badge className="bg-success/20 text-success"><CheckCircle className="w-3 h-3 mr-1" /> Healthy</Badge>
                  ) : (
                    <Badge className="bg-warning/20 text-warning"><AlertTriangle className="w-3 h-3 mr-1" /> {stats.vmsToolsNotRunning} Tools Issues</Badge>
                  )}
                </div>
              </div>
              
              {/* Storage Health */}
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <HardDrive className="w-5 h-5 text-chart-3" />
                  <span className="font-medium">Datastores</span>
                </div>
                <div className="flex items-center gap-2">
                  {stats.datastoresHighUsage === 0 ? (
                    <Badge className="bg-success/20 text-success"><CheckCircle className="w-3 h-3 mr-1" /> Healthy</Badge>
                  ) : (
                    <Badge className="bg-warning/20 text-warning"><AlertTriangle className="w-3 h-3 mr-1" /> {stats.datastoresHighUsage} High Usage</Badge>
                  )}
                </div>
              </div>
              
              {/* Snapshots Health */}
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <Camera className="w-5 h-5 text-chart-5" />
                  <span className="font-medium">Snapshots</span>
                </div>
                <div className="flex items-center gap-2">
                  {stats.snapshotsVeryOld === 0 && stats.snapshotsOld === 0 ? (
                    <Badge className="bg-success/20 text-success"><CheckCircle className="w-3 h-3 mr-1" /> Healthy</Badge>
                  ) : stats.snapshotsVeryOld > 0 ? (
                    <Badge className="bg-destructive/20 text-destructive"><AlertOctagon className="w-3 h-3 mr-1" /> {stats.snapshotsVeryOld} Very Old</Badge>
                  ) : (
                    <Badge className="bg-warning/20 text-warning"><AlertTriangle className="w-3 h-3 mr-1" /> {stats.snapshotsOld} Aging</Badge>
                  )}
                </div>
              </div>
              
              {/* Networks Health */}
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <Network className="w-5 h-5 text-chart-4" />
                  <span className="font-medium">Networks</span>
                </div>
                <Badge className="bg-success/20 text-success"><CheckCircle className="w-3 h-3 mr-1" /> Healthy</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Connected vCenters - Using vcenters state instead of health */}
      {vcenters.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              Connected vCenters ({vcenters.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {vcenters.map((vc, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      vc.status?.Value === 'Connected' ? 'bg-success' : 'bg-destructive'
                    )} />
                    <div>
                      <p className="text-sm text-foreground font-medium truncate max-w-[180px]">{vc.hostname}</p>
                      <p className="text-xs text-muted-foreground">{vc.vmCount} VMs, {vc.hostCount} Hosts</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Links */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Link to="/hosts">
              <Button variant="outline" className="w-full justify-start">
                <Server className="w-4 h-4 mr-2" />
                View Hosts
              </Button>
            </Link>
            <Link to="/vms">
              <Button variant="outline" className="w-full justify-start">
                <Monitor className="w-4 h-4 mr-2" />
                View VMs
              </Button>
            </Link>
            <Link to="/snapshots">
              <Button variant="outline" className="w-full justify-start">
                <Camera className="w-4 h-4 mr-2" />
                View Snapshots
              </Button>
            </Link>
            <Link to="/cmdb">
              <Button variant="outline" className="w-full justify-start">
                <Database className="w-4 h-4 mr-2" />
                View CMDB
              </Button>
            </Link>
            <Link to="/settings">
              <Button variant="outline" className="w-full justify-start">
                <Server className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}