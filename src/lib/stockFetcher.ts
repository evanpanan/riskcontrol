export interface StockQuote {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose?: number;
  open?: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
  fetchedAt: Date;
}

export interface StockHistoryEntry {
  date: Date;
  price: number;
  volume?: number;
}

export async function fetchStockQuote(symbol: string): Promise<StockQuote> {
  const mockQuotes: Record<string, StockQuote> = generateMockQuotes();
  const quote = mockQuotes[symbol.toUpperCase()];
  if (quote) return quote;

  return generateRandomQuote(symbol);
}

export async function fetchStockBatch(symbols: string[]): Promise<Record<string, StockQuote>> {
  const results: Record<string, StockQuote> = {};
  for (const symbol of symbols) {
    results[symbol] = await fetchStockQuote(symbol);
  }
  return results;
}

function generateMockQuotes(): Record<string, StockQuote> {
  const now = new Date();
  return {
    NVDA: {
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      price: 118.42,
      change: 3.21,
      changePercent: 2.79,
      previousClose: 115.21,
      open: 115.80,
      dayHigh: 119.10,
      dayLow: 115.30,
      volume: 324500000,
      fetchedAt: now,
    },
    TSLA: {
      symbol: "TSLA",
      name: "Tesla, Inc.",
      price: 237.45,
      change: -5.82,
      changePercent: -2.39,
      previousClose: 243.27,
      open: 241.00,
      dayHigh: 242.50,
      dayLow: 235.10,
      volume: 112800000,
      fetchedAt: now,
    },
    AAPL: {
      symbol: "AAPL",
      name: "Apple Inc.",
      price: 228.18,
      change: 1.45,
      changePercent: 0.64,
      previousClose: 226.73,
      open: 227.20,
      dayHigh: 229.30,
      dayLow: 226.50,
      volume: 54200000,
      fetchedAt: now,
    },
    MSFT: {
      symbol: "MSFT",
      name: "Microsoft Corporation",
      price: 418.52,
      change: 6.37,
      changePercent: 1.55,
      previousClose: 412.15,
      open: 413.80,
      dayHigh: 420.10,
      dayLow: 412.50,
      volume: 22100000,
      fetchedAt: now,
    },
    META: {
      symbol: "META",
      name: "Meta Platforms, Inc.",
      price: 568.25,
      change: -3.18,
      changePercent: -0.56,
      previousClose: 571.43,
      open: 570.00,
      dayHigh: 573.40,
      dayLow: 565.80,
      volume: 14800000,
      fetchedAt: now,
    },
    GOOGL: {
      symbol: "GOOGL",
      name: "Alphabet Inc.",
      price: 162.35,
      change: 2.08,
      changePercent: 1.30,
      previousClose: 160.27,
      open: 161.00,
      dayHigh: 163.50,
      dayLow: 160.20,
      volume: 28500000,
      fetchedAt: now,
    },
    AMZN: {
      symbol: "AMZN",
      name: "Amazon.com, Inc.",
      price: 185.67,
      change: 4.12,
      changePercent: 2.27,
      previousClose: 181.55,
      open: 182.30,
      dayHigh: 186.90,
      dayLow: 181.80,
      volume: 48900000,
      fetchedAt: now,
    },
    AMD: {
      symbol: "AMD",
      name: "Advanced Micro Devices, Inc.",
      price: 142.88,
      change: -8.76,
      changePercent: -5.78,
      previousClose: 151.64,
      open: 150.00,
      dayHigh: 151.20,
      dayLow: 140.50,
      volume: 89600000,
      fetchedAt: now,
    },
  };
}

function generateRandomQuote(symbol: string): StockQuote {
  const now = new Date();
  const basePrice = 50 + Math.random() * 450;
  const changePercent = (Math.random() - 0.5) * 10;
  const change = basePrice * (changePercent / 100);

  return {
    symbol: symbol.toUpperCase(),
    name: symbol.toUpperCase(),
    price: Number(basePrice.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    previousClose: Number((basePrice - change).toFixed(2)),
    open: Number((basePrice - change + (Math.random() - 0.5) * 2).toFixed(2)),
    dayHigh: Number((basePrice + Math.random() * 5).toFixed(2)),
    dayLow: Number((basePrice - Math.random() * 5).toFixed(2)),
    volume: Math.floor(Math.random() * 500000000),
    fetchedAt: now,
  };
}

export function updateStockPriceDynamically(
  basePrice: number,
  volatilityPercent: number = 0.5
): { price: number; changePercent: number } {
  const change = (Math.random() - 0.5) * (basePrice * (volatilityPercent / 100) * 2);
  const newPrice = Math.max(0.01, basePrice + change);
  const changePercent = ((newPrice - basePrice) / basePrice) * 100;
  return {
    price: Number(newPrice.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
  };
}
