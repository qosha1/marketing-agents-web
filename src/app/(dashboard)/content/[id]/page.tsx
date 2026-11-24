'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { ContentItem } from '@/components/content/ContentItem';
import { entityKey } from '@/lib/entity-cache';
import { getEntity } from '@/lib/foundry-api';

export default function ContentItemPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: entityKey(id), queryFn: () => getEntity(id) });

  if (q.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-neutral-500">Couldn’t load this item.</p>
        <Link href="/content" className="text-sm text-neutral-600 underline">‹ Content</Link>
      </div>
    );
  }
  return <ContentItem key={`${q.data.id}`} draft={q.data} />;
}
