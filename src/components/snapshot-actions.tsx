/**
 * Snapshot-row actions: Revert / Delete, both destructive → both go through
 * the confirmation-token dance keyed to the parent VM's name.
 */
import { useState } from 'react';
import { RotateCcw, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { api, ApiResponse } from '@/lib/api';

interface Snap { snapshotId: string; snapshotName: string; vmId: string; vmName: string }
interface Props { snap: Snap; onDone: () => void }

export function SnapshotRowActions({ snap, onDone }: Props) {
  const [active, setActive] = useState<'revert' | 'delete' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setActive('revert')}>
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />Revert VM to this snapshot
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setActive('delete')}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete snapshot
        </Button>
      </div>
      {msg && (
        <div
          className={`mt-2 text-xs px-2 py-1 rounded border cursor-pointer ${
            msg.ok
              ? 'text-green-700 bg-green-500/10 border-green-500/30 dark:text-green-400'
              : 'text-red-700 bg-red-500/10 border-red-500/30 dark:text-red-400'
          }`}
          onClick={() => setMsg(null)}
        >
          {msg.text}
        </div>
      )}
      {active === 'revert' && (
        <ConfirmDialog
          verb="Revert"
          action="snapshot_revert"
          vmName={snap.vmName}
          description={`This will restore ${snap.vmName} to the state captured in snapshot "${snap.snapshotName}". Any changes since then are lost.`}
          run={(token) => api.vmSnapshotRevert(snap.vmId, snap.snapshotId, token)}
          onClose={() => setActive(null)}
          onResult={(r) => { setMsg({ ok: r.success, text: r.success ? 'Snapshot revert complete' : (r.message || 'Failed') }); if (r.success) onDone(); setActive(null); }}
        />
      )}
      {active === 'delete' && (
        <DeleteSnapshotDialog
          snap={snap}
          onClose={() => setActive(null)}
          onResult={(r) => { setMsg({ ok: r.success, text: r.success ? 'Snapshot deleted' : (r.message || 'Failed') }); if (r.success) onDone(); setActive(null); }}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  verb, action, vmName, description, run, onClose, onResult,
}: {
  verb: string; action: string; vmName: string; description: string;
  run: (token: string) => Promise<ApiResponse<any>>;
  onClose: () => void; onResult: (r: ApiResponse<any>) => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === vmName;

  const submit = async () => {
    setBusy(true); setError(null);
    const tok = await api.issueConfirmToken(action, vmName);
    if (!tok.success || !tok.data?.token) {
      setBusy(false); setError(tok.message || 'Failed to obtain confirmation token'); return;
    }
    const r = await run(tok.data.token);
    setBusy(false);
    if (!r.success) { setError(r.message || 'Failed'); return; }
    onResult(r);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="w-5 h-5" /> {verb} — type VM name to confirm
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-muted rounded px-3 py-2 font-mono text-sm">{vmName}</div>
          <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type VM name" />
          {error && <div className="text-sm text-red-500">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!matches || busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSnapshotDialog({
  snap, onClose, onResult,
}: { snap: Snap; onClose: () => void; onResult: (r: ApiResponse<any>) => void }) {
  const [removeChildren, setRemoveChildren] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === snap.vmName;

  const submit = async () => {
    setBusy(true); setError(null);
    const tok = await api.issueConfirmToken('snapshot_delete', snap.vmName);
    if (!tok.success || !tok.data?.token) {
      setBusy(false); setError(tok.message || 'Failed to obtain confirmation token'); return;
    }
    const r = await api.vmSnapshotDelete(snap.vmId, snap.snapshotId, tok.data.token, removeChildren);
    setBusy(false);
    if (!r.success) { setError(r.message || 'Failed'); return; }
    onResult(r);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Trash2 className="w-5 h-5" /> Delete snapshot "{snap.snapshotName}"
          </DialogTitle>
          <DialogDescription>
            Removes this snapshot from {snap.vmName}. Type the VM name to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <Checkbox checked={removeChildren} onCheckedChange={(v) => setRemoveChildren(!!v)} />
            <span className="text-sm">Also delete descendant snapshots</span>
          </label>
          <div className="bg-muted rounded px-3 py-2 font-mono text-sm">{snap.vmName}</div>
          <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type VM name" />
          {error && <div className="text-sm text-red-500">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!matches || busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
