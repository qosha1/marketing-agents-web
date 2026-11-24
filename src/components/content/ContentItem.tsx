'use client';

/**
 * The v2 Content item page (bd startsim-nkvgn). One header with the status and
 * its actions, one editor that saves itself, Schedule, Comments, History.
 * Reject (bd startsim-bd1lj) and Schedule (bd startsim-2x1im) hang off the
 * status flow in lib/content-status.ts.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, notify } from '@startsimpli/ui';
import { StaleSaveDialog } from '@startsimpli/ui/history';

import { ContentEditor } from '@/components/content/ContentEditor';
import { CommentsPanel } from '@/components/content/CommentsPanel';
import { ContentHistory } from '@/components/content/ContentHistory';
import { RejectDialog } from '@/components/content/RejectDialog';
import { SchedulePicker } from '@/components/content/SchedulePicker';
import { useContentWrite } from '@/components/content/useContentWrite';
import { attrLabel } from '@/components/record-columns';
import { readData } from '@/lib/board';
import { CONTENT_TYPES } from '@/lib/content-new';
import {
  approveData,
  contentActions,
  contentStatusLabel,
  contentStatusOf,
  markPostedData,
  rejectData,
  scheduleData,
  schedulingAvailable,
  unscheduleData,
} from '@/lib/content-status';
import { getEntity, whoami, type EntityRecord } from '@/lib/foundry-api';
import { entityKey } from '@/lib/entity-cache';
import { revisionClient } from '@/lib/revisions';
import { canEditRecord } from '@/lib/track-changes';
import { draftTitle } from '@/lib/topic-drafts';

const CHIP: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-600',
  approved: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-emerald-100 text-emerald-700',
  posted: 'bg-sky-100 text-sky-700',
};

const str = (data: EntityRecord['data'], name: string) => String(readData(data, name) ?? '');

export function ContentItem({ draft }: { draft: EntityRecord }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { record, write, save, latest } = useContentWrite(draft);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const me = useQuery({ queryKey: ['whoami'], queryFn: () => whoami(), staleTime: 5 * 60_000 });
  const canEdit = canEditRecord(record, me.data?.role);

  const topicRef = str(record.data, 'topic_ref');
  const topic = useQuery({ queryKey: entityKey(topicRef), queryFn: () => getEntity(topicRef), enabled: !!topicRef });
  const revisions = useMemo(() => revisionClient(draft.id), [draft.id]);

  const status = contentStatusOf(readData(record.data, 'status'));
  const actions = canEdit ? contentActions(status) : [];
  const scheduledRaw = str(record.data, 'scheduled_for');
  const scheduledAt = scheduledRaw && !Number.isNaN(new Date(scheduledRaw).getTime()) ? new Date(scheduledRaw) : null;

  const channel = str(record.data, 'channel');
  const initialType = (CONTENT_TYPES.find((t) => t.key === channel) ??
    (str(record.data, 'blog') && !str(record.data, 'linkedin') ? CONTENT_TYPES.find((t) => t.key === 'blog') : undefined) ??
    CONTENT_TYPES[0]).key;

  async function act(
    change: (d: Record<string, unknown>) => Record<string, unknown>,
    done: string,
    whatFailed: string,
    // The server's answer must show the change took; a 200 that left the item
    // as it was is a failure the user has to see (bd startsim-bj3zz.14).
    took?: (saved: Record<string, unknown>) => boolean,
  ) {
    setBusy(true);
    try {
      if (await write(change, whatFailed)) {
        if (took && !took(latest().data as Record<string, unknown>)) {
          notify.error(`${whatFailed} The server did not keep the change.`);
          return false;
        }
        await qc.invalidateQueries({ queryKey: ['content-list'] });
        await qc.invalidateQueries({ queryKey: ['content-calendar'] });
        notify.success(done);
        return true;
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reject(reason: string) {
    if (await act((d) => rejectData(d, reason), 'Rejected. It has left the Content list.', 'Could not reject.')) {
      setRejecting(false);
      router.push('/content');
    }
  }

  function run(id: string) {
    if (id === 'approve') void act(approveData, 'Approved.', 'Could not approve.');
    if (id === 'reject') setRejecting(true);
    if (id === 'mark-posted') void act((d) => markPostedData(d, new Date()), 'Marked as posted.', 'Could not mark as posted.');
  }

  return (
    <div className="space-y-4">
      <Link href="/content" className="text-sm text-neutral-600 hover:underline">‹ Content</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold">{draftTitle(record)}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
            {status ? (
              <span className={`rounded-full px-2.5 py-0.5 text-xs ${CHIP[status]}`}>{contentStatusLabel(status)}</span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[...actions].reverse().map((a) => (
            <Button key={a.id} variant={a.tone === 'primary' ? 'default' : 'secondary'} disabled={busy} onClick={() => run(a.id)}>
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ContentEditor
          footer={
            topic.data ? (
              <>
                Based on{' '}
                <Link href={`/story/${topic.data.id}`} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-700 hover:underline">
                  {str(topic.data.data, 'title') || topic.data.name}
                </Link>
              </>
            ) : null
          }
          initialType={initialType}
          initialText={{ blog: str(record.data, 'blog'), linkedin: str(record.data, 'linkedin') }}
          canEdit={canEdit}
          onSave={(field, value) => write((d) => ({ ...d, [field]: value }), 'Could not save the draft.')}
        />
        <div className="space-y-4">
          {canEdit && schedulingAvailable(status) ? (
            <SchedulePicker
              current={scheduledAt}
              busy={busy}
              onSchedule={(when) =>
                act((d) => scheduleData(d, when), 'Scheduled.', 'Could not schedule.', (saved) => readData(saved, 'status') === 'scheduled')
              }
              onUnschedule={() => act(unscheduleData, 'Unscheduled.', 'Could not unschedule.')}
            />
          ) : null}
          <CommentsPanel recordId={String(draft.id)} />
          <ContentHistory client={revisions} recordId={String(draft.id)} version={save.version ?? null} />
        </div>
      </div>

      <RejectDialog open={rejecting} busy={busy} onCancel={() => setRejecting(false)} onReject={(r) => void reject(r)} />

      <StaleSaveDialog
        conflict={save.conflict}
        open={save.dialogOpen}
        recordLabel="this item"
        fieldLabel={attrLabel}
        busy={save.resolving}
        onDismiss={save.dismissConflict}
        onKeepMine={() => {
          void save.keepMine().then((r) => {
            if (r.status === 'saved') notify.success('Saved. Your version replaced theirs.');
          });
        }}
        onAcceptTheirs={() => {
          save.acceptTheirs();
          // The page re-seeds from the server's copy.
          void qc.invalidateQueries({ queryKey: entityKey(draft.id) }).then(() => window.location.reload());
        }}
        onReviewChange={() => save.dismissConflict()}
      />
    </div>
  );
}
