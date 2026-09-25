// 抓 XMAX 过去半年 历史 日线 - Nasdaq Unofficial source
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
async function main() {
  const days = 210;
  const fromdate = new Date(Date.now() - days*24*3600*1000).toISOString().slice(0,10);
  const limit = Math.max(30, Math.floor(days*1.4)+10);
  const url = `https://api.nasdaq.com/api/quote/XMAX/historical?assetclass=stocks&fromdate=${fromdate}&limit=${limit}`;
  console.error('GET', url);
  let candles = null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: 'https://www.nasdaq.com/' },
      signal: AbortSignal.timeout(12000)
    });
    const j = await res.json();
    const rows = (j?.data?.tradesTable?.rows) || (j?.data?.table?.rows) || [];
    console.error('rows=', rows.length, 'status=', res.status);
    const fromMs = Date.now() - days*24*3600*1000;
    const out = [];
    for (const r of rows) {
      const d = r.date || r.tradeDate;
      const close = Number(String(r.close || r.Close || '0').replace(/[^0-9.\-]/g, ''));
      if (!d || !Number.isFinite(close) || !close) continue;
      const t = new Date(d).getTime();
      if (!Number.isFinite(t) || t < fromMs) continue;
      out.push({
        time: Math.round(t/1000),
        date: new Date(t).toISOString().slice(0,10),
        open: Number(String(r.open || r.Open || close).replace(/[^0-9.\-]/g, '')),
        high: Number(String(r.high || r.High || close).replace(/[^0-9.\-]/g, '')),
        low: Number(String(r.low || r.Low || close).replace(/[^0-9.\-]/g, '')),
        close,
        volume: Number(String(r.volume || r.Volume || '0').replace(/[^0-9]/g, '')),
      });
    }
    candles = out.sort((a,b)=>a.time-b.time);
    console.error(`Nasdaq: ${candles.length} candles, from ${candles[0]?.date} to ${candles[candles.length-1]?.date}`);
  } catch(e) { console.error('Nasdaq failed:', e.message); }

  if (!candles || candles.length < 60) {
    console.error('Trying Stooq (alternative URL)...');
    // try nasdaq.com asx api endpoint (quote info json with history)
    const url2 = `https://api.nasdaq.com/api/quote/XMAX/historical?assetclass=etf&fromdate=${fromdate}&limit=${limit}`;
    try {
      const res = await fetch(url2, {headers:{'User-Agent':UA, Accept:'application/json', Referer:'https://www.nasdaq.com/'}, signal:AbortSignal.timeout(12000)});
      const j = await res.json();
      console.error('etf endpoint status:', res.status, 'keys:', j && j.data ? Object.keys(j.data).slice(0,5) : null);
      const rows = (j?.data?.tradesTable?.rows) || (j?.data?.table?.rows) || [];
      const out = [];
      const fromMs = Date.now() - days*24*3600*1000;
      for (const r of rows) {
        const d = r.date || r.tradeDate;
        const close = Number(String(r.close || r.Close || '0').replace(/[^0-9.\-]/g, ''));
        if (!d || !Number.isFinite(close) || !close) continue;
        const t = new Date(d).getTime();
        if (!Number.isFinite(t) || t < fromMs) continue;
        out.push({time:Math.round(t/1000), date:new Date(t).toISOString().slice(0,10),
          open: Number(String(r.open || r.Open || close).replace(/[^0-9.\-]/g, '')),
          high: Number(String(r.high || r.High || close).replace(/[^0-9.\-]/g, '')),
          low: Number(String(r.low || r.Low || close).replace(/[^0-9.\-]/g, '')),
          close,
          volume: Number(String(r.volume || r.Volume || '0').replace(/[^0-9]/g, '')),
        });
      }
      out.sort((a,b)=>a.time-b.time);
      if (out.length) { candles = out; console.error('etf endpoint rows=', out.length);}
    } catch (e) { console.error('etf endpoint failed:', e.message); }
  }

  if (!candles || !candles.length) { console.error('ALL FAILED'); process.exit(2); }
  process.stdout.write(JSON.stringify({symbol:'XMAX', candles}, null, 2));
}
main().catch(e=>{console.error(e);process.exit(2)});
