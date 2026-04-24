/**
 * 07 · HTTP smoke tests — hit the same endpoints the UI / Chrome extension
 * hits (prod by default, can override to localhost with QA_BASE_URL).
 *
 * Why separate from 02-filter-audit: that one goes straight to `getEvents()`.
 * This one goes over HTTP so we also cover: JSON serialization, query-param
 * parsing, Next.js middleware, caching, and any API-route bugs that don't
 * show up against the raw DB layer.
 */

import fs from 'fs';
import path from 'path';

const BASE = process.env.QA_BASE_URL || 'https://pulseup.me';
const OUT = path.join(process.cwd(), 'reports', 'qa', `07-http-smoke-${BASE.includes('localhost') ? 'local' : 'prod'}.json`);

interface Case {
  id: string;
  name: string;
  url: string;
  check: (data: unknown, status: number) => { ok: boolean; detail: string };
}

interface Ev { id: number; title: string; is_free?: boolean; age_best_from?: number; age_best_to?: number; country_county?: string; category_l1?: string; }
interface ListResp { events?: Ev[]; total?: number; error?: string; }

const ok = (detail: string) => ({ ok: true, detail });
const bad = (detail: string) => ({ ok: false, detail });

const CASES: Case[] = [
  {
    id: 'h01',
    name: 'GET /api/events (baseline)',
    url: '/api/events?page_size=500',
    check: (d, s) => {
      const r = d as ListResp;
      if (s !== 200) return bad(`status=${s} error=${r.error}`);
      if (!Array.isArray(r.events) || r.events.length === 0) return bad('no events');
      return ok(`${r.total} total events`);
    },
  },
  {
    id: 'h02',
    name: 'Age=4 — no events outside bounds',
    url: '/api/events?age=4&page_size=200',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as ListResp;
      const wrong = (r.events ?? []).filter(
        (e) => (e.age_best_from != null && e.age_best_from > 4) || (e.age_best_to != null && e.age_best_to < 4)
      );
      return wrong.length === 0 ? ok(`${r.total} events, all age-fit`) : bad(`${wrong.length} out-of-range: ${wrong.slice(0, 2).map((e) => `#${e.id}`).join(',')}`);
    },
  },
  {
    id: 'h03',
    name: 'Age=7 + girl (regression: was HTTP 500)',
    url: '/api/events?age=7&child_genders=girl&page_size=50',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as ListResp;
      return (r.events ?? []).length > 0 ? ok(`${r.total} events returned`) : bad('zero returned');
    },
  },
  {
    id: 'h04',
    name: 'Brooklyn — no Manhattan leaks',
    url: '/api/events?neighborhoods=Brooklyn&page_size=200',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as ListResp;
      const leak = (r.events ?? []).filter(
        (e) => e.country_county && e.country_county !== 'Kings County'
      );
      return leak.length === 0 ? ok(`${r.total} events, all in Kings County`) : bad(`${leak.length} non-Brooklyn: ${leak.slice(0, 2).map((e) => `${e.country_county}#${e.id}`).join(',')}`);
    },
  },
  {
    id: 'h05',
    name: 'Manhattan filter',
    url: '/api/events?neighborhoods=Manhattan&page_size=200',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as ListResp;
      return (r.events ?? []).length > 0 ? ok(`${r.total} Manhattan events`) : bad('zero results');
    },
  },
  {
    id: 'h06',
    name: 'Free-only filter',
    url: '/api/events?is_free=true&page_size=200',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as ListResp;
      const paid = (r.events ?? []).filter((e) => e.is_free === false);
      return paid.length === 0 ? ok(`${r.total} free events`) : bad(`${paid.length} paid events leaked`);
    },
  },
  {
    id: 'h07',
    name: 'Science category returns something',
    url: '/api/events?categories=science&page_size=50',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as ListResp;
      return (r.events ?? []).length > 0 ? ok(`${r.total} science events`) : bad('zero returned (DB is known scarce, but >0 expected)');
    },
  },
  {
    id: 'h08',
    name: 'Combo: 4yo + Brooklyn + free',
    url: '/api/events?age=4&neighborhoods=Brooklyn&is_free=true&page_size=50',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as ListResp;
      const bad_age = (r.events ?? []).filter((e) => (e.age_best_from ?? 0) > 4 || (e.age_best_to != null && e.age_best_to < 4));
      const bad_geo = (r.events ?? []).filter((e) => e.country_county && e.country_county !== 'Kings County');
      const bad_price = (r.events ?? []).filter((e) => e.is_free === false);
      const issues = bad_age.length + bad_geo.length + bad_price.length;
      return issues === 0 ? ok(`${r.total} events, all clean`) : bad(`age-wrong=${bad_age.length} geo-wrong=${bad_geo.length} price-wrong=${bad_price.length}`);
    },
  },
  {
    id: 'h09',
    name: 'GET /api/digests',
    url: '/api/digests',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      // Response can be either {digests:[...]} or Array<{name,digests:[]}>
      let count = 0;
      if (Array.isArray(d)) {
        count = (d as Array<{ digests?: unknown[] }>).flatMap((c) => c.digests ?? []).length;
      } else if (d && typeof d === 'object' && Array.isArray((d as { digests?: unknown[] }).digests)) {
        count = ((d as { digests: unknown[] }).digests).length;
      }
      return count >= 5 ? ok(`${count} digests`) : bad(`only ${count} digests`);
    },
  },
  {
    id: 'h10',
    name: 'Digest by slug: weekend',
    url: '/api/digests/weekend',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as { digest?: { title?: string }; events?: unknown[] };
      return Array.isArray(r.events) && r.events.length > 0 ? ok(`${r.events.length} events`) : bad('no events in digest');
    },
  },
  {
    id: 'h11',
    name: 'Digest by slug: indoor',
    url: '/api/digests/indoor',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as { events?: unknown[] };
      return Array.isArray(r.events) && r.events.length > 0 ? ok(`${r.events.length} events`) : bad('no events');
    },
  },
  {
    id: 'h12',
    name: 'GET /api/categories',
    url: '/api/categories',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      return Array.isArray(d) && d.length > 5 ? ok(`${(d as unknown[]).length} categories`) : bad('too few categories');
    },
  },
  {
    id: 'h13',
    name: 'Chat API — simple query',
    url: '__CHAT__:Things to do this weekend',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as { events?: unknown[]; message?: string; filters?: unknown };
      if (!r.message) return bad('no reply message');
      if (!Array.isArray(r.events)) return bad('events field missing');
      return ok(`${r.events.length} events, filters: ${JSON.stringify(r.filters ?? {}).slice(0, 60)}`);
    },
  },
  {
    id: 'h14',
    name: 'Chat API — age + gender (was 500)',
    url: '__CHAT__:What can my 7 year old girl do today',
    check: (d, s) => {
      if (s !== 200) return bad(`status=${s}`);
      const r = d as { events?: unknown[] };
      return Array.isArray(r.events) ? ok(`${r.events.length} events`) : bad('no events array');
    },
  },
];

async function main() {
  console.log(`\n════ HTTP SMOKE (${BASE}) ════`);
  const rows: Array<{ id: string; name: string; ok: boolean; detail: string; latencyMs: number; status: number }> = [];
  for (const c of CASES) {
    const start = Date.now();
    try {
      let res: Response;
      if (c.url.startsWith('__CHAT__:')) {
        const msg = c.url.replace('__CHAT__:', '');
        res = await fetch(`${BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg }),
        });
      } else {
        res = await fetch(`${BASE}${c.url}`);
      }
      const latencyMs = Date.now() - start;
      const data = await res.json().catch(() => ({}));
      const verdict = c.check(data, res.status);
      rows.push({ id: c.id, name: c.name, ok: verdict.ok, detail: verdict.detail, latencyMs, status: res.status });
      const icon = verdict.ok ? '✓' : '✗';
      console.log(`  ${c.id} ${icon} ${(res.status + '').padStart(3)} ${String(latencyMs).padStart(5)}ms  ${c.name.padEnd(45)}  ${verdict.detail}`);
    } catch (e) {
      const latencyMs = Date.now() - start;
      rows.push({ id: c.id, name: c.name, ok: false, detail: `THROWN: ${(e as Error).message}`, latencyMs, status: 0 });
      console.log(`  ${c.id} ✗ ERR  ${(e as Error).message.slice(0, 60)}`);
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, cases: rows }, null, 2));
  const pass = rows.filter((r) => r.ok).length;
  console.log(`\nSummary: ${pass}/${rows.length} passed · base=${BASE}`);
  console.log(`Report → ${OUT}`);
  process.exit(pass === rows.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
