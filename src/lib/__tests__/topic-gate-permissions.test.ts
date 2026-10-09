/**
 * The generate-drafts route gates on the topic's `permissions` (bd
 * startsim-768w.71), and it reads the topic through `entityFromWire` — which
 * used to keep only the fields it named, so the object never reached the gate.
 */
import { describe, expect, it } from 'vitest';
import { entityFromWire, permissionsFromWire } from '../topic-gate';

describe('permissions off the wire', () => {
  it('keeps the tenant answer, from snake_case', () => {
    const topic = entityFromWire({
      id: 'T1', entity_type: 'topic', name: 't', data: {},
      permissions: { level: 'view', can_edit: false, can_comment: true },
    });
    expect(topic.permissions?.canEdit).toBe(false);
    expect(topic.permissions?.canComment).toBe(true);
    expect(topic.permissions?.level).toBe('view');
  });

  it('is null when the tenant sends none', () => {
    expect(entityFromWire({ id: 'T1', data: {} }).permissions).toBeNull();
    expect(permissionsFromWire(undefined)).toBeNull();
  });
});
