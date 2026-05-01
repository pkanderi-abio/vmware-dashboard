/**
 * VM Detail Page - Individual VM information
 */
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Server, ArrowLeft, RefreshCw, Cpu, MemoryStick, HardDrive,
  Network, Globe, Clock, Tag, Activity, Terminal, CheckCircle,
  XCircle, AlertTriangle, Wifi, WifiOff, History, Settings
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { getApiBase } from '@/config/api';

export default function VMDetailPage() {
  const { vmName } = useParams();
  const [vm, setVm] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (vmName) loadVM();
  }, [vmName]);

  const loadVM = async () => {
    setLoading(true);
    setError(null);
    try {
      // Search for VM in CMDB
      const res = await fetch(`${getApiBase()}/cmdb/vm/${encodeURIComponent(vmName || '')}`);
      const data = await res.json();
      
      if (data.success && data.data) {
        setVm(data.data);
      } else {
        setError('VM not found');
      }
    } catch (err) {
      setError('Failed to load VM details');
      console.error(err);
    }
    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>;
      case 'unreachable':
        return <Badge className="bg-orange-500"><WifiOff className="w-3 h-3 mr-1" />Unreachable</Badge>;
      case 'decommissioned':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Decommissioned</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPowerBadge = (powerState: any) => {
    const state = typeof powerState === 'object' ? powerState?.Value : powerState;
    if (state?.toLowerCase().includes('on')) {
      return <Badge className="bg-green-500/20 text-green-600 border-green-500/30">Powered On</Badge>;
    }
    return <Badge variant="outline" className="text-gray-500">Powered Off</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3">Loading VM details...</span>
      </div>
    );
  }

  if (error || !vm) {
    return (
      <div className="p-6">
        <Link to="/vms">
          <Button variant="ghost" className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />Back to VMs
          </Button>
        </Link>
        <Card className="border-red-500">
          <CardContent className="p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold">{error || 'VM Not Found'}</h2>
            <p className="text-muted-foreground mt-2">The requested VM could not be found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Link to="/vms">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary/10 rounded-xl">
                <Server className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{vm.vmName}</h1>
                <p className="text-muted-foreground">{vm.uuid}</p>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              {getStatusBadge(vm.status)}
              {getPowerBadge(vm.powerState)}
              {vm.pingStatus === 'reachable' && (
                <Badge className="bg-yellow-500/20 text-yellow-600"><Wifi className="w-3 h-3 mr-1" />Ping OK</Badge>
              )}
            </div>
          </div>
        </div>
        <Button onClick={loadVM} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Cpu className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{vm.cpuCount || 0}</div>
              <div className="text-xs text-muted-foreground">vCPUs</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <MemoryStick className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{vm.memoryGB || 0} GB</div>
              <div className="text-xs text-muted-foreground">Memory</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-cyan-500/20 rounded-lg">
              <HardDrive className="w-5 h-5 text-cyan-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{vm.totalDiskGB || 0} GB</div>
              <div className="text-xs text-muted-foreground">Storage</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Network className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <div className="text-lg font-bold truncate">{vm.ipAddress || 'N/A'}</div>
              <div className="text-xs text-muted-foreground">IP Address</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview"><Server className="w-4 h-4 mr-2" />Overview</TabsTrigger>
          <TabsTrigger value="resources"><Cpu className="w-4 h-4 mr-2" />Resources</TabsTrigger>
          <TabsTrigger value="puppet"><Terminal className="w-4 h-4 mr-2" />Puppet</TabsTrigger>
          <TabsTrigger value="history"><History className="w-4 h-4 mr-2" />History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Location */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Globe className="w-5 h-5 text-blue-500" />Location
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">vCenter</span>
                  <span className="font-medium">{vm.vcenterName?.split('.')[0]}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Datacenter</span>
                  <span className="font-medium">{vm.datacenter || '-'}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Cluster</span>
                  <span className="font-medium">{vm.cluster || '-'}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Host</span>
                  <span className="font-medium">{vm.hostName?.split('.')[0] || '-'}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Folder</span>
                  <span className="font-medium truncate max-w-[auto]">{vm.folder || '-'}</span>
                </div>
              </CardContent>
            </Card>

            {/* Guest OS */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Settings className="w-5 h-5 text-purple-500" />Guest OS
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Operating System</span>
                  <span className="font-medium truncate max-w-[auto]">{vm.guestOS || '-'}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">VMware Tools</span>
                  <span className="font-medium">{vm.toolsStatus || '-'}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">IP Address</span>
                  <span className="font-medium">{vm.ipAddress || '-'}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">DNS Name</span>
                  <span className="font-medium">{vm.dnsName || vm.vmName}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Custom Attributes */}
          {vm.customAttributes && Object.keys(vm.customAttributes).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Tag className="w-5 h-5 text-cyan-500" />Custom Attributes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {Object.entries(vm.customAttributes).map(([key, value]) => (
                    <div key={key} className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-xs text-muted-foreground">{key}</div>
                      <div className="font-medium truncate">{String(value) || '(empty)'}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="resources" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* CPU */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-blue-500" />CPU
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span>vCPUs</span>
                  <span className="text-2xl font-bold">{vm.cpuCount || 0}</span>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm text-muted-foreground">Usage</span>
                    <span className="text-sm font-medium">{vm.cpuUsagePct || 0}%</span>
                  </div>
                  <Progress value={parseFloat(vm.cpuUsagePct) || 0} className="h-2" />
                </div>
              </CardContent>
            </Card>

            {/* Memory */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MemoryStick className="w-5 h-5 text-purple-500" />Memory
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span>Allocated</span>
                  <span className="text-2xl font-bold">{vm.memoryGB || 0} GB</span>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm text-muted-foreground">Usage</span>
                    <span className="text-sm font-medium">{vm.memoryUsagePct || 0}%</span>
                  </div>
                  <Progress value={parseFloat(vm.memoryUsagePct) || 0} className="h-2" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Storage */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-cyan-500" />Storage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between items-center mb-4">
                <span>Total Disk</span>
                <span className="text-2xl font-bold">{vm.totalDiskGB || 0} GB</span>
              </div>
              {vm.datastores && vm.datastores.length > 0 && (
                <div>
                  <span className="text-sm text-muted-foreground">Datastores:</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {vm.datastores.map((ds: string, i: number) => (
                      <Badge key={i} variant="outline">{ds}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="puppet" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Terminal className="w-5 h-5 text-purple-500" />Puppet Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              {vm.puppetData?.puppet_found ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg border border-green-500/30">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    <div>
                      <div className="font-semibold">Puppet Managed</div>
                      <div className="text-sm text-muted-foreground">This VM is managed by Puppet</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-xs text-muted-foreground">Certname</div>
                      <div className="font-medium">{vm.puppetData.puppet_certname || vm.vmName}</div>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-xs text-muted-foreground">Environment</div>
                      <div className="font-medium">{vm.puppetData.puppet_environment || 'production'}</div>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-xs text-muted-foreground">Last Run</div>
                      <div className="font-medium">{vm.puppetData.puppet_last_run || 'Unknown'}</div>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-xs text-muted-foreground">Last Status</div>
                      <Badge className={vm.puppetData.puppet_last_status === 'failed' ? 'bg-red-500' : 'bg-green-500'}>
                        {vm.puppetData.puppet_last_status || 'Unknown'}
                      </Badge>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center p-8 text-muted-foreground">
                  <Terminal className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p>Not managed by Puppet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="w-5 h-5 text-amber-500" />Change History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {vm.changeHistory && vm.changeHistory.length > 0 ? (
                <div className="space-y-3">
                  {vm.changeHistory.slice(0, 20).map((change: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                      <Clock className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <div className="flex-1">
                        <div className="flex justify-between">
                          <span className="font-medium">{change.field}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(change.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <span className="text-red-500">{change.oldValue}</span>
                          {' → '}
                          <span className="text-green-500">{change.newValue}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center p-8 text-muted-foreground">
                  <History className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p>No changes recorded</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timestamps */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Timestamps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">First Seen</span>
                <span>{vm.firstSeen ? new Date(vm.firstSeen).toLocaleString() : '-'}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Last Seen</span>
                <span>{vm.lastSeen ? new Date(vm.lastSeen).toLocaleString() : '-'}</span>
              </div>
              {vm.unreachableSince && (
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Unreachable Since</span>
                  <span className="text-orange-500">{new Date(vm.unreachableSince).toLocaleString()}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
