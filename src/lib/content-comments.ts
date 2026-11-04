/**
 * Read a page of comment threads (`GET entities/<id>/comments/`) as a flat list.
 * Each thread carries its comments in `comments` (root first); both key
 * spellings are read because the shared client may camelCase. A deleted comment
 * has a null body and is dropped.
 */
export interface Comment {
  id: string;
  who: string;
  when: string;
  text: string;
}

type Raw = Record<string, unknown>;

export function readComments(page: unknown): Comment[] {
  const p = page as { results?: unknown[]; items?: unknown[] } | unknown[] | null;
  const threads = (Array.isArray(p) ? p : (p?.results ?? p?.items ?? [])) as Raw[];
  const out: Comment[] = [];
  for (const thread of threads) {
    const list = (Array.isArray(thread.comments) ? thread.comments : [thread]) as Raw[];
    for (const c of list) {
      if (typeof c.body !== 'string' || !c.body) continue;
      const author = (c.author ?? {}) as Raw;
      out.push({
        id: String(c.id ?? out.length),
        who: String(author.label ?? author.sub ?? 'Someone'),
        when: String(c.created_at ?? c.createdAt ?? ''),
        text: c.body,
      });
    }
  }
  return out.sort((a, b) => a.when.localeCompare(b.when));
}
