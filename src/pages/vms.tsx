/**
 * VMs Page - Fixed decom detection for _old patterns
 */
import { useEffect, useState, useMemo, Fragment } from 'react';
import {
  Server, Search, RefreshCw, Terminal, ChevronDown, ChevronRight,
  Power, PowerOff, Cpu, Network, Monitor, Tag, Download, 
  ArrowUpDown, Globe, FileBox, Trash2, Info, Ban, HardDrive,
  AlertTriangle, Flame, MemoryStick, Wrench
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { getApiBase } from '@/config/api';
import { api } from '@/lib/api';

const HIGH_CPU_THRESHOLD = 80;
const HIGH_MEM_THRESHOLD = 80;
const WARN_CPU_THRESHOLD = 50;
const WARN_MEM_THRESHOLD = 50;

const INVALID_NAME_PATTERNS = [/%2f/i, /^\/vmfs\//i, /vmfs%2fvolumes/i, /^\[.*\]/, /\.vmdk$/i, /\.vmx$/i];

// Decom patterns checked in BOTH name and annotation
const DECOM_PATTERNS = [
  /decommission/i,
  /[_\-\.]decom/i,
  /decom[_\-\.]/i,
  /decom$/i,
  /LI\.VM\.Decom/i,
  /marked.*decom/i,
  /scheduled.*decom/i,
  /to.be.deleted/i,
  /delete.?me/i,
  /Deprecated/i,
];

// Decom patterns checked ONLY in VM name (to avoid "gold" in annotation)
const DECOM_NAME_ONLY_PATTERNS = [
  /_old$/i,
  /-old$/i,
  /\.old$/i,
  /_old_/i,
  /-old-/i,
];

const TEMPLATE_PATTERNS = [/template/i, /^tpl-/i, /^tmpl-/i, /-template$/i, /-tpl$/i, /golden.?image/i, /base.?image/i];

interface VM {
  vmKey?: string;
  vmId: string;
  vmName: string;
  vcenterName: string;
  status?: string;
  powerState: any;
  cpuCount: string;
  memoryGB: string;
  memoryMB?: string;
  cpuUsagePct: string;
  memoryUsagePct: string;
  guestOS: string;
  guestState?: string;
  ipAddress: string;
  ipAddresses?: string[];
  macAddresses?: string[];
  hostName: string;
  cluster: string;
  datacenter: string;
  folder: string;
  resourcePool?: string;
  datastores?: string[];
  totalDiskGB: string | number;
  numVirtualDisks?: string | number;
  numEthernetCards?: string | number;
  toolsStatus: string;
  toolsVersion?: string;
  hardwareVersion?: string;
  uuid: string;
  instanceUuid?: string;
  createDate?: string;
  annotation?: string;
  hasSnapshot?: string;
  snapshotCount?: string | number;
  customAttributes?: Record<string, string>;
  puppetData?: any;
  firstSeen?: string;
  lastSeen?: string;
}

type VMType = 'regular' | 'template' | 'decommissioned' | 'invalid';
type ToolsStatus = 'ok' | 'outdated' | 'notRunning' | 'notInstalled' | 'unknown';

function isPoweredOn(vm: VM): boolean {
  return getPowerState(vm).toLowerCase().includes('on');
}

function getPowerState(vm: VM): string {
  if (typeof vm.powerState === 'object' && vm.powerState?.Value) return vm.powerState.Value;
  return String(vm.powerState || 'unknown');
}

function getCpuUsage(vm: VM): number {
  return parseFloat(String(vm.cpuUsagePct || 0));
}

function getMemUsage(vm: VM): number {
  return parseFloat(String(vm.memoryUsagePct || 0));
}

function isHighCpu(vm: VM): boolean {
  return isPoweredOn(vm) && getCpuUsage(vm) >= HIGH_CPU_THRESHOLD;
}

function isHighMem(vm: VM): boolean {
  return isPoweredOn(vm) && getMemUsage(vm) >= HIGH_MEM_THRESHOLD;
}

function isWarnCpu(vm: VM): boolean {
  const cpu = getCpuUsage(vm);
  return isPoweredOn(vm) && cpu >= WARN_CPU_THRESHOLD && cpu < HIGH_CPU_THRESHOLD;
}

function isWarnMem(vm: VM): boolean {
  const mem = getMemUsage(vm);
  return isPoweredOn(vm) && mem >= WARN_MEM_THRESHOLD && mem < HIGH_MEM_THRESHOLD;
}

function detectVMType(vm: VM): VMType {
  const name = vm.vmName || '';
  const annotation = vm.annotation || '';
  const folder = vm.folder || '';
  const poweredOn = isPoweredOn(vm);
  
  // 1. Check INVALID first (path-like names)
  for (const p of INVALID_NAME_PATTERNS) {
    if (p.test(name)) return 'invalid';
  }
  
  // 2. Check TEMPLATE - only if powered OFF
  if (!poweredOn) {
    for (const p of TEMPLATE_PATTERNS) {
      if (p.test(name) || p.test(folder)) return 'template';
    }
  }
  
  // 3. Check DECOMMISSIONED - only if powered OFF
  if (!poweredOn) {
    // Check general decom patterns in name + annotation
    const text = name + ' ' + annotation;
    for (const p of DECOM_PATTERNS) {
      if (p.test(text)) return 'decommissioned';
    }
    // Check name-only patterns (like _old) - NOT in annotation to avoid "gold"
    for (const p of DECOM_NAME_ONLY_PATTERNS) {
      if (p.test(name)) return 'decommissioned';
    }
  }
  
  // 4. Everything else is Regular
  return 'regular';
}

function getToolsStatus(vm: VM): ToolsStatus {
  const status = (vm.toolsStatus || '').toLowerCase();
  if (status.includes('ok') || status.includes('current')) return 'ok';
  if (status.includes('old') || status.includes('outdated') || status.includes('needsupgrade')) return 'outdated';
  if (status.includes('notrunning') || status.includes('not running')) return 'notRunning';
  if (status.includes('notinstalled') || status.includes('not installed')) return 'notInstalled';
  return 'unknown';
}

function getToolsDisplayText(vm: VM): string {
  const status = getToolsStatus(vm);
  switch (status) {
    case 'ok': return 'OK';
    case 'outdated': return 'Old';
    case 'notRunning': return 'Stopped';
    case 'notInstalled': return 'None';
    default: return '-';
  }
}

function hasToolsIssue(vm: VM): boolean {
  if (!isPoweredOn(vm)) return false;
  const status = getToolsStatus(vm);
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

function getDiskCount(vm: VM): number {
  const num = parseInt(String(vm.numVirtualDisks || 0));
  if (num > 0) return num;
  const totalGB = parseFloat(String(vm.totalDiskGB || 0));
  if (totalGB > 0) return Math.max(1, vm.datastores?.length || 1);
  return 0;
}

export default function VMsPage() {
  const [vms, setVms] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string>('vmName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterVCenter, setFilterVCenter] = useState<string>('all');
  const [filterPower, setFilterPower] = useState<string>('all');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('all');
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({});
  const [allTagNames, setAllTagNames] = useState<string[]>([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [vmRes, tagRes] = await Promise.all([
        fetch(getApiBase() + '/cmdb/vms?include_decommissioned=false').then(r => r.json()).catch(() => null),
        api.getTags().catch(() => null),
      ]);
      if (vmRes?.success && vmRes.data) setVms(vmRes.data);
      else {
        try {
          const r2 = await fetch(getApiBase() + '/vms');
          const d2 = await r2.json();
          if (d2.data) setVms(d2.data);
        } catch {}
      }
      if (tagRes?.success && tagRes.data) {
        setTagMap(tagRes.data.vm_tags || {});
        setAllTagNames(tagRes.tag_names || []);
      }
    } catch {}
    setLoading(false);
  };

  const toggleRow = (vmId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      newSet.has(vmId) ? newSet.delete(vmId) : newSet.add(vmId);
      return newSet;
    });
  };

  const handleSort = (field: string) => {
    if (sortField === field) setSortDirection(p => p === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };

  const vCenters = useMemo(() => [...new Set(vms.map(v => v.vcenterName).filter(Boolean))].sort(), [vms]);

  const stats = useMemo(() => {
    let regular = 0, templates = 0, decommissioned = 0, invalid = 0;
    let poweredOn = 0, poweredOff = 0;
    let highCpu = 0, highMem = 0, warnCpu = 0, warnMem = 0;
    let withSnapshots = 0;
    let toolsOk = 0, toolsOutdated = 0, toolsNotRunning = 0, toolsNotInstalled = 0;
    let withPuppet = 0, puppetFailed = 0;
    
    vms.forEach(vm => {
      const t = detectVMType(vm);
      if (t === 'template') templates++;
      else if (t === 'decommissioned') decommissioned++;
      else if (t === 'invalid') invalid++;
      else regular++;
      
      if (isPoweredOn(vm)) {
        poweredOn++;
        if (isHighCpu(vm)) highCpu++;
        else if (isWarnCpu(vm)) warnCpu++;
        if (isHighMem(vm)) highMem++;
        else if (isWarnMem(vm)) warnMem++;
        
        const tools = getToolsStatus(vm);
        if (tools === 'ok') toolsOk++;
        else if (tools === 'outdated') toolsOutdated++;
        else if (tools === 'notRunning') toolsNotRunning++;
        else if (tools === 'notInstalled') toolsNotInstalled++;
      } else {
        poweredOff++;
      }
      
      if (parseInt(String(vm.snapshotCount || 0)) > 0) withSnapshots++;
      
      // Puppet stats
      if (vm.puppetData?.puppet_found) {
        withPuppet++;
        if (vm.puppetData?.puppet_last_status === 'failed') puppetFailed++;
      }
    });
    
    return { 
      total: vms.length, regular, templates, decommissioned, invalid, 
      poweredOn, poweredOff, highCpu, highMem, warnCpu, warnMem, withSnapshots,
      toolsOk, toolsOutdated, toolsNotRunning, toolsNotInstalled,
      toolsIssues: toolsOutdated + toolsNotRunning + toolsNotInstalled,
      withPuppet, puppetFailed
    };
  }, [vms]);

  const filteredVMs = useMemo(() => {
    let result = [...vms];

    switch (activeTab) {
      case 'regular': result = result.filter(v => detectVMType(v) === 'regular'); break;
      case 'puppet': result = result.filter(v => v.puppetData?.puppet_found); break;
      case 'templates': result = result.filter(v => detectVMType(v) === 'template'); break;
      case 'decommissioned': result = result.filter(v => detectVMType(v) === 'decommissioned'); break;
      case 'invalid': result = result.filter(v => detectVMType(v) === 'invalid'); break;
      case 'poweredOn': result = result.filter(v => isPoweredOn(v)); break;
      case 'poweredOff': result = result.filter(v => !isPoweredOn(v)); break;
      case 'highCpu': result = result.filter(v => isHighCpu(v)); break;
      case 'highMem': result = result.filter(v => isHighMem(v)); break;
      case 'withSnapshots': result = result.filter(v => parseInt(String(v.snapshotCount || 0)) > 0); break;
      case 'toolsIssues': result = result.filter(v => hasToolsIssue(v)); break;
    }

    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter(v => 
        v.vmName?.toLowerCase().includes(s) || 
        v.ipAddress?.toLowerCase().includes(s) || 
        v.cluster?.toLowerCase().includes(s) || 
        v.hostName?.toLowerCase().includes(s) ||
        v.vcenterName?.toLowerCase().includes(s)
      );
    }
    
    if (filterVCenter !== 'all') result = result.filter(v => v.vcenterName === filterVCenter);
    if (filterPower !== 'all') result = result.filter(v => filterPower === 'on' ? isPoweredOn(v) : !isPoweredOn(v));
    if (filterTag !== 'all') {
      result = result.filter(v => {
        const vmTags = tagMap[v.vmId] || [];
        return vmTags.includes(filterTag);
      });
    }

    result.sort((a, b) => {
      let av: any, bv: any;
      
      if (sortField === 'cpuUsagePct') { av = getCpuUsage(a); bv = getCpuUsage(b); }
      else if (sortField === 'memoryUsagePct') { av = getMemUsage(a); bv = getMemUsage(b); }
      else if (sortField === 'toolsStatus') { av = getToolsStatus(a); bv = getToolsStatus(b); }
      else { av = (a as any)[sortField] || ''; bv = (b as any)[sortField] || ''; }
      
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      
      return av < bv ? (sortDirection === 'asc' ? -1 : 1) : av > bv ? (sortDirection === 'asc' ? 1 : -1) : 0;
    });
    
    return result;
  }, [vms, searchTerm, filterVCenter, filterPower, filterTag, sortField, sortDirection, activeTab, tagMap]);

  const getTypeBadge = (vm: VM) => {
    const t = detectVMType(vm);
    if (t === 'invalid') return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">Invalid</span>;
    if (t === 'template') return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">Template</span>;
    if (t === 'decommissioned') return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700">Decom</span>;
    return <span className="text-[10px] text-muted-foreground">-</span>;
  };

  const getPowerBadge = (vm: VM) => isPoweredOn(vm) 
    ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">On</span>
    : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">Off</span>;

  const getToolsBadge = (vm: VM) => {
    if (!isPoweredOn(vm)) return <span className="text-[10px] text-gray-400">-</span>;
    
    const status = getToolsStatus(vm);
    const text = getToolsDisplayText(vm);
    
    switch (status) {
      case 'ok': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">{text}</span>;
      case 'outdated': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700">{text}</span>;
      case 'notRunning': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700">{text}</span>;
      case 'notInstalled': return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">{text}</span>;
      default: return <span className="text-[10px] text-gray-400">-</span>;
    }
  };

  const exportCSV = () => {
    const h = ['VM Name','Type','Power','Tools','CPU%','Mem%','vCenter','Cluster','Host','IP','vCPUs','Memory GB','OS'];
    const r = filteredVMs.map(v => [v.vmName,detectVMType(v),getPowerState(v),v.toolsStatus,v.cpuUsagePct,v.memoryUsagePct,v.vcenterName,v.cluster,v.hostName,v.ipAddress,v.cpuCount,v.memoryGB,v.guestOS]);
    const csv = [h,...r].map(row => row.map(c => '"' + (c||'') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'vms_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      <span className="ml-3">Loading VMs...</span>
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            Virtual Machines
            <span className="text-sm font-normal text-muted-foreground">({filteredVMs.length} of {vms.length})</span>
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
          <Server className="w-3 h-3 text-blue-500" /><span className="font-semibold">{stats.total}</span> Total
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-green-50 text-xs">
          <Power className="w-3 h-3 text-green-500" /><span className="font-semibold text-green-600">{stats.poweredOn}</span> On
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
          <PowerOff className="w-3 h-3 text-gray-400" /><span className="font-semibold">{stats.poweredOff}</span> Off
        </div>
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
        {stats.toolsIssues > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-yellow-50 text-xs">
            <Wrench className="w-3 h-3 text-yellow-500" /><span className="font-semibold text-yellow-600">{stats.toolsIssues}</span> Tools Issues
          </div>
        )}
        {stats.withSnapshots > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-yellow-50 text-xs">
            <AlertTriangle className="w-3 h-3 text-yellow-500" /><span className="font-semibold text-yellow-600">{stats.withSnapshots}</span> Snapshots
          </div>
        )}
        {stats.withPuppet > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-purple-50 text-xs">
            <Terminal className="w-3 h-3 text-purple-500" /><span className="font-semibold text-purple-600">{stats.withPuppet}</span> Puppet
          </div>
        )}
        {stats.templates > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-purple-50 text-xs">
            <FileBox className="w-3 h-3 text-purple-500" /><span className="font-semibold text-purple-600">{stats.templates}</span> Templates
          </div>
        )}
        {stats.decommissioned > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-orange-50 text-xs">
            <Trash2 className="w-3 h-3 text-orange-500" /><span className="font-semibold text-orange-600">{stats.decommissioned}</span> Decom
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8 p-0.5 gap-0.5">
          <TabsTrigger value="all" className="text-[11px] h-7 px-2">All</TabsTrigger>
          <TabsTrigger value="poweredOn" className="text-[11px] h-7 px-2">On ({stats.poweredOn})</TabsTrigger>
          <TabsTrigger value="poweredOff" className="text-[11px] h-7 px-2">Off ({stats.poweredOff})</TabsTrigger>
          {stats.highCpu > 0 && <TabsTrigger value="highCpu" className="text-[11px] h-7 px-2 text-red-600">CPU≥80% ({stats.highCpu})</TabsTrigger>}
          {stats.highMem > 0 && <TabsTrigger value="highMem" className="text-[11px] h-7 px-2 text-red-600">Mem≥80% ({stats.highMem})</TabsTrigger>}
          {stats.toolsIssues > 0 && <TabsTrigger value="toolsIssues" className="text-[11px] h-7 px-2 text-yellow-600">Tools Issues ({stats.toolsIssues})</TabsTrigger>}
          {stats.withSnapshots > 0 && <TabsTrigger value="withSnapshots" className="text-[11px] h-7 px-2 text-yellow-600">Snapshots ({stats.withSnapshots})</TabsTrigger>}
          {stats.withPuppet > 0 && <TabsTrigger value="puppet" className="text-[11px] h-7 px-2 text-purple-600">Puppet ({stats.withPuppet})</TabsTrigger>}
          {stats.templates > 0 && <TabsTrigger value="templates" className="text-[11px] h-7 px-2 text-purple-600">Templates ({stats.templates})</TabsTrigger>}
          {stats.decommissioned > 0 && <TabsTrigger value="decommissioned" className="text-[11px] h-7 px-2 text-orange-600">Decom ({stats.decommissioned})</TabsTrigger>}
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search name, IP, cluster..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>
        <Select value={filterVCenter} onValueChange={setFilterVCenter}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="All vCenters" /></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All vCenters</SelectItem>
            {vCenters.map(vc => <SelectItem key={vc} value={vc}>{vc?.split('.')[0]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPower} onValueChange={setFilterPower}>
          <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="Power" /></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="on">On</SelectItem>
            <SelectItem value="off">Off</SelectItem>
          </SelectContent>
        </Select>
        {allTagNames.length > 0 && (
          <Select value={filterTag} onValueChange={setFilterTag}>
            <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="All Tags" /></SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">All Tags</SelectItem>
              {allTagNames.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
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
                  <th className="w-16 p-2 font-semibold text-center whitespace-nowrap">Type</th>
                  <th className="w-12 p-2 font-semibold text-center whitespace-nowrap">Power</th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap cursor-pointer" onClick={() => handleSort('toolsStatus')}>
                    <span className="flex items-center justify-center gap-1">Tools <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
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
                {filteredVMs.slice(0, 100).map((vm) => {
                  const vmId = vm.vmKey || vm.vmId || vm.uuid;
                  const isExpanded = expandedRows.has(vmId);
                  const vmType = detectVMType(vm);
                  const hasAttrs = vm.customAttributes && Object.keys(vm.customAttributes).length > 0;
                  const hasPuppet = vm.puppetData?.puppet_found;
                  const vmTags = tagMap[vm.vmId] || [];
                  const cpuPct = getCpuUsage(vm);
                  const memPct = getMemUsage(vm);
                  const snapCount = parseInt(String(vm.snapshotCount || 0));

                  return (
                    <Fragment key={vmId}>
                      <tr 
                        className={cn(
                          "border-b cursor-pointer transition-colors",
                          isExpanded ? "bg-muted" : "hover:bg-muted/30",
                          vmType === 'decommissioned' && "bg-orange-50/30",
                          vmType === 'template' && "bg-purple-50/30",
                          vmType === 'invalid' && "bg-red-50/30"
                        )} 
                        onClick={() => toggleRow(vmId)}
                      >
                        <td className="p-2 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            {hasAttrs && <Tag className="w-2.5 h-2.5 text-blue-500" />}
                            {vmTags.length > 0 && <Tag className="w-2.5 h-2.5 text-green-500" />}
                            {hasPuppet && <Terminal className="w-2.5 h-2.5 text-purple-500" />}
                            {snapCount > 0 && <AlertTriangle className="w-2.5 h-2.5 text-yellow-500" />}
                          </div>
                        </td>
                        <td className="p-2 font-medium truncate max-w-[300px]" title={vm.vmName}>{vm.vmName}</td>
                        <td className="p-2 text-center">{getTypeBadge(vm)}</td>
                        <td className="p-2 text-center">{getPowerBadge(vm)}</td>
                        <td className="p-2 text-center">{getToolsBadge(vm)}</td>
                        <td className="p-2 text-center">
                          {vm.puppetData?.puppet_found ? (
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium",
                              vm.puppetData?.puppet_last_status === 'failed' ? "bg-red-100 text-red-700" :
                              vm.puppetData?.puppet_last_status === 'changed' ? "bg-yellow-100 text-yellow-700" :
                              "bg-green-100 text-green-700"
                            )}>
                              {vm.puppetData?.puppet_last_status === 'failed' ? 'Failed' :
                               vm.puppetData?.puppet_last_status === 'changed' ? 'Changed' : 'OK'}
                            </span>
                          ) : <span className="text-[10px] text-gray-400">-</span>}
                        </td>
                        <td className="p-2 text-center">{vm.cpuCount}</td>
                        <td className="p-2 text-center">{vm.memoryGB}G</td>
                        <td className="p-2 text-center">
                          <span className={cn(
                            "inline-block w-10 px-1 py-0.5 rounded text-[10px] font-medium text-center",
                            cpuPct >= HIGH_CPU_THRESHOLD ? "bg-red-100 text-red-700" :
                            cpuPct >= WARN_CPU_THRESHOLD ? "bg-yellow-100 text-yellow-700" : "bg-gray-50"
                          )}>
                            {vm.cpuUsagePct || 0}%
                          </span>
                        </td>
                        <td className="p-2 text-center">
                          <span className={cn(
                            "inline-block w-10 px-1 py-0.5 rounded text-[10px] font-medium text-center",
                            memPct >= HIGH_MEM_THRESHOLD ? "bg-red-100 text-red-700" :
                            memPct >= WARN_MEM_THRESHOLD ? "bg-yellow-100 text-yellow-700" : "bg-gray-50"
                          )}>
                            {vm.memoryUsagePct || 0}%
                          </span>
                        </td>
                        <td className="p-2 font-mono text-[11px]">{vm.ipAddress || '-'}</td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-muted/50">
                          <td colSpan={11} className="p-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                              
                              {/* Location */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-blue-600">
                                  <Globe className="w-3.5 h-3.5" />Location
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">vCenter:</span><span className="font-medium">{vm.vcenterName?.split('.')[0]}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Datacenter:</span><span className="font-medium">{vm.datacenter || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Cluster:</span><span className="font-medium">{vm.cluster || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Host:</span><span className="font-medium">{vm.hostName?.split('.')[0] || '-'}</span></div>
                                </div>
                              </div>

                              {/* Resources */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-green-600">
                                  <Cpu className="w-3.5 h-3.5" />Resources
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">vCPUs:</span><span className="font-medium">{vm.cpuCount}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Memory:</span><span className="font-medium">{vm.memoryGB} GB</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Storage:</span><span className="font-medium">{vm.totalDiskGB} GB</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Disks:</span><span className="font-medium">{getDiskCount(vm)}</span></div>
                                </div>
                              </div>

                              {/* Performance */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-orange-600">
                                  <Flame className="w-3.5 h-3.5" />Performance
                                </h4>
                                <div className="space-y-1.5">
                                  <div>
                                    <div className="flex justify-between mb-0.5">
                                      <span className="text-muted-foreground">CPU:</span>
                                      <span className={cn("font-medium", cpuPct >= 80 ? "text-red-600" : cpuPct >= 50 ? "text-yellow-600" : "")}>
                                        {vm.cpuUsagePct || 0}%
                                      </span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-1">
                                      <div 
                                        className={cn("h-1 rounded-full", cpuPct >= 80 ? "bg-red-500" : cpuPct >= 50 ? "bg-yellow-500" : "bg-green-500")} 
                                        style={{width: Math.min(cpuPct, 100) + '%'}}
                                      ></div>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex justify-between mb-0.5">
                                      <span className="text-muted-foreground">Memory:</span>
                                      <span className={cn("font-medium", memPct >= 80 ? "text-red-600" : memPct >= 50 ? "text-yellow-600" : "")}>
                                        {vm.memoryUsagePct || 0}%
                                      </span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-1">
                                      <div 
                                        className={cn("h-1 rounded-full", memPct >= 80 ? "bg-red-500" : memPct >= 50 ? "bg-yellow-500" : "bg-green-500")} 
                                        style={{width: Math.min(memPct, 100) + '%'}}
                                      ></div>
                                    </div>
                                  </div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Snapshots:</span><span className={cn("font-medium", snapCount > 0 && "text-yellow-600")}>{snapCount}</span></div>
                                </div>
                              </div>

                              {/* Guest & Tools */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-purple-600">
                                  <Wrench className="w-3.5 h-3.5" />Guest & Tools
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Tools:</span>
                                    {getToolsBadge(vm)}
                                  </div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Tools Ver:</span><span className="font-medium">{vm.toolsVersion || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">HW Ver:</span><span className="font-medium">{vm.hardwareVersion || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Created:</span><span className="font-medium">{formatDate(vm.createDate)}</span></div>
                                </div>
                              </div>

                              {/* Puppet */}
                              {vm.puppetData?.puppet_found && (
                                <div className="bg-background p-2.5 rounded border text-xs md:col-span-2">
                                  <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-purple-600">
                                    <Terminal className="w-3.5 h-3.5" />Puppet
                                  </h4>
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">Status:</span>
                                      <span className={cn(
                                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                        vm.puppetData?.puppet_last_status === 'failed' ? "bg-red-100 text-red-700" :
                                        vm.puppetData?.puppet_last_status === 'changed' ? "bg-yellow-100 text-yellow-700" :
                                        "bg-green-100 text-green-700"
                                      )}>
                                        {vm.puppetData?.puppet_last_status || 'OK'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Role:</span><span className="font-medium">{vm.puppetData?.puppet_role || '-'}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Certname:</span><span className="font-medium text-[10px]">{vm.puppetData?.puppet_certname || '-'}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Agent:</span><span className="font-medium">{vm.puppetData?.puppet_agent_version || '-'}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">OS:</span><span className="font-medium">{vm.puppetData?.puppet_os_name} {vm.puppetData?.puppet_os_release}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Kernel:</span><span className="font-medium">{vm.puppetData?.puppet_kernelversion || '-'}</span></div>
                                    {vm.puppetData?.puppet_last_report && (
                                      <div className="flex justify-between col-span-2"><span className="text-muted-foreground">Last Report:</span><span className="font-medium">{new Date(vm.puppetData.puppet_last_report).toLocaleString()}</span></div>
                                    )}
                                    {vm.puppetData?.puppet_uptime && (
                                      <div className="flex justify-between"><span className="text-muted-foreground">Uptime:</span><span className="font-medium">{vm.puppetData.puppet_uptime}</span></div>
                                    )}
                                    {(vm.puppetData?.puppet_last_failures || 0) > 0 && (
                                      <div className="flex justify-between"><span className="text-muted-foreground">Failures:</span><span className="font-medium text-red-600">{vm.puppetData.puppet_last_failures}</span></div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* OS */}
                              <div className="bg-background p-2.5 rounded border text-xs md:col-span-2">
                                <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-cyan-600">
                                  <Monitor className="w-3.5 h-3.5" />Operating System
                                </h4>
                                <p className="text-muted-foreground">{vm.guestOS || '-'}</p>
                              </div>

                              {/* vSphere Tags */}
                              {vmTags.length > 0 && (
                                <div className="bg-background p-2.5 rounded border text-xs md:col-span-2">
                                  <h4 className="font-semibold mb-1.5 flex items-center gap-1.5 text-green-600">
                                    <Tag className="w-3.5 h-3.5" />vSphere Tags ({vmTags.length})
                                  </h4>
                                  <div className="flex flex-wrap gap-1">
                                    {vmTags.map((tag, i) => (
                                      <span key={i} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">{tag}</span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Datastores */}
                              {vm.datastores && vm.datastores.length > 0 && (
                                <div className="bg-background p-2.5 rounded border text-xs md:col-span-2">
                                  <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-amber-600">
                                    <HardDrive className="w-3.5 h-3.5" />Datastores ({vm.datastores.length})
                                  </h4>
                                  <div className="flex flex-wrap gap-1">
                                    {vm.datastores.map((ds, i) => <span key={i} className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">{ds}</span>)}
                                  </div>
                                </div>
                              )}

                              {/* Annotation */}
                              {vm.annotation && (
                                <div className="bg-background p-2.5 rounded border text-xs lg:col-span-4 md:col-span-2">
                                  <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-blue-600"><Info className="w-3.5 h-3.5" />Annotation</h4>
                                  <p className="text-muted-foreground whitespace-pre-wrap text-[11px]">{vm.annotation}</p>
                                </div>
                              )}

                              {/* Custom Attributes */}
                              {hasAttrs && (
                                <div className="bg-background p-2.5 rounded border text-xs lg:col-span-4 md:col-span-2">
                                  <h4 className="font-semibold mb-1.5 flex items-center gap-1.5 text-indigo-600">
                                    <Tag className="w-3.5 h-3.5" />Custom Attributes ({Object.keys(vm.customAttributes || {}).length})
                                  </h4>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-1.5">
                                    {Object.entries(vm.customAttributes || {}).map(([key, value]) => (
                                      <div key={key} className="bg-muted/50 p-1.5 rounded">
                                        <div className="text-[9px] text-muted-foreground truncate">{key}</div>
                                        <div className="text-[10px] font-medium truncate">{String(value) || '-'}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Network */}
                              {((vm.ipAddresses && vm.ipAddresses.length > 0) || (vm.macAddresses && vm.macAddresses.length > 0)) && (
                                <div className="bg-background p-2.5 rounded border text-xs lg:col-span-4 md:col-span-2">
                                  <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-teal-600"><Network className="w-3.5 h-3.5" />Network</h4>
                                  <div className="flex flex-wrap gap-1">
                                    {vm.ipAddresses?.map((ip, i) => <span key={'ip-' + i} className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">{ip}</span>)}
                                    {vm.macAddresses?.map((m, i) => <span key={'mac-' + i} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-mono">{m}</span>)}
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
          
          {filteredVMs.length > 100 && (
            <div className="p-2 text-center text-xs text-muted-foreground border-t bg-muted/30">
              Showing 100 of {filteredVMs.length} VMs
            </div>
          )}
          
          {filteredVMs.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Server className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No VMs found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
