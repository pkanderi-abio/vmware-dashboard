/**
 * CMDB Page - Simplified Status Logic
 * - Active: VM exists in current inventory/cache
 * - Deleted: VM no longer in inventory (was seen before)
 * - Invalid: VM name has path-like patterns (shown separately)
 */
import { useEffect, useState, useMemo, Fragment } from 'react';
import {
  Database, Search, RefreshCw, ChevronDown, ChevronRight,
  Server, Tag, AlertTriangle, Archive,
  CheckCircle, Download, ArrowUpDown, Globe,
  Cpu, HardDrive, Network, Terminal,
  Power, PowerOff, Wrench, Flame, MemoryStick, FileBox, Trash2, Ban, Info, Monitor
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

// Invalid name patterns (path-like names from vCenter artifacts)
const INVALID_NAME_PATTERNS = [/%2f/i, /^\/vmfs\//i, /vmfs%2fvolumes/i, /^\[.*\]/, /\.vmdk$/i, /\.vmx$/i];

// Decom patterns for VM names
const DECOM_PATTERNS = [
  /Deprecated/i, /decommission/i, /[_\-\.]decom/i, /decom[_\-\.]/i, /decom$/i,
  /LI\.VM\.Decom/i, /marked.*decom/i, /scheduled.*decom/i, /to.be.deleted/i, /delete.?me/i,
];
const DECOM_NAME_ONLY_PATTERNS = [/_old$/i, /-old$/i, /\.old$/i, /_old_/i, /-old-/i];

// Template patterns
const TEMPLATE_PATTERNS = [/template/i, /^tpl-/i, /^tmpl-/i, /-template$/i, /-tpl$/i, /golden.?image/i, /base.?image/i];

interface PuppetData {
  puppet_found: boolean;
  puppet_certname?: string;
  puppet_role?: string;
  puppet_os_name?: string;
  puppet_os_release?: string;
  puppet_agent_version?: string;
  puppet_last_status?: string;
  puppet_environment?: string;
  puppet_uptime?: string;
  puppet_memory_total?: string;
  puppet_memory_used?: string;
  puppet_ipaddress?: string;
  puppet_macaddress?: string;
  puppet_kernelversion?: string;
  puppet_virtual?: string;
  puppet_last_report?: string;
  puppet_last_resources?: number;
  puppet_last_failures?: number;
}

interface CMDBRecord {
  vmKey: string;
  vmId: string;
  vmName: string;
  vcenterName: string;
  status: 'active' | 'unreachable' | 'decommissioned';
  firstSeen: string;
  lastSeen: string;
  powerState: any;
  cpuCount: string;
  memoryGB: string;
  cpuUsagePct: string;
  memoryUsagePct: string;
  guestOS: string;
  ipAddress: string;
  hostName: string;
  cluster: string;
  datacenter: string;
  folder: string;
  datastores: string[];
  totalDiskGB: string;
  toolsStatus: string;
  toolsVersion?: string;
  hardwareVersion?: string;
  annotation?: string;
  uuid: string;
  instanceUuid?: string;
  customAttributes: Record<string, string>;
  puppetData?: PuppetData;
  snapshotCount?: number;
  ID: number;
}

// Simplified status: Active, Deleted, Invalid
type SimpleStatus = 'active' | 'deleted' | 'invalid';
type VMType = 'regular' | 'template' | 'decom';
type ToolsStatus = 'ok' | 'outdated' | 'notRunning' | 'notInstalled' | 'unknown';

function isPoweredOn(r: CMDBRecord): boolean {
  const ps = r.powerState;
  if (typeof ps === 'object' && ps?.Value) return ps.Value.toLowerCase().includes('on');
  return String(ps || '').toLowerCase().includes('on');
}

function getPowerState(r: CMDBRecord): string {
  if (typeof r.powerState === 'object' && r.powerState?.Value) return r.powerState.Value;
  return String(r.powerState || 'unknown');
}

function getCpuUsage(r: CMDBRecord): number {
  return parseFloat(String(r.cpuUsagePct || 0));
}

function getMemUsage(r: CMDBRecord): number {
  return parseFloat(String(r.memoryUsagePct || 0));
}

// Check if VM name is invalid (path-like)
function isInvalidName(name: string): boolean {
  for (const p of INVALID_NAME_PATTERNS) {
    if (p.test(name)) return true;
  }
  return false;
}

// Get simplified status
function getSimpleStatus(r: CMDBRecord): SimpleStatus {
  // Invalid names take priority
  if (isInvalidName(r.vmName || '')) return 'invalid';
  
  // Active = in cache (status is 'active')
  // Deleted = not in cache anymore (status is 'decommissioned' or 'unreachable')
  if (r.status === 'active') return 'active';
  return 'deleted';
}

// Detect VM type (template, decom pattern, or regular)
function detectVMType(r: CMDBRecord): VMType {
  const name = r.vmName || '';
  const annotation = r.annotation || '';
  const folder = r.folder || '';
  const poweredOn = isPoweredOn(r);
  
  // Template only if powered OFF
  if (!poweredOn) {
    for (const p of TEMPLATE_PATTERNS) {
      if (p.test(name) || p.test(folder)) return 'template';
    }
  }
  
  // Decom patterns
  if (!poweredOn) {
    const text = name + ' ' + annotation;
    for (const p of DECOM_PATTERNS) if (p.test(text)) return 'decom';
    for (const p of DECOM_NAME_ONLY_PATTERNS) if (p.test(name)) return 'decom';
  }
  
  return 'regular';
}

function getToolsStatus(r: CMDBRecord): ToolsStatus {
  const status = (r.toolsStatus || '').toLowerCase();
  if (status.includes('ok') || status.includes('current')) return 'ok';
  if (status.includes('old') || status.includes('outdated') || status.includes('needsupgrade')) return 'outdated';
  if (status.includes('notrunning') || status.includes('not running')) return 'notRunning';
  if (status.includes('notinstalled') || status.includes('not installed')) return 'notInstalled';
  return 'unknown';
}

function getToolsDisplayText(r: CMDBRecord): string {
  const status = getToolsStatus(r);
  switch (status) {
    case 'ok': return 'OK';
    case 'outdated': return 'Old';
    case 'notRunning': return 'Stopped';
    case 'notInstalled': return 'None';
    default: return '-';
  }
}

function hasToolsIssue(r: CMDBRecord): boolean {
  if (!isPoweredOn(r)) return false;
  const status = getToolsStatus(r);
  return status === 'outdated' || status === 'notRunning' || status === 'notInstalled';
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.split('T')[0] || '-';
    return d.toLocaleDateString();
  } catch { return '-'; }
}

export default function CMDBPage() {
  const [records, setRecords] = useState<CMDBRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string>('vmName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterVCenter, setFilterVCenter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('active');
  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiBase() + '/cmdb/vms?include_decommissioned=true');
      const data = await res.json();
      if (data.success && data.data) setRecords(data.data);
    } catch (err) {
      console.error('Failed to load CMDB:', err);
    }
    setLoading(false);
  };

  const syncCMDB = async () => {
    setSyncing(true);
    try {
      await fetch(getApiBase() + '/cmdb/sync', { method: 'POST' });
      await loadData();
    } catch (err) {
      console.error('Sync failed:', err);
    }
    setSyncing(false);
  };

  const enrichWithPuppet = async () => {
    setEnriching(true);
    try {
      await fetch(getApiBase() + '/cmdb/enrich/puppet', { method: 'POST' });
      await loadData();
    } catch (err) {
      console.error('Puppet enrichment failed:', err);
    }
    setEnriching(false);
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

  const vCenters = useMemo(() => [...new Set(records.map(r => r.vcenterName).filter(Boolean))].sort(), [records]);

  // Stats calculation
  const stats = useMemo(() => {
    let total = 0, active = 0, deleted = 0, invalid = 0;
    let poweredOn = 0, poweredOff = 0;
    let highCpu = 0, highMem = 0;
    let templates = 0, vmDecom = 0;
    let toolsIssues = 0, withPuppet = 0, puppetFailed = 0;
    
    records.forEach(r => {
      total++;
      
      const simpleStatus = getSimpleStatus(r);
      
      // Count by simple status
      if (simpleStatus === 'invalid') {
        invalid++;
        return; // Don't count invalid in other stats
      } else if (simpleStatus === 'active') {
        active++;
      } else {
        deleted++;
        return; // Don't count deleted in power/resource stats
      }
      
      // VM Type (for active, non-invalid VMs)
      const vmType = detectVMType(r);
      if (vmType === 'template') templates++;
      else if (vmType === 'decom') vmDecom++;
      
      // Power state (only for active VMs)
      if (isPoweredOn(r)) {
        poweredOn++;
        if (getCpuUsage(r) >= HIGH_CPU_THRESHOLD) highCpu++;
        if (getMemUsage(r) >= HIGH_MEM_THRESHOLD) highMem++;
        if (hasToolsIssue(r)) toolsIssues++;
      } else {
        poweredOff++;
      }
      
      if (r.puppetData?.puppet_found) {
        withPuppet++;
        if (r.puppetData?.puppet_last_status === 'failed') puppetFailed++;
      }
    });
    
    return { 
      total, active, deleted, invalid,
      poweredOn, poweredOff, highCpu, highMem,
      templates, vmDecom, toolsIssues, withPuppet, puppetFailed
    };
  }, [records]);

  // Filter records
  const filteredRecords = useMemo(() => {
    let result = [...records];

    // Tab filter
    switch (activeTab) {
      case 'active': result = result.filter(r => getSimpleStatus(r) === 'active'); break;
      case 'deleted': result = result.filter(r => getSimpleStatus(r) === 'deleted'); break;
      case 'invalid': result = result.filter(r => getSimpleStatus(r) === 'invalid'); break;
      case 'poweredOn': result = result.filter(r => getSimpleStatus(r) === 'active' && isPoweredOn(r)); break;
      case 'poweredOff': result = result.filter(r => getSimpleStatus(r) === 'active' && !isPoweredOn(r)); break;
      case 'highCpu': result = result.filter(r => getSimpleStatus(r) === 'active' && isPoweredOn(r) && getCpuUsage(r) >= HIGH_CPU_THRESHOLD); break;
      case 'highMem': result = result.filter(r => getSimpleStatus(r) === 'active' && isPoweredOn(r) && getMemUsage(r) >= HIGH_MEM_THRESHOLD); break;
      case 'toolsIssues': result = result.filter(r => getSimpleStatus(r) === 'active' && hasToolsIssue(r)); break;
      case 'templates': result = result.filter(r => getSimpleStatus(r) === 'active' && detectVMType(r) === 'template'); break;
      case 'puppet': result = result.filter(r => r.puppetData?.puppet_found); break;
      case 'puppetFailed': result = result.filter(r => r.puppetData?.puppet_found && r.puppetData?.puppet_last_status === 'failed'); break;
    }

    // Search
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter(r =>
        r.vmName?.toLowerCase().includes(s) ||
        r.ipAddress?.toLowerCase().includes(s) ||
        r.cluster?.toLowerCase().includes(s) ||
        r.vcenterName?.toLowerCase().includes(s) ||
      );
    }

    // vCenter filter
    if (filterVCenter !== 'all') result = result.filter(r => r.vcenterName === filterVCenter);

    // Sort
    result.sort((a, b) => {
      let av: any = (a as any)[sortField] || '';
      let bv: any = (b as any)[sortField] || '';
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      return av < bv ? (sortDirection === 'asc' ? -1 : 1) : av > bv ? (sortDirection === 'asc' ? 1 : -1) : 0;
    });
    
    return result;
  }, [records, searchTerm, filterVCenter, sortField, sortDirection, activeTab]);

  // Status badge
  const getStatusBadge = (r: CMDBRecord) => {
    const status = getSimpleStatus(r);
    switch (status) {
      case 'active': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-700 dark:text-green-400">Active</span>;
      case 'deleted': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-700 dark:text-red-400">Deleted</span>;
      case 'invalid': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">Invalid</span>;
    }
  };

  // VM Type badge
  const getTypeBadge = (r: CMDBRecord) => {
    if (getSimpleStatus(r) === 'invalid') return <span className="text-[10px] text-muted-foreground">-</span>;
    const t = detectVMType(r);
    if (t === 'template') return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-700 dark:text-purple-400">Template</span>;
    if (t === 'decom') return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/15 text-orange-700 dark:text-orange-400">Decom</span>;
    return <span className="text-[10px] text-muted-foreground">-</span>;
  };

  // Power badge
  const getPowerBadge = (r: CMDBRecord) => {
    if (getSimpleStatus(r) !== 'active') return <span className="text-[10px] text-muted-foreground">-</span>;
    return isPoweredOn(r)
      ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-700 dark:text-green-400">On</span>
      : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">Off</span>;
  };

  // Tools badge
  const getToolsBadge = (r: CMDBRecord) => {
    if (getSimpleStatus(r) !== 'active' || !isPoweredOn(r)) return <span className="text-[10px] text-muted-foreground">-</span>;
    const status = getToolsStatus(r);
    const text = getToolsDisplayText(r);
    switch (status) {
      case 'ok': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-700 dark:text-green-400">{text}</span>;
      case 'outdated': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/15 text-yellow-700 dark:text-yellow-300">{text}</span>;
      case 'notRunning': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/15 text-orange-700 dark:text-orange-400">{text}</span>;
      case 'notInstalled': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-700 dark:text-red-400">{text}</span>;
      default: return <span className="text-[10px] text-muted-foreground">-</span>;
    }
  };

  // Export CSV
  const exportCSV = () => {
    const h = ['VM Name','Status','Type','Power','Tools','vCenter','Datacenter','Cluster','IP','vCPUs','Memory GB','Disk GB','OS','Puppet Role','Puppet Status','Puppet Environment','Puppet Agent','Puppet Last Report','First Seen','Last Seen'];
    const rows = filteredRecords.map(r => [
      r.vmName, getSimpleStatus(r), detectVMType(r), getPowerState(r), r.toolsStatus,
      r.vcenterName, r.datacenter, r.cluster, r.ipAddress, r.cpuCount, r.memoryGB, r.totalDiskGB,
      r.guestOS,
      r.puppetData?.puppet_role || '', r.puppetData?.puppet_last_status || '',
      r.puppetData?.puppet_environment || '', r.puppetData?.puppet_agent_version || '',
      r.puppetData?.puppet_last_report || '',
      r.firstSeen, r.lastSeen,
    ]);
    const csv = [h,...rows].map(row => row.map(c => '"' + String(c||'').replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'cmdb_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
  };

  // Export JSON
  const exportJSON = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(filteredRecords, null, 2)],{type:'application/json'}));
    a.download = 'cmdb_' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      <span className="ml-3">Loading CMDB...</span>
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            CMDB Inventory
            <span className="text-sm font-normal text-muted-foreground">({filteredRecords.length} of {records.length})</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={exportCSV} variant="outline" size="sm" className="h-8 text-xs">
            <Download className="w-3 h-3 mr-1" />CSV
          </Button>
          <Button onClick={exportJSON} variant="outline" size="sm" className="h-8 text-xs">
            <Download className="w-3 h-3 mr-1" />JSON
          </Button>
          <Button onClick={enrichWithPuppet} variant="outline" size="sm" className="h-8 text-xs" disabled={enriching}>
            <Terminal className={cn("w-3 h-3 mr-1", enriching && "animate-spin")} />Puppet
          </Button>
          <Button onClick={syncCMDB} variant="outline" size="sm" className="h-8 text-xs" disabled={syncing}>
            <RefreshCw className={cn("w-3 h-3 mr-1", syncing && "animate-spin")} />Sync
          </Button>
          <Button onClick={loadData} variant="outline" size="sm" className="h-8 text-xs">
            <RefreshCw className={cn("w-3 h-3 mr-1", loading && "animate-spin")} />Refresh
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
          <Database className="w-3 h-3 text-blue-500" /><span className="font-semibold">{stats.total}</span> Total
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-green-500/10 text-xs">
          <CheckCircle className="w-3 h-3 text-green-500" /><span className="font-semibold text-green-600 dark:text-green-400">{stats.active}</span> Active
        </div>
        {stats.deleted > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 text-xs">
            <Trash2 className="w-3 h-3 text-red-500" /><span className="font-semibold text-red-600 dark:text-red-400">{stats.deleted}</span> Deleted
          </div>
        )}
        {stats.invalid > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
            <Ban className="w-3 h-3 text-muted-foreground" /><span className="font-semibold">{stats.invalid}</span> Invalid
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-green-500/10 text-xs">
          <Power className="w-3 h-3 text-green-500" /><span className="font-semibold text-green-600 dark:text-green-400">{stats.poweredOn}</span> On
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
          <PowerOff className="w-3 h-3 text-muted-foreground" /><span className="font-semibold">{stats.poweredOff}</span> Off
        </div>
        {stats.highCpu > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 text-xs">
            <Flame className="w-3 h-3 text-red-500" /><span className="font-semibold text-red-600 dark:text-red-400">{stats.highCpu}</span> High CPU
          </div>
        )}
        {stats.highMem > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 text-xs">
            <MemoryStick className="w-3 h-3 text-red-500" /><span className="font-semibold text-red-600 dark:text-red-400">{stats.highMem}</span> High Mem
          </div>
        )}
        {stats.toolsIssues > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-yellow-500/10 text-xs">
            <Wrench className="w-3 h-3 text-yellow-500" /><span className="font-semibold text-yellow-600 dark:text-yellow-300">{stats.toolsIssues}</span> Tools Issues
          </div>
        )}
        {stats.withPuppet > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-purple-500/10 text-xs">
            <Terminal className="w-3 h-3 text-purple-500" /><span className="font-semibold text-purple-600 dark:text-purple-400">{stats.withPuppet}</span> Puppet
          </div>
        )}
        {stats.puppetFailed > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 text-xs">
            <Terminal className="w-3 h-3 text-red-500" /><span className="font-semibold text-red-600 dark:text-red-400">{stats.puppetFailed}</span> Puppet Failed
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8 p-0.5 gap-0.5 flex-wrap">
          <TabsTrigger value="active" className="text-[11px] h-7 px-2 text-green-600">Active ({stats.active})</TabsTrigger>
          {stats.deleted > 0 && <TabsTrigger value="deleted" className="text-[11px] h-7 px-2 text-red-600">Deleted ({stats.deleted})</TabsTrigger>}
          {stats.invalid > 0 && <TabsTrigger value="invalid" className="text-[11px] h-7 px-2 text-gray-600">Invalid ({stats.invalid})</TabsTrigger>}
          <TabsTrigger value="poweredOn" className="text-[11px] h-7 px-2">On ({stats.poweredOn})</TabsTrigger>
          <TabsTrigger value="poweredOff" className="text-[11px] h-7 px-2">Off ({stats.poweredOff})</TabsTrigger>
          {stats.highCpu > 0 && <TabsTrigger value="highCpu" className="text-[11px] h-7 px-2 text-red-600">CPU≥80% ({stats.highCpu})</TabsTrigger>}
          {stats.highMem > 0 && <TabsTrigger value="highMem" className="text-[11px] h-7 px-2 text-red-600">Mem≥80% ({stats.highMem})</TabsTrigger>}
          {stats.toolsIssues > 0 && <TabsTrigger value="toolsIssues" className="text-[11px] h-7 px-2 text-yellow-600">Tools Issues ({stats.toolsIssues})</TabsTrigger>}
          {stats.templates > 0 && <TabsTrigger value="templates" className="text-[11px] h-7 px-2 text-purple-600">Templates ({stats.templates})</TabsTrigger>}
          {stats.withPuppet > 0 && <TabsTrigger value="puppet" className="text-[11px] h-7 px-2 text-purple-600">Puppet ({stats.withPuppet})</TabsTrigger>}
          {stats.puppetFailed > 0 && <TabsTrigger value="puppetFailed" className="text-[11px] h-7 px-2 text-red-600">Puppet Failed ({stats.puppetFailed})</TabsTrigger>}
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex-1 min-w-[160px] relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search name, IP, cluster, team..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>
        <Select value={filterVCenter} onValueChange={setFilterVCenter}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="All vCenters" /></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All vCenters</SelectItem>
            {vCenters.map(vc => <SelectItem key={vc} value={vc}>{vc?.split('.')[0]}</SelectItem>)}
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
                  <th className="text-left p-2 font-semibold cursor-pointer whitespace-nowrap" onClick={() => handleSort('vmName')}>
                    <span className="flex items-center gap-1">Name <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-16 p-2 font-semibold text-center whitespace-nowrap">Status</th>
                  <th className="w-16 p-2 font-semibold text-center whitespace-nowrap">Type</th>
                  <th className="w-12 p-2 font-semibold text-center whitespace-nowrap">Power</th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap">Tools</th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap">Puppet</th>
                  <th className="w-12 p-2 font-semibold text-center whitespace-nowrap">vCPU</th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap">Mem</th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap cursor-pointer" onClick={() => handleSort('cpuUsagePct')}>
                    <span className="flex items-center justify-center gap-1">CPU% <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap cursor-pointer" onClick={() => handleSort('memoryUsagePct')}>
                    <span className="flex items-center justify-center gap-1">Mem% <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-28 p-2 font-semibold text-left whitespace-nowrap">IP Address</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.slice(0, 100).map((r) => {
                  const id = r.vmKey || r.vmId || r.uuid;
                  const isExpanded = expandedRows.has(id);
                  const simpleStatus = getSimpleStatus(r);
                  const cpuPct = getCpuUsage(r);
                  const memPct = getMemUsage(r);
                  const hasAttrs = r.customAttributes && Object.keys(r.customAttributes).length > 0;
                  const hasPuppet = r.puppetData?.puppet_found;

                  return (
                    <Fragment key={id}>
                      <tr 
                        className={cn(
                          "border-b cursor-pointer transition-colors",
                          isExpanded ? "bg-muted" : "hover:bg-muted/30",
                          simpleStatus === 'deleted' && "bg-red-500/5",
                          simpleStatus === 'invalid' && "bg-muted/50"
                        )} 
                        onClick={() => toggleRow(id)}
                      >
                        <td className="p-2 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            {hasAttrs && <Tag className="w-2.5 h-2.5 text-blue-500" />}
                            {hasPuppet && <Terminal className="w-2.5 h-2.5 text-purple-500" />}
                          </div>
                        </td>
                        <td className="p-2 font-medium truncate max-w-[250px]" title={r.vmName}>{r.vmName}</td>
                        <td className="p-2 text-center">{getStatusBadge(r)}</td>
                        <td className="p-2 text-center">{getTypeBadge(r)}</td>
                        <td className="p-2 text-center">{getPowerBadge(r)}</td>
                        <td className="p-2 text-center">{getToolsBadge(r)}</td>
                        <td className="p-2 text-center">
                          {r.puppetData?.puppet_found ? (
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium",
                              r.puppetData?.puppet_last_status === 'failed' ? "bg-red-500/15 text-red-700 dark:text-red-400" :
                              r.puppetData?.puppet_last_status === 'changed' ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300" :
                              "bg-green-500/15 text-green-700 dark:text-green-400"
                            )}>
                              {r.puppetData?.puppet_last_status === 'failed' ? 'Failed' :
                               r.puppetData?.puppet_last_status === 'changed' ? 'Changed' : 'OK'}
                            </span>
                          ) : <span className="text-[10px] text-muted-foreground">-</span>}
                        </td>
                        <td className="p-2 text-center">{simpleStatus === 'active' ? r.cpuCount : '-'}</td>
                        <td className="p-2 text-center">{simpleStatus === 'active' ? r.memoryGB + 'G' : '-'}</td>
                        <td className="p-2 text-center">
                          {simpleStatus === 'active' ? (
                            <span className={cn(
                              "inline-block w-10 px-1 py-0.5 rounded text-[10px] font-medium text-center",
                              cpuPct >= HIGH_CPU_THRESHOLD ? "bg-red-500/15 text-red-700 dark:text-red-400" :
                              cpuPct >= WARN_CPU_THRESHOLD ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300" : "bg-muted"
                            )}>
                              {r.cpuUsagePct || 0}%
                            </span>
                          ) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="p-2 text-center">
                          {simpleStatus === 'active' ? (
                            <span className={cn(
                              "inline-block w-10 px-1 py-0.5 rounded text-[10px] font-medium text-center",
                              memPct >= HIGH_MEM_THRESHOLD ? "bg-red-500/15 text-red-700 dark:text-red-400" :
                              memPct >= WARN_MEM_THRESHOLD ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300" : "bg-muted"
                            )}>
                              {r.memoryUsagePct || 0}%
                            </span>
                          ) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="p-2 font-mono text-[11px]">{r.ipAddress || '-'}</td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-muted/50">
                          <td colSpan={12} className="p-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                              
                              {/* Location */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-blue-600">
                                  <Globe className="w-3.5 h-3.5" />Location
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">vCenter:</span><span className="font-medium">{r.vcenterName?.split('.')[0]}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Datacenter:</span><span className="font-medium">{r.datacenter || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Cluster:</span><span className="font-medium">{r.cluster || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Host:</span><span className="font-medium">{r.hostName?.split('.')[0] || '-'}</span></div>
                                </div>
                              </div>

                              {/* CMDB Info */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-green-600">
                                  <Database className="w-3.5 h-3.5" />CMDB Info
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center"><span className="text-muted-foreground">Status:</span>{getStatusBadge(r)}</div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">First Seen:</span><span className="font-medium">{formatDate(r.firstSeen)}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Last Seen:</span><span className="font-medium">{formatDate(r.lastSeen)}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">VM ID:</span><span className="font-medium">{r.vmId}</span></div>
                                  {r.uuid && <div className="flex flex-col gap-0.5"><span className="text-muted-foreground">BIOS UUID:</span><span className="font-mono text-[10px] break-all">{r.uuid}</span></div>}
                                  {r.instanceUuid && <div className="flex flex-col gap-0.5"><span className="text-muted-foreground">Instance UUID:</span><span className="font-mono text-[10px] break-all">{r.instanceUuid}</span></div>}
                                </div>
                              </div>

                              {/* Resources */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-cyan-600">
                                  <Cpu className="w-3.5 h-3.5" />Resources
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">vCPUs:</span><span className="font-medium">{r.cpuCount}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Memory:</span><span className="font-medium">{r.memoryGB} GB</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Storage:</span><span className="font-medium">{r.totalDiskGB} GB</span></div>
                                </div>
                              </div>

                              {/* Tools & Guest */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-purple-600">
                                  <Wrench className="w-3.5 h-3.5" />Guest & Tools
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center"><span className="text-muted-foreground">Tools:</span>{getToolsBadge(r)}</div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Tools Ver:</span><span className="font-medium">{r.toolsVersion || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">HW Ver:</span><span className="font-medium">{r.hardwareVersion || '-'}</span></div>
                                </div>
                              </div>

                              {/* OS */}
                              <div className="bg-background p-2.5 rounded border text-xs md:col-span-2">
                                <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-cyan-600">
                                  <Monitor className="w-3.5 h-3.5" />Operating System
                                </h4>
                                <p className="text-muted-foreground">{r.guestOS || '-'}</p>
                              </div>

                              {/* Puppet */}
                              {hasPuppet && (
                                <div className="bg-background p-2.5 rounded border text-xs md:col-span-2">
                                  <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-purple-600">
                                    <Terminal className="w-3.5 h-3.5" />Puppet
                                  </h4>
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    <div className="flex justify-between"><span className="text-muted-foreground">Role:</span><span className="font-medium">{r.puppetData?.puppet_role || '-'}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Status:</span><span className="font-medium">{r.puppetData?.puppet_last_status || '-'}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">OS:</span><span className="font-medium">{r.puppetData?.puppet_os_name} {r.puppetData?.puppet_os_release}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Agent:</span><span className="font-medium">{r.puppetData?.puppet_agent_version || '-'}</span></div>
                                    {r.puppetData?.puppet_environment && <div className="flex justify-between"><span className="text-muted-foreground">Env:</span><span className="font-medium truncate">{r.puppetData.puppet_environment}</span></div>}
                                    {r.puppetData?.puppet_uptime && <div className="flex justify-between"><span className="text-muted-foreground">Uptime:</span><span className="font-medium">{r.puppetData.puppet_uptime}</span></div>}
                                    {r.puppetData?.puppet_memory_total && <div className="flex justify-between"><span className="text-muted-foreground">Mem Total:</span><span className="font-medium">{r.puppetData.puppet_memory_total}</span></div>}
                                    {r.puppetData?.puppet_last_report && <div className="flex justify-between col-span-2"><span className="text-muted-foreground">Last Report:</span><span className="font-medium">{new Date(r.puppetData.puppet_last_report).toLocaleString()}</span></div>}
                                  </div>
                                </div>
                              )}

                              {/* Custom Attributes & Puppet Facts */}
                              {(hasAttrs || hasPuppet) && (
                                <div className="bg-background p-2.5 rounded border text-xs lg:col-span-4 md:col-span-2">
                                  <h4 className="font-semibold mb-1.5 flex items-center gap-1.5 text-indigo-600">
                                    <Tag className="w-3.5 h-3.5" />Custom Attributes{hasPuppet ? ' & Puppet Facts' : ''}
                                  </h4>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-1.5">
                                    {Object.entries(r.customAttributes || {}).map(([key, value]) => (
                                      <div key={key} className="bg-muted p-1.5 rounded">
                                        <div className="text-[9px] text-muted-foreground truncate">{key}</div>
                                        <div className="text-[10px] font-medium truncate">{String(value) || '-'}</div>
                                      </div>
                                    ))}
                                    {hasPuppet && ([
                                      ['role', r.puppetData?.puppet_role],
                                      ['environment', r.puppetData?.puppet_environment],
                                      ['certname', r.puppetData?.puppet_certname],
                                      ['os', `${r.puppetData?.puppet_os_name || ''} ${r.puppetData?.puppet_os_release || ''}`.trim()],
                                      ['kernel_ver', r.puppetData?.puppet_kernelversion],
                                      ['virtual', r.puppetData?.puppet_virtual],
                                      ['uptime', r.puppetData?.puppet_uptime],
                                      ['mem_total', r.puppetData?.puppet_memory_total],
                                      ['mem_used', r.puppetData?.puppet_memory_used],
                                      ['ip', r.puppetData?.puppet_ipaddress],
                                      ['mac', r.puppetData?.puppet_macaddress],
                                      ['agent_ver', r.puppetData?.puppet_agent_version],
                                      ['resources', r.puppetData?.puppet_last_resources != null ? String(r.puppetData.puppet_last_resources) : undefined],
                                      ['failures', r.puppetData?.puppet_last_failures != null ? String(r.puppetData.puppet_last_failures) : undefined],
                                    ] as [string, string | undefined][]).filter(([, v]) => v).map(([key, value]) => (
                                      <div key={`p_${key}`} className="bg-purple-500/10 p-1.5 rounded">
                                        <div className="text-[9px] text-purple-500 dark:text-purple-400 truncate">{key}</div>
                                        <div className="text-[10px] font-medium truncate">{String(value)}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

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
          
          {filteredRecords.length > 100 && (
            <div className="p-2 text-center text-xs text-muted-foreground border-t bg-muted/30">
              Showing 100 of {filteredRecords.length} records
            </div>
          )}
          
          {filteredRecords.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Database className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No records found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
