/**
 * TLS Certificate expiry monitor for ESXi hosts + vCenter Servers.
 *
 * The backend caches the scan alongside the rest of the vSphere data cache
 * (refreshed every 30 min via background_refresh). This page can also kick
 * an on-demand rescan without waiting for the next window.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, ShieldAlert, ShieldX, RefreshCw, Search, Filter, AlertTriangle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { getThresholds } from '@/lib/thresholds';
import { cn, shortHost } from '@/lib/utils';

interface CertEntry {
  host: string;
  kind: 'esxi' | 'vcenter';
  vcenter: string;
  status: 'ok' | 'warning' | 'critical' | 'expired' | 'error';
  message?: string;
  subject?: string;
  issuer?: string;
  notBefore?: string;
  notAfter?: string;
  daysUntilExpiry?: number;
  serialNumber?: string;
  san?: string[];
  signatureAlgorithm?: string;
  selfSigned?: boolean;
}

const STATUS_ORDER = { expired: 0, critical: 1, warning: 2, error: 3, ok: 4 } as const;

function StatusBadge({ status, days }: { status: CertEntry['status']; days?: number }) {
  const label = status === 'ok' ? 'OK'
    : status === 'warning' ? `Expiring in ${days ?? '?'}d`
    : status === 'critical' ? `Critical: ${days ?? '?'}d`
    : status === 'expired' ? `Expired ${days !== undefined ? Math.abs(days) + 'd ago' : ''}`
    : 'Error';
  const cls = status === 'ok' ? 'bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30'
    : status === 'warning' ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30'
    : status === 'critical' ? 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30'
    : status === 'expired' ? 'bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30'
    : 'bg-slate-500/20 text-slate-700 dark:text-slate-400 border-slate-500/30';
  return <Badge className={cls}>{label}</Badge>;
}

export default function CertificatesPage() {
  const [rows, setRows] = useState<CertEntry[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({ ok: 0, warning: 0, critical: 0, expired: 0, error: 0 });
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'esxi' | 'vcenter'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | CertEntry['status']>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const t = useMemo(() => getThresholds(), []);

  const load = async () => {
    setLoading(true);
    const r = await api.getCertificates(t.certWarnDays, t.certCriticalDays);
    if (r.success && Array.isArray(r.data)) {
      setRows(r.data as CertEntry[]);
      setSummary((r as any).summary || {});
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const rescan = async () => {
    setRescanning(true);
    await api.refreshCertificates();
    // Poll a couple of times until the cache picks up the new scan.
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const r = await api.getCertificates(t.certWarnDays, t.certCriticalDays);
      if (r.success && Array.isArray(r.data) && r.data.length > 0) {
        setRows(r.data as CertEntry[]);
        setSummary((r as any).summary || {});
        break;
      }
    }
    setRescanning(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => kindFilter === 'all' || r.kind === kindFilter)
      .filter(r => statusFilter === 'all' || r.status === statusFilter)
      .filter(r => !q
        || r.host.toLowerCase().includes(q)
        || (r.subject || '').toLowerCase().includes(q)
        || (r.issuer || '').toLowerCase().includes(q))
      .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || a.host.localeCompare(b.host));
  }, [rows, search, kindFilter, statusFilter]);

  const attention = (summary.expired || 0) + (summary.critical || 0) + (summary.warning || 0);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">TLS Certificates</h1>
          <span className="text-sm text-muted-foreground">
            ({rows.length} scanned · warn ≤ {t.certWarnDays}d · critical ≤ {t.certCriticalDays}d)
          </span>
        </div>
        <Button variant="outline" onClick={rescan} disabled={rescanning || loading}>
          <RefreshCw className={cn('w-4 h-4 mr-2', (rescanning || loading) && 'animate-spin')} />
          {rescanning ? 'Rescanning…' : 'Rescan now'}
        </Button>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <SummaryChip label="Expired" count={summary.expired || 0} tone="red" icon={<ShieldX className="w-4 h-4" />} />
        <SummaryChip label="Critical" count={summary.critical || 0} tone="orange" icon={<ShieldAlert className="w-4 h-4" />} />
        <SummaryChip label="Warning" count={summary.warning || 0} tone="yellow" icon={<AlertTriangle className="w-4 h-4" />} />
        <SummaryChip label="OK" count={summary.ok || 0} tone="green" icon={<ShieldCheck className="w-4 h-4" />} />
        <SummaryChip label="Errors" count={summary.error || 0} tone="slate" icon={<Filter className="w-4 h-4" />} />
      </div>

      {/* Attention banner */}
      {attention > 0 && (
        <Card className="border-orange-500/40 bg-orange-500/5">
          <CardContent className="p-3 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            <span>
              {attention} certificate{attention === 1 ? '' : 's'} need attention.
              {(summary.expired || 0) > 0 && ' Some are already expired — ESXi API access may be intermittent.'}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search host, subject, issuer…"
                 value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={kindFilter} onValueChange={(v: any) => setKindFilter(v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All targets</SelectItem>
            <SelectItem value="esxi">ESXi hosts</SelectItem>
            <SelectItem value="vcenter">vCenter</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="ok">OK</SelectItem>
            <SelectItem value="error">Errors only</SelectItem>
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
                  <th className="text-left p-2 font-semibold">Host</th>
                  <th className="w-20 p-2 font-semibold text-center">Kind</th>
                  <th className="w-36 p-2 font-semibold text-center">Status</th>
                  <th className="w-40 p-2 font-semibold text-left">Expires</th>
                  <th className="text-left p-2 font-semibold">Issuer</th>
                  <th className="w-14 p-2 font-semibold text-center">Self-signed</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && !loading && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No certificates match.</td></tr>
                )}
                {filtered.map((r) => {
                  const key = `${r.kind}:${r.host}`;
                  const isOpen = expanded.has(key);
                  return (
                    <>
                      <tr key={key} className="border-b hover:bg-muted/30 cursor-pointer"
                          onClick={() => {
                            const s = new Set(expanded);
                            s.has(key) ? s.delete(key) : s.add(key);
                            setExpanded(s);
                          }}>
                        <td className="p-2 font-medium">{shortHost(r.host)}</td>
                        <td className="p-2 text-center">
                          <Badge variant="outline" className="text-[10px]">{r.kind}</Badge>
                        </td>
                        <td className="p-2 text-center">
                          <StatusBadge status={r.status} days={r.daysUntilExpiry} />
                        </td>
                        <td className="p-2 text-[11px]">
                          {r.notAfter ? new Date(r.notAfter).toLocaleString() : '—'}
                        </td>
                        <td className="p-2 truncate max-w-[280px]" title={r.issuer}>{r.issuer || '—'}</td>
                        <td className="p-2 text-center">
                          {r.selfSigned === undefined ? '—' : (r.selfSigned ? 'Yes' : 'No')}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={key + ':exp'} className="bg-muted/40">
                          <td colSpan={6} className="p-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                              <Detail label="Host" value={r.host} />
                              <Detail label="vCenter" value={r.vcenter} />
                              <Detail label="Subject" value={r.subject} />
                              <Detail label="Issuer" value={r.issuer} />
                              <Detail label="Not Before" value={r.notBefore} />
                              <Detail label="Not After" value={r.notAfter} />
                              <Detail label="Serial" value={r.serialNumber} mono />
                              <Detail label="Signature" value={r.signatureAlgorithm} />
                              <Detail label="SAN" value={(r.san || []).join(', ')} />
                              {r.status === 'error' && <Detail label="Error" value={r.message} tone="red" />}
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
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryChip({
  label, count, tone, icon,
}: { label: string; count: number; tone: 'red'|'orange'|'yellow'|'green'|'slate'; icon: React.ReactNode }) {
  const tones = {
    red: 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400',
    orange: 'bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400',
    yellow: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400',
    green: 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400',
    slate: 'bg-slate-500/10 border-slate-500/30 text-slate-700 dark:text-slate-400',
  } as const;
  return (
    <div className={cn('rounded border px-3 py-2 flex items-center gap-2', tones[tone])}>
      {icon}
      <div>
        <div className="text-xl font-bold leading-none">{count}</div>
        <div className="text-[10px] uppercase tracking-wide">{label}</div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono, tone }: { label: string; value?: string; mono?: boolean; tone?: 'red' }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-muted-foreground uppercase tracking-wide text-[10px]">{label}</div>
      <div className={cn(mono && 'font-mono break-all', tone === 'red' && 'text-red-500')}>{value}</div>
    </div>
  );
}
