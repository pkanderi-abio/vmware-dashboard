/**
 * vCenter Health Page - Enhanced Visual Design
 */
import { useEffect, useState } from 'react';
import {
  Server, RefreshCw, Wifi, WifiOff, Shield, ShieldCheck, ShieldX,
  Activity, Clock, CheckCircle, XCircle, AlertTriangle,
  Loader2, Globe, Lock, Unlock, Zap, Network, Eye, TrendingUp,
  AlertCircle, ChevronRight, ExternalLink
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import { getApiBase } from '@/config/api';

interface VCenterHealth {
  hostname: string;
  short_name: string;
  status: string;
  message: string;
  ping: string;
  https: string;
  sdk: string;
  session: string;
  latency_ms: number | null;
  checked_at: string;
}

interface HealthSummary {
  total: number;
  healthy: number;
  service_ok: number;
  degraded: number;
  auth_failed: number;
  auth_failed_ldap: number;
  unreachable: number;
  unknown: number;
  last_check: string;
  vcenters: VCenterHealth[];
}

export default function VCenterHealthPage() {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkingHost, setCheckingHost] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const res = await fetch(`${getApiBase()}/vcenter-health`);
      const data = await res.json();
      if (data.success) setSummary(data.data);
    } catch (err) {
      console.error('Failed to load health data:', err);
    }
    setLoading(false);
  };

  const triggerFullCheck = async () => {
    setChecking(true);
    try {
      await fetch(`${getApiBase()}/vcenter-health/check`, { method: 'POST' });
      setTimeout(() => { loadData(); setChecking(false); }, 15000);
    } catch (err) {
      setChecking(false);
    }
  };

  const triggerSingleCheck = async (hostname: string) => {
    setCheckingHost(hostname);
    try {
      await fetch(`${getApiBase()}/vcenter-health/check/${hostname}`, { method: 'POST' });
      await loadData();
    } catch (err) {}
    setCheckingHost(null);
  };

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { icon: any; color: string; bg: string; border: string; label: string }> = {
      'healthy': { icon: ShieldCheck, color: 'text-green-600', bg: 'bg-green-500/10', border: 'border-green-500/30', label: 'Healthy' },
      'service_ok': { icon: Shield, color: 'text-blue-600', bg: 'bg-blue-500/10', border: 'border-blue-500/30', label: 'Service OK' },
      'degraded': { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', label: 'Degraded' },
      'auth_failed': { icon: ShieldX, color: 'text-red-600', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Auth Failed' },
      'auth_failed_ldap': { icon: ShieldX, color: 'text-red-600', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'LDAP Issue' },
      'auth_failed_creds': { icon: Lock, color: 'text-red-600', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Bad Credentials' },
      'auth_timeout': { icon: Clock, color: 'text-orange-600', bg: 'bg-orange-500/10', border: 'border-orange-500/30', label: 'Auth Timeout' },
      'ssl_error': { icon: AlertCircle, color: 'text-purple-600', bg: 'bg-purple-500/10', border: 'border-purple-500/30', label: 'SSL Error' },
      'unreachable': { icon: WifiOff, color: 'text-gray-600', bg: 'bg-gray-500/10', border: 'border-gray-500/30', label: 'Unreachable' },
      'service_down': { icon: XCircle, color: 'text-gray-600', bg: 'bg-gray-500/10', border: 'border-gray-500/30', label: 'Service Down' },
    };
    return configs[status] || { icon: AlertCircle, color: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-500/30', label: 'Unknown' };
  };

  const getCheckIcon = (status: string) => {
    if (status === 'ok') return <CheckCircle className="w-5 h-5 text-green-500" />;
    if (status === 'failed' || status === 'error') return <XCircle className="w-5 h-5 text-red-500" />;
    if (status === 'timeout') return <Clock className="w-5 h-5 text-yellow-500" />;
    if (status === 'connected') return <Unlock className="w-5 h-5 text-green-500" />;
    return <AlertCircle className="w-5 h-5 text-gray-400" />;
  };

  const formatTime = (isoString: string) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-background to-muted/30">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading vCenter Health...</p>
        </div>
      </div>
    );
  }

  const healthyPct = summary ? (summary.healthy / summary.total * 100) : 0;
  const sortedVCenters = summary?.vcenters?.sort((a, b) => {
    const order = ['unreachable', 'auth_failed_ldap', 'auth_failed', 'degraded', 'service_ok', 'healthy'];
    return order.indexOf(a.status) - order.indexOf(b.status);
  }) || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-xl">
                <Activity className="w-8 h-8 text-primary" />
              </div>
              vCenter Health Monitor
            </h1>
            <p className="text-muted-foreground mt-1">
              Real-time connectivity and authentication status
            </p>
          </div>
          <div className="flex items-center gap-3">
            {summary?.last_check && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                <Clock className="w-4 h-4" />
                Last: {formatTime(summary.last_check)}
              </div>
            )}
            <Button onClick={triggerFullCheck} disabled={checking} size="lg" className="shadow-lg">
              {checking ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Checking...</>
              ) : (
                <><Zap className="w-5 h-5 mr-2" />Check All</>
              )}
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-500/20">
                  <Server className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <div className="text-3xl font-bold">{summary?.total || 0}</div>
                  <div className="text-xs text-muted-foreground font-medium">Total</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-green-500/20">
                  <ShieldCheck className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <div className="text-3xl font-bold text-green-600">{summary?.healthy || 0}</div>
                  <div className="text-xs text-muted-foreground font-medium">Healthy</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 border-yellow-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-yellow-500/20">
                  <AlertTriangle className="w-6 h-6 text-yellow-500" />
                </div>
                <div>
                  <div className="text-3xl font-bold text-yellow-600">{(summary?.degraded || 0) + (summary?.service_ok || 0)}</div>
                  <div className="text-xs text-muted-foreground font-medium">Degraded</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={cn("bg-gradient-to-br from-red-500/10 to-red-500/5 border-red-500/20", (summary?.auth_failed || 0) > 0 && "ring-2 ring-red-500/50")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/20">
                  <ShieldX className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <div className="text-3xl font-bold text-red-600">{summary?.auth_failed || 0}</div>
                  <div className="text-xs text-muted-foreground font-medium">Auth Failed</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={cn("bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20", (summary?.auth_failed_ldap || 0) > 0 && "ring-2 ring-purple-500/50")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-500/20">
                  <Lock className="w-6 h-6 text-purple-500" />
                </div>
                <div>
                  <div className="text-3xl font-bold text-purple-600">{summary?.auth_failed_ldap || 0}</div>
                  <div className="text-xs text-muted-foreground font-medium">LDAP Issue</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={cn("bg-gradient-to-br from-gray-500/10 to-gray-500/5 border-gray-500/20", (summary?.unreachable || 0) > 0 && "ring-2 ring-orange-500/50")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gray-500/20">
                  <WifiOff className="w-6 h-6 text-gray-500" />
                </div>
                <div>
                  <div className="text-3xl font-bold text-gray-600">{summary?.unreachable || 0}</div>
                  <div className="text-xs text-muted-foreground font-medium">Unreachable</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Overall Health Progress */}
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-primary" />
                <span className="font-semibold text-lg">Overall Health Score</span>
              </div>
              <span className={cn(
                "text-3xl font-bold",
                healthyPct >= 80 ? "text-green-600" : healthyPct >= 50 ? "text-yellow-600" : "text-red-600"
              )}>{healthyPct.toFixed(0)}%</span>
            </div>
            <div className="relative">
              <Progress 
                value={healthyPct} 
                className={cn(
                  "h-4 rounded-full",
                  healthyPct >= 80 ? "" : healthyPct >= 50 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-red-500"
                )} 
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-medium text-white drop-shadow">
                  {summary?.healthy || 0} / {summary?.total || 0} vCenters Healthy
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Health Check Legend */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <span className="font-semibold text-muted-foreground">Health Checks:</span>
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-blue-500" />
                <span>Ping</span>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-purple-500" />
                <span>HTTPS/Web UI</span>
              </div>
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-cyan-500" />
                <span>SDK/API</span>
              </div>
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-green-500" />
                <span>Authentication</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* vCenter Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedVCenters.map((vc) => {
            const config = getStatusConfig(vc.status);
            const StatusIcon = config.icon;
            
            return (
              <Card 
                key={vc.hostname} 
                className={cn(
                  "overflow-hidden transition-all duration-200 hover:shadow-lg",
                  config.bg,
                  config.border,
                  "border-2"
                )}
              >
                {/* Status Bar */}
                <div className={cn(
                  "h-1.5",
                  vc.status === 'healthy' && "bg-green-500",
                  vc.status?.includes('auth_failed') && "bg-red-500",
                  vc.status === 'unreachable' && "bg-gray-500",
                  vc.status === 'degraded' && "bg-yellow-500",
                  vc.status === 'service_ok' && "bg-blue-500"
                )} />
                
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2.5 rounded-xl", config.bg)}>
                        <StatusIcon className={cn("w-6 h-6", config.color)} />
                      </div>
                      <div>
                        <CardTitle className="text-xl">{vc.short_name}</CardTitle>
                        <CardDescription className="text-xs font-mono">{vc.hostname}</CardDescription>
                      </div>
                    </div>
                    <Badge className={cn("capitalize", config.bg, config.color, "border-0")}>
                      {config.label}
                    </Badge>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  {/* Status Message */}
                  <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-2.5 border">
                    {vc.message || 'No status message'}
                  </p>
                  
                  {/* Health Checks Grid */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="flex flex-col items-center p-2.5 bg-background rounded-lg border">
                      {getCheckIcon(vc.ping)}
                      <span className="text-xs mt-1 text-muted-foreground font-medium">Ping</span>
                      {vc.latency_ms && <span className="text-xs text-green-600">{vc.latency_ms}ms</span>}
                    </div>
                    <div className="flex flex-col items-center p-2.5 bg-background rounded-lg border">
                      {getCheckIcon(vc.https)}
                      <span className="text-xs mt-1 text-muted-foreground font-medium">HTTPS</span>
                    </div>
                    <div className="flex flex-col items-center p-2.5 bg-background rounded-lg border">
                      {getCheckIcon(vc.sdk)}
                      <span className="text-xs mt-1 text-muted-foreground font-medium">SDK</span>
                    </div>
                    <div className="flex flex-col items-center p-2.5 bg-background rounded-lg border">
                      {vc.session === 'connected' ? (
                        <Unlock className="w-5 h-5 text-green-500" />
                      ) : vc.session === 'failed' ? (
                        <Lock className="w-5 h-5 text-red-500" />
                      ) : (
                        <Lock className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="text-xs mt-1 text-muted-foreground font-medium">Auth</span>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(vc.checked_at)}
                    </span>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={() => window.open(`https://${vc.hostname}/ui/`, '_blank')}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="h-8"
                        onClick={() => triggerSingleCheck(vc.hostname)}
                        disabled={checkingHost === vc.hostname}
                      >
                        {checkingHost === vc.hostname ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <><RefreshCw className="w-4 h-4 mr-1" />Check</>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Empty State */}
        {(!summary?.vcenters || summary.vcenters.length === 0) && (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center">
              <Server className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
              <h3 className="text-xl font-semibold mb-2">No vCenters Found</h3>
              <p className="text-muted-foreground mb-4">Click "Check All" to scan for vCenters</p>
              <Button onClick={triggerFullCheck} disabled={checking}>
                <Zap className="w-4 h-4 mr-2" />Start Health Check
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
