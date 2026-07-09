# Marketing Agents Dashboard Update — build spec

## Overview

This update enhances the dashboard for the marketing-agents app, providing a clear overview of source health and article collection metrics.

## Users

Marketing agents and team leads managing content sources and articles.

## Data contract

The data lives in the marketing-agents own DB via the tenant API, with no cross-app calls. The News Item entity has fields: title, url, source_name, source_type (press_wire / company_blog / news_aggregator / sec_filing / gov_registry / patent / trademark / nfx_signal), collected date, and sync state (pending / synced / failed). Source state is derived from News Items: group by source_name, count articles and take the last-collected date; a source is 'producing' if it has a recent item and 'silent' if no item in over 48h. No additional source health fields will be created or called from the engine.

## Data model

- **News Item**
  - title
  - url
  - source_name
  - source_type
  - collected_date
  - sync_state
- **Source**
  - source_name
  - state
  - last_collected

## Screens

### Dashboard

Provide an overview of source health and article collection metrics.

- Metrics row at the top showing healthy/producing vs silent sources, items collected today and this week.
- Source Health section listing each source_name with producing vs silent status, article count, last-collected date, with silent/at-risk flagged first.
- Article Collection section featuring a 14-day bar chart for collected articles with today/this-week headline numbers, most recent items, and breakdowns by source_name, source_type, and sync state.

## Metrics

- Total articles collected
- Articles collected today
- Articles collected this week
- 14-day daily trend of articles collected
- Count of articles by source_name
- Count of articles by source_type
- Count of articles by sync state

## Quick actions

- Open a source's collected items
- Filter sources by state (producing/silent)
- Open a recent news item

## Acceptance criteria

- [ ] Dashboard must compute and display all metrics accurately based on the data contract.
- [ ] The layout must adhere exactly to the specified design, with sections clearly defined and functional as described.
- [ ] Quick actions must work as intended, allowing easy access to source items and filtering.

## Look & feel

Modern, clean, with blue accent colors.