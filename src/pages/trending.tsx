/**
 * Capacity Trending - Historical CPU, Memory, and Storage utilization charts
 */
import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, RefreshCw, Cpu, MemoryStick, HardDrive, Monitor, Server } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getApiBase } from '@/config/api';
import { getThresholds } from '@/lib/thresholds';

interface TrendingPoint {
  timestamp: number;
  datetime: string;
  avgCpuPct: number;
  avgMemPct: number;
  avgStoragePct: number;
  totalVMs: number;
  poweredOnVMs: number;
  totalHosts: number;
  totalStorageGB: number;
  freeStorageGB: number;
}

const PERIODS: { label: string; hours: number }[] = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
];

function formatAxisDate(iso: string, totalPoints: number): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  if (totalPoints <= 48) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── SVG Line Chart ───────────────────────────────────────────────────────────
interface ChartProps {
  data: TrendingPoint[];
  metric: keyof TrendingPoint;
  color: string;
  thresholdPct?: number;
  yLabel?: string;
}

function SparkLine({ data, metric, color, thresholdPct }: ChartProps) {
  const W = 1000;
  const H = 180;
  const PAD = { top: 10, right: 16, bottom: 36, left: 36 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const toX = (i: number) => PAD.left + (data.length > 1 ? (i / (data.length - 1)) * cW : cW / 2);
  const toY = (v: number) => PAD.top + cH - (Math.min(Math.max(v, 0), 100) / 100) * cH;

  const linePoints = data.map((d, i) => `${toX(i).toFixed(1)},${toY(d[metric] as number).toFixed(1)}`).join(' ');
  const areaPoints = [
    `${PAD.left},${PAD.top + cH}`,
    ...data.map((d, i) => `${toX(i).toFixed(1)},${toY(d[metric] as number).toFixed(1)}`),
    `${toX(data.length - 1).toFixed(1)},${PAD.top + cH}`,
  ].join(' ');

  const gridLines = [0, 25, 50, 75, 100];
  const labelCount = Math.min(data.length, 6);
  const labelIndices = data.length <= 1 ? [0]
    : Array.from({ length: labelCount }, (_, i) => Math.round((i / (labelCount - 1)) * (data.length - 1)));

  const lastVal = data.length > 0 ? (data[data.length - 1][metric] as number) : 0;
  const avgVal = data.length > 0 ? data.reduce((s, d) => s + (d[metric] as number), 0) / data.length : 0;
  const maxVal = data.length > 0 ? Math.max(...data.map(d => d[metric] as number)) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>Current: <span className="font-semibold text-foreground">{lastVal.toFixed(1)}%</span></span>
        <span>Avg: <span className="font-semibold text-foreground">{avgVal.toFixed(1)}%</span></span>
        <span>Peak: <span className="font-semibold text-foreground">{maxVal.toFixed(1)}%</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
        {/* Grid */}
        {gridLines.map(y => (
          <g key={y}>
            <line x1={PAD.left} y1={toY(y)} x2={W - PAD.right} y2={toY(y)}
              stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
            <text x={PAD.left - 4} y={toY(y) + 3.5} textAnchor="end" fontSize="10"
              fill="currentColor" fillOpacity="0.45">{y}</text>
          </g>
        ))}

        {/* Threshold */}
        {thresholdPct != null && (
          <line x1={PAD.left} y1={toY(thresholdPct)} x2={W - PAD.right} y2={toY(thresholdPct)}
            stroke="#ef4444" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="6,3" />
        )}

        {/* Area */}
        {data.length > 1 && (
          <polyline points={areaPoints} fill={color} fillOpacity="0.12" stroke="none" />
        )}

        {/* Line */}
        {data.length > 1 && (
          <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Data point dot at last value */}
        {data.length > 0 && (
          <circle cx={toX(data.length - 1)} cy={toY(data[data.length - 1][metric] as number)}
            r="4" fill={color} />
        )}

        {/* X-axis labels */}
        {labelIndices.map(i => (
          <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="9"
            fill="currentColor" fillOpacity="0.45">
            {formatAxisDate(data[i]?.datetime ?? '', data.length)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ─── Capacity bar (storage TB) ────────────────────────────────────────────────
function StorageCapacityBar({ latest }: { latest: TrendingPoint | null }) {
  if (!latest) return null;
  const usedGB = latest.totalStorageGB - latest.freeStorageGB;
  const pct = latest.totalStorageGB > 0 ? (usedGB / latest.totalStorageGB) * 100 : 0;
  const color = pct >= 95 ? '#ef4444' : pct >= 85 ? '#f97316' : '#22c55e';
  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between text-muted-foreground">
        <span>Used: <span className="font-semibold text-foreground">{(usedGB / 1024).toFixed(1)} TB</span></span>
        <span>Free: <span className="font-semibold text-foreground">{(latest.freeStorageGB / 1024).toFixed(1)} TB</span></span>
        <span>Total: <span className="font-semibold text-foreground">{(latest.totalStorageGB / 1024).toFixed(1)} TB</span></span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
      </div>
      <p className="text-muted-foreground text-right">{pct.toFixed(1)}% utilized</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TrendingPage() {
  const [data, setData] = useState<TrendingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<number>(168);
  const [message, setMessage] = useState('');
  const thresholds = useMemo(() => getThresholds(), []);

  useEffect(() => { void loadData(); }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/trending?hours=${period}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data || []);
        setMessage(json.message || '');
      }
    } catch {
      setData([]);
    }
    setLoading(false);
  };

  const latest = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground">
            <TrendingUp className="w-6 h-6 text-primary" />
            Capacity Trending
          </h1>
          <p className="text-muted-foreground text-sm">
            Historical CPU, memory, and storage utilization across all vCenters
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border overflow-hidden">
            {PERIODS.map(p => (
              <button
                key={p.hours}
                onClick={() => setPeriod(p.hours)}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium transition-colors',
                  period === p.hours
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button onClick={() => void loadData()} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><Monitor className="w-5 h-5 text-blue-500" /></div>
            <div><div className="text-2xl font-bold">{latest.totalVMs}</div><div className="text-xs text-muted-foreground">Total VMs</div></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10"><Monitor className="w-5 h-5 text-green-500" /></div>
            <div><div className="text-2xl font-bold">{latest.poweredOnVMs}</div><div className="text-xs text-muted-foreground">VMs On</div></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10"><Server className="w-5 h-5 text-cyan-500" /></div>
            <div><div className="text-2xl font-bold">{latest.totalHosts}</div><div className="text-xs text-muted-foreground">ESXi Hosts</div></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-500/10"><HardDrive className="w-5 h-5 text-orange-500" /></div>
            <div><div className="text-2xl font-bold">{(latest.totalStorageGB / 1024).toFixed(1)} TB</div><div className="text-xs text-muted-foreground">Total Storage</div></div>
          </CardContent></Card>
        </div>
      )}

      {/* No data state */}
      {!loading && data.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <TrendingUp className="w-16 h-16 mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium">{message || 'No trending data yet'}</p>
            <p className="text-sm mt-1">Data is collected automatically after each background refresh (~30 min intervals).</p>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      {data.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* CPU */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-500" />
                Average CPU Utilization
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SparkLine data={data} metric="avgCpuPct" color="#06b6d4"
                thresholdPct={thresholds.cpuWarning} />
            </CardContent>
          </Card>

          {/* Memory */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MemoryStick className="w-4 h-4 text-purple-500" />
                Average Memory Utilization
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SparkLine data={data} metric="avgMemPct" color="#a855f7"
                thresholdPct={thresholds.memWarning} />
            </CardContent>
          </Card>

          {/* Storage % */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-orange-500" />
                Average Datastore Utilization
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SparkLine data={data} metric="avgStoragePct" color="#f97316"
                thresholdPct={thresholds.storageWarning} />
            </CardContent>
          </Card>

          {/* Storage capacity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-amber-500" />
                Current Storage Capacity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <StorageCapacityBar latest={latest} />
              <SparkLine data={data} metric="avgStoragePct" color="#f59e0b" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* VM count trend */}
      {data.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Monitor className="w-4 h-4 text-blue-500" />
              VM Count Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Custom chart for VM count (not %, so different scale) */}
            <VmCountChart data={data} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── VM Count Chart (Y-axis is count, not %) ─────────────────────────────────
function VmCountChart({ data }: { data: TrendingPoint[] }) {
  if (data.length < 2) return null;

  const W = 1000;
  const H = 140;
  const PAD = { top: 10, right: 16, bottom: 36, left: 44 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const totals = data.map(d => d.totalVMs);
  const onVMs = data.map(d => d.poweredOnVMs);
  const maxV = Math.max(...totals, 1);

  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * cW;
  const toY = (v: number) => PAD.top + cH - (v / maxV) * cH;

  const totalPts = data.map((_, i) => `${toX(i).toFixed(1)},${toY(totals[i]).toFixed(1)}`).join(' ');
  const onPts = data.map((_, i) => `${toX(i).toFixed(1)},${toY(onVMs[i]).toFixed(1)}`).join(' ');

  const labelCount = Math.min(data.length, 6);
  const labelIndices = Array.from({ length: labelCount }, (_, i) => Math.round((i / (labelCount - 1)) * (data.length - 1)));
  const gridVals = [0, Math.round(maxV * 0.25), Math.round(maxV * 0.5), Math.round(maxV * 0.75), maxV];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" />Total VMs: <span className="font-semibold text-foreground">{data[data.length - 1].totalVMs}</span></span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" />Powered On: <span className="font-semibold text-foreground">{data[data.length - 1].poweredOnVMs}</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }}>
        {gridVals.map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)}
              stroke="currentColor" strokeOpacity="0.08" />
            <text x={PAD.left - 4} y={toY(v) + 3.5} textAnchor="end" fontSize="10"
              fill="currentColor" fillOpacity="0.45">{v}</text>
          </g>
        ))}
        <polyline points={totalPts} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={onPts} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" strokeDasharray="5,2" />
        {labelIndices.map(i => (
          <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="9"
            fill="currentColor" fillOpacity="0.45">
            {formatAxisDate(data[i]?.datetime ?? '', data.length)}
          </text>
        ))}
      </svg>
    </div>
  );
}
