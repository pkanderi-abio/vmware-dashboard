/**
 * Layout Component - Main app layout with sidebar and global search
 */
import React, { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';

// Error boundary for search results — prevents search errors from crashing the page
class SearchResultsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-sm text-muted-foreground text-center">
          <p>Could not render results. Try a different search term.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
import {
  Server, Cpu, HardDrive, Network, Camera, Database,
  Activity, Settings, Menu, X, ChevronRight, Home,
  Shield, Search, Command, Loader2, RefreshCw, Clock,
  Sun, Moon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { useTheme } from '@/lib/theme';
import { getApiBase } from '@/config/api';

const navItems = [
  { path: '/', icon: Home, label: 'Dashboard' },
  { path: '/vms', icon: Server, label: 'Virtual Machines' },
  { path: '/hosts', icon: Cpu, label: 'ESXi Hosts' },
  { path: '/datastores', icon: HardDrive, label: 'Datastores' },
  { path: '/networks', icon: Network, label: 'Networks' },
  { path: '/snapshots', icon: Camera, label: 'Snapshots' },
  { path: '/cmdb', icon: Database, label: 'CMDB' },
  { path: '/vcenter-health', icon: Activity, label: 'vCenter Health', highlight: true },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheAgeSeconds, setCacheAgeSeconds] = useState<number | null>(null);

  // Poll backend health every 30s for refresh status + cache age
  useEffect(() => {
    const pollHealth = async () => {
      try {
        const res = await fetch(`${getApiBase()}/health`);
        const data = await res.json();
        setRefreshing(!!data.refresh_in_progress);
        // Use the minimum cache age across tracked keys, or the vms age as a proxy
        const ages: number[] = [];
        if (data.cache_status) {
          for (const key of ['vms', 'hosts', 'datastores', 'networks', 'snapshots']) {
            const entry = data.cache_status[key];
            if (entry && typeof entry.age_seconds === 'number') {
              ages.push(entry.age_seconds);
            }
          }
        }
        if (ages.length > 0) {
          setCacheAgeSeconds(Math.min(...ages));
        }
      } catch {
        // silently ignore health poll errors
      }
    };
    pollHealth();
    const interval = setInterval(pollHealth, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus search input when dialog opens
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  // Search debounce
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${getApiBase()}/search?q=${encodeURIComponent(searchQuery)}&limit=20`);
        const data = await res.json();
        if (data.success) {
          setSearchResults(data.data);
        }
      } catch (err) {
        console.error('Search failed:', err);
      }
      setSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleResultClick = (type: string, name: string) => {
    setSearchOpen(false);
    setSearchQuery('');
    
    if (type === 'vm') {
      navigate(`/vm/${encodeURIComponent(name)}`);
    } else if (type === 'host') {
      navigate('/hosts');
    } else if (type === 'datastore') {
      navigate('/datastores');
    } else if (type === 'network') {
      navigate('/networks');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-card border-b z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <span className="font-bold text-lg">CIE</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)}>
          <Search className="w-5 h-5" />
        </Button>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed top-0 left-0 h-full bg-card border-r z-50 transition-all duration-300",
        sidebarOpen ? "w-64" : "w-20",
        "hidden lg:block",
        mobileMenuOpen && "block w-64"
      )}>
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            {sidebarOpen && (
              <div>
                <h1 className="font-bold text-lg leading-tight">CIE</h1>
                <p className="text-xs text-muted-foreground">Dashboard</p>
              </div>
            )}
          </Link>
          <Button variant="ghost" size="icon" className="hidden lg:flex" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <ChevronRight className={cn("w-4 h-4 transition-transform", !sidebarOpen && "rotate-180")} />
          </Button>
        </div>

        {/* Search Button */}
        {sidebarOpen && (
          <div className="p-3">
            <Button 
              variant="outline" 
              className="w-full justify-start text-muted-foreground"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="w-4 h-4 mr-2" />
              <span className="flex-1 text-left">Search...</span>
              <kbd className="hidden md:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-xs">
                <Command className="w-3 h-3" />K
              </kbd>
            </Button>
          </div>
        )}

        {/* Navigation */}
        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                  "hover:bg-muted",
                  isActive && "bg-primary/10 text-primary font-medium",
                  !isActive && "text-muted-foreground hover:text-foreground",
                  item.highlight && !isActive && "text-primary/80"
                )}
              >
                <div className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-lg",
                  isActive ? "bg-primary text-primary-foreground" : "bg-muted",
                  item.highlight && !isActive && "bg-primary/20"
                )}>
                  <Icon className="w-4 h-4" />
                </div>
                {sidebarOpen && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {item.highlight && <Badge variant="outline" className="text-xs bg-primary/10 border-primary/30">Live</Badge>}
                  </>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        {sidebarOpen && (
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t space-y-2">
            {refreshing ? (
              <div className="flex items-center gap-2 text-xs text-amber-500">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Refreshing data…</span>
              </div>
            ) : cacheAgeSeconds !== null ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>
                  Updated{' '}
                  {cacheAgeSeconds < 60
                    ? 'just now'
                    : cacheAgeSeconds < 3600
                    ? `${Math.floor(cacheAgeSeconds / 60)} min ago`
                    : `${Math.floor(cacheAgeSeconds / 3600)} hr ago`}
                </span>
              </div>
            ) : null}
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? (
                <><Sun className="w-3.5 h-3.5" /><span>Light Mode</span></>
              ) : (
                <><Moon className="w-3.5 h-3.5" /><span>Dark Mode</span></>
              )}
            </button>
            <div className="text-xs text-muted-foreground text-center">
              <p>VMware Dashboard v2.0</p>
              <p className="mt-0.5">© 2026 Prasannakumar Kanderi</p>
            </div>
          </div>
        )}
        {/* Collapsed sidebar: show theme icon only */}
        {!sidebarOpen && (
          <div className="absolute bottom-0 left-0 right-0 p-3 border-t flex justify-center">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className={cn(
        "min-h-screen transition-all duration-300",
        sidebarOpen ? "lg:ml-64" : "lg:ml-20",
        "pt-16 lg:pt-0"
      )}>
        <Outlet />
      </main>

      {/* Global Search Dialog */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-[600px] p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="sr-only">Search</DialogTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder="Search VMs, hosts, datastores, networks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-12 text-lg"
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-muted-foreground" />
              )}
            </div>
          </DialogHeader>
          
          <div className="max-h-[400px] overflow-y-auto p-4 pt-2">
            <SearchResultsErrorBoundary>
            {searchResults && searchResults.total > 0 ? (
              <div className="space-y-4">
                {/* VMs */}
                {searchResults.vms?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <Server className="w-4 h-4" />Virtual Machines ({searchResults.vms.length})
                    </h3>
                    <div className="space-y-1">
                      {searchResults.vms.map((vm: any, i: number) => (
                        <button
                          key={i}
                          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted text-left"
                          onClick={() => handleResultClick('vm', vm.name)}
                        >
                          <Server className="w-4 h-4 text-blue-500" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{vm.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {vm.ip && `${vm.ip} • `}{vm.vcenter} • {vm.status}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs">{vm.status}</Badge>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hosts */}
                {searchResults.hosts?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <Cpu className="w-4 h-4" />ESXi Hosts ({searchResults.hosts.length})
                    </h3>
                    <div className="space-y-1">
                      {searchResults.hosts.map((host: any, i: number) => (
                        <button
                          key={i}
                          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted text-left"
                          onClick={() => handleResultClick('host', host.name)}
                        >
                          <Cpu className="w-4 h-4 text-purple-500" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{host.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {host.cluster && `${host.cluster} • `}{host.vcenter}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Datastores */}
                {searchResults.datastores?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <HardDrive className="w-4 h-4" />Datastores ({searchResults.datastores.length})
                    </h3>
                    <div className="space-y-1">
                      {searchResults.datastores.map((ds: any, i: number) => (
                        <button
                          key={i}
                          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted text-left"
                          onClick={() => handleResultClick('datastore', ds.name)}
                        >
                          <HardDrive className="w-4 h-4 text-cyan-500" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{ds.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {ds.dsType} • {ds.vcenter} • {ds.usagePct != null ? Number(ds.usagePct).toFixed(0) : '?'}% used
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Networks */}
                {searchResults.networks?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <Network className="w-4 h-4" />Networks ({searchResults.networks.length})
                    </h3>
                    <div className="space-y-1">
                      {searchResults.networks.map((net: any, i: number) => (
                        <button
                          key={i}
                          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted text-left"
                          onClick={() => handleResultClick('network', net.name)}
                        >
                          <Network className="w-4 h-4 text-indigo-500" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{net.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {net.netType} • {net.vcenter}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : searchQuery.length >= 2 && !searching ? (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No results found for "{searchQuery}"</p>
              </div>
            ) : !searchQuery ? (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>Type to search across all resources</p>
                <p className="text-xs mt-2">VMs, hosts, datastores, networks</p>
              </div>
            ) : null}
            </SearchResultsErrorBoundary>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
