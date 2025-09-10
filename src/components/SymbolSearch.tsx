"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getInfoClient, getSubsClient } from "@/lib/hyperliquid";
import CoinIcon from "@/components/CoinIcon";

type Props = {
  value: string;
  onSelect: (coin: string) => void;
  placeholder?: string;
  alwaysOpen?: boolean; // keep suggestions open without focusing input
  embedded?: boolean; // render input inside the dropdown panel
};

type MarketInfo = {
  mid?: number;
  dayNtlVlm?: number;
  openInterest?: number;
  changePct?: number;
  maxLev?: number;
};

export default function SymbolSearch({ value, onSelect, placeholder = "Search markets (e.g. BTC, ETH)…", alwaysOpen = false, embedded = false }: Props) {
  const [query, setQuery] = useState("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [marketInfo, setMarketInfo] = useState<Record<string, MarketInfo>>({});
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const midsSubRef = useRef<{ unsubscribe: () => Promise<void> } | null>(null);
  const pollRef = useRef<any>(null);

  // Fallback cap table (used if API lacks explicit cap)
  const fallbackCap = (sym: string): number | undefined => {
    const s = (sym || "").toUpperCase();
    const table: Record<string, number> = { BTC: 40, ETH: 25, SOL: 20, HYPE: 10, XRP: 20 };
    if (table[s]) return table[s];
    if (["BNB","AVAX","MATIC","DOT","UNI","LINK","LTC","AAVE","MKR","CRV"].includes(s)) return 20;
    return 10; // generic default
  };

  // Bootstrap list + contexts
  useEffect(() => {
    let mounted = true;
    const info = getInfoClient();

    console.log("Market SymbolSearch info:=========>", info.allMids());

    (async () => {
      try {
        const [mids, metaAndCtx] = await Promise.all([
          info.allMids(),
          info.metaAndAssetCtxs(),
        ]);
        if (!mounted) return;
        const list = Object.keys(mids).filter((k) => !k.startsWith("@"));
        setSymbols(list);
        const universe = metaAndCtx[0]?.universe ?? [];
        const ctxs = metaAndCtx[1] ?? [];
        const map: Record<string, MarketInfo> = {};
        universe.forEach((u: any, i: number) => {
          const c = ctxs[i] ?? {};
          const mid = typeof c.midPx === "string" ? Number(c.midPx) : undefined;
          const prev = typeof c.prevDayPx === "string" ? Number(c.prevDayPx) : undefined;
          const levFields = [c?.maxLeverage, (c as any)?.maxLev, (c as any)?.levCap, (c as any)?.max_leverage];
          const levRaw = levFields.find((v: any) => typeof v === "number" || typeof v === "string");
          const lev = typeof levRaw === "string" ? Number(levRaw) : (levRaw as number | undefined);
          map[u.name] = {
            mid,
            dayNtlVlm: c?.dayNtlVlm ? Number(c.dayNtlVlm) : undefined,
            openInterest: c?.openInterest ? Number(c.openInterest) : undefined,
            changePct: mid && prev ? ((mid - prev) / prev) * 100 : undefined,
            maxLev: Number.isFinite(lev) ? (lev as number) : fallbackCap(u.name),
          };
        });
        setMarketInfo(map);
      } catch {}
    })();

    // Live mids subscription
    (async () => {
      try {
        if (midsSubRef.current) await midsSubRef.current.unsubscribe();
        const subs = getSubsClient();
        midsSubRef.current = await subs.allMids((data: any) => {
          const source: Record<string, string> = (data && typeof data === "object" && "mids" in data)
            ? (data.mids as Record<string, string>)
            : (data as Record<string, string>);
          setMarketInfo((prev) => {
            const next = { ...prev };
            for (const [coin, px] of Object.entries(source)) {
              if (coin.startsWith("@")) continue;
              const mid = Number(px);
              const prevEntry = next[coin] ?? {};
              next[coin] = { ...prevEntry, mid };
            }
            return next;
          });
          if (symbols.length === 0) setSymbols(Object.keys(source).filter((k) => !k.startsWith("@")));
        });
      } catch {}
    })();

    // Poll contexts periodically for volume/change
    const poll = async () => {
      try {
        const metaAndCtx = await info.metaAndAssetCtxs();
        const universe = metaAndCtx[0]?.universe ?? [];
        const ctxs = metaAndCtx[1] ?? [];
        setMarketInfo((prev) => {
          const next = { ...prev };
          universe.forEach((u: any, i: number) => {
            const c = ctxs[i] ?? {};
            const mid = typeof c.midPx === "string" ? Number(c.midPx) : prev[u.name]?.mid;
            const prevDay = typeof c.prevDayPx === "string" ? Number(c.prevDayPx) : undefined;
            const levFields = [c?.maxLeverage, (c as any)?.maxLev, (c as any)?.levCap, (c as any)?.max_leverage];
            const levRaw = levFields.find((v: any) => typeof v === "number" || typeof v === "string");
            const lev = typeof levRaw === "string" ? Number(levRaw) : (levRaw as number | undefined);
            next[u.name] = {
              ...next[u.name],
              mid,
              dayNtlVlm: c?.dayNtlVlm ? Number(c.dayNtlVlm) : next[u.name]?.dayNtlVlm,
              openInterest: c?.openInterest ? Number(c.openInterest) : next[u.name]?.openInterest,
              changePct: mid && prevDay ? ((mid - prevDay) / prevDay) * 100 : next[u.name]?.changePct,
              maxLev: Number.isFinite(lev) ? (lev as number) : (next[u.name]?.maxLev ?? fallbackCap(u.name)),
            };
          });
          return next;
        });
      } catch {}
      pollRef.current = setTimeout(poll, 30000);
    };
    poll();

    return () => {
      mounted = false;
      try { if (midsSubRef.current) midsSubRef.current.unsubscribe(); } catch {}
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (alwaysOpen) return; // Don't close if alwaysOpen is true
      
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [open, alwaysOpen]);

  const topByVolume = useMemo(() => {
    const arr = symbols.map((s) => ({ s, v: marketInfo[s]?.dayNtlVlm ?? 0 }));
    arr.sort((a, b) => (b.v || 0) - (a.v || 0));
    return arr.slice(0, 15).map((x) => x.s);
  }, [symbols, marketInfo]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return topByVolume;
    return symbols.filter((s) => s.toLowerCase().includes(q)).slice(0, 15);
  }, [symbols, query, topByVolume]);

  function choose(sym: string) {
    // Defer to ensure click doesn't get swallowed by blur
    setTimeout(() => {
      onSelect(sym);
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    }, 0);
  }

  function format(n?: number) {
    if (n === undefined || Number.isNaN(n)) return "-";
    return n.toLocaleString();
  }

  function formatPct(n?: number) {
    if (n === undefined || Number.isNaN(n)) return "-";
    const sign = n >= 0 ? "+" : "";
    return `${sign}${n.toFixed(2)}%`;
  }

  const isOpen = alwaysOpen || open;

  return (
    <div ref={containerRef} className="relative w-full max-w-[420px]" onMouseDown={(e) => e.stopPropagation()}>
      {!embedded && (
        <input
          ref={inputRef}
          className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-white/20 text-white"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (filtered.length > 0) choose(filtered[0]);
            }
            if (e.key === "Escape") setOpen(false);
          }}
          onBlur={() => { if (!alwaysOpen) setTimeout(() => setOpen(false), 120); }}
        />
      )}
      {isOpen && (
                 <div className="absolute z-20 mt-1 w-full rounded-md border border-white/10 bg-black shadow-lg max-h-[60vh] overflow-auto p-0">
          {embedded && (
            <div className="sticky top-0 z-10 bg-black border-b border-white/10 p-2">
              <input
                ref={inputRef}
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-white/20 text-white"
                placeholder={placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (filtered.length > 0) choose(filtered[0]);
                  }
                }}
              />
            </div>
          )}
          <div className="p-2">
          {filtered.map((s) => {
            const info = marketInfo[s] ?? {};
            const up = (info.changePct ?? 0) >= 0;
            return (
              <button
                key={s}
                className="w-full text-left px-3 py-2 text-sm text-white/90 hover:bg-white/10 hover:cursor-pointer flex items-center gap-3"
                onClick={() => choose(s)}
              >
                <CoinIcon symbol={s} />
                <span className="font-medium flex-1 flex items-center gap-2">
                  {s}-PERP
                  {typeof info.maxLev === 'number' && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border"
                      style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' }}
                    >
                      {info.maxLev}x
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-white/80">{format(info.mid)}</span>
                <span className={`tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>{formatPct(info.changePct)}</span>
              </button>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}

