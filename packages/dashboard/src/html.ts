/**
 * The embedded dashboard — a single, dependency-free HTML page. It polls the
 * JSON API and renders counters, overhead percentiles, per-route load and the
 * top throttled keys. Works in light and dark.
 */
export function dashboardHtml(basePath: string, pollMs: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rate Limiter</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --muted: #666; --card: #f6f7f9;
    --border: #e3e5e8; --accent: #2563eb; --ok: #16a34a; --bad: #dc2626;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --fg: #e8eaed; --muted: #9aa0a6; --card: #181b20;
      --border: #272b31; --accent: #60a5fa; --ok: #4ade80; --bad: #f87171;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  header { padding: 16px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 16px; margin: 0; }
  .status { margin-left: auto; color: var(--muted); font-size: 12px; }
  main { padding: 16px; max-width: 980px; margin: 0 auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px; margin-bottom: 16px; }
  .card { background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px; }
  .card .label { color: var(--muted); font-size: 12px; text-transform: uppercase;
    letter-spacing: .04em; }
  .card .value { font-size: 26px; font-weight: 600; margin-top: 4px; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }
  .bar { height: 8px; border-radius: 4px; background: var(--border);
    overflow: hidden; margin-top: 10px; display: flex; }
  .bar > span { display: block; height: 100%; }
  section h2 { font-size: 13px; color: var(--muted); text-transform: uppercase;
    letter-spacing: .04em; margin: 20px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border);
    font-size: 13px; }
  th { color: var(--muted); font-weight: 500; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  code { background: var(--border); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .empty { color: var(--muted); padding: 10px; }
</style>
</head>
<body>
<header>
  <h1>Rate Limiter Dashboard</h1>
  <span class="status" id="status">connecting…</span>
</header>
<main>
  <div class="grid" id="counters"></div>
  <div class="card">
    <div class="label">Allowed vs Blocked</div>
    <div class="bar"><span id="barOk" style="background:var(--ok)"></span><span id="barBad" style="background:var(--bad)"></span></div>
  </div>
  <div class="grid" id="latency" style="margin-top:16px"></div>
  <section>
    <h2>Top throttled keys</h2>
    <table><thead><tr><th>Key</th><th class="num">Blocked</th></tr></thead>
    <tbody id="topBody"></tbody></table>
  </section>
  <section>
    <h2>By route</h2>
    <table><thead><tr><th>Route</th><th class="num">Allowed</th><th class="num">Blocked</th></tr></thead>
    <tbody id="routeBody"></tbody></table>
  </section>
</main>
<script>
  const BASE = ${JSON.stringify(basePath)};
  const POLL = ${pollMs};
  const el = (id) => document.getElementById(id);
  function card(label, value, cls) {
    return '<div class="card"><div class="label">' + label + '</div><div class="value ' +
      (cls||'') + '">' + value + '</div></div>';
  }
  function esc(s) { return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  async function tick() {
    try {
      const res = await fetch(BASE + '/api/metrics', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const m = await res.json();
      el('status').textContent = 'updated ' + new Date().toLocaleTimeString();
      const c = m.counters;
      el('counters').innerHTML =
        card('Allowed', c.allowed, 'ok') + card('Blocked', c.blocked, 'bad') +
        card('Degraded', c.degraded) + card('Store errors', c.storeErrors);
      const total = c.allowed + c.blocked || 1;
      el('barOk').style.width = (100 * c.allowed / total) + '%';
      el('barBad').style.width = (100 * c.blocked / total) + '%';
      el('latency').innerHTML =
        card('p50 overhead', m.latency.p50 + ' ms') +
        card('p95 overhead', m.latency.p95 + ' ms') +
        card('p99 overhead', m.latency.p99 + ' ms') +
        card('samples', m.latency.count);
      el('topBody').innerHTML = (m.topThrottled || []).length
        ? m.topThrottled.map(t => '<tr><td><code>' + esc(t.key) + '</code></td><td class="num">' +
            t.blocked + '</td></tr>').join('')
        : '<tr><td class="empty" colspan="2">No throttled keys yet</td></tr>';
      const routes = Object.entries(m.byRoute || {});
      el('routeBody').innerHTML = routes.length
        ? routes.map(([r, v]) => '<tr><td><code>' + esc(r) + '</code></td><td class="num">' +
            v.allowed + '</td><td class="num">' + v.blocked + '</td></tr>').join('')
        : '<tr><td class="empty" colspan="3">No traffic yet</td></tr>';
    } catch (e) {
      el('status').textContent = 'error: ' + e.message;
    }
  }
  tick();
  setInterval(tick, POLL);
</script>
</body>
</html>`;
}
