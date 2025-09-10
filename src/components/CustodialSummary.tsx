"use client";

import { useEffect, useRef, useState } from "react";
import { getInfoClient } from "@/lib/hyperliquid";
import { useDebouncedToast } from "@/hooks/useDebouncedToast";

type BalanceResp = { sol?: number; usdc?: number; publicKey?: string } | { error: string };
type MeResp = { custodialPublicKey?: string | null } | { error: string };

export default function CustodialSummary() {
  const { showWarning, showError } = useDebouncedToast();
  
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const prevSolRef = useRef<number | null>(null);
  const prevUsdcRef = useRef<number | null>(null);
  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        const j: MeResp = await r.json();
        if (!cancelled && (j as any)?.custodialPublicKey) {
          setPubkey((j as any).custodialPublicKey as string);
        } else if (!cancelled) {
          setPubkey(null);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let timer: any;
    const tick = async () => {
      try {
        const r = await fetch("/api/wallet/balance", { cache: "no-store" });
        const j: BalanceResp = await r.json();
        if ((j as any)?.sol !== undefined) {
          const next = (j as any).sol as number;
          const prev = prevSolRef.current;
          setSol(next);
          
          // Check for low SOL balance (only when crossing threshold)
          if (next < 0.01 && (prev === null || prev >= 0.01)) {
            showWarning("Low SOL balance! Consider depositing more SOL for trading fees.");
          }
          
          // Trigger confetti on positive delta >= 0.001 SOL
          if (typeof window !== 'undefined' && prev !== null && next - prev > 0.001) {
            import('canvas-confetti').then(({ default: confetti }) => {
              const originX = 0.85; // near right side
              const originY = 0.10; // near top
              confetti({ particleCount: 60, spread: 60, startVelocity: 35, scalar: 0.8, origin: { x: originX, y: originY } });
              setTimeout(() => confetti({ particleCount: 40, spread: 50, startVelocity: 25, scalar: 0.9, origin: { x: originX, y: originY } }), 120);
            }).catch(() => {});
          }
          prevSolRef.current = next;
        }
        if ((j as any)?.usdc !== undefined) {
          const nextUsdc = (j as any).usdc as number;
          const prevUsdc = prevUsdcRef.current;
          setUsdc(nextUsdc);
          
          // Check for low USDC balance (only when crossing threshold)
          if (nextUsdc < 10 && (prevUsdc === null || prevUsdc >= 10)) {
            showWarning("Low USDC balance! Consider depositing more USDC for trading.");
          }
          
          prevUsdcRef.current = nextUsdc;
        }
      } catch {}
      // Fetch SOL/USD price for USD + PnL display
      try {
        const info = getInfoClient();
        const all = await info.allMids();
        const p = Number((all as any).SOL || (all as any)["SOL"]);
        if (Number.isFinite(p)) setPriceUsd(p);
      } catch {}
    };
    tick();
    timer = setInterval(tick, 15000);
    return () => { if (timer) clearInterval(timer); };
  }, []);

  const short = (s?: string | null) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : "-");

  const fmtTotalUsd = () => {
    if (sol === null || priceUsd === null) return "…";
    const solUsd = sol * priceUsd;
    const usdcValue = usdc || 0;
    const totalUsd = solUsd + usdcValue;
    return `$${totalUsd.toFixed(2)}`;
  };



  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="flex items-center gap-1 sm:gap-2" ref={menuRef}>
      {!pubkey ? null : (
      <>
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="px-3 h-9 inline-flex items-center rounded-md border border-white/15 bg-white/5 text-white/80 text-sm tabular-nums whitespace-nowrap hover:bg-white/10"
          title="Total balance in USD"
        >
          {fmtTotalUsd()}
        </button>
        {menuOpen && (
        <div className="absolute right-0 mt-2 z-50 w-[90vw] sm:w-64 rounded-md border border-white/10 bg-black/90 backdrop-blur p-3 shadow">
          <div className="text-xs text-white/60 mb-2">Wallet Balance</div>
          <div className="flex items-center justify-between text-sm mb-2">
            <div className="text-white/70">SOL</div>
            <div className="text-white/90 tabular-nums">{sol === null ? "…" : `${sol.toFixed(4)} SOL`}</div>
          </div>
          <div className="flex items-center justify-between text-sm mb-2">
            <div className="text-white/70">USDC</div>
            <div className="text-white/90 tabular-nums">{usdc === null ? "…" : `${usdc.toFixed(2)} USDC`}</div>
          </div>
          <div className="border-t border-white/10 pt-2">
            <div className="flex items-center justify-between text-sm">
              <div className="text-white/70">Total USD</div>
              <div className="text-white font-medium tabular-nums">{fmtTotalUsd()}</div>
            </div>
          </div>
        </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

