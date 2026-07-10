'use client';

/**
 * Draft review = compare candidates, pick one, review it, mark it ready to post.
 * The workspace is shared (@startsimpli/ui/collection); this wrapper just injects
 * the tenant client.
 */
import { DraftReviewWorkspace } from '@startsimpli/ui/collection';

import { collectionClient } from '@/lib/foundry-api';

export default function DraftsPage() {
  return <DraftReviewWorkspace client={collectionClient} />;
}
