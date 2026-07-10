'use client';

/**
 * Marketing Agents home = the topic review workspace (the "live-ranked list").
 * The workspace itself is shared (@startsimpli/ui/collection); this wrapper just
 * injects the tenant client, the OGMC market vocab, and the app's record drawer.
 */
import { TopicReviewWorkspace } from '@startsimpli/ui/collection';

import { EntityDetailDrawer } from '@/components/entity-detail-drawer';
import { collectionClient } from '@/lib/foundry-api';

// The markets we publish for (locks the box — no "Dubai" vs "Dubai, UAE" drift).
const MARKETS = [
  'GCC-wide', 'MENA', 'Saudi Arabia', 'UAE', 'Abu Dhabi (UAE)', 'Dubai (UAE)',
  'Qatar', 'Bahrain', 'Kuwait', 'Oman', 'China',
];

export default function HomePage() {
  return (
    <TopicReviewWorkspace
      client={collectionClient}
      markets={MARKETS}
      renderDetail={(record, type, onClose, onSaved) => (
        <EntityDetailDrawer type={type} record={record} onClose={onClose} onSaved={onSaved} />
      )}
    />
  );
}
