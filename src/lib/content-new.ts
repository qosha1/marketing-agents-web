/**
 * Add content by hand (bd startsim-rcnt1): Title, Type, optional Based on topic,
 * What should it say. Content may come from anywhere, not only a topic.
 *
 * The new item is a Draft (`ready_for_review`) of the existing `draft` type, so
 * the editor, history, approve and the list all work on it unchanged. The text
 * goes in the field its Type edits (`blog` or `linkedin`); `channel` remembers
 * the choice. A topic, when given, is linked and lends its scope; otherwise no
 * scope path is invented (lib/scope.ts: a wrong scope is worse than none).
 */
export interface ContentType {
  key: 'blog' | 'linkedin';
  label: string;
  /** The draft attribute this type's text is edited in. */
  field: 'blog' | 'linkedin';
}

export const CONTENT_TYPES: ContentType[] = [
  { key: 'linkedin', label: 'LinkedIn post', field: 'linkedin' },
  { key: 'blog', label: 'Blog post', field: 'blog' },
];

export interface NewContentForm {
  title: string;
  type: ContentType['key'];
  topicId: string;
  brief: string;
}

export function validateNewContent(form: NewContentForm): { title?: string } {
  return form.title.trim() ? {} : { title: 'Give it a title.' };
}

export function newContentInput(
  form: NewContentForm,
  ctx: { scopePath: string | null },
): { entityType: 'draft'; name: string; data: Record<string, unknown> } {
  const type = CONTENT_TYPES.find((t) => t.key === form.type) ?? CONTENT_TYPES[0];
  const data: Record<string, unknown> = {
    status: 'ready_for_review',
    channel: type.key,
    [type.field]: form.brief.trim(),
  };
  if (form.topicId) {
    data.topic_ref = form.topicId;
    if (ctx.scopePath) data.scope_path = ctx.scopePath;
  } else if (ctx.scopePath) {
    data.scope_path = ctx.scopePath;
  }
  return { entityType: 'draft', name: form.title.trim(), data };
}

/**
 * The scope a hand-made item can safely take when it has neither a topic nor an
 * active project: the one path every visible record already shares. Two or more
 * different paths is ambiguous, and then there is none (the tenant refuses an
 * unscoped row, and a guessed scope is worse than a refusal).
 */
export function sharedScopePath(paths: (string | undefined)[]): string | null {
  const set = new Set(paths.map((p) => (p ?? '').trim()).filter(Boolean));
  return set.size === 1 ? [...set][0] : null;
}

/**
 * Whether "Based on" can really be left empty. The design (V16 New) says
 * optional, and it is when the item can still be placed in a scope: a project
 * is active, or every visible record shares one. On All projects with several
 * scopes a topicless item has no scope to take, so a topic is what places it,
 * and the form says so and holds Create until one is picked (bd startsim-bj3zz.10).
 */
export function basedOnRule(ctx: {
  topicId: string;
  activeProject: string | null;
  sharedScope: string | null;
}): { required: boolean; satisfied: boolean } {
  const required = !ctx.activeProject && !ctx.sharedScope;
  return { required, satisfied: !required || !!ctx.topicId };
}
