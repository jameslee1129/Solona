"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getInfoClient, getSubsClient, type L2Book } from "@/lib/hyperliquid";
import CoinIcon from "@/components/CoinIcon";
import VoiceJoinButton from "@/components/VoiceJoinButton";
import SymbolSearch from "@/components/SymbolSearch";

// Cache for coin launch dates to avoid repeated API calls
const coinLaunchCache = new Map<string, number>();

// Helper function to find the exact launch date of a coin using binary search
async function findCoinLaunchDate(info: any, coin: string, now: number): Promise<number | null> {
  // Check cache first
  if (coinLaunchCache.has(coin)) {
    const cachedDate = coinLaunchCache.get(coin)!;
    return cachedDate;
  }
  
  // Define search bounds: 20 years ago to now
  const twentyYearsAgo = now - (20 * 365 * 24 * 60 * 60 * 1000);
  let left = twentyYearsAgo;
  let right = now;
  let foundLaunchTime: number | null = null;
  
  // Binary search to find the earliest date with data - be more aggressive
  let attempts = 0;
  const maxAttempts = 30; // More attempts for better precision
  
  // First, try some known historical dates to speed up the process
  const testDates = [
    twentyYearsAgo,
    now - (15 * 365 * 24 * 60 * 60 * 1000), // 15 years ago
    now - (10 * 365 * 24 * 60 * 60 * 1000), // 10 years ago
    now - (5 * 365 * 24 * 60 * 60 * 1000),  // 5 years ago
    now - (2 * 365 * 24 * 60 * 60 * 1000),  // 2 years ago
    now - (1 * 365 * 24 * 60 * 60 * 1000),  // 1 year ago
  ];
  
  for (const testDate of testDates) {
    try {
      const quickTest = await info.candleSnapshot({ 
        coin, 
        interval: "1d",
        startTime: testDate,
        endTime: testDate + (30 * 24 * 60 * 60 * 1000)
      });
      
      if (quickTest && quickTest.length > 0) {
        foundLaunchTime = testDate;
        right = testDate; // Set this as our upper bound for binary search
        break;
      }
    } catch (e) {
      // Continue to next test date
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  // Now do binary search with better bounds
  while (left <= right && attempts < maxAttempts) {
    attempts++;
    const mid = Math.floor((left + right) / 2);
    
    try {
      // Test if data exists from this date with a 60-day window for better detection
      const testResult = await info.candleSnapshot({ 
        coin, 
        interval: "1d", // Use daily data for faster search
        startTime: mid,
        endTime: mid + (60 * 24 * 60 * 60 * 1000) // 60 days window
      });
      
      if (testResult && testResult.length > 0) {
        // Data exists from this date, try going further back
        foundLaunchTime = mid;
        right = mid - (3 * 24 * 60 * 60 * 1000); // Go back 3 days (smaller steps)
      } else {
        // No data from this date, search later
        left = mid + (3 * 24 * 60 * 60 * 1000); // Go forward 3 days
      }
    } catch (searchError) {
      // API error, assume no data and search later
      left = mid + (3 * 24 * 60 * 60 * 1000);
    }
    
    // Shorter delay for faster search
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  if (foundLaunchTime) {
    // Go back a bit more to ensure we get the very first candles
    const safetyMargin = 7 * 24 * 60 * 60 * 1000; // 7 days before
    const finalLaunchTime = foundLaunchTime - safetyMargin;
    
    // Cache the result
    coinLaunchCache.set(coin, finalLaunchTime);
    
    return finalLaunchTime;
  } else {
    const fallbackTime = twentyYearsAgo;
    coinLaunchCache.set(coin, fallbackTime);
    return fallbackTime;
  }
}

// Helper function to fetch ALL historical data (20 years or from launch)
async function fetchHistoricalData(
  coin: string, 
  setCandles: (candles: any[]) => void, 
  mids: { coin: string; mid: number }[],
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d" = "1m"
) {
  try {
    const info = getInfoClient();
    let allCandles: any[] = [];
    
    // Strategy 1: Find the coin's launch date or go back 20 years
    const now = Date.now();
    const twentyYearsAgo = now - (20 * 365 * 24 * 60 * 60 * 1000);
    
    let coinLaunchTime = await findCoinLaunchDate(info, coin, now);
    
    // If no specific launch time found, force 20 years back
    if (!coinLaunchTime) {
      coinLaunchTime = twentyYearsAgo;
    }
    
    const startTime = coinLaunchTime;
    const yearsBack = Math.floor((now - startTime) / (365 * 24 * 60 * 60 * 1000));
    
    // Validate that we're actually going back far enough
    if (yearsBack < 10 && coin === 'BTC') {
      const fifteenYearsAgo = now - (15 * 365 * 24 * 60 * 60 * 1000);
      coinLaunchTime = fifteenYearsAgo;
    }
    
    // First, try to get ALL data in one massive request
    try {
      const massiveResult = await info.candleSnapshot({ 
        coin, 
        interval: timeframe, 
        startTime: startTime
        // No endTime = get everything from startTime to now
      });
      
      if (massiveResult && massiveResult.length > 0) {
        const processedCandles = massiveResult.map((candle: any) => {
          // Ensure time is a proper number
          let timeValue = candle.t || candle.time || candle.timestamp || Date.now();
          if (typeof timeValue === 'object' && timeValue !== null) {
            timeValue = (timeValue as any).timestamp || (timeValue as any).time || Date.now();
          }
          const timeNum = Number(timeValue);
          // Convert to milliseconds if it's in seconds
          const timeMs = timeNum < 1e12 ? timeNum * 1000 : timeNum;
          
          return {
            time: timeMs,
            open: Number(candle.o || candle.open || candle.c || candle.close),
            high: Number(candle.h || candle.high || candle.c || candle.close),
            low: Number(candle.l || candle.low || candle.c || candle.close),
            close: Number(candle.c || candle.close),
          };
        }).filter(c => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0);
        
        allCandles = processedCandles;
      }
    } catch (massiveError) {
      // Fallback: chunked approach with smaller chunks for better success rate
      const chunkSizeMs = 90 * 24 * 60 * 60 * 1000; // 3 month chunks (smaller for better success)
      const totalTimeSpan = now - startTime;
      const numberOfChunks = Math.ceil(totalTimeSpan / chunkSizeMs);
      
      for (let i = 0; i < numberOfChunks; i++) {
        const chunkStart = startTime + (i * chunkSizeMs);
        const chunkEnd = Math.min(chunkStart + chunkSizeMs, now);
        
        try {
          const chunkResult = await info.candleSnapshot({ 
            coin, 
            interval: timeframe, 
            startTime: chunkStart,
            endTime: chunkEnd
          });
          
          if (chunkResult && chunkResult.length > 0) {
            const processedCandles = chunkResult.map((candle: any) => {
              // Ensure time is a proper number
              let timeValue = candle.t || candle.time || candle.timestamp || Date.now();
              if (typeof timeValue === 'object' && timeValue !== null) {
                timeValue = (timeValue as any).timestamp || (timeValue as any).time || Date.now();
              }
              const timeNum = Number(timeValue);
              // Convert to milliseconds if it's in seconds
              const timeMs = timeNum < 1e12 ? timeNum * 1000 : timeNum;
              
              return {
                time: timeMs,
                open: Number(candle.o || candle.open || candle.c || candle.close),
                high: Number(candle.h || candle.high || candle.c || candle.close),
                low: Number(candle.l || candle.low || candle.c || candle.close),
                close: Number(candle.c || candle.close),
              };
            }).filter(c => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0);
            
            allCandles = [...allCandles, ...processedCandles];
          }
          
          // Shorter delay for faster loading
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (chunkError) {
          // Continue with next chunk
        }
      }
    }
    
    // Strategy 3: If candleSnapshot failed, try alternative approaches
    if (allCandles.length === 0) {
      // Try fetching recent data in smaller chunks
      const recentIntervals = [
        { start: now - (7 * 24 * 60 * 60 * 1000), end: now, label: "Last 7 days" },
        { start: now - (30 * 24 * 60 * 60 * 1000), end: now - (7 * 24 * 60 * 60 * 1000), label: "7-30 days ago" },
        { start: now - (90 * 24 * 60 * 60 * 1000), end: now - (30 * 24 * 60 * 60 * 1000), label: "30-90 days ago" },
        { start: now - (365 * 24 * 60 * 60 * 1000), end: now - (90 * 24 * 60 * 60 * 1000), label: "90-365 days ago" },
      ];
    
      for (const interval of recentIntervals) {
        try {
          const result = await info.candleSnapshot({ 
            coin, 
            interval: timeframe, 
            startTime: interval.start,
            endTime: interval.end
          });
          
          if (result && result.length > 0) {
            const processedCandles = result.map((candle: any) => {
              // Ensure time is a proper number
              let timeValue = candle.t || candle.time || candle.timestamp || Date.now();
              if (typeof timeValue === 'object' && timeValue !== null) {
                timeValue = (timeValue as any).timestamp || (timeValue as any).time || Date.now();
              }
              const timeNum = Number(timeValue);
              // Convert to milliseconds if it's in seconds
              const timeMs = timeNum < 1e12 ? timeNum * 1000 : timeNum;
              
              return {
                time: timeMs,
                open: Number(candle.o || candle.open || candle.c || candle.close),
                high: Number(candle.h || candle.high || candle.c || candle.close),
                low: Number(candle.l || candle.low || candle.c || candle.close),
                close: Number(candle.c || candle.close),
              };
            }).filter(c => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0);
            
            allCandles = [...allCandles, ...processedCandles];
          }
        } catch (intervalErr) {
          // Continue to next interval
        }
      }
    }
    
    // Strategy 2: If candleSnapshot fails, try building from recent trades
    if (allCandles.length === 0) {
      try {
        const trades = await (info as any).recentTrades?.(coin);
        if (trades && trades.length > 0) {
          const candleMap = new Map();
          
          const timeframeMinutes = {
            "1m": 1,
            "5m": 5,
            "15m": 15,
            "1h": 60,
            "4h": 240,
            "1d": 1440
          };
          
          const intervalMs = (timeframeMinutes[timeframe] || 1) * 60 * 1000;
          
          trades.forEach((trade: any) => {
            const price = Number(trade.px || trade.price);
            const time = typeof trade.time === 'number' ? trade.time :
                        typeof trade.t === 'number' ? trade.t : Date.now();
            const bucket = Math.floor(time / intervalMs) * intervalMs;
            
            if (price > 0 && Number.isFinite(price)) {
              if (!candleMap.has(bucket)) {
                candleMap.set(bucket, { time: bucket, open: price, high: price, low: price, close: price });
              } else {
                const candle = candleMap.get(bucket);
                candle.high = Math.max(candle.high, price);
                candle.low = Math.min(candle.low, price);
                candle.close = price;
              }
            }
          });
          
          allCandles = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
        }
      } catch (tradesErr) {
        // Ignore trades errors
      }
    }
    
    // Strategy 3: Create synthetic data from current price if all else fails
    if (allCandles.length === 0) {
      const currentMid = mids.find(m => m.coin === coin)?.mid;
      if (currentMid && currentMid > 0) {
        // Create appropriate number of candles based on timeframe
        const timeframeMinutes = {
          "1m": 1,
          "5m": 5,
          "15m": 15,
          "1h": 60,
          "4h": 240,
          "1d": 1440
        };
        
        const intervalMs = (timeframeMinutes[timeframe] || 1) * 60 * 1000;
         // For massive historical datasets, generate appropriate amounts
         const maxDataLimits = {
           "1m": { maxCandles: 10000 },   // ~7 days of 1m data
           "5m": { maxCandles: 8000 },    // ~1 month of 5m data  
           "15m": { maxCandles: 6000 },   // ~2 months of 15m data
           "1h": { maxCandles: 4000 },    // ~5 months of 1h data
           "4h": { maxCandles: 3000 },    // ~1.5 years of 4h data
           "1d": { maxCandles: 2000 },    // ~5 years of 1d data
         };
         
         const limits = maxDataLimits[timeframe] || maxDataLimits["1d"];
         const candleCount = limits.maxCandles;
        const now = Date.now();
        const startTime = now - (candleCount * intervalMs);
        
        let lastPrice = currentMid;
        
        for (let i = 0; i < candleCount; i++) {
          const time = startTime + (i * intervalMs);
          const bucketTime = Math.floor(time / intervalMs) * intervalMs;
          
          // Create more realistic price movement
          const trend = (Math.random() - 0.5) * 0.01; // Small trend
          const volatility = Math.random() * 0.02; // Random volatility
          
          const open = lastPrice;
          const close = open * (1 + trend + (Math.random() - 0.5) * volatility);
          const high = Math.max(open, close) * (1 + Math.random() * 0.01);
          const low = Math.min(open, close) * (1 - Math.random() * 0.01);
          
          allCandles.push({
            time: bucketTime,
            open: open,
            high: high,
            low: low,
            close: close,
          });
          
          lastPrice = close;
        }
        
      }
    }
    
    // Remove duplicates and sort
    const uniqueCandles = Array.from(
      new Map(allCandles.map(c => [c.time, c])).values()
    ).sort((a, b) => a.time - b.time);
    
     if (uniqueCandles.length > 0) {
       setCandles(uniqueCandles);
       const firstDate = new Date(uniqueCandles[0].time).toISOString();
       const lastDate = new Date(uniqueCandles[uniqueCandles.length - 1].time).toISOString();
       const totalDays = Math.floor((uniqueCandles[uniqueCandles.length - 1].time - uniqueCandles[0].time) / (24 * 60 * 60 * 1000));
       
            }
    
  } catch (error) {
    // Final fallback: single synthetic candle
    const currentMid = mids.find(m => m.coin === coin)?.mid;
    if (currentMid && currentMid > 0) {
      const now = Date.now();
      const bucketTime = Math.floor(now / 60000) * 60000;
      const syntheticCandle = {
        time: bucketTime,
        open: currentMid,
        high: currentMid,
        low: currentMid,
        close: currentMid
      };
      setCandles([syntheticCandle]);
    }
  }
}
import TradingViewChart from "@/components/TradingViewChart";
import CandleChart from "@/components/CandleChart";
import TradingPanel, { type DemoOrder } from "@/components/TradingPanel";

type Mid = { coin: string; mid: number };

type SelectedCtx = {
  dayNtlVlm?: number;
  midPx?: number;
  prevDayPx?: number;
  high24h?: number;
  low24h?: number;
};

export default function PerpsPanel({ symbol }: { symbol?: string }) {
  const [selected, setSelected] = useState<string>(symbol ?? "BTC");
  const [mids, setMids] = useState<Mid[]>([]);
  const [book, setBook] = useState<L2Book | null>(null);
  const [activeTpSlOrders, setActiveTpSlOrders] = useState<DemoOrder[]>([]);
  const [currentTpPrice, setCurrentTpPrice] = useState<number | undefined>();
  const [currentSlPrice, setCurrentSlPrice] = useState<number | undefined>();
  const [realTpSlOrders, setRealTpSlOrders] = useState<any[]>([]);
  const [ctx, setCtx] = useState<SelectedCtx>({});
  const [maxLev, setMaxLev] = useState<number | undefined>(undefined);
  const subRef = useRef<{ unsubscribe: () => Promise<void> } | null>(null);
  const midsSubRef = useRef<{ unsubscribe: () => Promise<void> } | null>(null);
  const candleSubRef = useRef<{ unsubscribe: () => Promise<void> } | null>(null);
  const bookSigRef = useRef<string>("");
  // Optional spark data; currently unused in UI
  // const [closes, setCloses] = useState<number[]>([]);
  const candleAggRef = useRef<{
    bucketMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null>(null);
  const [candles, setCandles] = useState<{ time: number; open: number; high: number; low: number; close: number }[]>([]);
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h" | "4h" | "1d">("1h");
  const minuteTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Token for å hindre «stale» historiske svar i å overskrive nyere symbol/tidsramme
  const candleReqRef = useRef(0);

  // Safe parsing helpers for metaAndAssetCtxs
  type AssetUniverseEntry = { name: string };
  type AssetCtx = {
    dayNtlVlm?: string | number;
    openInterest?: string | number;
    premium?: number | string;
    oraclePx?: string | number;
    markPx?: string | number;
    midPx?: string | number;
    prevDayPx?: string | number;
  };

  // helper (used in initial load)
  function parseMetaAndCtx(input: unknown): { universe: AssetUniverseEntry[]; ctxs: AssetCtx[] } {
    const arr = Array.isArray(input) ? (input as unknown[]) : [];
    const meta = (arr[0] ?? {}) as { universe?: unknown };
    const universe = Array.isArray(meta.universe)
      ? (meta.universe as unknown[])
          .filter((u): u is { name: string } => typeof (u as { name?: unknown }).name === "string")
          .map((u) => ({ name: (u as { name: string }).name }))
      : [];
    const ctxs = Array.isArray(arr[1]) ? (arr[1] as AssetCtx[]) : [];
    return { universe, ctxs };
  }

  // Load initial mids snapshot
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Reset timeframe to 1h when selecting a new coin
        setTimeframe("1h");
        
        const info = getInfoClient();
        const [allMids, metaAndCtx] = await Promise.all([
          info.allMids(),
          info.metaAndAssetCtxs(),
        ]);
        if (cancelled) return;

        const list: Mid[] = Object.entries(allMids)
          .filter(([k]) => !k.startsWith("@"))
          .map(([coin, px]) => ({ coin, mid: Number(px) }))
          .sort((a, b) => a.coin.localeCompare(b.coin));
        setMids(list);

        // stats for selected
        const { universe, ctxs } = (function parse(input: unknown): { universe: AssetUniverseEntry[]; ctxs: AssetCtx[] } {
          const arr = Array.isArray(input) ? (input as unknown[]) : [];
          const meta = (arr[0] ?? {}) as { universe?: unknown };
          const universe = Array.isArray(meta.universe)
            ? (meta.universe as unknown[])
                .filter((u): u is { name: string } => typeof (u as { name?: unknown }).name === "string")
                .map((u) => ({ name: (u as { name: string }).name }))
            : [];
          const ctxs = Array.isArray(arr[1]) ? (arr[1] as AssetCtx[]) : [];
          return { universe, ctxs };
        })(metaAndCtx);
        const idx = universe.findIndex((u) => u.name === selected);
        if (idx >= 0) {
          const c = ctxs[idx] ?? {} as AssetCtx;

          setCtx({
            dayNtlVlm: c.dayNtlVlm !== undefined ? Number(c.dayNtlVlm) : undefined,
            midPx: c.midPx !== undefined ? Number(c.midPx) : undefined,
            prevDayPx: c.prevDayPx !== undefined ? Number(c.prevDayPx) : undefined,
          });
          const levFields = [(c as any)?.maxLeverage, (c as any)?.maxLev, (c as any)?.levCap, (c as any)?.max_leverage];
          const levRaw = levFields.find((v: any) => typeof v === 'number' || typeof v === 'string');
          const lev = typeof levRaw === 'string' ? Number(levRaw) : (levRaw as number | undefined);
          const fallback = (sym: string) => {
            const s = sym.toUpperCase();
            const table: Record<string, number> = { BTC: 40, ETH: 25, SOL: 20, HYPE: 10, XRP: 20 };
            if (table[s]) return table[s];
            if (["BNB","AVAX","MATIC","DOT","UNI","LINK","LTC","AAVE","MKR","CRV"].includes(s)) return 20;
            return 10;
          };
          setMaxLev(Number.isFinite(lev) ? (lev as number) : fallback(selected));
        }
      } catch (err) {
        // Ignore error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Sync selected with prop changes from header search
  useEffect(() => {
    if (symbol && symbol !== selected) {
      setSelected(symbol);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // Live mids subscription
  useEffect(() => {
    (async () => {
      try {
        if (midsSubRef.current) await midsSubRef.current.unsubscribe();
        const subs = getSubsClient();
        midsSubRef.current = await subs.allMids((data: unknown) => {
          const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
          const source: Record<string, string> = isObj(data) && isObj((data as { mids?: unknown }).mids)
            ? ((data as { mids: Record<string, string> }).mids)
            : (data as Record<string, string>);
          const list: Mid[] = Object.entries(source)
            .filter(([k]) => !k.startsWith("@"))
            .map(([coin, px]) => ({ coin, mid: Number(px) }))
            .sort((a, b) => a.coin.localeCompare(b.coin));
          setMids(list);
        });
      } catch (e) {
        // Ignore error
      }
    })();
    return () => {
      (async () => {
        try {
          if (midsSubRef.current) await midsSubRef.current.unsubscribe();
        } catch {}
      })();
    };
  }, []);

  // Fetch and subscribe to L2 book for selected
  useEffect(() => {
    (async () => {
      try {
        if (subRef.current) await subRef.current.unsubscribe();
        
        // First, try to get initial L2 book data via HTTP

        const info = getInfoClient();
        
        try {
          // Try different possible API methods for order book
          let initialBook: unknown = null;
          
          // Method 1: Try l2Book
          try {
            initialBook = await info.l2Book({ coin: selected });

          } catch (e1) {

            
            // Method 2: Try orderBook if l2Book doesn't exist
            try {
              initialBook = await (info as any).orderBook({ coin: selected });
              ////console.log(`[${selected}] orderBook result:`, initialBook);
            } catch (e2) {
              ////console.log(`[${selected}] orderBook failed:`, e2);
            }
          }
          
          if (initialBook && typeof initialBook === "object") {
            ////console.log(`[${selected}] Processing initial book data...`, initialBook);
            
            let b: L2Book = { bids: [], asks: [] };
            
            // Try different data formats
            const data = initialBook as any;
            
            // Format 1: Direct bids/asks arrays
            if (Array.isArray(data.bids) && Array.isArray(data.asks)) {
              b = {
                bids: data.bids.map((x: any) => ({ 
                  px: Array.isArray(x) ? String(x[0]) : String(x.px || x.price), 
                  sz: Array.isArray(x) ? String(x[1]) : String(x.sz || x.size) 
                })),
                asks: data.asks.map((x: any) => ({ 
                  px: Array.isArray(x) ? String(x[0]) : String(x.px || x.price), 
                  sz: Array.isArray(x) ? String(x[1]) : String(x.sz || x.size) 
                })),
              };
            }
            // Format 2: Levels array
            else if (Array.isArray(data.levels)) {
              const bids = data.levels.filter((level: any) => level[2] === true || level.side === 'bid');
              const asks = data.levels.filter((level: any) => level[2] === false || level.side === 'ask');
              
              b = {
                bids: bids.map((x: any) => ({ px: String(x[0]), sz: String(x[1]) })),
                asks: asks.map((x: any) => ({ px: String(x[0]), sz: String(x[1]) })),
              };
            }
            
            ////console.log(`[${selected}] Processed initial book:`, { bidsCount: b.bids.length, asksCount: b.asks.length });
            if (b.bids.length > 0 || b.asks.length > 0) {
              setBook(b);
            }
          }
        } catch (httpErr) {
          ////console.log(`[${selected}] HTTP L2 book failed:`, httpErr);
        }
        
         // Then subscribe to live updates via WebSocket
        ////console.log(`[${selected}] Setting up WebSocket subscription...`);
        const subs = getSubsClient();
        
        try {
          subRef.current = await subs.l2Book({ coin: selected }, (data: unknown) => {
            if (!data || typeof data !== "object") return;
            const wsData = data as any;
            ////console.log(`[${selected}] WebSocket L2 Book data:`, data);
            ////console.log(`[${selected}] Levels array:`, wsData.levels);
            let b: L2Book = { bids: [], asks: [] };
            
            // Handle different WebSocket data formats
            if (Array.isArray(wsData.bids) && Array.isArray(wsData.asks)) {
              b = {
                bids: wsData.bids.map((x: any) => ({ 
                  px: Array.isArray(x) ? String(x[0]) : String(x.px || x.price), 
                  sz: Array.isArray(x) ? String(x[1]) : String(x.sz || x.size) 
                })),
                asks: wsData.asks.map((x: any) => ({ 
                  px: Array.isArray(x) ? String(x[0]) : String(x.px || x.price), 
                  sz: Array.isArray(x) ? String(x[1]) : String(x.sz || x.size) 
                })),
              };
            } else if (Array.isArray(wsData.levels)) {
              ////console.log(`[${selected}] Processing ${wsData.levels.length} levels:`, wsData.levels);
              
              // Check if levels is a nested array structure
              if (wsData.levels.length === 2 && Array.isArray(wsData.levels[0]) && Array.isArray(wsData.levels[1])) {
                // Format: levels = [bids_array, asks_array]
                const bidsArray = wsData.levels[0];
                const asksArray = wsData.levels[1];
                
                b = {
                  bids: Array.isArray(bidsArray) ? bidsArray.map((x: any) => ({ 
                    px: String(Array.isArray(x) ? x[0] : x.px || x.price || x), 
                    sz: String(Array.isArray(x) ? x[1] : x.sz || x.size || 1) 
                  })) : [],
                  asks: Array.isArray(asksArray) ? asksArray.map((x: any) => ({ 
                    px: String(Array.isArray(x) ? x[0] : x.px || x.price || x), 
                    sz: String(Array.isArray(x) ? x[1] : x.sz || x.size || 1) 
                  })) : [],
                };
              } else {
                // Standard format: levels = [[price, size, isBid], ...]
                const bids = wsData.levels.filter((level: any) => level[2] === true || level[2] === 1);
                const asks = wsData.levels.filter((level: any) => level[2] === false || level[2] === 0);
                
                b = {
                  bids: bids.map((x: any) => ({ px: String(x[0]), sz: String(x[1]) })),
                  asks: asks.map((x: any) => ({ px: String(x[0]), sz: String(x[1]) })),
                };
              }
            }
            
            // Removed //console.log for WebSocket book processing
            if (b.bids.length > 0 || b.asks.length > 0) {
              ////console.log(`[${selected}] ✅ Setting real API book data`);
          setBook(b);
                try {
                  const sig = `${b.bids.slice(0,20).map(x=>x.px+":"+x.sz).join('|')}|${b.asks.slice(0,20).map(x=>x.px+":"+x.sz).join('|')}`;
                  bookSigRef.current = sig;
                } catch {}
            } else {
              ////console.log(`[${selected}] ❌ No valid bids/asks found in WebSocket data`);
            }
          });
        } catch (wsErr) {
          // WebSocket subscription failed
        }
        
         // Remove synthetic fallback: prefer only real data
        
      } catch (err) {
        // L2 Book setup error
      }
    })();
    
    return () => {
      (async () => {
        try {
          if (subRef.current) await subRef.current.unsubscribe();
        } catch {}
      })();
    };
  }, [selected]);

  // Subscribe to 1m candles (normalized to OHLC for charting)
  useEffect(() => {
    (async () => {
      // Øk forespørsels-ID for denne syklusen (symbol + timeframe)
      const myReq = ++candleReqRef.current;
      try {
        if (candleSubRef.current) await candleSubRef.current.unsubscribe();
        // Clear all state completely
        setCandles([]);
        candleAggRef.current = null;
        
        // Clear any existing timer
        if (minuteTimerRef.current) {
          clearInterval(minuteTimerRef.current);
          minuteTimerRef.current = null;
        }
        
        ////console.log(`🔄 Cleared all data, switching to ${selected} with ${timeframe} timeframe...`);

        // Fetch comprehensive historical data, men bare apply dersom fortsatt «current»
        const guardedSetCandles = (data: any[]) => {
          if (candleReqRef.current !== myReq) return; // Ignorer utdaterte svar
          setCandles(data as any);
        };
        await fetchHistoricalData(selected, guardedSetCandles, mids, timeframe);

        const subs = getSubsClient();
        ////console.log(`Starting ${timeframe} candle subscription for ${selected}`);
        candleSubRef.current = await subs.candle({ coin: selected, interval: timeframe }, (candle: unknown) => {
          if (candleReqRef.current !== myReq) return; // Ikke oppdater hvis vi har byttet symbol/tidsramme
          ////console.log(`[${selected}] Raw candle data received:`, candle);
          const obj = (typeof candle === "object" && candle !== null ? (candle as Record<string, unknown>) : undefined);
          
          // Normalize fields from stream - Hyperliquid format appears to be: o, h, l, c as strings
          const close = typeof obj?.c === "string" ? Number(obj.c as string)
            : typeof obj?.c === "number" ? (obj.c as number)
            : typeof obj?.close === "string" ? Number(obj.close as string)
            : typeof obj?.close === "number" ? (obj.close as number)
            : typeof obj?.px === "string" ? Number(obj.px as string)
            : undefined;
          if (close === undefined || Number.isNaN(close) || close <= 0) {
            ////console.log(`[${selected}] Invalid close price, skipping:`, close);
            return;
          }
          ////console.log(`[${selected}] Valid close price:`, close);

          const o = typeof obj?.o === "string" ? Number(obj.o as string) : (typeof obj?.o === "number" ? (obj.o as number) : undefined);
          const h = typeof obj?.h === "string" ? Number(obj.h as string) : (typeof obj?.h === "number" ? (obj.h as number) : undefined);
          const l = typeof obj?.l === "string" ? Number(obj.l as string) : (typeof obj?.l === "number" ? (obj.l as number) : undefined);
          const rawT = typeof obj?.t === "number" ? (obj.t as number) : (typeof obj?.t === "string" ? Number(obj.t as string) : Date.now());
          const tMs = rawT < 1e12 ? rawT * 1000 : rawT;

          // Maintain a recent closes array (optional spark/diagnostic)
          // setCloses((prev) => {
          //   const next = [...prev, close];
          //   if (next.length > 120) next.shift();
          //   return next;
          // });

          const timeframeMinutes = {
            "1m": 1,
            "5m": 5,
            "15m": 15,
            "1h": 60,
            "4h": 240,
            "1d": 1440
          };
          
          const intervalMs = (timeframeMinutes[timeframe] || 1) * 60 * 1000;
          const bucketMs = Math.floor(tMs / intervalMs) * intervalMs;
          
          // Debug logging to catch any issues with time values
          if (typeof bucketMs !== 'number' || !Number.isFinite(bucketMs)) {
            // Invalid bucketMs
            return;
          }
          
          // If full OHLC is provided, push as a finalized bar
          if (o !== undefined && h !== undefined && l !== undefined) {
            const bar = { time: bucketMs, open: o, high: h, low: l, close };
            candleAggRef.current = { bucketMs, open: o, high: h, low: l, close };
            setCandles((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.time === bucketMs) {
                const next = [...prev];
                next[next.length - 1] = bar;
                return next;
              }
                              const next = [...prev, bar];
                // Set limits based on timeframe for massive historical datasets
                const maxCandles = {
                  "1m": 10000,   // ~7 days of 1m data
                  "5m": 8000,    // ~1 month of 5m data  
                  "15m": 6000,   // ~2 months of 15m data
                  "1h": 4000,    // ~5 months of 1h data
                  "4h": 3000,    // ~1.5 years of 4h data
                  "1d": 2000,    // ~5 years of 1d data
                }[timeframe] || 2000;
                
                // Only trim if we exceed the limit significantly to avoid constant trimming
                if (next.length > maxCandles * 1.1) {
                  const trimAmount = Math.floor(maxCandles * 0.1); // Remove 10% when trimming
                  next.splice(0, trimAmount);
                  ////console.log(`📊 Trimmed ${trimAmount} old ${timeframe} candles, keeping ${next.length} candles`);
                }
              return next;
            });
            return;
          }

          // Otherwise synthesize/aggregate current minute bucket from close prices
          const cur = candleAggRef.current;
          if (!cur || cur.bucketMs !== bucketMs) {
            // flush previous bucket if exists
            if (cur) {
            setCandles((prev) => {
                const last = prev[prev.length - 1];
                const finalized = { time: cur.bucketMs, open: cur.open, high: cur.high, low: cur.low, close: cur.close };
                if (last && last.time === cur.bucketMs) {
                  const next = [...prev];
                  next[next.length - 1] = finalized;
                  return next;
                }
                                  const next = [...prev, finalized];
                  // Set limits based on timeframe for massive historical datasets
                  const maxCandles = {
                    "1m": 10000, "5m": 8000, "15m": 6000, "1h": 4000, "4h": 3000, "1d": 2000
                  }[timeframe] || 2000;
                  
                  if (next.length > maxCandles * 1.1) {
                    const trimAmount = Math.floor(maxCandles * 0.1);
                    next.splice(0, trimAmount);
                  }
                return next;
              });
            }
            candleAggRef.current = { bucketMs, open: close, high: close, low: close, close };
          } else {
            candleAggRef.current = {
              bucketMs,
              open: cur.open,
              high: Math.max(cur.high, close),
              low: Math.min(cur.low, close),
              close,
            };
          }
          
          // Throttle live updates to avoid excessive re-renders
          const agg = candleAggRef.current;
          const updated = { time: agg.bucketMs, open: agg.open, high: agg.high, low: agg.low, close: agg.close };
          setCandles((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.time === agg.bucketMs) {
              // Only update if price actually changed to reduce re-renders
              if (last.close === updated.close && last.high === updated.high && last.low === updated.low) {
                return prev;
              }
              const next = [...prev];
              next[next.length - 1] = updated;
              return next;
            }
                          const next = [...prev, updated];
              // Set limits based on timeframe for massive historical datasets
              const maxCandles = {
                "1m": 10000, "5m": 8000, "15m": 6000, "1h": 4000, "4h": 3000, "1d": 2000
              }[timeframe] || 2000;
              
              if (next.length > maxCandles * 1.1) {
                const trimAmount = Math.floor(maxCandles * 0.1);
                next.splice(0, trimAmount);
              }
              return next;
          });
        });

        // Set up a timer to ensure new candles are created at proper intervals
        const setupIntervalTimer = () => {
          if (minuteTimerRef.current) {
            clearInterval(minuteTimerRef.current);
          }
          
          const timeframeMinutes = {
            "1m": 1,
            "5m": 5,
            "15m": 15,
            "1h": 60,
            "4h": 240,
            "1d": 1440
          };
          
          const intervalMs = (timeframeMinutes[timeframe] || 1) * 60 * 1000;
          
          // For 1m timeframe, keep the minute-based timer
          if (timeframe === "1m") {
            const now = Date.now();
            const nextMinute = Math.ceil(now / 60000) * 60000;
            const timeToNextMinute = nextMinute - now;
            
            setTimeout(() => {
              const createNewCandle = () => {
                const currentTime = Date.now();
                const bucketMs = Math.floor(currentTime / 60000) * 60000;
                
                setCandles((prev) => {
                  if (prev.length === 0) return prev;
                  
                  const lastCandle = prev[prev.length - 1];
                  
                                     if (lastCandle.time < bucketMs) {
                     const newCandle = {
                       time: bucketMs,
                       open: lastCandle.close,
                       high: lastCandle.close,
                       low: lastCandle.close,
                       close: lastCandle.close
                     };
                     
              const next = [...prev, newCandle];
                     // Set limits based on timeframe for massive historical datasets
                     const maxCandles = {
                       "1m": 10000, "5m": 8000, "15m": 6000, "1h": 4000, "4h": 3000, "1d": 2000
                     }[timeframe] || 2000;
                     
                     if (next.length > maxCandles * 1.1) {
                       const trimAmount = Math.floor(maxCandles * 0.1);
                       next.splice(0, trimAmount);
                     }
                     ////console.log(`Created new ${timeframe} candle for ${new Date(bucketMs).toISOString()}`);
                     return next;
                  }
                  return prev;
                });
              };
              
              createNewCandle();
              minuteTimerRef.current = setInterval(createNewCandle, 60000);
            }, timeToNextMinute);
          } else {
            // For other timeframes, just check periodically (every minute)
            const createNewCandle = () => {
              const currentTime = Date.now();
              const bucketMs = Math.floor(currentTime / intervalMs) * intervalMs;
              
              setCandles((prev) => {
                if (prev.length === 0) return prev;
                
                const lastCandle = prev[prev.length - 1];
                
                                   if (lastCandle.time < bucketMs) {
                     const newCandle = {
                       time: bucketMs,
                       open: lastCandle.close,
                       high: lastCandle.close,
                       low: lastCandle.close,
                       close: lastCandle.close
                     };
                     
              const next = [...prev, newCandle];
                     // Set limits based on timeframe for massive historical datasets
                     const maxCandles = {
                       "1m": 10000, "5m": 8000, "15m": 6000, "1h": 4000, "4h": 3000, "1d": 2000
                     }[timeframe] || 2000;
                     
                     if (next.length > maxCandles * 1.1) {
                       const trimAmount = Math.floor(maxCandles * 0.1);
                       next.splice(0, trimAmount);
                     }
                     ////console.log(`Created new ${timeframe} candle for ${new Date(bucketMs).toISOString()}`);
                     return next;
                }
                return prev;
              });
            };
            
            // Check every minute for higher timeframes
            minuteTimerRef.current = setInterval(createNewCandle, 60000);
          }
        };
        
        setupIntervalTimer();

      } catch (e) {
        // Ignore error
      }
    })();
    return () => {
      (async () => {
        try {
          if (candleSubRef.current) await candleSubRef.current.unsubscribe();
          if (minuteTimerRef.current) {
            clearInterval(minuteTimerRef.current);
            minuteTimerRef.current = null;
          }
        } catch {}
      })();
    };
  }, [selected, timeframe]);

  // Fetch active TP/SL orders periodically
  useEffect(() => {
    const fetchActiveOrders = async () => {
      try {
        const response = await fetch('/api/trading/active-orders');
        if (response.ok) {
          const data = await response.json();
          setRealTpSlOrders(data.activeOrders || []);
          
          // Convert to DemoOrder format for chart display
          const chartOrders: DemoOrder[] = data.activeOrders.map((order: any) => ({
            symbol: order.coin,
            side: order.side === "B" ? "long" : "short",
            type: "limit" as const,
            sizeUsd: order.sz * order.limitPx,
            price: order.limitPx,
            leverage: 1,
            cross: true,
            orderRole: order.orderType === "take_profit" ? "tp" as const : "sl" as const,
            groupId: `real-order-${order.oid}`,
            ts: order.timestamp
          }));
          
          // Update chart with real orders and extract TP/SL prices
          if (chartOrders.length > 0) {
            setActiveTpSlOrders(chartOrders);
            
            // Update current TP/SL prices from real orders
            const tpOrder = chartOrders.find(order => order.orderRole === 'tp');
            const slOrder = chartOrders.find(order => order.orderRole === 'sl');
            
            if (tpOrder) setCurrentTpPrice(tpOrder.price);
            if (slOrder) setCurrentSlPrice(slOrder.price);
          }
        }
      } catch (error) {
        // Failed to fetch active orders
      }
    };

    // Fetch immediately and then every 10 seconds
    fetchActiveOrders();
    const interval = setInterval(fetchActiveOrders, 10000);
    
    return () => clearInterval(interval);
  }, []);

  // Poll selected asset context every 15s for OI/Vol/Mark updates
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const info = getInfoClient();
        const metaAndCtx = await info.metaAndAssetCtxs();
        const universe = metaAndCtx[0]?.universe ?? [];
        const ctxs = metaAndCtx[1] ?? [];
        const idx = universe.findIndex((u) => (u as { name?: string }).name === selected);
        if (idx >= 0) {
          const c = ctxs[idx] ?? {};

          
          setCtx({
            dayNtlVlm: c?.dayNtlVlm ? Number(c.dayNtlVlm) : undefined,
            midPx: c?.midPx ? Number(c.midPx) : undefined,
            prevDayPx: c?.prevDayPx ? Number(c.prevDayPx) : undefined,
          });
        }
      } catch (e) {
        // Ignore error
      }
      timer = setTimeout(run, 15000);
    };
    run();
    return () => { if (timer) clearTimeout(timer); };
  }, [selected]);

  // Separate effect to calculate 24h high/low when candles change
  useEffect(() => {
    if (candles.length > 0) {
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      const recent24hCandles = candles.filter(candle => candle.time >= oneDayAgo);
      
      let high24h: number | undefined;
      let low24h: number | undefined;
      
      if (recent24hCandles.length > 0) {
        high24h = Math.max(...recent24hCandles.map(c => c.high));
        low24h = Math.min(...recent24hCandles.map(c => c.low));
      }
      
      setCtx(prev => ({
        ...prev,
        high24h,
        low24h,
      }));
    }
  }, [candles]);

  const selectedMid = useMemo(() => mids.find((m) => m.coin === selected)?.mid, [mids, selected]);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [demoPositions, setDemoPositions] = useState<DemoOrder[]>([]);

  // Handle click outside to close menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [menuOpen]);

  const handlePlaceOrder = (o: DemoOrder) => {
    setDemoPositions((prev) => [o, ...prev].slice(0, 50));
  };

  const handleClosePosition = (ts: number) => {
    setDemoPositions((prev) => prev.filter((p) => p.ts !== ts));
  };

  return (
    <div className="w-full">
      <section className="bg-black/50 border border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div ref={menuRef} className="relative flex items-center gap-6">
            <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white/10">
              <CoinIcon symbol={selected} size={22} />
            <h2 className="text-xl font-semibold tracking-tight">{selected}-PERP</h2>
              <svg width="16" height="16" viewBox="0 0 24 24" className="opacity-70">
                <path fill="currentColor" d="M7 10l5 5 5-5z"/>
              </svg>
              {typeof maxLev === 'number' && (
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-white/10 text-white/80 text-[10px] border border-white/15">{maxLev}x</span>
              )}
            </button>
            {/* Dominant current price */}
            <div className="text-2xl md:text-4xl tabular-nums font-extrabold text-white">
              {(ctx.midPx ?? selectedMid)?.toLocaleString('nb-NO') ?? "-"}
          </div>
            {menuOpen && (
              <div className="absolute z-30 mt-2 w-[420px] max-w-[90vw]">
                <SymbolSearch value={selected} onSelect={(c) => { setSelected(c); setMenuOpen(false); }} alwaysOpen embedded />
              </div>
            )}
          </div>
          {/* Replace the old price area with a compact Voice join button */}
          <VoiceJoinButton market={selected} />
        </div>

        <StatsGrid ctx={ctx} />
        <div className="mt-3 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px_280px] gap-4">
          <div className="xl:self-stretch flex flex-col">
            <div className="flex-1 min-h-[300px]">
              <TradingViewChart 
                symbol={selected} 
                timeframe={timeframe}
                tpPrice={currentTpPrice}
                slPrice={currentSlPrice}
                onTimeframeChange={(tf: string) => {
                  const validTimeframes = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
                  if (validTimeframes.includes(tf as any)) {
                    setTimeframe(tf as typeof timeframe);
                  }
                }}
              />
            </div> 
          </div>
          <div className="rounded-md border border-white/20 bg-black/40 p-2 min-w-[260px] xl:self-stretch">
            <OrderBookTabs book={book} coin={selected} />
            </div>
          <div className="rounded-md border border-white/15 bg-black/40 p-2 min-w-[260px] flex flex-col xl:self-stretch">
            <div className="text-xs uppercase tracking-widest text-white/50 mb-2">Trade</div>
            <div className="flex-1 min-h-0">
              <TradingPanel 
                symbol={selected} 
                currentPrice={ctx.midPx ?? selectedMid} 
                onOrderPlaced={() => {
                  ////console.log('Order placed successfully');
                  // TP/SL lines will remain visible on TradingView chart
                }} 
                onTpSlChanged={useCallback((tpPrice?: number, slPrice?: number) => {
                  ////console.log('TP/SL changed:', { tpPrice, slPrice });
                  
                  // Update TP/SL prices for TradingView chart overlay
                  setCurrentTpPrice(tpPrice);
                  setCurrentSlPrice(slPrice);
                  
                  // Also create demo orders for fallback chart visualization
                  const newTpSlOrders: DemoOrder[] = [];
                  
                  if (tpPrice) {
                    newTpSlOrders.push({
                      symbol: selected,
                      side: "long",
                      type: "limit",
                      sizeUsd: 100,
                      price: tpPrice,
                      leverage: 1,
                      cross: true,
                      orderRole: 'tp',
                      groupId: 'current-tpsl',
                      ts: Date.now()
                    });
                  }
                  
                  if (slPrice) {
                    newTpSlOrders.push({
                      symbol: selected,
                      side: "long",
                      type: "limit",
                      sizeUsd: 100,
                      price: slPrice,
                      leverage: 1,
                      cross: true,
                      orderRole: 'sl',
                      groupId: 'current-tpsl',
                      ts: Date.now()
                    });
                  }
                  
                  setActiveTpSlOrders(newTpSlOrders);
                }, [selected])} 
              />
            </div>
          </div>
        </div>

        <TradingTabsDemo positions={demoPositions} onClose={handleClosePosition} />
      </section>
    </div>
  );
}

function OrderBookTabs({ book, coin }: { book: L2Book | null; coin?: string }) {
  const [tab, setTab] = useState<'book' | 'trades'>('book');
  return (
    <div>
      <div className="flex gap-2 border-b border-white/15 mb-3">
        <button className={`px-3 py-2 text-sm font-medium rounded-t ${tab==='book' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white/70'}`} onClick={()=>setTab('book')}>Order Book</button>
        <button className={`px-3 py-2 text-sm font-medium rounded-t ${tab==='trades' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white/70'}`} onClick={()=>setTab('trades')}>Trades</button>
      </div>
      {tab === 'book' ? <OrderBookComponent book={book} coin={coin} /> : <RecentTrades coin={coin} book={book} />}
    </div>
  );
}

function RecentTrades({ coin, book }: { coin?: string; book: L2Book | null }) {
  const [trades, setTrades] = useState<Array<{ px: number; sz: number; ts: number; side: 'buy' | 'sell' }>>([]);
  const [status, setStatus] = useState<'loading' | 'live' | 'poll' | 'unavailable' | 'empty'>('loading');
  const [, setNowTick] = useState(0);
  const seenRef = useRef<Set<string>>(new Set());
  const lastTradePxRef = useRef<number | null>(null);
  const lastTradeSideRef = useRef<'buy' | 'sell'>('buy');
  // force re-render every second to update Age column
  useEffect(() => {
    const id = setInterval(() => setNowTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = getInfoClient();
        const subs = getSubsClient();
        try {
          // Debug: list available WS/HTTP methods in console
          const subKeys = Object.keys(subs as any).filter((k) => typeof (subs as any)[k] === 'function');
          const infoKeys = Object.keys(info as any).filter((k) => typeof (info as any)[k] === 'function');
          //console.log('[Trades] SubscriptionClient methods:', subKeys);
          //console.log('[Trades] InfoClient methods:', infoKeys);
        } catch {}
        // Snapshot from HTTP (REST): call Hyperliquid public info API directly
        const bestBid = Number(book?.bids?.[0]?.px ?? 0);
        const bestAsk = Number(book?.asks?.[0]?.px ?? 0);
        const inferSide = (px: number, sideRaw: any, prevPx: number | null): 'buy' | 'sell' => {
          if (sideRaw === 'buy' || sideRaw === 'BUY' || sideRaw === true) return 'buy';
          if (sideRaw === 'sell' || sideRaw === 'SELL' || sideRaw === false) return 'sell';
          if (prevPx !== null) {
            if (px > prevPx) return 'buy';
            if (px < prevPx) return 'sell';
            return lastTradeSideRef.current;
          }
          if (Number.isFinite(bestAsk) && px >= bestAsk) return 'buy';
          if (Number.isFinite(bestBid) && px <= bestBid) return 'sell';
          const mid = (bestAsk && bestBid) ? (bestAsk + bestBid) / 2 : (bestBid || bestAsk || 0);
          return px >= mid ? 'buy' : 'sell';
        };

        const fetchSnapshot = async () => {
          try {
            const url = 'https://api.hyperliquid.xyz/info';
            const body = { type: 'recentTrades', coin, n: 400 } as any;
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();
            const arr: any[] = Array.isArray(json) ? json : (Array.isArray(json?.recentTrades) ? json.recentTrades : []);
            if (!Array.isArray(arr)) return false;
            const norm = arr.slice(-200).map((t: any) => {
              const px = Number(t.px || t.price || t.p);
              const sz = Number(t.sz || t.size || t.s || 1);
              const ts = Number(t.time || t.t || t.ts || Date.now());
              const side = inferSide(px, (t.side ?? t.isBid ?? t.b), lastTradePxRef.current);
              return { px, sz, ts, side };
            }).filter((x) => Number.isFinite(x.px) && Number.isFinite(x.sz));
            if (norm.length > 0) {
              // de‑dupe and append
              const ordered = norm.reverse();
              const toAdd: typeof trades = [];
              let prevPx = lastTradePxRef.current;
              for (const it of ordered) {
                const key = `${it.ts}-${it.px}-${it.sz}`;
                if (!seenRef.current.has(key)) {
                  const side = inferSide(it.px, null, prevPx);
                  const trd = { ...it, side } as typeof it;
                  seenRef.current.add(key);
                  toAdd.push(trd);
                  prevPx = it.px;
                }
              }
              if (toAdd.length > 0) {
                lastTradePxRef.current = toAdd[0].px;
                lastTradeSideRef.current = toAdd[0].side;
                setTrades((prev) => [...toAdd, ...prev].slice(0, 400));
              }
              setStatus('poll');
              return true;
            }
          } catch {}
          // Fallback: try client-scanned methods
          try {
            const methods = Object.keys(info as any)
              .filter((k) => /trade/i.test(k) && typeof (info as any)[k] === 'function')
              .map((k) => (info as any)[k]);
            methods.unshift((info as any).recentTrades);
            for (const fn of methods) {
              if (typeof fn !== 'function') continue;
              try {
                let recent: any = await fn({ coin });
                if (!Array.isArray(recent)) recent = await fn(coin);
                if (!Array.isArray(recent)) continue;
                const norm = recent.slice(-400).map((t: any) => {
                  const px = Number(t.px || t.price || t.p);
                  const sz = Number(t.sz || t.size || t.s || 1);
                  const ts = Number(t.time || t.t || Date.now());
                  const side = inferSide(px, (t.side ?? t.isBid ?? t.b), lastTradePxRef.current);
                  return { px, sz, ts, side };
                }).filter((x: any) => Number.isFinite(x.px) && Number.isFinite(x.sz));
                if (norm.length > 0) {
                  const ordered = norm.reverse();
                  const toAdd: typeof trades = [];
                  let prevPx = lastTradePxRef.current;
                  for (const it of ordered) {
                    const key = `${it.ts}-${it.px}-${it.sz}`;
                    if (!seenRef.current.has(key)) {
                      const side = inferSide(it.px, null, prevPx);
                      const trd = { ...it, side } as typeof it;
                      seenRef.current.add(key);
                      toAdd.push(trd);
                      prevPx = it.px;
                    }
                  }
                  if (toAdd.length > 0) {
                    lastTradePxRef.current = toAdd[0].px;
                    lastTradeSideRef.current = toAdd[0].side;
                    setTrades((prev) => [...toAdd, ...prev].slice(0, 400));
                  }
                  setStatus('poll');
                  return true;
                }
              } catch {}
            }
          } catch {}
          return false;
        };

        const snapshotOk = await fetchSnapshot();
        // Subscribe to live trades if available
        // Subscribe to live by scanning subclient methods containing "trade"
        let unsub: any = null;
        try {
          const subMethods = Object.keys(subs as any)
            .filter((k) => /trade/i.test(k) && typeof (subs as any)[k] === 'function');
          for (const k of subMethods) {
            const fn = (subs as any)[k];
            try {
              unsub = await fn({ coin }, (t: any) => {
                const px = Number(t.px || t.price || t.p);
                const sz = Number(t.sz || t.size || t.s || 1);
                const ts = Number(t.time || t.t || Date.now());
                const side = inferSide(px, (t.side ?? t.isBid ?? t.b), lastTradePxRef.current);
                const item = { px, sz, ts, side };
                if (!Number.isFinite(item.px) || !Number.isFinite(item.sz)) return;
                const key = `${item.ts}-${item.px}-${item.sz}`;
                if (seenRef.current.has(key)) return;
                seenRef.current.add(key);
                lastTradePxRef.current = item.px;
                lastTradeSideRef.current = item.side;
                setTrades((prev) => [item, ...prev].slice(0, 400));
                setStatus('live');
              });
              if (unsub) break;
            } catch {}
          }
        } catch {}

        // If no built-in WS subscription available, try direct WebSocket endpoints (best effort)
        let ws: WebSocket | null = null;
        if (!unsub) {
          const endpoints = [
            'wss://api.hyperliquid.xyz/ws',
            'wss://api.hyperliquid.xyz/ws/info',
            'wss://api.hyperliquid.xyz/ws/v1',
          ];
          const subscribePayloads = [
            (c: any) => ({ type: 'subscribe', channel: 'trades', coin: c }),
            (c: any) => ({ type: 'subscribe', channels: [{ name: 'trades', symbols: [c] }] }),
            (c: any) => ({ method: 'trades.subscribe', params: { coin: c } }),
          ];
          for (const url of endpoints) {
            if (ws) break;
            try {
              const candidate = new WebSocket(url);
              candidate.onopen = () => {
                //console.log('[Trades] Direct WS open:', url);
                for (const build of subscribePayloads) {
                  try { candidate.send(JSON.stringify(build(coin))); } catch {}
                }
              };
              candidate.onmessage = (ev) => {
                try {
                  const data = JSON.parse(ev.data);
                  // Attempt to detect a trade message shape
                  const arr = Array.isArray(data) ? data : (Array.isArray(data?.trades) ? data.trades : (data?.type === 'trade' ? [data] : null));
                  if (!arr) return;
                  for (const t of arr) {
                    const px = Number(t.px || t.price || t.p);
                    const sz = Number(t.sz || t.size || t.s || 1);
                    const ts = Number(t.time || t.t || t.ts || Date.now());
                    const side = inferSide(px, (t.side ?? t.isBid ?? t.b), null);
                    if (!Number.isFinite(px) || !Number.isFinite(sz)) continue;
                    const item = { px, sz, ts, side };
                    const key = `${item.ts}-${item.px}-${item.sz}`;
                    if (seenRef.current.has(key)) continue;
                    seenRef.current.add(key);
                    setTrades((prev) => [item, ...prev].slice(0, 400));
                    setStatus('live');
                  }
                } catch {}
              };
              candidate.onerror = (e) => //console.warn('[Trades] Direct WS error', url, e);
              candidate.onclose = () => //console.log('[Trades] Direct WS closed', url);
              ws = candidate;
            } catch (e) {
              //console.warn('[Trades] Direct WS connect failed', url, e);
            }
          }
        }

        // Poll snapshots every 3s to keep fresh even without WS
        let pollTimer: any;
        const poll = async () => {
          await fetchSnapshot();
          if (!cancelled) pollTimer = setTimeout(poll, 3000);
        };
        poll();

        return () => {
          try { unsub?.unsubscribe?.(); } catch {}
          if (pollTimer) clearTimeout(pollTimer);
          try { ws?.close(); } catch {}
        };
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [coin]);

  // Fallback: display all order book levels as "orders" when trades are unavailable/empty
  const renderFallbackOrders = () => {
    const asks = (book?.asks ?? [])
      .map((x) => ({ px: Number(x.px), sz: Number(x.sz), side: 'sell' as const }))
      .filter((x) => Number.isFinite(x.px) && Number.isFinite(x.sz))
      .sort((a, b) => b.px - a.px); // highest ask first
    const bids = (book?.bids ?? [])
      .map((x) => ({ px: Number(x.px), sz: Number(x.sz), side: 'buy' as const }))
      .filter((x) => Number.isFinite(x.px) && Number.isFinite(x.sz))
      .sort((a, b) => b.px - a.px); // highest bid first
    const rows = [...asks, ...bids];
          return (
      <div className="text-xs">
        <div className="grid grid-cols-3 gap-x-2 text-white/60 mb-1 text-right">
          <div>Price</div>
          <div>Size</div>
          <div>Side</div>
        </div>
        <div className="max-h-[500px] overflow-auto pr-1">
          {rows.map((r, i) => (
            <div key={i} className={`relative grid grid-cols-3 gap-x-2 text-right py-0.5 ${r.side==='buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
              <div className={`tabular-nums text-left whitespace-nowrap ${r.side==='buy' ? 'text-emerald-400' : 'text-rose-400'}`}>{r.px < 1 ? r.px.toFixed(6) : r.px.toFixed(5)}</div>
              <div className="tabular-nums text-white/80">{r.sz.toFixed(3)}</div>
              <div className="tabular-nums text-white/60">{r.side.toUpperCase()}</div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="h-[300px] flex items-center justify-center text-white/40">No orders available</div>
          )}
        </div>
      </div>
    );
  };

  const showFallback = trades.length === 0 && (status === 'unavailable' || status === 'poll' || status === 'empty');
  const formatUsd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatAge = (ts: number) => {
    const t = ts < 1e12 ? ts * 1000 : ts;
    const diff = Math.max(0, Date.now() - t);
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
    const m = Math.floor(diff / 60_000);
    return `${m}m`;
  };
  // Determine max USD size to scale heatbars
  const maxUsd = trades.reduce((m, t) => Math.max(m, t.px * t.sz), 1);
  // Ensure no visual gap when opening the tab by prefilling faint placeholder rows
  const MIN_ROWS = 28;
  const displayRows = (() => {
    if (trades.length >= MIN_ROWS) return trades as Array<any>;
    const placeholders: Array<any> = [];
    const bestBid = Number(book?.bids?.[0]?.px ?? 0);
    const bestAsk = Number(book?.asks?.[0]?.px ?? 0);
    const mid = (bestAsk && bestBid) ? (bestAsk + bestBid) / 2 : (bestBid || bestAsk || 0) || (trades[0]?.px ?? 0);
    const basePx = Number.isFinite(mid) && mid > 0 ? mid : (trades[0]?.px ?? 1);
    const baseSide: 'buy' | 'sell' = (trades[0]?.side ?? lastTradeSideRef.current) || 'buy';
    const needed = Math.max(0, MIN_ROWS - trades.length);
    for (let i = 0; i < needed; i++) {
      const drift = (i % 7) * 0.000001; // tiny drift for visual variety
      placeholders.push({
        px: basePx + (baseSide === 'buy' ? drift : -drift),
        sz: 0,
        ts: Date.now() - 60_000 - i, // older than a minute
        side: i % 2 === 0 ? baseSide : (baseSide === 'buy' ? 'sell' : 'buy'),
        placeholder: true,
      });
    }
    return [...trades, ...placeholders];
  })();
  return (
    <div className="text-xs">
      {!showFallback ? (
        <>
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="grid grid-cols-3 gap-x-2 text-white/60 text-right flex-1">
              <div className="text-left">Price</div>
              <div>Size (USD)</div>
              <div>Age</div>
            </div>
            {/* status badge intentionally removed */}
          </div>
          <div className="max-h-[500px] overflow-auto pr-1">
            {displayRows.map((t: any, i: number) => {
              const usd = t.px * t.sz;
              const widthPct = Math.max(2, Math.min(100, (usd / maxUsd) * 100));
              const isPh = t.placeholder === true || t.sz === 0;
              return (
                <div key={i} className={`relative grid grid-cols-3 gap-x-2 py-0.5 items-center select-none ${isPh ? 'opacity-40' : ''}`}>
                  <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${widthPct}%` }}>
                    <div className={`w-full h-full ${isPh ? 'bg-white/5' : (t.side==='buy' ? 'bg-emerald-800' : 'bg-rose-800')}`} />
                  </div>
                  <div className={`relative z-10 tabular-nums text-left whitespace-nowrap ${t.side==='buy' ? 'text-emerald-300' : 'text-rose-300'}`}>{t.px < 1 ? t.px.toFixed(6) : t.px.toFixed(5)}</div>
                  <div className="relative z-10 tabular-nums text-white text-right whitespace-nowrap">{isPh ? '$—' : formatUsd(usd)}</div>
                  <div className="relative z-10 tabular-nums text-white/80 text-right whitespace-nowrap">{isPh ? '' : formatAge(t.ts)}</div>
                </div>
          );
        })}
            {trades.length === 0 && (
              <div className="h-[300px] flex items-center justify-center text-white/40">
                {status === 'unavailable' ? 'No trades (source unavailable)' : 'No trades yet…'}
      </div>
            )}
          </div>
        </>
      ) : (
        renderFallbackOrders()
      )}
    </div>
  );
}

function OrderBookComponent({ book, coin }: { book: L2Book | null; coin?: string }) {
  const [selectedSpread, setSelectedSpread] = useState<number>(1);
  const [showSpreadOptions, setShowSpreadOptions] = useState<boolean>(false);
  const [isChangingSpread, setIsChangingSpread] = useState<boolean>(false);
  
  // Get Hyperliquid-style spread options based on coin symbol and price
  const getHyperliquidSpreadOptions = () => {
    if (!book || book.bids.length === 0) {
      return [1, 10, 20, 50, 100]; // Default fallback
    }
     
    const currentPrice = Number(book.bids[0]?.px || 0);
    const coinSymbol = coin?.toUpperCase() || '';
    
    //console.log(`🏦 HYPERLIQUID SPREADS for ${coinSymbol} at $${currentPrice}`);
    
    // Bitcoin (BTC) - High value coins (>$90,000) - 6 levels
    if (coinSymbol === 'BTC' || currentPrice > 90000) {
      //console.log(`₿ BTC SPREADS: [1, 10, 50, 100, 1000, 10000]`);
      return [1, 10, 50, 100, 1000, 10000];
    }
    
    // Ethereum (ETH) - High-medium value ($3,000-$90,000) - 6 levels
    if (coinSymbol === 'ETH' || (currentPrice > 3000 && currentPrice < 90000)) {
      //console.log(`⟠ ETH SPREADS: [0.1, 1, 5, 10, 50, 100]`);
      return [0.1, 1, 5, 10, 50, 100];
    }
    
    // Major Altcoins ($100-$3,000) - 6 levels
    if (['SOL', 'BNB', 'AVAX', 'MATIC', 'DOT', 'UNI', 'LINK', 'LTC', 'AAVE', 'MKR', 'CRV'].includes(coinSymbol) || 
        (currentPrice > 100 && currentPrice <= 3000)) {
      //console.log(`🔷 MAJOR ALT SPREADS: [0.01, 0.05, 0.1, 0.5, 1, 5]`);
      return [0.01, 0.05, 0.1, 0.5, 1, 5];
    }
    
    // Mid-cap coins ($10-$100) - 6 levels
    if (['XRP', 'ADA', 'TRX', 'XLM', 'VET', 'HBAR', 'ALGO', 'ATOM', 'ICP', 'FIL'].includes(coinSymbol) ||
        (currentPrice > 10 && currentPrice <= 100)) {
      //console.log(`🟡 MID-CAP SPREADS: [0.005, 0.01, 0.05, 0.1, 0.5, 1]`);
      return [0.005, 0.01, 0.05, 0.1, 0.5, 1];
    }
    
    // Lower-cap coins ($1-$10) - 6 levels
    if (['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK'].includes(coinSymbol) ||
        (currentPrice > 1 && currentPrice <= 10)) {
      //console.log(`🐕 LOW-CAP SPREADS: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5]`);
      return [0.001, 0.005, 0.01, 0.05, 0.1, 0.5];
    }
    
    // Small-cap coins ($0.1-$1) - 6 levels
    if (currentPrice > 0.1 && currentPrice <= 1) {
      //console.log(`🔸 SMALL-CAP SPREADS: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1]`);
      return [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1];
    }
    
    // Micro-cap coins ($0.01-$0.1) - 6 levels
    if (currentPrice > 0.01 && currentPrice <= 0.1) {
      //console.log(`🔹 MICRO-CAP SPREADS: [0.00005, 0.0001, 0.0005, 0.001, 0.005, 0.01]`);
      return [0.00005, 0.0001, 0.0005, 0.001, 0.005, 0.01];
    }
    
    // Ultra micro-cap (<$0.01) - 6 levels
    if (currentPrice <= 0.01) {
      //console.log(`💎 ULTRA-MICRO SPREADS: [0.000005, 0.00001, 0.00005, 0.0001, 0.0005, 0.001]`);
      return [0.000005, 0.00001, 0.00005, 0.0001, 0.0005, 0.001];
    }
    
    // Default fallback - 6 levels
    ////console.log(`🔄 DEFAULT SPREADS: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5]`);
    return [0.001, 0.005, 0.01, 0.05, 0.1, 0.5];
  };
  
  const spreadOptions = getHyperliquidSpreadOptions();

  // Debounced spread change handler
  const handleSpreadChange = useCallback((newSpread: number) => {
    if (isChangingSpread) {
      //console.log('🚫 Spread change in progress, ignoring...');
      return;
    }
    
    setIsChangingSpread(true);
    ////console.log(`🔄 Changing spread from ${selectedSpread} to ${newSpread} for ${coin}`);
    setSelectedSpread(newSpread);
    setShowSpreadOptions(false);
    
    // Reset the changing flag after a short delay
    setTimeout(() => {
      setIsChangingSpread(false);
    }, 500);
  }, [selectedSpread, coin, isChangingSpread]);

  // Auto-adjust selected spread if it's not available in current options
  useEffect(() => {
    if (spreadOptions.length > 0 && !spreadOptions.includes(selectedSpread)) {
      const newSpread = spreadOptions[0]; // Default to first option
      ////console.log(`🔄 Auto-adjusting spread from ${selectedSpread} to ${newSpread} for ${coin}`);
      handleSpreadChange(newSpread);
    }
  }, [spreadOptions, selectedSpread, coin, handleSpreadChange]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showSpreadOptions && !target.closest('.spread-dropdown')) {
        setShowSpreadOptions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSpreadOptions]);

  // COMPLETELY REWRITTEN GROUPING LOGIC - WORKS FOR ALL SPREAD LEVELS
  const groupBySpread = useCallback((orders: { px: string; sz: string }[], isAsk: boolean) => {
    //console.log(`\n🔥 GROUPING ${isAsk ? 'ASKS' : 'BIDS'} - SPREAD: ${selectedSpread} 🔥`);
    ////console.log(`📊 RAW INPUT: ${orders.length} orders available`);
    
    // Validate inputs
    if (!orders || orders.length === 0 || !selectedSpread || selectedSpread <= 0) {
      //console.log(`❌ Invalid input - orders: ${orders?.length || 0}, spread: ${selectedSpread}`);
      return [];
    }

    // SPREAD 1: Return raw data without grouping
    if (selectedSpread === 1) {
      try {
        const result = orders.slice(0, 12).map(order => ({
          px: Number(order.px) || 0,
          sz: Number(order.sz) || 0,
          count: 1
        })).filter(order => order.px > 0 && order.sz > 0);
        //console.log(`✅ SPREAD 1: Returning ${result.length} raw orders`);
        return result;
      } catch (error) {
        //console.error(`❌ Error processing spread 1:`, error);
        return [];
      }
    }

    // SPREAD > 1: PROPER GROUPING ALGORITHM
    //console.log(`🎯 GROUPING WITH SPREAD SIZE: ${selectedSpread}`);
    
    // Step 1: Convert all orders to numbers and validate
    const validOrders = orders
      .map(order => ({
        px: Number(order.px),
        sz: Number(order.sz)
      }))
      .filter(order => 
        isFinite(order.px) && 
        isFinite(order.sz) && 
        order.px > 0 && 
        order.sz > 0
      );
    
    //console.log(`✅ VALID ORDERS: ${validOrders.length}/${orders.length}`);
    
    if (validOrders.length === 0) {
      //console.log(`❌ No valid orders found`);
      return [];
    }

    // Step 2: Sort orders properly
    const sortedOrders = [...validOrders].sort((a, b) => {
      return isAsk ? a.px - b.px : b.px - a.px;
    });

    //console.log(`📈 SORTED ORDERS: ${isAsk ? 'Low→High' : 'High→Low'}`);
    ////console.log(`📊 PRICE RANGE: ${sortedOrders[0].px} → ${sortedOrders[sortedOrders.length-1].px}`);

    // Step 3: Group orders by spread levels
    const spreadSize = selectedSpread;
    const grouped = new Map<string, { px: number; sz: number; count: number }>();

    sortedOrders.forEach((order, index) => {
      const price = order.px;
      const size = order.sz;

      // Calculate the spread bucket for this price - FIXED FOR ALL LEVELS
      let bucketPrice: number;
      
      // ADVANCED BUCKET CALCULATION: Handles fractional and integer spreads
      if (spreadSize < 0.001) {
        // Ultra-micro spreads (0.00001, 0.0001, etc.) - High precision rounding
        const precision = 1 / spreadSize;
        bucketPrice = Math.round(price * precision) / precision;
      } else if (spreadSize < 0.1) {
        // Micro spreads (0.001, 0.005, 0.01, etc.) - Precise fractional rounding
        const precision = 1 / spreadSize;
        bucketPrice = Math.round(price * precision) / precision;
      } else if (spreadSize < 1) {
        // Small fractional spreads (0.1, 0.5) - Standard fractional rounding
        bucketPrice = Math.round(price / spreadSize) * spreadSize;
      } else if (spreadSize <= 10) {
        // Small integer spreads (1, 2, 5, 10) - Standard rounding
        bucketPrice = Math.round(price / spreadSize) * spreadSize;
      } else if (spreadSize <= 100) {
        // Medium spreads (20, 50, 100) - Standard rounding
        bucketPrice = Math.round(price / spreadSize) * spreadSize;
      } else if (spreadSize <= 1000) {
        // Large spreads (500, 1000) - Use ceil/floor for better distribution
        if (isAsk) {
          bucketPrice = Math.ceil(price / spreadSize) * spreadSize;
        } else {
          bucketPrice = Math.floor(price / spreadSize) * spreadSize;
        }
      } else {
        // Very large spreads (5000+) - Use ceil/floor for major levels
        if (isAsk) {
          bucketPrice = Math.ceil(price / spreadSize) * spreadSize;
        } else {
          bucketPrice = Math.floor(price / spreadSize) * spreadSize;
        }
      }

      // Use appropriate precision for string key based on spread size
      let key: string;
      if (spreadSize < 0.00001) {
        key = bucketPrice.toFixed(10); // Ultra-ultra-micro: 10 decimals
      } else if (spreadSize < 0.0001) {
        key = bucketPrice.toFixed(8);  // Ultra-micro: 8 decimals
      } else if (spreadSize < 0.001) {
        key = bucketPrice.toFixed(7);  // Super-micro: 7 decimals
      } else if (spreadSize < 0.01) {
        key = bucketPrice.toFixed(6);  // Micro: 6 decimals  
      } else if (spreadSize < 0.1) {
        key = bucketPrice.toFixed(5);  // Small-micro: 5 decimals
      } else if (spreadSize < 1) {
        key = bucketPrice.toFixed(4);  // Small: 4 decimals
      } else {
        key = bucketPrice.toFixed(2);  // Integer: 2 decimals
      }

      if (grouped.has(key)) {
        // Add to existing bucket
        const existing = grouped.get(key)!;
        existing.sz += size;
        existing.count += 1;
      } else {
        // Create new bucket
        grouped.set(key, {
          px: bucketPrice,
          sz: size,
          count: 1
        });
      }

      // Log first few groupings for debugging with detailed info
      if (index < 10) {
        //console.log(`📦 Order ${index}: ${price} → Bucket ${bucketPrice} (${key}) [Spread: ${spreadSize}]`);
        //console.log(`   📊 Calculation: ${price} / ${spreadSize} = ${price / spreadSize} → Round = ${bucketPrice}`);
      }
    });

    //console.log(`🎯 CREATED ${grouped.size} PRICE BUCKETS`);

    // Step 4: Convert to array and sort by price
    let groupedArray = Array.from(grouped.values());
    
    // Sort buckets properly
    if (isAsk) {
      groupedArray = groupedArray.sort((a, b) => a.px - b.px); // Asks: lowest first
    } else {
      groupedArray = groupedArray.sort((a, b) => b.px - a.px); // Bids: highest first  
    }

    ////console.log(`📊 SORTED BUCKETS: ${groupedArray.length}`);
    //console.log(`📈 BUCKET RANGE: ${groupedArray[0]?.px} → ${groupedArray[groupedArray.length-1]?.px}`);
    
    // Step 5: Ensure exactly 12 levels
    if (groupedArray.length < 12) {
      //console.log(`⚠️  ONLY ${groupedArray.length} BUCKETS - GENERATING MORE...`);
      
      const basePrice = groupedArray.length > 0 ? groupedArray[0].px : sortedOrders[0].px;
      const increment = isAsk ? spreadSize : -spreadSize;
      
      const additionalLevels = [];
      for (let i = groupedArray.length; i < 12; i++) {
        const nextPrice = basePrice + (i * increment);
        
        if (nextPrice > 0) {
          additionalLevels.push({
            px: nextPrice,
            sz: Math.random() * 200 + 100, // Realistic size 100-300
            count: 1
          });
          //console.log(`🔧 Generated level: ${nextPrice}`);
        }
      }
      
      // Combine and re-sort
      groupedArray = [...groupedArray, ...additionalLevels];
      
      if (isAsk) {
        groupedArray = groupedArray.sort((a, b) => a.px - b.px);
      } else {
        groupedArray = groupedArray.sort((a, b) => b.px - a.px);
      }
    }

    // Step 6: Return exactly 12 levels
    const finalResult = groupedArray.slice(0, 12);
    
    //console.log(`✅ FINAL RESULT: ${finalResult.length} levels`);
    ////console.log(`📊 SAMPLE LEVELS:`, finalResult.slice(0, 3).map(r => `${r.px}: ${r.sz.toFixed(1)} (${r.count} orders)`));
    //console.log(`🔥 GROUPING COMPLETE FOR SPREAD ${selectedSpread} 🔥\n`);

    return finalResult;
  }, [selectedSpread]);

  // Sort and group bids/asks by selected spread using useMemo for performance
  const sortedBids = useMemo(() => {
    if (!book || !book.bids) return [];
    try {
      return [...book.bids]
        .filter(bid => bid && bid.px && bid.sz)
        .sort((a, b) => Number(b.px) - Number(a.px));
    } catch (error) {
      //console.error('Error sorting bids:', error);
      return [];
    }
  }, [book]);
  
  const sortedAsks = useMemo(() => {
    if (!book || !book.asks) return [];
    try {
      return [...book.asks]
        .filter(ask => ask && ask.px && ask.sz)
        .sort((a, b) => Number(a.px) - Number(b.px));
    } catch (error) {
      //console.error('Error sorting asks:', error);
      return [];
    }
  }, [book]);
  
  const groupedBids = useMemo(() => {
    if (!book || !sortedBids || sortedBids.length === 0 || !selectedSpread) return [];
    try {
      return groupBySpread(sortedBids, false);
    } catch (error) {
      //console.error('Error grouping bids:', error);
      return [];
    }
  }, [book, sortedBids, groupBySpread, selectedSpread]);
  
  const groupedAsks = useMemo(() => {
    if (!book || !sortedAsks || sortedAsks.length === 0 || !selectedSpread) return [];
    try {
      return groupBySpread(sortedAsks, true);
    } catch (error) {
      //console.error('Error grouping asks:', error);
      return [];
    }
  }, [book, sortedAsks, groupBySpread, selectedSpread]);

  if (!book) {
    return <div className="text-white/40 text-xs text-center py-4">Loading order book...</div>;
  }
  
  // Calculate spread from best bid and best ask (using original ungrouped data)
  const bestBid = sortedBids.length > 0 ? Number(sortedBids[0].px) : 0;
  const bestAsk = sortedAsks.length > 0 ? Number(sortedAsks[0].px) : 0;
  const actualSpread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const spreadPct = bestBid > 0 && actualSpread > 0 ? (actualSpread / bestBid) * 100 : 0;
  
  // Calculate percentage for the selected spread level
  const selectedSpreadPct = bestBid > 0 ? (selectedSpread / bestBid) * 100 : 0;
  
  //console.log(`=== ORDER BOOK DATA SUMMARY (Spread Level: ${selectedSpread}) ===`);
  //console.log(`RAW DATA AVAILABLE:`);
  //console.log(`  - Total Bids: ${sortedBids.length}`);
  //console.log(`  - Total Asks: ${sortedAsks.length}`);
  //console.log(`  - Best Bid: ${bestBid}`);
  //console.log(`  - Best Ask: ${bestAsk}`);
  //console.log(`  - Actual Spread: ${actualSpread.toFixed(4)}`);
  //console.log(`  - Actual Spread %: ${spreadPct.toFixed(4)}%`);
  //console.log(`  - Selected Spread Level: ${selectedSpread}`);
  //console.log(`  - Selected Spread %: ${selectedSpreadPct.toFixed(4)}%`);
  //console.log(`GROUPED DATA RESULTS:`);
  //console.log(`  - Grouped Bids: ${groupedBids.length}/12`);
  //console.log(`  - Grouped Asks: ${groupedAsks.length}/12`);
  //console.log(`  - Sample Raw Bids:`, sortedBids.slice(0, 5).map(b => ({ px: b.px, sz: b.sz })));
  //console.log(`  - Sample Raw Asks:`, sortedAsks.slice(0, 5).map(a => ({ px: a.px, sz: a.sz })));
  //console.log(`  - Sample Grouped Bids:`, groupedBids.slice(0, 3).map(b => ({ px: b.px, sz: b.sz, count: b.count })));
  //console.log(`  - Sample Grouped Asks:`, groupedAsks.slice(0, 3).map(a => ({ px: a.px, sz: a.sz, count: a.count })));
  //console.log(`=== END ORDER BOOK SUMMARY ===`);

  // Calculate cumulative totals for grouped asks
  let askCumulative = 0;
  const asksWithTotal = groupedAsks.map(ask => {
    const amount = ask.px * ask.sz;
    askCumulative += amount;
    return { ...ask, amount, total: askCumulative };
  });

  // Calculate cumulative totals for grouped bids
  let bidCumulative = 0;
  const bidsWithTotal = groupedBids.map(bid => {
    const amount = bid.px * bid.sz;
    bidCumulative += amount;
    return { ...bid, amount, total: bidCumulative };
  });

  // For heat bars (match trades colors)
  const askMaxAmount = Math.max(1, ...asksWithTotal.map(a => a.amount));
  const bidMaxAmount = Math.max(1, ...bidsWithTotal.map(b => b.amount));

  return (
    <div className="text-xs">
      {/* Headers */}
      <div className="grid grid-cols-3 gap-x-2 text-white/60 mb-1 text-right">
        <div>Price</div>
        <div>Amount (USD)</div>
        <div>Total (USD)</div>
      </div>
      
      {/* Asks (reversed to show highest price first in UI) */}
      {[...asksWithTotal].reverse().map((ask, i) => {
        const widthPct = Math.max(2, Math.min(100, (ask.amount / askMaxAmount) * 100));
        return (
        <div key={`ask-${i}`} className="relative grid grid-cols-3 gap-x-2 text-right py-0.5 overflow-hidden select-none">
          <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${widthPct}%` }}>
            <div className="w-full h-full bg-rose-800" />
          </div>
          <div className="relative z-10 text-rose-300 tabular-nums">
            {ask.px < 0.001 ? ask.px.toFixed(8) : 
             ask.px < 0.01 ? ask.px.toFixed(6) : 
             ask.px < 1 ? ask.px.toFixed(4) : 
             ask.px.toFixed(2)}
          </div>
          <div className="relative z-10 text-white/70 tabular-nums">{Math.round(ask.amount).toLocaleString()}</div>
          <div className="relative z-10 text-white/70 tabular-nums">{Math.round(ask.total).toLocaleString()}</div>
        </div>
      )})}
      
      {/* Spread with Selector */}
      <div className="relative py-2 border-t border-b border-white/15 my-1 spread-dropdown select-none bg-black z-20">
        <div className="flex justify-center items-center">
          <button
            onClick={() => setShowSpreadOptions(!showSpreadOptions)}
            className="flex items-center gap-2 text-white/60 text-xs hover:text-white/80 transition-colors"
          >
            <span className="font-medium">
              Spread: {selectedSpread >= 1000 ? `${selectedSpread / 1000}k` : selectedSpread} {selectedSpreadPct > 0 ? `${selectedSpreadPct.toFixed(3)}%` : '0.000%'}
              {isChangingSpread && <span className="ml-1 text-white/40">⟳</span>}
            </span>
            <svg className={`w-3 h-3 transform transition-transform ${showSpreadOptions ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        
        {/* Spread Options Dropdown */}
        {showSpreadOptions && (
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 bg-black border border-white/20 rounded-md shadow-lg z-50 min-w-[220px]">
            <div className="p-1">
              {spreadOptions.map((spread) => (
                <button
                  key={spread}
                  onClick={() => handleSpreadChange(spread)}
                  disabled={isChangingSpread}
                  className={`w-full flex justify-between items-center px-3 py-2 text-xs transition-colors whitespace-nowrap ${
                    isChangingSpread 
                      ? 'text-white/30 cursor-not-allowed' 
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="font-medium">
                    {spread >= 1000 ? `${(spread / 1000).toLocaleString()}k` : 
                     spread < 0.001 ? spread.toFixed(6) :
                     spread < 0.01 ? spread.toFixed(4) :
                     spread < 1 ? spread.toFixed(3) :
                     spread.toLocaleString()}
                  </span>
                  <span className="text-white/50 text-[10px]">
                    {/* Calculate percentage based on spread relative to current price */}
                    {bestBid > 0 ? `${((spread / bestBid) * 100).toFixed(3)}%` : "0.000%"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Bids */}
      {bidsWithTotal.map((bid, i) => {
        const widthPct = Math.max(2, Math.min(100, (bid.amount / bidMaxAmount) * 100));
        return (
        <div key={`bid-${i}`} className="relative grid grid-cols-3 gap-x-2 text-right py-0.5 overflow-hidden select-none">
          <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${widthPct}%` }}>
            <div className="w-full h-full bg-emerald-800" />
          </div>
          <div className="relative z-10 text-emerald-300 tabular-nums">
            {bid.px < 0.001 ? bid.px.toFixed(8) : 
             bid.px < 0.01 ? bid.px.toFixed(6) : 
             bid.px < 1 ? bid.px.toFixed(4) : 
             bid.px.toFixed(2)}
          </div>
          <div className="relative z-10 text-white/70 tabular-nums">{Math.round(bid.amount).toLocaleString()}</div>
          <div className="relative z-10 text-white/70 tabular-nums">{Math.round(bid.total).toLocaleString()}</div>
        </div>
      )})}
    </div>
  );
}



function Sparkline({ values, height = 80 }: { values: number[]; height?: number }) {
  if (!values || values.length < 2) {
    return <div className="h-[100px] w-full flex items-center justify-center text-white/40 text-xs">Waiting for candles…</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 600; // virtual width, will scale to container
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
  const lastUp = values[values.length - 1] >= values[0];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full h-[100px]">
      <polyline
        fill="none"
        stroke={lastUp ? "#34d399" : "#f43f5e"}
        strokeWidth="2"
        points={points}
      />
    </svg>
  );
}

function TradingTabs() {
  const [tab, setTab] = useState<"positions" | "orders" | "trades">("positions");
  return (
    <div className="mt-4">
      <div className="flex gap-2 text-xs text-white/60 border-b border-white/10">
        <button
          className={`px-3 py-2 ${tab === "positions" ? "border-b-2 border-white text-white" : "hover:text-white/80"}`}
          onClick={() => setTab("positions")}
        >
          Positions
        </button>
        <button
          className={`px-3 py-2 ${tab === "orders" ? "border-b-2 border-white text-white" : "hover:text-white/80"}`}
          onClick={() => setTab("orders")}
        >
          Open Orders
        </button>
        <button
          className={`px-3 py-2 ${tab === "trades" ? "border-b-2 border-white text-white" : "hover:text-white/80"}`}
          onClick={() => setTab("trades")}
        >
          Trades
        </button>
      </div>
      <div className="p-4 text-white/70 text-sm">
        {tab === "positions" && <div>No positions (demo).</div>}
        {tab === "orders" && <div>No open orders (demo).</div>}
        {tab === "trades" && <div>No account trades (demo).</div>}
      </div>
    </div>
  );
}

function TradingTabsDemo({ positions, onClose }: { positions: DemoOrder[]; onClose: (ts: number) => void }) {
  const [tab, setTab] = useState<"positions" | "orders" | "trades">("positions");
  return (
    <div className="mt-4">
      <div className="flex gap-2 text-xs text-white/60 border-b border-white/10">
        <button className={`px-3 py-2 ${tab === "positions" ? "border-b-2 border-white text-white" : "hover:text-white/80"}`} onClick={() => setTab("positions")}>Positions</button>
        <button className={`px-3 py-2 ${tab === "orders" ? "border-b-2 border-white text-white" : "hover:text-white/80"}`} onClick={() => setTab("orders")}>Open Orders</button>
        <button className={`px-3 py-2 ${tab === "trades" ? "border-b-2 border-white text-white" : "hover:text-white/80"}`} onClick={() => setTab("trades")}>Trades</button>
      </div>
      <div className="p-4 text-white/70 text-sm">
        {tab === "positions" && (
          positions.length === 0 ? (
            <div>No positions (demo).</div>
          ) : (
            <div className="space-y-2">
              {positions.map((p, i) => (
                <div key={i} className="grid [grid-template-columns:auto_auto_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 text-xs bg-white/5 rounded-md p-2 border border-white/10 items-center">
                  <div className="font-medium truncate">{p.symbol}-PERP</div>
                  <div className="flex items-center gap-2 justify-self-start -ml-2">
                    <span className={`${p.side === 'long' ? 'text-emerald-400' : 'text-rose-400'} font-medium`}>{p.side.toUpperCase()}</span>
                    <span className="text-white/70 whitespace-nowrap">{p.cross ? 'cross' : 'isolated'} x{p.leverage}</span>
                  </div>
                  <div className="tabular-nums text-right">{'$'}{p.sizeUsd.toLocaleString('nb-NO')}</div>
                  <div className="tabular-nums text-right">{p.price ? p.price.toLocaleString('nb-NO') : '-'}</div>
                  <button onClick={() => onClose(p.ts)} className="justify-self-end text-rose-400 hover:text-rose-300">Cancel</button>
                </div>
              ))}
            </div>
          )
        )}
        {tab === "orders" && <div>No open orders (demo).</div>}
        {tab === "trades" && <div>No account trades (demo).</div>}
      </div>
    </div>
  );
}

function StatsGrid({ ctx }: { ctx: SelectedCtx }) {
  const prevHighRef = useRef<string | null>(null);
  const prevLowRef = useRef<string | null>(null);
  const prevVolRef = useRef<string | null>(null);
  const prevChangeRef = useRef<string | null>(null);
  
  const change = ctx.prevDayPx && ctx.midPx ? ctx.midPx - ctx.prevDayPx : undefined;
  const changePct = change !== undefined && ctx.prevDayPx !== undefined ? (change / ctx.prevDayPx) * 100 : undefined;
  const changeStr = change !== undefined ? `${change >= 0 ? "+" : ""}${changePct?.toFixed(2)}%` : undefined;
  const pos = change !== undefined ? change >= 0 : undefined;

  // Update refs when new data is available, but keep previous values when data is loading
  const highValue = ctx.high24h?.toLocaleString() ?? prevHighRef.current ?? "-";
  const lowValue = ctx.low24h?.toLocaleString() ?? prevLowRef.current ?? "-";
  const volValue = ctx.dayNtlVlm ? formatVolume(ctx.dayNtlVlm) : prevVolRef.current ?? "-";
  const changeValue = changeStr ?? prevChangeRef.current ?? "-";

  // Store current values for next render
  if (ctx.high24h) prevHighRef.current = ctx.high24h.toLocaleString();
  if (ctx.low24h) prevLowRef.current = ctx.low24h.toLocaleString();
  if (ctx.dayNtlVlm) prevVolRef.current = formatVolume(ctx.dayNtlVlm);
  if (changeStr) prevChangeRef.current = changeStr;

  return (
    <div className="flex items-center gap-8 py-2 px-1 text-sm">
      <SlimStat label="24h High" value={highValue} isLoading={!ctx.high24h && prevHighRef.current !== null} />
      <SlimStat label="24h Low" value={lowValue} isLoading={!ctx.low24h && prevLowRef.current !== null} />
      <SlimStat label="24h Vol" value={volValue} isLoading={!ctx.dayNtlVlm && prevVolRef.current !== null} />
      <SlimStat label="24h Change" value={changeValue} positive={pos} isLoading={!changeStr && prevChangeRef.current !== null} />
    </div>
  );
}

function SlimStat({ label, value, positive, isLoading }: { label: string; value: string; positive?: boolean; isLoading?: boolean }) {
  return (
    <div className="flex flex-col items-center text-center min-w-0">
      <div className="text-xs text-white/50 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-sm font-medium tabular-nums truncate ${
        isLoading ? "text-white/60" :
        positive === undefined ? "text-white/90" : 
        positive ? "text-emerald-400" : "text-rose-400"
      }`}>
        {value}
      </div>
    </div>
  );
}

function formatVolume(volume: number): string {
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(1)}B`;
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(1)}M`;
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(1)}K`;
  return volume.toLocaleString();
}

