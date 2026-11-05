'use client';

/** "Reject this draft?" with an optional reason (bd startsim-bd1lj). */
import { useState } from 'react';
import { BaseDialog, Button } from '@startsimpli/ui';

export function RejectDialog({
  open,
  busy,
  onCancel,
  onReject,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <BaseDialog open={open} onOpenChange={(o) => (o ? null : onCancel())} size="sm" loading={busy}>
      <BaseDialog.Header>
        <BaseDialog.Title>Reject this draft?</BaseDialog.Title>
      </BaseDialog.Header>
      <div className="space-y-3 px-6 pb-6">
        <p className="text-sm text-neutral-600">It leaves the Content list. The topic stays in Research.</p>
        <label className="block space-y-1 text-sm font-medium">
          Why? (optional)
          <textarea
            className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <Button variant="destructive" disabled={busy} onClick={() => onReject(reason)}>
            Reject
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </BaseDialog>
  );
}
