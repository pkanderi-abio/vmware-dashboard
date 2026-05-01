/**
 * Snapshots Page - VM Snapshot Inventory
 * Consistent styling with other pages
 */
import { useEffect, useState, useMemo, Fragment } from 'react';
import {
  Camera, Search, RefreshCw, ChevronDown, ChevronRight,
  Download, ArrowUpDown, Globe, Server, Clock,
  AlertTriangle, CheckCircle, Calendar, Power, PowerOff
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

const OLD_SNAPSHOT_DAYS = 7;
const WARN_SNAPSHOT_DAYS = 3;

interface Snapshot {
  snapshotId: string;
  snapshotName: string;
  description: string;
  vcenterName: string;
  vmId: string;
  vmName: string;
  vmPowerState: string;
  createTime: string;
  createTimeRaw: string;
  ageDays: number;
  isCurrent: boolean;
  quiesced: boolean;
  replaySupported: boolean;
  parentSnapshot: string;
  snapshotDepth: number;
}

function isOldSnapshot(snap: Snapshot): boolean {
  return (snap.ageDays || 0) >= OLD_SNAPSHOT_DAYS;
}

function isWarnSnapshot(snap: Snapshot): boolean {
  const age = snap.ageDays || 0;
  return age >= WARN_SNAPSHOT_DAYS && age < OLD_SNAPSHOT_DAYS;
}

function isPoweredOn(snap: Snapshot): boolean {
  return (snap.vmPowerState || '').toLowerCase().includes('on');
}

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string>('ageDays');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterVCenter, setFilterVCenter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiBase() + '/snapshots');
      const data = await res.json();
      const raw: any[] = (data.success || data.data) ? (data.data || []) : [];
      // Normalize: handle both old format (name/created) and new format (snapshotName/createTime/ageDays)
      const normalized: Snapshot[] = raw.map((s: any) => {
        const createdRaw = s.createTimeRaw || s.created || '';
        const ageDays = s.ageDays !== undefined
          ? Number(s.ageDays)
          : createdRaw
          ? Math.floor((Date.now() - new Date(createdRaw).getTime()) / 86_400_000)
          : 0;
        return {
          snapshotId:     s.snapshotId || s.id || `${s.vmName}-${s.name || s.snapshotName}`,
          snapshotName:   s.snapshotName || s.name || '',
          description:    s.description || '',
          vcenterName:    s.vcenterName || '',
          vmId:           s.vmId || '',
          vmName:         s.vmName || '',
          vmPowerState:   s.vmPowerState || '',
          createTime:     s.createTime || (createdRaw ? new Date(createdRaw).toLocaleString() : ''),
          createTimeRaw:  createdRaw,
          ageDays:        isNaN(ageDays) ? 0 : ageDays,
          isCurrent:      s.isCurrent ?? false,
          quiesced:       s.quiesced ?? false,
          replaySupported: s.replaySupported ?? false,
          parentSnapshot: s.parentSnapshot || '',
          snapshotDepth:  s.snapshotDepth || 1,
        };
      });
      setSnapshots(normalized);
    } catch (err) {
      console.error('Failed to load snapshots:', err);
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
    else { setSortField(field); setSortDirection('desc'); }
  };

  const vCenters = useMemo(() => [...new Set(snapshots.map(s => s.vcenterName).filter(Boolean))].sort(), [snapshots]);

  // Stats calculation
  const stats = useMemo(() => {
    let total = 0, oldSnapshots = 0, warnSnapshots = 0, current = 0;
    let uniqueVMs = new Set<string>();
    
    snapshots.forEach(snap => {
      total++;
      
      if (isOldSnapshot(snap)) oldSnapshots++;
      else if (isWarnSnapshot(snap)) warnSnapshots++;
      
      if (snap.isCurrent) current++;
      uniqueVMs.add(snap.vmName);
    });
    
    return { total, oldSnapshots, warnSnapshots, current, uniqueVMs: uniqueVMs.size };
  }, [snapshots]);

  // Filter snapshots
  const filteredSnapshots = useMemo(() => {
    let result = [...snapshots];

    switch (activeTab) {
      case 'old': result = result.filter(s => isOldSnapshot(s)); break;
      case 'warn': result = result.filter(s => isWarnSnapshot(s)); break;
      case 'current': result = result.filter(s => s.isCurrent); break;
    }

    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter(snap => 
        snap.snapshotName?.toLowerCase().includes(s) || 
        snap.vmName?.toLowerCase().includes(s) ||
        snap.description?.toLowerCase().includes(s) ||
        snap.vcenterName?.toLowerCase().includes(s)
      );
    }
    
    if (filterVCenter !== 'all') result = result.filter(s => s.vcenterName === filterVCenter);

    result.sort((a, b) => {
      let av: any = (a as any)[sortField] || '';
      let bv: any = (b as any)[sortField] || '';
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      return av < bv ? (sortDirection === 'asc' ? -1 : 1) : av > bv ? (sortDirection === 'asc' ? 1 : -1) : 0;
    });
    
    return result;
  }, [snapshots, searchTerm, filterVCenter, sortField, sortDirection, activeTab]);

  const getAgeBadge = (snap: Snapshot) => {
    const age = snap.ageDays || 0;
    if (age >= OLD_SNAPSHOT_DAYS) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">{age}d</span>;
    }
    if (age >= WARN_SNAPSHOT_DAYS) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700">{age}d</span>;
    }
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">{age}d</span>;
  };

  const getPowerBadge = (snap: Snapshot) => isPoweredOn(snap)
    ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">On</span>
    : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">Off</span>;

  const exportCSV = () => {
    const h = ['Snapshot Name','VM Name','Age Days','Create Time','vCenter','Current','Quiesced','Description'];
    const rows = filteredSnapshots.map(s => [s.snapshotName,s.vmName,s.ageDays,s.createTime,s.vcenterName,s.isCurrent?'Yes':'No',s.quiesced?'Yes':'No',s.description]);
    const csv = [h,...rows].map(row => row.map(c => '"' + (c||'') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'snapshots_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      <span className="ml-3">Loading Snapshots...</span>
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            VM Snapshots
            <span className="text-sm font-normal text-muted-foreground">({filteredSnapshots.length} of {snapshots.length})</span>
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
          <Camera className="w-3 h-3 text-blue-500" /><span className="font-semibold">{stats.total}</span> Snapshots
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-50 text-xs">
          <Server className="w-3 h-3 text-blue-500" /><span className="font-semibold text-blue-600">{stats.uniqueVMs}</span> VMs
        </div>
        {stats.oldSnapshots > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 text-xs">
            <AlertTriangle className="w-3 h-3 text-red-500" /><span className="font-semibold text-red-600">{stats.oldSnapshots}</span> Old (≥7d)
          </div>
        )}
        {stats.warnSnapshots > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-yellow-50 text-xs">
            <Clock className="w-3 h-3 text-yellow-500" /><span className="font-semibold text-yellow-600">{stats.warnSnapshots}</span> Warning (3-7d)
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-green-50 text-xs">
          <CheckCircle className="w-3 h-3 text-green-500" /><span className="font-semibold text-green-600">{stats.current}</span> Current
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8 p-0.5 gap-0.5 flex-wrap">
          <TabsTrigger value="all" className="text-[11px] h-7 px-2">All ({stats.total})</TabsTrigger>
          {stats.oldSnapshots > 0 && <TabsTrigger value="old" className="text-[11px] h-7 px-2 text-red-600">Old ≥7d ({stats.oldSnapshots})</TabsTrigger>}
          {stats.warnSnapshots > 0 && <TabsTrigger value="warn" className="text-[11px] h-7 px-2 text-yellow-600">3-7d ({stats.warnSnapshots})</TabsTrigger>}
          <TabsTrigger value="current" className="text-[11px] h-7 px-2 text-green-600">Current ({stats.current})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search snapshot, VM name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>
        <Select value={filterVCenter} onValueChange={setFilterVCenter}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="All vCenters" /></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All vCenters</SelectItem>
            {vCenters.map(vc => <SelectItem key={vc} value={vc || ''}>{vc?.split('.')[0]}</SelectItem>)}
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
                  <th className="text-left p-2 font-semibold cursor-pointer whitespace-nowrap" onClick={() => handleSort('snapshotName')}>
                    <span className="flex items-center gap-1">Snapshot <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-left p-2 font-semibold cursor-pointer whitespace-nowrap" onClick={() => handleSort('vmName')}>
                    <span className="flex items-center gap-1">VM Name <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-12 p-2 font-semibold text-center whitespace-nowrap">Power</th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap cursor-pointer" onClick={() => handleSort('ageDays')}>
                    <span className="flex items-center justify-center gap-1">Age <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-32 p-2 font-semibold text-left whitespace-nowrap cursor-pointer" onClick={() => handleSort('createTime')}>
                    <span className="flex items-center gap-1">Created <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap">Current</th>
                  <th className="w-28 p-2 font-semibold text-left whitespace-nowrap">vCenter</th>
                </tr>
              </thead>
              <tbody>
                {filteredSnapshots.slice(0, 100).map((snap) => {
                  const id = snap.snapshotId || snap.snapshotName + snap.vmName;
                  const isExpanded = expandedRows.has(id);

                  return (
                    <Fragment key={id}>
                      <tr 
                        className={cn(
                          "border-b cursor-pointer transition-colors",
                          isExpanded ? "bg-muted" : "hover:bg-muted/30",
                          isOldSnapshot(snap) && "bg-red-50/30",
                          isWarnSnapshot(snap) && "bg-yellow-50/20"
                        )} 
                        onClick={() => toggleRow(id)}
                      >
                        <td className="p-2 text-center">
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </td>
                        <td className="p-2 font-medium truncate max-w-[200px]" title={snap.snapshotName}>{snap.snapshotName}</td>
                        <td className="p-2 truncate max-w-[200px]" title={snap.vmName}>{snap.vmName}</td>
                        <td className="p-2 text-center">{getPowerBadge(snap)}</td>
                        <td className="p-2 text-center">{getAgeBadge(snap)}</td>
                        <td className="p-2 text-[10px]">{snap.createTime || '-'}</td>
                        <td className="p-2 text-center">
                          {snap.isCurrent 
                            ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">Yes</span>
                            : <span className="text-gray-400">-</span>
                          }
                        </td>
                        <td className="p-2 truncate max-w-[120px]" title={snap.vcenterName}>{snap.vcenterName?.split('.')[0]}</td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-muted/50">
                          <td colSpan={8} className="p-3">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              
                              {/* Snapshot Details */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-blue-600">
                                  <Camera className="w-3.5 h-3.5" />Snapshot Details
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">Snapshot ID:</span><span className="font-medium text-[10px]">{snap.snapshotId}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Depth:</span><span className="font-medium">{snap.snapshotDepth || 1}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Quiesced:</span><span className="font-medium">{snap.quiesced ? 'Yes' : 'No'}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Replay Supported:</span><span className="font-medium">{snap.replaySupported ? 'Yes' : 'No'}</span></div>
                                </div>
                              </div>

                              {/* VM Info */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-green-600">
                                  <Server className="w-3.5 h-3.5" />VM Info
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">VM Name:</span><span className="font-medium">{snap.vmName}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">VM ID:</span><span className="font-medium">{snap.vmId}</span></div>
                                  <div className="flex justify-between items-center"><span className="text-muted-foreground">Power:</span>{getPowerBadge(snap)}</div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">vCenter:</span><span className="font-medium">{snap.vcenterName?.split('.')[0]}</span></div>
                                </div>
                              </div>

                              {/* Time Info */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-orange-600">
                                  <Calendar className="w-3.5 h-3.5" />Time Info
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">Created:</span><span className="font-medium">{snap.createTime}</span></div>
                                  <div className="flex justify-between items-center"><span className="text-muted-foreground">Age:</span>{getAgeBadge(snap)}</div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Current:</span>
                                    {snap.isCurrent 
                                      ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">Yes</span>
                                      : <span className="text-gray-400">No</span>
                                    }
                                  </div>
                                </div>
                              </div>

                              {/* Description */}
                              {snap.description && (
                                <div className="bg-background p-2.5 rounded border text-xs md:col-span-3">
                                  <h4 className="font-semibold mb-1 text-purple-600">Description</h4>
                                  <p className="text-muted-foreground">{snap.description}</p>
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
          
          {filteredSnapshots.length > 100 && (
            <div className="p-2 text-center text-xs text-muted-foreground border-t bg-muted/30">
              Showing 100 of {filteredSnapshots.length} snapshots
            </div>
          )}
          
          {filteredSnapshots.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No snapshots found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
