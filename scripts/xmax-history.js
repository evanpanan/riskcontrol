// 临时：抓 XMAX 过去半年 3M 周期的真实行情
process.on('unhandledRejection', (e) => { console.error('UNHANDLED:', e); process.exit(1); });

async function main() {
  const p2 = Math.floor(Date.now()/1000);
  const p1 = Math.floor(Date.now()/1000) - 210*24*3600; // 3M = 210天
  console.error('Fetch Yahoo Finance XMAX past 6 months...');

  const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' };

  const hosts = ['query1','query2'];
  let candles = null;
  for (const host of hosts) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/XMAX?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) { console.error(`${host} HTTP ${res.status}`); continue; }
      const j = await res.json();
      const r = j.chart && j.chart.result && j.chart.result[0];
      if (!r || !r.timestamp) { console.error(`${host} no result`); continue; }
      const ts = r.timestamp;
      const q = r.indicators.quote[0];
      const out = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        out.push({
          time: ts[i],
          date: new Date(ts[i]*1000).toISOString().slice(0,10),
          open: q.open[i],
          high: q.high[i],
          low: q.low[i],
          close: q.close[i],
          volume: q.volume[i] || 0,
        });
      }
      console.error(`${host}: got ${out.length} candles, range ${out[0]?.date} ~ ${out[out.length-1]?.date}`);
      if (out.length >= 80) { candles = out; break; }
    } catch (e) { console.error(`${host} error:`, e.message); }
  }

  if (!candles) {
    console.error('All hosts failed. Trying Stooq as fallback.');
    const today = new Date();
    const fmt = (d) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const end = today;
    const start = new Date(today.getTime() - 210*86400000);
    const d1 = fmt(start), d2 = fmt(end);
    const url = `https://stooq.com/q/d/l/?s=xmax.us&d1=${d1}&d2=${d2}&i=d`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      const t = await res.text();
      console.error('Stooq resp first 300:', t.slice(0,300));
      // Stooq returns CSV with Date,Open,High,Low,Close,Volume
      const lines = t.split('\n').filter(l => l.trim());
      const out = [];
      for (const l of lines.slice(1)) {
        const parts = l.split(',');
        if (parts.length < 5 || !parts[0] || parts[0] === '<') continue;
        const [dy, dm, dd] = parts[0].split('-').map(Number);
        if (!dy) continue;
        const time = Math.floor(new Date(Date.UTC(dy, dm-1, dd)).getTime()/1000);
        out.push({
          time, date: parts[0],
          open: Number(parts[1]), high: Number(parts[2]), low: Number(parts[3]),
          close: Number(parts[4]), volume: Number(parts[5]||0)
        });
      }
      if (out.length) { console.error('Stooq:', out.length, 'candles'); candles = out; }
    } catch (e) { console.error('Stooq err:', e.message); }
  }

  if (!candles) {
    console.error('No data from any source. FAIL.');
    process.exit(2);
  }

  // 输出 JSON 到 stdout
  process.stdout.write(JSON.stringify({ symbol: 'XMAX', candles }, null, 2));
}
main();
