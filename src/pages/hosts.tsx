/**
 * Hosts Page - ESXi Host Inventory
 * Consistent styling with VMs and CMDB pages
 */
import { useEffect, useState, useMemo, Fragment } from 'react';
import {
  Server, Search, RefreshCw, ChevronDown, ChevronRight,
  Cpu, HardDrive, MemoryStick, Network, Monitor,
  Download, ArrowUpDown, Globe, Power, PowerOff,
  AlertTriangle, CheckCircle, XCircle, Flame, Tag
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { getApiBase } from '@/config/api';

const HIGH_CPU_THRESHOLD = 80;
const HIGH_MEM_THRESHOLD = 80;
const WARN_CPU_THRESHOLD = 50;
const WARN_MEM_THRESHOLD = 50;

interface Host {
  hostId: string;
  hostName: string;
  clusterName?: string;
  cluster?: string;
  datacenterName?: string;
  datacenter?: string;
  vcenterName: string;
  connectionState?: string;
  powerState?: string;
  maintenanceMode?: boolean;
  inMaintenanceMode?: boolean;
  cpuCores: number;
  cpuSockets?: number;
  cpuThreads?: number;
  cpuMhz?: number;
  cpuModel?: string;
  cpuUsageMhz?: number;
  cpuUsagePct?: number;
  memoryGB: number;
  memoryUsageMB?: number;
  memoryUsagePct?: number;
  esxiVersion?: string;
  version?: string;
  esxiBuild?: string;
  build?: string;
  vendor?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  biosVersion?: string;
  vmCount?: number;
  datastoreCount?: number;
  networkCount?: number;
  uptimeDays?: number;
  bootTime?: string;
}

function isConnected(host: Host): boolean {
  // If no connectionState field, assume connected (we got data from it)
  if (!host.connectionState) return true;
  const state = host.connectionState.toLowerCase();
  return state === 'connected' || state === '';
}

function isInMaintenance(host: Host): boolean {
  return host.maintenanceMode === true || host.inMaintenanceMode === true;
}

function getCpuUsage(host: Host): number {
  return parseFloat(String(host.cpuUsagePct ?? 0));
}

function getMemUsage(host: Host): number {
  return parseFloat(String(host.memoryUsagePct ?? 0));
}

export default function HostsPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string>('hostName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterVCenter, setFilterVCenter] = useState<string>('all');
  const [filterCluster, setFilterCluster] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiBase() + '/hosts');
      const data = await res.json();
      if (data.success && data.data) setHosts(data.data);
      else if (data.data) setHosts(data.data);
    } catch (err) {
      console.error('Failed to load hosts:', err);
    }
    setLoading(false);
  };

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      newSet.has(id) ? newSet.delete(id) : newSet.add(id);
      return newSet;
    });
  };

  const handleSort = (field: string) => {
    if (sortField === field) setSortDirection(p => p === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };

  const vCenters = useMemo(() => [...new Set(hosts.map(h => h.vcenterName).filter(Boolean))].sort(), [hosts]);
  const clusters = useMemo(() => [...new Set(hosts.map(h => (h.clusterName || h.cluster)).filter(Boolean))].sort(), [hosts]);

  // Stats calculation
  const stats = useMemo(() => {
    let total = 0, connected = 0, disconnected = 0, maintenance = 0;
    let highCpu = 0, highMem = 0;
    let totalVMs = 0, totalCores = 0, totalMemoryGB = 0;
    
    hosts.forEach(h => {
      total++;
      
      if (isConnected(h)) {
        connected++;
        if (getCpuUsage(h) >= HIGH_CPU_THRESHOLD) highCpu++;
        if (getMemUsage(h) >= HIGH_MEM_THRESHOLD) highMem++;
      } else {
        disconnected++;
      }
      
      if (isInMaintenance(h)) maintenance++;
      
      totalVMs += parseInt(String(h.vmCount || 0)) || 0;
      totalCores += parseInt(String(h.cpuCores || 0)) || 0;
      totalMemoryGB += parseInt(String(h.memoryGB || 0)) || 0;
    });
    
    const totalMemoryTB = (totalMemoryGB / 1024).toFixed(1);
    
    return { 
      total, connected, disconnected, maintenance,
      highCpu, highMem, totalVMs, totalCores, 
      totalMemoryGB, totalMemoryTB
    };
  }, [hosts]);

  // Filter hosts
  const filteredHosts = useMemo(() => {
    let result = [...hosts];

    // Tab filter
    switch (activeTab) {
      case 'connected': result = result.filter(h => isConnected(h)); break;
      case 'disconnected': result = result.filter(h => !isConnected(h)); break;
      case 'maintenance': result = result.filter(h => isInMaintenance(h)); break;
      case 'highCpu': result = result.filter(h => isConnected(h) && getCpuUsage(h) >= HIGH_CPU_THRESHOLD); break;
      case 'highMem': result = result.filter(h => isConnected(h) && getMemUsage(h) >= HIGH_MEM_THRESHOLD); break;
    }

    // Search
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter(h => 
        h.hostName?.toLowerCase().includes(s) || 
        h.clusterName?.toLowerCase().includes(s) ||
        h.vcenterName?.toLowerCase().includes(s) ||
        h.esxiVersion?.toLowerCase().includes(s)
      );
    }
    
    // Filters
    if (filterVCenter !== 'all') result = result.filter(h => h.vcenterName === filterVCenter);
    if (filterCluster !== 'all') result = result.filter(h => (h.clusterName || h.cluster) === filterCluster);

    // Sort
    result.sort((a, b) => {
      let av: any = (a as any)[sortField] || '';
      let bv: any = (b as any)[sortField] || '';
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      return av < bv ? (sortDirection === 'asc' ? -1 : 1) : av > bv ? (sortDirection === 'asc' ? 1 : -1) : 0;
    });
    
    return result;
  }, [hosts, searchTerm, filterVCenter, filterCluster, sortField, sortDirection, activeTab]);

  // Status badge
  const getStatusBadge = (host: Host) => {
    if (isInMaintenance(host)) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700">Maint</span>;
    }
    if (isConnected(host)) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">Connected</span>;
    }
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">Disconnected</span>;
  };

  // Export CSV
  const exportCSV = () => {
    const h = ['Host Name','Status','Cluster','vCenter','Datacenter','CPU Cores','Memory GB','CPU%','Mem%','VMs','ESXi Version'];
    const rows = filteredHosts.map(host => [host.hostName,host.connectionState,host.clusterName,host.vcenterName,host.datacenterName,host.cpuCores,host.memoryGB,host.cpuUsagePct,host.memoryUsagePct,host.vmCount,host.esxiVersion]);
    const csv = [h,...rows].map(row => row.map(c => '"' + (c||'') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'hosts_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      <span className="ml-3">Loading Hosts...</span>
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            ESXi Hosts
            <span className="text-sm font-normal text-muted-foreground">({filteredHosts.length} of {hosts.length})</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={exportCSV} variant="outline" size="sm" className="h-8 text-xs">
            <Download className="w-3 h-3 mr-1" />Export
          </Button>
          <Button onClick={loadData} variant="outline" size="sm" className="h-8 text-xs">
            <RefreshCw className={cn("w-3 h-3 mr-1", loading && "animate-spin")} />Refresh
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
          <Server className="w-3 h-3 text-blue-500" /><span className="font-semibold">{stats.total}</span> Hosts
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-green-50 text-xs">
          <CheckCircle className="w-3 h-3 text-green-500" /><span className="font-semibold text-green-600">{stats.connected}</span> Connected
        </div>
        {stats.disconnected > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 text-xs">
            <XCircle className="w-3 h-3 text-red-500" /><span className="font-semibold text-red-600">{stats.disconnected}</span> Disconnected
          </div>
        )}
        {stats.maintenance > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-yellow-50 text-xs">
            <AlertTriangle className="w-3 h-3 text-yellow-500" /><span className="font-semibold text-yellow-600">{stats.maintenance}</span> Maintenance
          </div>
        )}
        {stats.highCpu > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 text-xs">
            <Flame className="w-3 h-3 text-red-500" /><span className="font-semibold text-red-600">{stats.highCpu}</span> High CPU
          </div>
        )}
        {stats.highMem > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 text-xs">
            <MemoryStick className="w-3 h-3 text-red-500" /><span className="font-semibold text-red-600">{stats.highMem}</span> High Mem
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-50 text-xs">
          <Monitor className="w-3 h-3 text-blue-500" /><span className="font-semibold text-blue-600">{stats.totalVMs.toLocaleString()}</span> VMs
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
          <Cpu className="w-3 h-3 text-cyan-500" /><span className="font-semibold">{stats.totalCores.toLocaleString()}</span> Cores
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
          <MemoryStick className="w-3 h-3 text-purple-500" /><span className="font-semibold">{stats.totalMemoryTB} TB</span> RAM
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8 p-0.5 gap-0.5 flex-wrap">
          <TabsTrigger value="all" className="text-[11px] h-7 px-2">All ({stats.total})</TabsTrigger>
          <TabsTrigger value="connected" className="text-[11px] h-7 px-2 text-green-600">Connected ({stats.connected})</TabsTrigger>
          {stats.disconnected > 0 && <TabsTrigger value="disconnected" className="text-[11px] h-7 px-2 text-red-600">Disconnected ({stats.disconnected})</TabsTrigger>}
          {stats.maintenance > 0 && <TabsTrigger value="maintenance" className="text-[11px] h-7 px-2 text-yellow-600">Maintenance ({stats.maintenance})</TabsTrigger>}
          {stats.highCpu > 0 && <TabsTrigger value="highCpu" className="text-[11px] h-7 px-2 text-red-600">CPU≥80% ({stats.highCpu})</TabsTrigger>}
          {stats.highMem > 0 && <TabsTrigger value="highMem" className="text-[11px] h-7 px-2 text-red-600">Mem≥80% ({stats.highMem})</TabsTrigger>}
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search host, cluster, version..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>
        <Select value={filterVCenter} onValueChange={setFilterVCenter}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="All vCenters" /></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All vCenters</SelectItem>
            {vCenters.map(vc => <SelectItem key={vc} value={vc || ''}>{vc?.split('.')[0]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCluster} onValueChange={setFilterCluster}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="All Clusters" /></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All Clusters</SelectItem>
            {clusters.map(c => <SelectItem key={c} value={c || ''}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="w-7 p-2"></th>
                  <th className="text-left p-2 font-semibold cursor-pointer whitespace-nowrap" onClick={() => handleSort('hostName')}>
                    <span className="flex items-center gap-1">Host Name <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-20 p-2 font-semibold text-center whitespace-nowrap">Status</th>
                  <th className="w-28 p-2 font-semibold text-left whitespace-nowrap cursor-pointer" onClick={() => handleSort('clusterName')}>
                    <span className="flex items-center gap-1">Cluster <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap">Cores</th>
                  <th className="w-16 p-2 font-semibold text-center whitespace-nowrap">Memory</th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap cursor-pointer" onClick={() => handleSort('cpuUsagePct')}>
                    <span className="flex items-center justify-center gap-1">CPU% <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap cursor-pointer" onClick={() => handleSort('memoryUsagePct')}>
                    <span className="flex items-center justify-center gap-1">Mem% <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-12 p-2 font-semibold text-center whitespace-nowrap cursor-pointer" onClick={() => handleSort('vmCount')}>
                    <span className="flex items-center justify-center gap-1">VMs <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-24 p-2 font-semibold text-left whitespace-nowrap">ESXi Version</th>
                </tr>
              </thead>
              <tbody>
                {filteredHosts.slice(0, 100).map((host) => {
                  const id = host.hostId || host.hostName;
                  const isExpanded = expandedRows.has(id);
                  const cpuPct = getCpuUsage(host);
                  const memPct = getMemUsage(host);
                  const connected = isConnected(host);
                  const inMaint = isInMaintenance(host);

                  return (
                    <Fragment key={id}>
                      <tr 
                        className={cn(
                          "border-b cursor-pointer transition-colors",
                          isExpanded ? "bg-muted" : "hover:bg-muted/30",
                          !connected && "bg-red-50/30",
                          inMaint && "bg-yellow-50/30"
                        )} 
                        onClick={() => toggleRow(id)}
                      >
                        <td className="p-2 text-center">
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </td>
                        <td className="p-2 font-medium truncate max-w-[200px]" title={host.hostName}>{host.hostName?.split('.')[0]}</td>
                        <td className="p-2 text-center">{getStatusBadge(host)}</td>
                        <td className="p-2 truncate max-w-[150px]" title={(host.clusterName || host.cluster)}>{(host.clusterName || host.cluster || '-')}</td>
                        <td className="p-2 text-center">{host.cpuCores || '-'}</td>
                        <td className="p-2 text-center">{host.memoryGB ? Math.round(host.memoryGB) + 'G' : '-'}</td>
                        <td className="p-2 text-center">
                          {connected ? (
                            <span className={cn(
                              "inline-block w-10 px-1 py-0.5 rounded text-[10px] font-medium text-center",
                              cpuPct >= HIGH_CPU_THRESHOLD ? "bg-red-100 text-red-700" :
                              cpuPct >= WARN_CPU_THRESHOLD ? "bg-yellow-100 text-yellow-700" : "bg-gray-50"
                            )}>
                              {cpuPct.toFixed(0)}%
                            </span>
                          ) : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="p-2 text-center">
                          {connected ? (
                            <span className={cn(
                              "inline-block w-10 px-1 py-0.5 rounded text-[10px] font-medium text-center",
                              memPct >= HIGH_MEM_THRESHOLD ? "bg-red-100 text-red-700" :
                              memPct >= WARN_MEM_THRESHOLD ? "bg-yellow-100 text-yellow-700" : "bg-gray-50"
                            )}>
                              {memPct.toFixed(0)}%
                            </span>
                          ) : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="p-2 text-center">{host.vmCount || 0}</td>
                        <td className="p-2 text-[10px]">{(host.esxiVersion || host.version || '-')}</td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-muted/50">
                          <td colSpan={10} className="p-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                              
                              {/* Location */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-blue-600">
                                  <Globe className="w-3.5 h-3.5" />Location
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">vCenter:</span><span className="font-medium">{host.vcenterName?.split('.')[0]}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Datacenter:</span><span className="font-medium">{(host.datacenterName || host.datacenter || '-')}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Cluster:</span><span className="font-medium">{(host.clusterName || host.cluster || '-')}</span></div>
                                </div>
                              </div>

                              {/* CPU */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-cyan-600">
                                  <Cpu className="w-3.5 h-3.5" />CPU
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">Cores:</span><span className="font-medium">{host.cpuCores}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Threads:</span><span className="font-medium">{host.cpuThreads || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">MHz:</span><span className="font-medium">{host.cpuMhz || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Model:</span><span className="font-medium text-[10px]">{host.cpuModel || '-'}</span></div>
                                  <div>
                                    <div className="flex justify-between mb-0.5">
                                      <span className="text-muted-foreground">Usage:</span>
                                      <span className={cn("font-medium", cpuPct >= 80 ? "text-red-600" : cpuPct >= 50 ? "text-yellow-600" : "text-green-600")}>
                                        {cpuPct.toFixed(1)}%
                                      </span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-1">
                                      <div className={cn("h-1 rounded-full", cpuPct >= 80 ? "bg-red-500" : cpuPct >= 50 ? "bg-yellow-500" : "bg-green-500")} style={{width: Math.min(cpuPct, 100) + '%'}}></div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Memory */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-purple-600">
                                  <MemoryStick className="w-3.5 h-3.5" />Memory
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">Total:</span><span className="font-medium">{host.memoryGB ? Math.round(host.memoryGB) + ' GB' : '-'}</span></div>
                                  <div>
                                    <div className="flex justify-between mb-0.5">
                                      <span className="text-muted-foreground">Usage:</span>
                                      <span className={cn("font-medium", memPct >= 80 ? "text-red-600" : memPct >= 50 ? "text-yellow-600" : "text-green-600")}>
                                        {memPct.toFixed(1)}%
                                      </span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-1">
                                      <div className={cn("h-1 rounded-full", memPct >= 80 ? "bg-red-500" : memPct >= 50 ? "bg-yellow-500" : "bg-green-500")} style={{width: Math.min(memPct, 100) + '%'}}></div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* System */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-orange-600">
                                  <Server className="w-3.5 h-3.5" />System
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">ESXi:</span><span className="font-medium">{(host.esxiVersion || host.version || '-')}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Build:</span><span className="font-medium">{host.esxiBuild || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Vendor:</span><span className="font-medium">{(host.vendor || host.manufacturer || '-')}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Model:</span><span className="font-medium text-[10px]">{host.model || '-'}</span></div>
                                </div>
                              </div>

                              {/* Workload */}
                              <div className="bg-background p-2.5 rounded border text-xs md:col-span-2">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-green-600">
                                  <Monitor className="w-3.5 h-3.5" />Workload
                                </h4>
                                <div className="grid grid-cols-3 gap-4">
                                  <div className="flex justify-between"><span className="text-muted-foreground">VMs:</span><span className="font-medium">{host.vmCount || 0}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Datastores:</span><span className="font-medium">{host.datastoreCount || 0}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Networks:</span><span className="font-medium">{host.networkCount || 0}</span></div>
                                </div>
                              </div>

                              {/* Hardware */}
                              <div className="bg-background p-2.5 rounded border text-xs md:col-span-2">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-gray-600">
                                  <HardDrive className="w-3.5 h-3.5" />Hardware Info
                                </h4>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">Serial:</span><span className="font-medium">{host.serialNumber || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">BIOS:</span><span className="font-medium">{host.biosVersion || '-'}</span></div>
                                  {host.uptimeDays && <div className="flex justify-between"><span className="text-muted-foreground">Uptime:</span><span className="font-medium">{host.uptimeDays} days</span></div>}
                                  {host.bootTime && <div className="flex justify-between"><span className="text-muted-foreground">Boot:</span><span className="font-medium">{new Date(host.bootTime).toLocaleDateString()}</span></div>}
                                </div>
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {filteredHosts.length > 100 && (
            <div className="p-2 text-center text-xs text-muted-foreground border-t bg-muted/30">
              Showing 100 of {filteredHosts.length} hosts
            </div>
          )}
          
          {filteredHosts.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Server className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No hosts found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
