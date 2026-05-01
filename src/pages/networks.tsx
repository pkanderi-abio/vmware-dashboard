/**
 * Networks Page - Network Inventory
 * Consistent styling with other pages
 */
import { useEffect, useState, useMemo, Fragment } from 'react';
import {
  Network, Search, RefreshCw, ChevronDown, ChevronRight,
  Download, ArrowUpDown, Globe, Server, Monitor,
  CheckCircle, XCircle
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { API_BASE } from '@/config/api';

interface NetworkItem {
  networkId: string;
  vcenterName: string;
  networkName: string;
  type: string;
  accessible: any;
  hostCount: number;
  vmCount: number;
}

function isAccessible(net: NetworkItem): boolean {
  if (typeof net.accessible === 'object' && net.accessible?.Value) {
    return net.accessible.Value.toLowerCase() === 'yes' || net.accessible.Value === true;
  }
  return net.accessible === true || net.accessible === 'Yes' || net.accessible === 'yes';
}

export default function NetworksPage() {
  const [networks, setNetworks] = useState<NetworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string>('networkName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterVCenter, setFilterVCenter] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(API_BASE + '/api/networks');
      const data = await res.json();
      if (data.success && data.data) setNetworks(data.data);
      else if (data.data) setNetworks(data.data);
    } catch (err) {
      console.error('Failed to load networks:', err);
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

  const vCenters = useMemo(() => [...new Set(networks.map(n => n.vcenterName).filter(Boolean))].sort(), [networks]);
  const types = useMemo(() => [...new Set(networks.map(n => n.type).filter(Boolean))].sort(), [networks]);

  // Stats calculation
  const stats = useMemo(() => {
    let total = 0, accessible = 0, inaccessible = 0;
    let totalVMs = 0, totalHosts = 0;
    const typeCounts: Record<string, number> = {};
    
    networks.forEach(net => {
      total++;
      
      if (isAccessible(net)) accessible++;
      else inaccessible++;
      
      totalVMs += parseInt(String(net.vmCount || 0)) || 0;
      totalHosts += parseInt(String(net.hostCount || 0)) || 0;
      
      const t = net.type || 'Unknown';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    
    return { total, accessible, inaccessible, totalVMs, totalHosts, typeCounts };
  }, [networks]);

  // Filter networks
  const filteredNetworks = useMemo(() => {
    let result = [...networks];

    switch (activeTab) {
      case 'accessible': result = result.filter(n => isAccessible(n)); break;
      case 'inaccessible': result = result.filter(n => !isAccessible(n)); break;
    }

    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter(n => 
        n.networkName?.toLowerCase().includes(s) || 
        n.vcenterName?.toLowerCase().includes(s) ||
        n.type?.toLowerCase().includes(s)
      );
    }
    
    if (filterVCenter !== 'all') result = result.filter(n => n.vcenterName === filterVCenter);
    if (filterType !== 'all') result = result.filter(n => n.type === filterType);

    result.sort((a, b) => {
      let av: any = (a as any)[sortField] || '';
      let bv: any = (b as any)[sortField] || '';
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      return av < bv ? (sortDirection === 'asc' ? -1 : 1) : av > bv ? (sortDirection === 'asc' ? 1 : -1) : 0;
    });
    
    return result;
  }, [networks, searchTerm, filterVCenter, filterType, sortField, sortDirection, activeTab]);

  const getAccessibleBadge = (net: NetworkItem) => {
    return isAccessible(net)
      ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">Yes</span>
      : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">No</span>;
  };

  const exportCSV = () => {
    const h = ['Network Name','Type','vCenter','Accessible','VMs','Hosts'];
    const rows = filteredNetworks.map(n => [n.networkName,n.type,n.vcenterName,isAccessible(n)?'Yes':'No',n.vmCount,n.hostCount]);
    const csv = [h,...rows].map(row => row.map(c => '"' + (c||'') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'networks_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      <span className="ml-3">Loading Networks...</span>
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            Networks
            <span className="text-sm font-normal text-muted-foreground">({filteredNetworks.length} of {networks.length})</span>
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
          <Network className="w-3 h-3 text-blue-500" /><span className="font-semibold">{stats.total}</span> Networks
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-green-50 text-xs">
          <CheckCircle className="w-3 h-3 text-green-500" /><span className="font-semibold text-green-600">{stats.accessible}</span> Accessible
        </div>
        {stats.inaccessible > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 text-xs">
            <XCircle className="w-3 h-3 text-red-500" /><span className="font-semibold text-red-600">{stats.inaccessible}</span> Inaccessible
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-50 text-xs">
          <Monitor className="w-3 h-3 text-blue-500" /><span className="font-semibold text-blue-600">{stats.totalVMs.toLocaleString()}</span> VMs
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
          <Server className="w-3 h-3 text-gray-500" /><span className="font-semibold">{stats.totalHosts.toLocaleString()}</span> Hosts
        </div>
        {Object.entries(stats.typeCounts).slice(0, 4).map(([type, count]) => (
          <div key={type} className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 text-xs">
            <span className="font-semibold">{count}</span> {type}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8 p-0.5 gap-0.5 flex-wrap">
          <TabsTrigger value="all" className="text-[11px] h-7 px-2">All ({stats.total})</TabsTrigger>
          <TabsTrigger value="accessible" className="text-[11px] h-7 px-2 text-green-600">Accessible ({stats.accessible})</TabsTrigger>
          {stats.inaccessible > 0 && <TabsTrigger value="inaccessible" className="text-[11px] h-7 px-2 text-red-600">Inaccessible ({stats.inaccessible})</TabsTrigger>}
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search network, vCenter..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>
        <Select value={filterVCenter} onValueChange={setFilterVCenter}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="All vCenters" /></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All vCenters</SelectItem>
            {vCenters.map(vc => <SelectItem key={vc} value={vc || ''}>{vc?.split('.')[0]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All Types</SelectItem>
            {types.map(t => <SelectItem key={t} value={t || ''}>{t}</SelectItem>)}
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
                  <th className="text-left p-2 font-semibold cursor-pointer whitespace-nowrap" onClick={() => handleSort('networkName')}>
                    <span className="flex items-center gap-1">Network Name <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-24 p-2 font-semibold text-center whitespace-nowrap cursor-pointer" onClick={() => handleSort('type')}>
                    <span className="flex items-center justify-center gap-1">Type <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-16 p-2 font-semibold text-center whitespace-nowrap">Access</th>
                  <th className="w-32 p-2 font-semibold text-left whitespace-nowrap">vCenter</th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap cursor-pointer" onClick={() => handleSort('vmCount')}>
                    <span className="flex items-center justify-center gap-1">VMs <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="w-14 p-2 font-semibold text-center whitespace-nowrap">Hosts</th>
                </tr>
              </thead>
              <tbody>
                {filteredNetworks.slice(0, 100).map((net) => {
                  const id = net.networkId || net.networkName;
                  const isExpanded = expandedRows.has(id);

                  return (
                    <Fragment key={id}>
                      <tr 
                        className={cn(
                          "border-b cursor-pointer transition-colors",
                          isExpanded ? "bg-muted" : "hover:bg-muted/30",
                          !isAccessible(net) && "bg-red-50/30"
                        )} 
                        onClick={() => toggleRow(id)}
                      >
                        <td className="p-2 text-center">
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </td>
                        <td className="p-2 font-medium truncate max-w-[300px]" title={net.networkName}>{net.networkName}</td>
                        <td className="p-2 text-center">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100">{net.type || '-'}</span>
                        </td>
                        <td className="p-2 text-center">{getAccessibleBadge(net)}</td>
                        <td className="p-2 truncate max-w-[150px]" title={net.vcenterName}>{net.vcenterName?.split('.')[0]}</td>
                        <td className="p-2 text-center">{net.vmCount || 0}</td>
                        <td className="p-2 text-center">{net.hostCount || 0}</td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-muted/50">
                          <td colSpan={7} className="p-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              
                              {/* Details */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-blue-600">
                                  <Globe className="w-3.5 h-3.5" />Details
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">Network ID:</span><span className="font-medium">{net.networkId}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">vCenter:</span><span className="font-medium">{net.vcenterName}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Type:</span><span className="font-medium">{net.type || '-'}</span></div>
                                  <div className="flex justify-between items-center"><span className="text-muted-foreground">Accessible:</span>{getAccessibleBadge(net)}</div>
                                </div>
                              </div>

                              {/* Connections */}
                              <div className="bg-background p-2.5 rounded border text-xs">
                                <h4 className="font-semibold mb-2 flex items-center gap-1.5 text-green-600">
                                  <Server className="w-3.5 h-3.5" />Connections
                                </h4>
                                <div className="space-y-1">
                                  <div className="flex justify-between"><span className="text-muted-foreground">VMs:</span><span className="font-medium">{net.vmCount || 0}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Hosts:</span><span className="font-medium">{net.hostCount || 0}</span></div>
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
          
          {filteredNetworks.length > 100 && (
            <div className="p-2 text-center text-xs text-muted-foreground border-t bg-muted/30">
              Showing 100 of {filteredNetworks.length} networks
            </div>
          )}
          
          {filteredNetworks.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Network className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No networks found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
