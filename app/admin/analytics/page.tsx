'use client';

import { useState, useEffect, useCallback } from 'react';

interface Summary {
  total_events: number;
  unique_anonymous: number;
  unique_sessions: number;
  page_views: number;
  session_started: number;
  chat_started: number;
  message_sent: number;
  onboarding_completed: number;
  recommendations_shown: number;
  card_clicked: number;
  buy_clicked: number;
  return_visit: number;
}
interface FunnelStep { step: string; sessions: number; }
interface UtmRow { utm_source: string; sessions: number; buy_clicked: number; rec_shown: number; }
interface TopEvent { event_id: string; clicks: number; buys: number; }
interface DailyRow { day: string; dau: number; sessions: number; }

export default function AdminAnalyticsPage() {
  const [auth, setAuth] = useState(false);
  const [password, setPassword] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [utm, setUtm] = useState<UtmRow[]>([]);
  const [topEvents, setTopEvents] = useState<TopEvent[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [retention, setRetention] = useState(0);
  const [latency, setLatency] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async (key: string) => {
    setLoading(true);
    const params = new URLSearchParams({ key });
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    try {
      const [s, f, u, t, d, r, l] = await Promise.all([
        fetch(`/api/analytics?view=summary&${params}`).then(r => r.json()),
        fetch(`/api/analytics?view=funnel&${params}`).then(r => r.json()),
        fetch(`/api/analytics?view=utm&${params}`).then(r => r.json()),
        fetch(`/api/analytics?view=top_events&${params}`).then(r => r.json()),
        fetch(`/api/analytics?view=daily&${params}`).then(r => r.json()),
        fetch(`/api/analytics?view=retention&${params}`).then(r => r.json()),
        fetch(`/api/analytics?view=latency&${params}`).then(r => r.json()),
      ]);
      setSummary(s); setFunnel(f); setUtm(u); setTopEvents(t); setDaily(d);
      setRetention(r?.returning_pct || 0);
      setLatency(l?.avg_ms || 0);
    } catch (e) {
      console.error('Failed to fetch analytics:', e);
    }
    setLoading(false);
  }, [dateFrom, dateTo]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setAuth(true);
    fetchData(password);
  };

  useEffect(() => { if (auth) fetchData(password); }, [dateFrom, dateTo]); // eslint-disable-line

  if (!auth) {
    return (
      <div style={S.loginWrap}>
        <form onSubmit={handleLogin} style={S.loginForm}>
          <h2 style={{ margin: 0, color: '#fff' }}>PulseUp Analytics</h2>
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={S.input} />
          <button type="submit" style={S.btn}>Login</button>
        </form>
      </div>
    );
  }

  const funnelMax = funnel.length ? Math.max(...funnel.map(f => f.sessions), 1) : 1;
  const rate = (a: number, b: number) => b > 0 ? `${Math.round(a / b * 100)}%` : '—';

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={{ margin: 0, fontSize: 22 }}>PulseUp · Admin Analytics</h1>
        <div style={S.dateFilters}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={S.dateInput} />
          <span style={{ color: '#999' }}>—</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={S.dateInput} />
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} style={S.btnSmall}>All time</button>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 30, color: '#999' }}>Loading…</div>}

      {summary && (
        <>
          <div style={S.cards}>
            <Card label="Unique users" value={summary.unique_anonymous} />
            <Card label="Sessions" value={summary.unique_sessions} />
            <Card label="Page views" value={summary.page_views} />
            <Card label="Chat started" value={summary.chat_started} color="#2196f3" />
            <Card label="Onboarding done" value={summary.onboarding_completed} color="#9c27b0" />
            <Card label="Recs shown" value={summary.recommendations_shown} />
            <Card label="Card clicks" value={summary.card_clicked} />
            <Card label="Buy clicks" value={summary.buy_clicked} color="#4caf50" />
            <Card label="Returning visits" value={summary.return_visit} color="#ff9800" />
            <Card label="Returning %" value={Math.round(retention * 100)} suffix="%" color="#ff9800" />
            <Card label="Avg recs latency" value={latency} suffix="ms" />
            <Card label="Total events" value={summary.total_events} />
          </div>

          <div style={S.section}>
            <h3 style={S.sectionTitle}>Conversion Rates (sessions)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 12 }}>
              <Mini label="chat_start_rate" value={rate(summary.chat_started, summary.session_started || summary.unique_sessions)} />
              <Mini label="onboarding_complete_rate" value={rate(summary.onboarding_completed, summary.chat_started)} />
              <Mini label="recommendations_shown_rate" value={rate(summary.recommendations_shown, summary.chat_started)} />
              <Mini label="card_click_rate" value={rate(summary.card_clicked, summary.recommendations_shown)} />
              <Mini label="buy_click_rate" value={rate(summary.buy_clicked, summary.recommendations_shown)} />
            </div>
          </div>

          <div style={S.section}>
            <h3 style={S.sectionTitle}>Conversion Funnel</h3>
            <div style={S.funnel}>
              {funnel.map((step, i) => (
                <div key={step.step} style={S.funnelStep}>
                  <div style={S.funnelLabel}>
                    {step.step.replace(/_/g, ' ')}
                    {i > 0 && funnel[i - 1].sessions > 0 && (
                      <span style={{ color: '#999', fontSize: 12, marginLeft: 6 }}>
                        ({Math.round(step.sessions / funnel[i - 1].sessions * 100)}%)
                      </span>
                    )}
                  </div>
                  <div style={S.barWrap}>
                    <div style={{ ...S.bar, width: `${(step.sessions / funnelMax) * 100}%` }} />
                  </div>
                  <div style={S.funnelCount}>{step.sessions}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={S.section}>
            <h3 style={S.sectionTitle}>Daily Unique Users</h3>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Day</th><th style={S.thNum}>Unique users</th><th style={S.thNum}>Sessions</th></tr></thead>
              <tbody>
                {daily.map(d => (
                  <tr key={d.day}><td style={S.td}>{d.day}</td><td style={S.tdNum}>{d.dau}</td><td style={S.tdNum}>{d.sessions}</td></tr>
                ))}
                {daily.length === 0 && <tr><td colSpan={3} style={S.td}>No data yet</td></tr>}
              </tbody>
            </table>
          </div>

          <div style={S.section}>
            <h3 style={S.sectionTitle}>UTM / Source Performance</h3>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Source</th><th style={S.thNum}>Sessions</th><th style={S.thNum}>Recs shown</th><th style={S.thNum}>Buy clicks</th><th style={S.thNum}>Conv %</th></tr></thead>
              <tbody>
                {utm.map(u => (
                  <tr key={u.utm_source}>
                    <td style={S.td}>{u.utm_source}</td>
                    <td style={S.tdNum}>{u.sessions}</td>
                    <td style={S.tdNum}>{u.rec_shown}</td>
                    <td style={S.tdNum}>{u.buy_clicked}</td>
                    <td style={S.tdNum}>{u.sessions > 0 ? `${Math.round(u.buy_clicked / u.sessions * 100)}%` : '—'}</td>
                  </tr>
                ))}
                {utm.length === 0 && <tr><td colSpan={5} style={S.td}>No data yet</td></tr>}
              </tbody>
            </table>
          </div>

          <div style={S.section}>
            <h3 style={S.sectionTitle}>Top Clicked Events</h3>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Event ID</th><th style={S.thNum}>Card clicks</th><th style={S.thNum}>Buy clicks</th><th style={S.thNum}>CTR</th></tr></thead>
              <tbody>
                {topEvents.map(e => (
                  <tr key={e.event_id}>
                    <td style={S.td}>#{e.event_id}</td>
                    <td style={S.tdNum}>{e.clicks}</td>
                    <td style={S.tdNum}>{e.buys}</td>
                    <td style={S.tdNum}>{e.clicks > 0 ? `${Math.round(e.buys / e.clicks * 100)}%` : '—'}</td>
                  </tr>
                ))}
                {topEvents.length === 0 && <tr><td colSpan={4} style={S.td}>No data yet</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, value, color, suffix }: { label: string; value: number; color?: string; suffix?: string }) {
  return (
    <div style={S.card}>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fff' }}>{value}{suffix || ''}</div>
      <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#22223a', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{label}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1100, margin: '0 auto', padding: '24px 16px', fontFamily: 'Arial, sans-serif', color: '#fff', background: '#0a0a0a', minHeight: '100vh' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  dateFilters: { display: 'flex', gap: 8, alignItems: 'center' },
  dateInput: { background: '#1a1a2e', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#fff', fontSize: 13 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 20 },
  card: { background: '#1a1a2e', borderRadius: 10, padding: '14px 12px', textAlign: 'center' as const },
  section: { background: '#1a1a2e', borderRadius: 10, padding: 16, marginBottom: 16 },
  sectionTitle: { margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: '#ddd' },
  funnel: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  funnelStep: { display: 'flex', alignItems: 'center', gap: 8 },
  funnelLabel: { width: 200, fontSize: 13 },
  barWrap: { flex: 1, background: '#2a2a3e', borderRadius: 4, height: 20, overflow: 'hidden' as const },
  bar: { height: '100%', background: 'linear-gradient(90deg, #e91e63, #ff5722)', borderRadius: 4, transition: 'width 0.3s' },
  funnelCount: { width: 50, textAlign: 'right' as const, fontSize: 13, fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 6px', borderBottom: '1px solid #333', color: '#999', fontWeight: 500 },
  thNum: { textAlign: 'right' as const, padding: '8px 6px', borderBottom: '1px solid #333', color: '#999', fontWeight: 500 },
  td: { padding: '8px 6px', borderBottom: '1px solid #222', color: '#ddd' },
  tdNum: { textAlign: 'right' as const, padding: '8px 6px', borderBottom: '1px solid #222', color: '#ddd' },
  loginWrap: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0a0a0a' },
  loginForm: { display: 'flex', flexDirection: 'column' as const, gap: 12, background: '#1a1a2e', padding: 32, borderRadius: 12 },
  input: { background: '#2a2a3e', border: '1px solid #444', borderRadius: 6, padding: '10px 14px', color: '#fff', fontSize: 14 },
  btn: { background: '#e91e63', border: 'none', borderRadius: 6, padding: '10px 20px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnSmall: { background: '#333', border: 'none', borderRadius: 6, padding: '6px 12px', color: '#ccc', fontSize: 12, cursor: 'pointer' },
};
