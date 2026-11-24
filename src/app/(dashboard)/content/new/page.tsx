'use client';

import Link from 'next/link';

import { AddContentForm } from '@/components/content/AddContentForm';

export default function NewContentPage() {
  return (
    <div className="space-y-4">
      <Link href="/content" className="text-sm text-neutral-600 hover:underline">‹ Content</Link>
      <AddContentForm />
    </div>
  );
}
