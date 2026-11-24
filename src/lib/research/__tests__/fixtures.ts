import type { AttributeDef, EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

const attr = (name: string, dataType: AttributeDef['dataType'], choices?: string[]): AttributeDef => ({
  id: name,
  name,
  dataType,
  required: false,
  config: choices ? { choices } : {},
});

export const NEWS_TYPE: EntityTypeDef = {
  id: 'news',
  key: 'news_item',
  label: 'News item',
  attributes: [
    attr('title', 'text'),
    attr('url', 'text'),
    attr('snippet', 'longtext'),
    attr('source_name', 'text'),
    attr('published_at', 'date'),
    attr('status', 'enum', ['new', 'surfaced', 'acceptable', 'cited', 'ignored', 'rejected', 'preview_only']),
  ],
};

export const TOPIC_TYPE: EntityTypeDef = {
  id: 'topic',
  key: 'topic',
  label: 'Topic',
  attributes: [
    attr('title', 'text'),
    attr('angle', 'longtext'),
    attr('market', 'text'),
    attr('status', 'enum', ['suggested', 'ready', 'rejected', 'written']),
    attr('team_verdict', 'text'),
    attr('source_1', 'text'),
    attr('source_2', 'text'),
    attr('source_3', 'text'),
  ],
};

export function record(
  id: string,
  entityType: string,
  data: Record<string, unknown>,
  extra: Partial<EntityRecord> = {},
): EntityRecord {
  return {
    id: id as unknown as number,
    entityType,
    externalId: null,
    name: String(data.title ?? id),
    data,
    createdAt: '2026-10-20T10:00:00Z',
    ...extra,
  };
}
