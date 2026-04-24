# PulseUp Analytics

Custom event-based product analytics. No Google Analytics. Events live in SQLite (`data/analytics.db`, table `analytics_events`).

## Architecture

```
client (lib/analytics.ts)
   │  POST /api/analytics/event   (batched, sendBeacon on unload)
   ▼
app/api/analytics/event/route.ts → insertAnalyticsEvents() → SQLite
                                                          ▲
app/admin/analytics  ← GET /api/analytics?view=… ─────────┘
```

* `lib/analytics-db.ts` — schema + insert/report helpers
* `lib/analytics.ts` — client library (`initAnalytics`, `trackEvent`, `trackPageView`)
* `app/api/analytics/event/route.ts` — write endpoint (POST single or `{events:[...]}`)
* `app/api/analytics/route.ts` — read endpoint (GET, password-protected)
* `app/admin/analytics/page.tsx` — dashboard

## Identity model

| Field          | Storage              | Lifetime                                |
|----------------|----------------------|-----------------------------------------|
| `anonymous_id` | `localStorage` `pu_anon_id` | persistent, until user clears storage |
| `session_id`   | `sessionStorage` `pu_session_id` + `pu_session_last` | rotates after 30 min inactivity |
| `user_id`      | passed in props if known | optional, reserved for auth |

First-touch UTM is captured on first visit and stored in `localStorage` `pu_first_touch`. Every event afterwards carries those original UTM values + current `referrer` / `landing_page`.

## Schema (SQLite)

`data/analytics.db` → table `analytics_events`:

```
id TEXT PRIMARY KEY                       -- uuid
created_at TEXT (datetime('now'))
event_name TEXT                           -- snake_case
event_version INTEGER DEFAULT 1
user_id TEXT NULL
anonymous_id TEXT NOT NULL
session_id TEXT NOT NULL
page_url, page_path, referrer, landing_page TEXT
utm_source, utm_medium, utm_campaign, utm_term, utm_content TEXT
device_type, browser, os TEXT
screen_width, screen_height INTEGER
event_props TEXT NOT NULL DEFAULT '{}'    -- JSON, query with json_extract()
```

Indexes: `created_at`, `event_name`, `anonymous_id`, `session_id`, `user_id`, `utm_source`.

> Note: spec was Postgres (`uuid`, `jsonb`, `gin`). SQLite-adapted: TEXT uuid, TEXT JSON queried via `json_extract()`. Same logic, identical query patterns.

## Event taxonomy

All event names are snake_case.

| P0 | Event | Where it's emitted |
|----|-------|--------------------|
| ✅ | `page_view` | `initAnalytics()` + `trackPageView()` |
| ✅ | `session_started` | first event in a new session (30-min timeout) |
| ✅ | `return_visit` | session_started where `anonymous_id` already existed |
| ✅ | `chat_started` | first message in chat sidebar |
| ✅ | `message_sent` | every message submission |
| ✅ | `recommendations_requested` | before chat API call |
| ✅ | `recommendations_shown` | after chat API responds (`latency_ms`) |
| ✅ | `card_clicked` | feed card click |
| ✅ | `card_opened` | event detail opened |
| ✅ | `buy_clicked` | "Buy ticket" CTA |
| ✅ | `ticket_link_clicked` | same CTA — alias for ticket flow |
| ✅ | `external_link_clicked` | any outbound link |
| ✅ | `onboarding_completed` | onboarding finishes |
| ✅ | `filter_applied` | any filter change (what / when / who / where / reset) |
| P1 | `share_clicked` | share button |
| P1 | `favorite_toggled` | favourite added/removed |
| P1 | `tab_switched` | feed ↔ for-you |

Add new events any time — see "How to add an event" below.

## Client API

```ts
import { initAnalytics, trackEvent, trackPageView } from '@/lib/analytics';

// Once on app mount (already wired in app/page.tsx):
initAnalytics();

// Anywhere:
trackEvent('buy_clicked', {
  event_id: '123',
  button_type: 'buy_tickets',
  destination_url: 'https://...',
});

// On client-side route changes (if any):
trackPageView();
```

Behaviour:
- Buffers events; flushes on size ≥ 10, every 5 s, or via `sendBeacon` on `pagehide`/`visibilitychange`/`beforeunload`.
- Never throws. Failed sends are best-effort re-queued.
- Server endpoint always returns 204 — analytics never break UX.

## Server endpoint

`POST /api/analytics/event`

Single event:
```json
{ "event_name": "card_clicked", "anonymous_id": "...", "session_id": "...", "event_props": { "event_id": "abc" } }
```

Batch:
```json
{ "events": [ { "event_name": "...", ... }, { ... } ] }
```

Validation:
- `event_name` must match `^[a-z][a-z0-9_]{0,63}$`
- `anonymous_id` and `session_id` are required
- Bad rows are silently dropped — entire batch never fails

(Backward-compat: `POST /api/analytics` accepts the same shape.)

## Read endpoint

`GET /api/analytics?view=<view>&key=<ANALYTICS_KEY>&from=YYYY-MM-DD&to=YYYY-MM-DD`

| view | returns |
|------|---------|
| `summary` | counts of key events + unique users/sessions |
| `funnel` | sessions count for each funnel step |
| `daily` | daily unique users + sessions |
| `retention` | `{ returning_pct }` |
| `utm` | per-source sessions / recs / buys |
| `top_events` | top clicked/bought event_ids |
| `latency` | average `recommendations_shown.latency_ms` |
| `recent` | last 200 raw events |

Password: env var `ANALYTICS_KEY` (default `pulse-analytics-2026` for dev).

## Dashboard

`/admin/analytics` — login with the same password. Shows:
- KPI cards (DAU, sessions, page views, chat starts, recs, buys, returning %, latency)
- Conversion-rate strip (chat_start_rate, onboarding_complete_rate, recommendations_shown_rate, card_click_rate, buy_click_rate)
- Funnel bars
- Daily users table
- UTM source performance
- Top clicked events

## SQL recipes

> SQLite syntax. Use `sqlite3 data/analytics.db` from the project root.

**Daily unique users**
```sql
SELECT date(created_at) AS day, COUNT(DISTINCT anonymous_id) AS dau
FROM analytics_events GROUP BY 1 ORDER BY 1 DESC;
```

**Sessions per day**
```sql
SELECT date(created_at) AS day, COUNT(DISTINCT session_id) AS sessions
FROM analytics_events GROUP BY 1 ORDER BY 1 DESC;
```

**Returning users %**
```sql
WITH per_user AS (
  SELECT anonymous_id, COUNT(DISTINCT session_id) AS sess
  FROM analytics_events GROUP BY anonymous_id
)
SELECT 1.0 * SUM(CASE WHEN sess > 1 THEN 1 ELSE 0 END) / COUNT(*) AS returning_pct
FROM per_user;
```

**Chat-start rate**
```sql
WITH s AS (SELECT DISTINCT session_id FROM analytics_events WHERE event_name='session_started'),
     c AS (SELECT DISTINCT session_id FROM analytics_events WHERE event_name='chat_started')
SELECT 1.0 * (SELECT COUNT(*) FROM c) / NULLIF((SELECT COUNT(*) FROM s), 0) AS chat_start_rate;
```

**Recommendations-shown rate**
```sql
WITH c AS (SELECT DISTINCT session_id FROM analytics_events WHERE event_name='chat_started'),
     r AS (SELECT DISTINCT session_id FROM analytics_events WHERE event_name='recommendations_shown')
SELECT 1.0 * (SELECT COUNT(*) FROM r) / NULLIF((SELECT COUNT(*) FROM c), 0) AS rec_shown_rate;
```

**Buy-click rate**
```sql
WITH r AS (SELECT DISTINCT session_id FROM analytics_events WHERE event_name='recommendations_shown'),
     b AS (SELECT DISTINCT session_id FROM analytics_events WHERE event_name='buy_clicked')
SELECT 1.0 * (SELECT COUNT(*) FROM b) / NULLIF((SELECT COUNT(*) FROM r), 0) AS buy_click_rate;
```

**UTM performance**
```sql
SELECT COALESCE(utm_source, '(direct)') AS src,
       COUNT(DISTINCT session_id) AS sessions,
       SUM(CASE WHEN event_name='buy_clicked' THEN 1 ELSE 0 END) AS buys
FROM analytics_events GROUP BY 1 ORDER BY sessions DESC;
```

**Top clicked event_ids**
```sql
SELECT json_extract(event_props, '$.event_id') AS event_id,
       COUNT(*) AS clicks
FROM analytics_events
WHERE event_name='card_clicked'
GROUP BY 1 ORDER BY clicks DESC LIMIT 20;
```

**Avg recommendations latency**
```sql
SELECT AVG(CAST(json_extract(event_props, '$.latency_ms') AS REAL)) AS avg_ms
FROM analytics_events WHERE event_name='recommendations_shown';
```

## How to add a new event

1. Pick a snake_case name that matches `^[a-z][a-z0-9_]{0,63}$`.
2. Call `trackEvent('your_event', { ...props })` from the relevant component.
3. (Optional) add it to a dashboard helper in `lib/analytics-db.ts` and a card in `app/admin/analytics/page.tsx`.
4. Append to the taxonomy table in this file.

No schema change is needed — `event_props` is JSON.

## Microsoft Clarity (placeholder)

Drop the Clarity snippet into `app/layout.tsx` inside a `<Script>` from `next/script`. Not enabled by default — own analytics is the source of truth.

## Inspecting the table

```bash
sqlite3 data/analytics.db
sqlite> .headers on
sqlite> .mode column
sqlite> SELECT event_name, COUNT(*) FROM analytics_events GROUP BY 1 ORDER BY 2 DESC;
```

In production the file lives at `<project>/data/analytics.db` on the VPS.
