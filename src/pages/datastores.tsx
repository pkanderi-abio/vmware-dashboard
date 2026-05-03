/**
 * Datastores Page - Capacity and Health Monitoring
 */
import { useEffect, useState } from 'react';
import {
  HardDrive, RefreshCw, Search, CheckCircle, XCircle,
  AlertTriangle, Database, Server, ChevronRight, ChevronDown, Download
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getThresholds } from '@/lib/thresholds';

interface Datastore {
  ID?: number;
  datastoreId?: string;
  datastoreName?: string;
  name?: string;
  type?: string;
  capacityGB?: string | number;
  freeSpaceGB?: string | number;
  usedSpaceGB?: string | number;
  usagePct?: string | number;
  accessible?: { Value: string } | string;
  vcenterName?: string;
  hostCount?: string | number;
  vmCount?: string | number;
}

function getName(d: Datastore) { return d.datastoreName || d.name || 'Unknown'; }
function getUsage(d: Datastore) { return parseInt(String(d.usagePct ?? 0)); }
function getCapacityGB(d: Datastore) { return parseInt(String(d.capacityGB ?? 0)); }
function getFreeGB(d: Datastore) { return parseInt(String(d.freeSpaceGB ?? 0)); }
function isAccessible(d: Datastore) {
  const val = typeof d.accessible === 'object' ? d.accessible?.Value : d.accessible;
  if (val === undefined || val === null) return true;
  return String(val).toLowerCase() !== 'no' && String(val).toLowerCase() !== 'false';
}
function getUsageSeverity(pct: number, criticalPct: number, warningPct: number): 'ok' | 'warning' | 'critical' {
  if (pct >= criticalPct) return 'critical';
  if (pct >= warningPct) return 'warning';
  return 'ok';
}

export default function DatastoresPage() {
  const [datastores, setDatastores] = useState<Datastore[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const thresholds = getThresholds();

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  useEffect(() => { void loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.getDatastores();
      if (res.success && res.data) setDatastores(res.data);
    } catch (err) {
      console.error('Failed to load datastores:', err);
    } finally {
      setLoading(false);
    }
  };

  const types = ['all', ...Array.from(new Set(datastores.map(d => d.type || 'Unknown')))];

  const filtered = datastores.filter(d => {
    const term = search.toLowerCase();
    const matchSearch = !term ||
      getName(d).toLowerCase().includes(term) ||
      (d.vcenterName || '').toLowerCase().includes(term) ||
      (d.type || '').toLowerCase().includes(term);
    const matchType = typeFilter === 'all' || (d.type || 'Unknown') === typeFilter;
    const accessible = isAccessible(d);
    const usage = getUsage(d);
    const matchStatus = statusFilter === 'all' ||
      (statusFilter === 'inaccessible' && !accessible) ||
      (statusFilter === 'critical' && accessible && usage >= thresholds.storageCritical) ||
      (statusFilter === 'warning' && accessible && usage >= thresholds.storageWarning && usage < thresholds.storageCritical) ||
      (statusFilter === 'healthy' && accessible && usage < thresholds.storageWarning);
    return matchSearch && matchType && matchStatus;
  });

  const totalCapacityGB = datastores.reduce((s, d) => s + getCapacityGB(d), 0);
  const totalFreeGB = datastores.reduce((s, d) => s + getFreeGB(d), 0);
  const overallUsage = totalCapacityGB > 0
    ? Math.round(((totalCapacityGB - totalFreeGB) / totalCapacityGB) * 100)
    : 0;
  const criticalCount = datastores.filter(d => isAccessible(d) && getUsage(d) >= thresholds.storageCritical).length;
  const warningCount = datastores.filter(d => isAccessible(d) && getUsage(d) >= thresholds.storageWarning && getUsage(d) < thresholds.storageCritical).length;
  const inaccessibleCount = datastores.filter(d => !isAccessible(d)).length;

  const exportCSV = () => {
    const h = ['Name','Type','vCenter','Capacity GB','Free GB','Used GB','Usage%','Accessible','Host Count','VM Count'];
    const rows = filtered.map(d => [
      getName(d), d.type || 'Unknown', d.vcenterName || '',
      getCapacityGB(d), getFreeGB(d),
      parseInt(String(d.usedSpaceGB ?? (getCapacityGB(d) - getFreeGB(d)))),
      getUsage(d), isAccessible(d) ? 'Yes' : 'No',
      d.hostCount ?? '', d.vmCount ?? '',
    ]);
    const csv = [h,...rows].map(row => row.map(c => '"' + (c ?? '') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'datastores_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
  };

  const exportJSON = () => {
    const data = filtered.map(d => ({
      name: getName(d), datastoreId: d.datastoreId, type: d.type,
      vcenterName: d.vcenterName, capacityGB: getCapacityGB(d),
      freeGB: getFreeGB(d),
      usedGB: parseInt(String(d.usedSpaceGB ?? (getCapacityGB(d) - getFreeGB(d)))),
      usagePct: getUsage(d), accessible: isAccessible(d),
      hostCount: d.hostCount, vmCount: d.vmCount,
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)],{type:'application/json'}));
    a.download = 'datastores_' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-lg">Loading Datastores...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground">
            <HardDrive className="w-6 h-6 text-primary" />
            Datastores
          </h1>
          <p className="text-muted-foreground text-sm">{datastores.length} datastores across all vCenters</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={exportCSV} variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />CSV
          </Button>
          <Button onClick={exportJSON} variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />JSON
          </Button>
          <Button onClick={() => void loadData()} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><Database className="w-5 h-5 text-primary" /></div>
            <div><div className="text-2xl font-bold">{datastores.length}</div><div className="text-xs text-muted-foreground">Total Datastores</div></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-chart-2/10"><HardDrive className="w-5 h-5 text-chart-2" /></div>
            <div><div className="text-2xl font-bold">{(totalCapacityGB / 1024).toFixed(1)} TB</div><div className="text-xs text-muted-foreground">Total Capacity</div></div>
          </div>
          <Progress value={overallUsage} className="h-1 mt-2" />
          <div className="text-xs text-muted-foreground mt-1">{overallUsage}% used &bull; {(totalFreeGB / 1024).toFixed(1)} TB free</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className={cn('p-2 rounded-lg', criticalCount > 0 ? 'bg-destructive/10' : warningCount > 0 ? 'bg-warning/10' : 'bg-success/10')}>
              {criticalCount > 0
                ? <XCircle className="w-5 h-5 text-destructive" />
                : warningCount > 0
                  ? <AlertTriangle className="w-5 h-5 text-warning" />
                  : <CheckCircle className="w-5 h-5 text-success" />}
            </div>
            <div>
              <div className={cn('text-2xl font-bold', criticalCount > 0 ? 'text-destructive' : warningCount > 0 ? 'text-warning' : 'text-success')}>{criticalCount + warningCount}</div>
              <div className="text-xs text-muted-foreground">Space Alerts</div>
            </div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className={cn('p-2 rounded-lg', inaccessibleCount > 0 ? 'bg-destructive/10' : 'bg-success/10')}>
              {inaccessibleCount > 0 ? <XCircle className="w-5 h-5 text-destructive" /> : <CheckCircle className="w-5 h-5 text-success" />}
            </div>
            <div>
              <div className={cn('text-2xl font-bold', inaccessibleCount > 0 ? 'text-destructive' : 'text-success')}>{inaccessibleCount > 0 ? inaccessibleCount : 'All OK'}</div>
              <div className="text-xs text-muted-foreground">Accessibility</div>
            </div>
          </div>
        </CardContent></Card>
      </div>

      <Card><CardContent className="p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search by name, vCenter, type..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {types.map(t => (
              <Button key={t} variant={typeFilter === t ? 'default' : 'outline'} size="sm" onClick={() => setTypeFilter(t)}>
                {t === 'all' ? 'All Types' : t}
              </Button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            {([{key:'all',label:'All'},{key:'healthy',label:'Healthy'},{key:'warning',label:'Warning'},{key:'critical',label:'Critical'},{key:'inaccessible',label:'Inaccessible'}] as const).map(s => (
              <Button key={s.key} variant={statusFilter === s.key ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s.key)}>
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      </CardContent></Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-primary" />
            Datastores ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <HardDrive className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p>No datastores found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-muted/30">
                  <tr>
                    <th className="w-8 py-3 px-2"></th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Name</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Type</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">vCenter</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Capacity</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Free</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground w-48">Usage</th>
                    <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d, i) => {
                    const accessible = isAccessible(d);
                    const usage = getUsage(d);
                    const severity = accessible ? getUsageSeverity(usage, thresholds.storageCritical, thresholds.storageWarning) : 'critical';
                    const capacityGB = getCapacityGB(d);
                    const freeGB = getFreeGB(d);
                    const usedGB = parseInt(String(d.usedSpaceGB ?? (capacityGB - freeGB)));
                    const rowId = d.datastoreId || String(i);
                    const isExpanded = expandedRows.has(rowId);
                    return (
                      <>
                        <tr
                          key={rowId}
                          className={cn('border-b hover:bg-muted/30 transition-colors cursor-pointer', isExpanded && 'bg-muted/20')}
                          onClick={() => toggleRow(rowId)}
                        >
                          <td className="py-3 px-2 text-center text-muted-foreground">
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5 inline" /> : <ChevronRight className="w-3.5 h-3.5 inline" />}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <HardDrive className={cn('w-4 h-4 shrink-0', severity === 'critical' ? 'text-destructive' : severity === 'warning' ? 'text-warning' : 'text-primary')} />
                              <span className="font-medium text-sm text-foreground">{getName(d)}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4"><Badge variant="outline" className="text-xs">{d.type || 'Unknown'}</Badge></td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Server className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[160px]">{d.vcenterName || '-'}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right text-sm text-foreground">
                            {capacityGB >= 1024 ? `${(capacityGB / 1024).toFixed(1)} TB` : `${capacityGB} GB`}
                          </td>
                          <td className="py-3 px-4 text-right text-sm text-muted-foreground">
                            {freeGB >= 1024 ? `${(freeGB / 1024).toFixed(1)} TB` : `${freeGB} GB`}
                          </td>
                          <td className="py-3 px-4">
                            {accessible ? (
                              <div className="space-y-1">
                                <Progress
                                  value={usage}
                                  className={cn('h-2',
                                    severity === 'critical' ? '[&>div]:bg-destructive' :
                                    severity === 'warning' ? '[&>div]:bg-warning' : ''
                                  )}
                                />
                                <span className={cn('text-xs font-medium',
                                  severity === 'critical' ? 'text-destructive' :
                                  severity === 'warning' ? 'text-warning' : 'text-muted-foreground'
                                )}>{usage}%</span>
                              </div>
                            ) : <span className="text-xs text-muted-foreground">-</span>}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {!accessible ? (
                              <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-xs">
                                <XCircle className="w-3 h-3 mr-1" />Inaccessible
                              </Badge>
                            ) : severity === 'critical' ? (
                              <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-xs">
                                <AlertTriangle className="w-3 h-3 mr-1" />Critical
                              </Badge>
                            ) : severity === 'warning' ? (
                              <Badge className="bg-warning/20 text-warning border-warning/30 text-xs">
                                <AlertTriangle className="w-3 h-3 mr-1" />Warning
                              </Badge>
                            ) : (
                              <Badge className="bg-success/20 text-success border-success/30 text-xs">
                                <CheckCircle className="w-3 h-3 mr-1" />Healthy
                              </Badge>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${rowId}-detail`} className="bg-muted/10 border-b">
                            <td colSpan={8} className="px-6 py-4">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Identification</h4>
                                  <div><span className="text-muted-foreground">Datastore ID:</span><br /><span className="font-mono text-xs">{d.datastoreId || '-'}</span></div>
                                  <div><span className="text-muted-foreground">Name:</span><br /><span className="font-medium">{getName(d)}</span></div>
                                  <div><span className="text-muted-foreground">Type:</span><br /><Badge variant="outline" className="text-xs mt-1">{d.type || 'Unknown'}</Badge></div>
                                  <div><span className="text-muted-foreground">vCenter:</span><br /><span>{d.vcenterName || '-'}</span></div>
                                </div>
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Capacity</h4>
                                  <div><span className="text-muted-foreground">Total Capacity:</span><br /><span className="font-medium">{capacityGB >= 1024 ? `${(capacityGB / 1024).toFixed(2)} TB` : `${capacityGB} GB`}</span></div>
                                  <div><span className="text-muted-foreground">Used Space:</span><br /><span className={cn('font-medium', severity === 'critical' ? 'text-destructive' : severity === 'warning' ? 'text-warning' : '')}>{usedGB >= 1024 ? `${(usedGB / 1024).toFixed(2)} TB` : `${usedGB} GB`}</span></div>
                                  <div><span className="text-muted-foreground">Free Space:</span><br /><span className="font-medium text-success">{freeGB >= 1024 ? `${(freeGB / 1024).toFixed(2)} TB` : `${freeGB} GB`}</span></div>
                                  <div><span className="text-muted-foreground">Usage:</span><br />
                                    <div className="flex items-center gap-2 mt-1">
                                      <Progress value={usage} className={cn('h-2 flex-1', severity === 'critical' ? '[&>div]:bg-destructive' : severity === 'warning' ? '[&>div]:bg-warning' : '')} />
                                      <span className={cn('text-xs font-bold w-10', severity === 'critical' ? 'text-destructive' : severity === 'warning' ? 'text-warning' : 'text-success')}>{usage}%</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Status & Usage</h4>
                                  <div><span className="text-muted-foreground">Accessibility:</span><br />
                                    {accessible
                                      ? <Badge className="bg-success/20 text-success border-success/30 text-xs mt-1"><CheckCircle className="w-3 h-3 mr-1" />Accessible</Badge>
                                      : <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-xs mt-1"><XCircle className="w-3 h-3 mr-1" />Inaccessible</Badge>}
                                  </div>
                                  <div><span className="text-muted-foreground">Health:</span><br />
                                    {severity === 'critical'
                                      ? <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-xs mt-1"><AlertTriangle className="w-3 h-3 mr-1" />Critical (&gt;{thresholds.storageCritical}%)</Badge>
                                      : severity === 'warning'
                                        ? <Badge className="bg-warning/20 text-warning border-warning/30 text-xs mt-1"><AlertTriangle className="w-3 h-3 mr-1" />Warning (&gt;{thresholds.storageWarning}%)</Badge>
                                        : <Badge className="bg-success/20 text-success border-success/30 text-xs mt-1"><CheckCircle className="w-3 h-3 mr-1" />Healthy</Badge>}
                                  </div>
                                </div>
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Connected Resources</h4>
                                  <div><span className="text-muted-foreground">Host Count:</span><br /><span className="font-medium text-lg">{d.hostCount ?? '-'}</span></div>
                                  <div><span className="text-muted-foreground">VM Count:</span><br /><span className="font-medium text-lg">{d.vmCount ?? '-'}</span></div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
