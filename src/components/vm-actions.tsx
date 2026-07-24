/**
 * VM lifecycle actions — single dropdown with dialogs for every mutating op.
 * Handles the confirmation-token dance server-side actions require:
 * for anything destructive we first POST /api/confirm with the exact VM name,
 * receive a token, then include it as X-Confirm-Token on the actual request.
 */
import { useState } from 'react';
import {
  Power, PowerOff, RotateCw, Pause, MonitorOff, Cog, Camera,
  Copy, Trash2, ChevronDown, Loader2, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { api, ApiResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

type VMLite = { vmId: string; vmName: string; powerState?: any };

interface Props {
  vm: VMLite;
  onDone?: () => void;   // fires after any successful op — parent refreshes
  compact?: boolean;     // small button variant for use in table rows
}

type ActiveDialog =
  | null
  | { kind: 'snapshot' }
  | { kind: 'modify' }
  | { kind: 'delete' }
  | { kind: 'clone' }
  | { kind: 'confirm'; action: string; verb: string; run: (token: string) => Promise<ApiResponse<any>> };

function isPoweredOn(vm: VMLite): boolean {
  const s = typeof vm.powerState === 'object' ? vm.powerState?.Value : vm.powerState;
  return String(s || '').toLowerCase().includes('on');
}

export function VMActions({ vm, onDone, compact }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<ActiveDialog>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const close = () => { setActive(null); setMessage(null); };

  const runDirect = async (verb: string, fn: () => Promise<ApiResponse<any>>) => {
    setMenuOpen(false);
    setBusy(true);
    setMessage(null);
    const r = await fn();
    setBusy(false);
    setMessage({ ok: r.success, text: r.success ? `${verb} succeeded` : (r.message || 'Failed') });
    if (r.success) onDone?.();
  };

  // Destructive ops route through the confirm dialog first.
  const askConfirm = (action: string, verb: string, run: (token: string) => Promise<ApiResponse<any>>) => {
    setMenuOpen(false);
    setActive({ kind: 'confirm', action, verb, run });
  };

  const powered = isPoweredOn(vm);

  return (
    <>
      <div className="relative inline-block">
        <Button
          size={compact ? 'sm' : 'default'}
          variant={compact ? 'ghost' : 'outline'}
          onClick={() => setMenuOpen(o => !o)}
          disabled={busy}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cog className="w-4 h-4" />}
          <span className={cn(compact ? 'sr-only' : 'ml-2')}>Actions</span>
          {!compact && <ChevronDown className="w-4 h-4 ml-1" />}
        </Button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 mt-1 w-56 bg-popover border rounded-md shadow-lg z-50 py-1 text-sm">
              <MenuItem icon={<Power className="w-4 h-4 text-green-500" />} label="Power On"
                disabled={powered}
                onClick={() => runDirect('Power on', () => api.vmPowerOn(vm.vmId))} />
              <MenuItem icon={<PowerOff className="w-4 h-4 text-red-500" />} label="Power Off (hard)"
                disabled={!powered}
                onClick={() => askConfirm('power_off', 'Power off', (t) => api.vmPowerOff(vm.vmId, t))} />
              <MenuItem icon={<MonitorOff className="w-4 h-4 text-yellow-500" />} label="Guest Shutdown"
                disabled={!powered}
                onClick={() => runDirect('Guest shutdown', () => api.vmGuestShutdown(vm.vmId))} />
              <MenuItem icon={<RotateCw className="w-4 h-4 text-orange-500" />} label="Reset (hard)"
                disabled={!powered}
                onClick={() => askConfirm('reset', 'Reset', (t) => api.vmReset(vm.vmId, t))} />
              <MenuItem icon={<RotateCw className="w-4 h-4 text-blue-500" />} label="Guest Reboot"
                disabled={!powered}
                onClick={() => runDirect('Guest reboot', () => api.vmGuestReboot(vm.vmId))} />
              <MenuItem icon={<Pause className="w-4 h-4 text-slate-500" />} label="Suspend"
                disabled={!powered}
                onClick={() => runDirect('Suspend', () => api.vmSuspend(vm.vmId))} />
              <Divider />
              <MenuItem icon={<Camera className="w-4 h-4 text-purple-500" />} label="Take snapshot…"
                onClick={() => { setMenuOpen(false); setActive({ kind: 'snapshot' }); }} />
              <MenuItem icon={<Cog className="w-4 h-4 text-cyan-500" />} label="Modify CPU / RAM…"
                onClick={() => { setMenuOpen(false); setActive({ kind: 'modify' }); }} />
              <MenuItem icon={<Copy className="w-4 h-4 text-indigo-500" />} label="Clone…"
                onClick={() => { setMenuOpen(false); setActive({ kind: 'clone' }); }} />
              <Divider />
              <MenuItem icon={<Trash2 className="w-4 h-4 text-red-600" />} label="Delete VM…" danger
                onClick={() => { setMenuOpen(false); setActive({ kind: 'delete' }); }} />
            </div>
          </>
        )}
      </div>

      {/* Inline status message */}
      {message && (
        <div className={cn('mt-2 text-sm px-3 py-2 rounded border',
          message.ok
            ? 'text-green-700 bg-green-500/10 border-green-500/30 dark:text-green-400'
            : 'text-red-700 bg-red-500/10 border-red-500/30 dark:text-red-400')}
             onClick={() => setMessage(null)}>
          {message.text}
        </div>
      )}

      {/* Snapshot create */}
      {active?.kind === 'snapshot' && (
        <SnapshotDialog vm={vm} onClose={close} onDone={() => { onDone?.(); close(); }} />
      )}
      {active?.kind === 'modify' && (
        <ModifyDialog vm={vm} onClose={close} onDone={() => { onDone?.(); close(); }} />
      )}
      {active?.kind === 'clone' && (
        <CloneDialog vm={vm} onClose={close} onDone={() => { onDone?.(); close(); }} />
      )}
      {active?.kind === 'delete' && (
        <DeleteDialog vm={vm} onClose={close} onDone={() => { onDone?.(); close(); }} />
      )}
      {active?.kind === 'confirm' && (
        <ConfirmDialog
          vm={vm}
          action={active.action}
          verb={active.verb}
          run={active.run}
          onClose={close}
          onDone={() => { onDone?.(); close(); }}
        />
      )}
    </>
  );
}

// ─── Menu building blocks ────────────────────────────────────────────────────

function MenuItem({
  icon, label, onClick, disabled, danger,
}: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted',
        disabled && 'opacity-40 cursor-not-allowed',
        danger && 'text-red-600 dark:text-red-400',
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
const Divider = () => <div className="my-1 border-t" />;


// ─── Confirm-token dialog (used for hard power off, reset, snapshot revert/delete) ──

function ConfirmDialog({
  vm, action, verb, run, onClose, onDone,
}: {
  vm: VMLite; action: string; verb: string;
  run: (token: string) => Promise<ApiResponse<any>>;
  onClose: () => void; onDone: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim() === vm.vmName;

  const submit = async () => {
    setBusy(true); setError(null);
    const tokRes = await api.issueConfirmToken(action, vm.vmName);
    if (!tokRes.success || !tokRes.data?.token) {
      setBusy(false); setError(tokRes.message || 'Failed to obtain confirmation token'); return;
    }
    const r = await run(tokRes.data.token);
    setBusy(false);
    if (!r.success) { setError(r.message || 'Action failed'); return; }
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="w-5 h-5" /> Confirm: {verb} {vm.vmName}
          </DialogTitle>
          <DialogDescription>
            This is a destructive operation. Type the exact VM name below to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-muted rounded px-3 py-2 font-mono text-sm">{vm.vmName}</div>
          <Input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type VM name here"
          />
          {error && <div className="text-sm text-red-500">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!matches || busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ─── Snapshot create ────────────────────────────────────────────────────────

function SnapshotDialog({ vm, onClose, onDone }: { vm: VMLite; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(`snapshot-${new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '')}`);
  const [description, setDescription] = useState('');
  const [memory, setMemory] = useState(false);
  const [quiesce, setQuiesce] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    const r = await api.vmSnapshotCreate(vm.vmId, { name, description, memory, quiesce });
    setBusy(false);
    if (!r.success) { setError(r.message || 'Snapshot failed'); return; }
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take snapshot of {vm.vmName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <label className="flex items-center gap-2">
            <Checkbox checked={memory} onCheckedChange={(v) => setMemory(!!v)} />
            <span className="text-sm">Include memory state (larger, slower)</span>
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={quiesce} onCheckedChange={(v) => setQuiesce(!!v)} />
            <span className="text-sm">Quiesce filesystem (requires VMware Tools)</span>
          </label>
          {error && <div className="text-sm text-red-500">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Take snapshot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ─── Modify hardware ────────────────────────────────────────────────────────

function ModifyDialog({ vm, onClose, onDone }: { vm: VMLite; onClose: () => void; onDone: () => void }) {
  const [numCpu, setNumCpu] = useState<string>('');
  const [memoryMb, setMemoryMb] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const body: { num_cpu?: number; memory_mb?: number } = {};
    if (numCpu.trim()) body.num_cpu = Number(numCpu);
    if (memoryMb.trim()) body.memory_mb = Number(memoryMb);
    if (body.num_cpu === undefined && body.memory_mb === undefined) {
      setError('Enter a new vCPU count and/or memory MB'); return;
    }
    setBusy(true); setError(null);
    const tokRes = await api.issueConfirmToken('modify', vm.vmName);
    if (!tokRes.success || !tokRes.data?.token) {
      setBusy(false); setError(tokRes.message || 'Failed to obtain confirmation token'); return;
    }
    const r = await api.vmModify(vm.vmId, body, tokRes.data.token);
    setBusy(false);
    if (!r.success) { setError(r.message || 'Modify failed'); return; }
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modify {vm.vmName}</DialogTitle>
          <DialogDescription>
            Most hardware changes require the VM to be powered off. Leave a field blank to keep it unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>vCPU count</Label><Input type="number" min={1} max={128} value={numCpu} onChange={(e) => setNumCpu(e.target.value)} /></div>
          <div><Label>Memory (MB)</Label><Input type="number" min={128} value={memoryMb} onChange={(e) => setMemoryMb(e.target.value)} /></div>
        </div>
        {error && <div className="mt-3 text-sm text-red-500">{error}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ─── Clone from template ────────────────────────────────────────────────────

function CloneDialog({ vm: _vm, onClose, onDone }: { vm: VMLite; onClose: () => void; onDone: () => void }) {
  const [templates, setTemplates] = useState<any[] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [targetName, setTargetName] = useState('');
  const [powerOn, setPowerOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load templates on first render.
  if (templates === null) {
    api.getTemplates().then(r => setTemplates(r.success && r.data ? r.data : []));
  }

  const submit = async () => {
    if (!templateId || !targetName.trim()) { setError('Pick a template and enter a name'); return; }
    setBusy(true); setError(null);
    const r = await api.vmClone({ template_id: templateId, target_name: targetName.trim(), power_on: powerOn });
    setBusy(false);
    if (!r.success) { setError(r.message || 'Clone failed'); return; }
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clone from template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Source template</Label>
            <select
              className="w-full border rounded p-2 bg-background"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">— select —</option>
              {(templates || []).map(t => (
                <option key={t.templateId} value={t.templateId}>
                  {t.name} ({t.numCPU} vCPU, {Math.round((t.memoryMB || 0) / 1024)} GB) — {t.vcenterName}
                </option>
              ))}
            </select>
            {templates?.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                No templates found on any connected vCenter.
              </p>
            )}
          </div>
          <div>
            <Label>New VM name</Label>
            <Input value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder="e.g. app-prod-42" />
          </div>
          <label className="flex items-center gap-2">
            <Checkbox checked={powerOn} onCheckedChange={(v) => setPowerOn(!!v)} />
            <span className="text-sm">Power on after clone</span>
          </label>
          {error && <div className="text-sm text-red-500">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ─── Delete VM (typed-name confirm) ─────────────────────────────────────────

function DeleteDialog({ vm, onClose, onDone }: { vm: VMLite; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === vm.vmName;

  const submit = async () => {
    setBusy(true); setError(null);
    const tokRes = await api.issueConfirmToken('delete', vm.vmName);
    if (!tokRes.success || !tokRes.data?.token) {
      setBusy(false); setError(tokRes.message || 'Failed to obtain confirmation token'); return;
    }
    const r = await api.vmDelete(vm.vmId, tokRes.data.token);
    setBusy(false);
    if (!r.success) { setError(r.message || 'Delete failed'); return; }
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Trash2 className="w-5 h-5" /> Delete {vm.vmName}
          </DialogTitle>
          <DialogDescription>
            This will power off the VM and destroy it. There is no undo.
            Type the VM name below to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-muted rounded px-3 py-2 font-mono text-sm">{vm.vmName}</div>
          <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type VM name here" />
          {error && <div className="text-sm text-red-500">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!matches || busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Delete forever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
