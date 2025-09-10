"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import bs58 from "bs58";
import AccountBadge from "@/components/AccountBadge";

type Overview = {
  userId: string;
  custodialPublicKey: string | null;
  sol: number;
  usd: number | null;
  usdPrice: number | null;
  history: Array<{ signature: string; kind: 'deposit'|'withdraw'; sol: number; lamports?: number; ts: number }>
};

type Me = {
  userId: string;
  walletAddress: string;
  custodialPublicKey: string | null;
  lastLoginAt: string | null;
  custodialCreatedAt: string | null;
};

export default function AccountPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [wdAddr, setWdAddr] = useState("");
  const [wdAmt, setWdAmt] = useState("");
  const [wdBusy, setWdBusy] = useState(false);
  const [wdMsg, setWdMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [canSend, setCanSend] = useState(true);
  const [estFee, setEstFee] = useState<number | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [maxBusy, setMaxBusy] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  const computeSafeFee = (feeSol: number | null): number => {
    const raw = typeof feeSol === 'number' && Number.isFinite(feeSol) ? feeSol : 0.00005; // default base
    const multiplier = 5; // 5x raw fee for extra safety
    const bufferAbs = 0.0003; // +300k lamports
    const minAbs = 0.0005; // at least 500k lamports
    return Math.max(raw * multiplier, raw + bufferAbs, minAbs);
  };
  const maxAmount = useMemo(() => {
    if (!data?.sol) return 0;
    const feeBuffer = 0.00001; // ~10k lamports
    return Math.max(0, data.sol - feeBuffer);
  }, [data?.sol]);

  const refreshOverview = useCallback(async () => {
    try {
      const r = await fetch('/api/account/overview', { cache: 'no-store' });
      const j = await r.json();
      setData(j);
      try { (window as any).__accountSolBalance = j?.sol ?? undefined; } catch {}
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      try { await refreshOverview(); } finally { setLoading(false); }
    })();
  }, [refreshOverview]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/me', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          setMe(j);
        }
      } catch {}
    })();
  }, []);

  const short = (s?: string | null) => (s ? `${s.slice(0, 6)}…${s.slice(-6)}` : "-");

  const fmtAge = (ts: number) => {
    const diff = Math.max(0, Date.now() - ts);
    const s = Math.floor(diff / 1000); if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24); return `${d}d`;
  };

  useEffect(() => {
    (async () => {
      if (!data?.custodialPublicKey) { setQr(null); return; }
      try {
        const url = `solana:${data.custodialPublicKey}`;
        const svg = await QRCode.toString(url, { type: 'svg', margin: 0, width: 180, color: { dark: '#FFFFFF', light: '#00000000' } });
        setQr(svg);
      } catch { setQr(null); }
    })();
  }, [data?.custodialPublicKey]);

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <a href="/" className="px-3 h-9 inline-flex items-center rounded-md border border-white/15 text-sm text-white/90 hover:bg-white/10">Back to app</a>
      </div>

      {/* Profile header */}
      <div className="relative overflow-hidden rounded-xl border border-white/10 mb-6">
        <div className="h-24 bg-gradient-to-r from-emerald-700/40 via-cyan-700/30 to-blue-700/30" />
        <div className="p-4 sm:p-5 -mt-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="inline-flex size-16 items-center justify-center rounded-full border border-white/10 ring-2 ring-black/40 bg-emerald-500/20 text-emerald-300 text-2xl">
                ✦
              </div>
              <div>
                <div className="text-lg font-semibold">{short(me?.walletAddress || me?.userId)}</div>
                <div className="text-xs text-white/60 font-mono break-all">{me?.walletAddress || '-'}</div>
                <div className="text-xs text-white/50 mt-1">
                  {me?.lastLoginAt ? `Last login ${new Date(me.lastLoginAt).toLocaleString()}` : ''}
                  {me?.custodialCreatedAt ? `${me?.lastLoginAt ? ' · ' : ''}Custodial created ${new Date(me.custodialCreatedAt).toLocaleString()}` : ''}
                </div>
              </div>
            </div>
            
          </div>
        </div>
      </div>
      {loading ? (
        <div>Loading…</div>
      ) : !data ? (
        <div>Failed to load.</div>
      ) : (
        <div className="space-y-6">
          <div className="border border-white/10 rounded p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-white/60">Custodial wallet</div>
              <div className="font-mono break-all">{data.custodialPublicKey || '-'}</div>
              <div className="mt-2 text-sm">Balance: {data.sol?.toFixed?.(6)} SOL {data.usd !== null ? `(≈ $${data.usd.toFixed(2)})` : ''}</div>
              {data.usdPrice !== null && (
                <div className="text-xs text-white/60">SOL/USD: ${data.usdPrice.toFixed(2)}</div>
              )}
              <RevealSecretSection />
              <div className="mt-3 text-sm">PnL (since baseline)</div>
              <PnLWidgets sol={data.sol} usdPrice={data.usdPrice} />
            </div>
            <div className="flex md:flex-col md:items-end gap-2">
              {qr ? (
                <div className="p-3 rounded-md border border-white/10 bg-black/60" dangerouslySetInnerHTML={{ __html: qr }} />
              ) : (
                <div className="text-white/60 text-sm">QR unavailable</div>
              )}
              {data.custodialPublicKey && (
                <div className="flex items-center gap-2">
                  <a className="text-white/70 underline text-sm" href={`https://solscan.io/address/${data.custodialPublicKey}`} target="_blank" rel="noreferrer">View on Solscan</a>
                  <button
                    onClick={async ()=>{ try { await navigator.clipboard.writeText(data.custodialPublicKey!); } catch {} }}
                    className="px-2 h-7 rounded-md border border-white/15 text-xs text-white/80 hover:bg-white/10"
                  >Copy</button>
                </div>
              )}
            </div>
          </div>
          <div className="border border-white/10 rounded p-4">
            <div className="text-sm text-white/60 mb-2">Withdraw</div>
            <div className="flex flex-col gap-2 max-w-xl">
              <input value={wdAddr} onChange={e=>setWdAddr(e.target.value)} placeholder="Destination address" className="w-full bg-white/5 border border-white/10 rounded px-2 h-9 text-sm font-mono" />
              <div className="flex items-center gap-2">
                <input value={wdAmt} onChange={e=>setWdAmt(e.target.value)} placeholder="Amount (SOL)" className="flex-1 bg-white/5 border border-white/10 rounded px-2 h-9 text-sm" />
                <button
                  onClick={async () => {
                    try {
                      setMaxBusy(true);
                      const balanceSol = data?.sol || 0;
                      const to = wdAddr || (data?.custodialPublicKey || "");
                      let balanceLamports = Math.floor(balanceSol * 1e9);
                      let bufferLamports = 600000; // 0.0006 SOL safety buffer
                      let amountLamports = Math.max(0, balanceLamports - 500000 - bufferLamports);
                      for (let i = 0; i < 4; i++) {
                        const r = await fetch(`/api/wallet/fee?to=${encodeURIComponent(to)}&lamports=${amountLamports}`, { cache: 'no-store' });
                        const j = await r.json();
                        const rawFeeLamports = typeof j?.feeLamports === 'number' ? j.feeLamports : 500000;
                        const safeFeeLamports = Math.max(rawFeeLamports * 5, rawFeeLamports + 300000, 500000);
                        const nextAmountLamports = Math.max(0, balanceLamports - safeFeeLamports - bufferLamports);
                        if (Math.abs(nextAmountLamports - amountLamports) < 1000) { amountLamports = nextAmountLamports; break; }
                        amountLamports = nextAmountLamports;
                      }
                      const max = amountLamports / 1e9;
                      setWdAmt(max.toFixed(6));
                    } catch {
                      setWdAmt(maxAmount.toFixed(6));
                    } finally { setMaxBusy(false); }
                  }}
                  className="px-2 h-9 rounded-md border border-white/15 text-sm"
                >{maxBusy ? '…' : 'Max'}</button>
                <button
                  disabled={wdBusy}
                  onClick={() => { if (wdAddr && wdAmt) setConfirmOpen(true); }}
                  className="px-3 h-9 rounded-md bg-white text-black text-sm"
                >{wdBusy ? 'Sending…' : 'Send'}</button>
              </div>
              {wdMsg && <div className="text-sm text-white/70">{wdMsg}</div>}
            </div>
          </div>
          {confirmOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/70" onClick={()=>setConfirmOpen(false)} />
              <div className="relative w-[92vw] sm:w-[420px] rounded-lg border border-white/15 bg-black p-4 shadow-xl">
                <div className="text-lg font-semibold mb-2">Confirm withdraw</div>
                <div className="text-sm text-white/70 mb-1">To</div>
                <div className="text-sm font-mono break-all mb-2">{wdAddr}</div>
                <div className="text-sm text-white/70 mb-1">Amount</div>
                <ConfirmFee amountSol={Number(wdAmt||0)} to={wdAddr} usdPrice={data?.usdPrice || null} balanceSol={data?.sol || 0} onEstimate={(e)=>{ setEstFee(e.feeSol); setCanSend(e.canSend); }} />
                <div className="flex justify-end gap-2">
                  <button className="px-3 h-9 rounded-md border border-white/15" onClick={()=>setConfirmOpen(false)}>Cancel</button>
                  <button
                    className="px-3 h-9 rounded-md bg-white text-black"
                    disabled={wdBusy || !canSend}
                    onClick={async ()=>{
                      setWdBusy(true); setWdMsg(null);
                      try {
                        const res = await fetch('/api/wallet/withdraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: wdAddr, amountSol: Number(wdAmt) }) });
                        const j = await res.json();
                        if (!res.ok) throw new Error(j?.error || 'withdraw_failed');
                        setWdMsg(`Sent: ${j.signature}`);
                        // Poll overview for a short while to ensure history appears
                        const deadline = Date.now() + 15000;
                        while (Date.now() < deadline) {
                          await refreshOverview();
                          await new Promise(r => setTimeout(r, 2000));
                        }
                        setConfirmOpen(false);
                      } catch (e: any) { setWdMsg(e?.message || 'Error'); } finally { setWdBusy(false); }
                    }}
                  >Confirm</button>
                </div>
                {!canSend && (
                  <div className="mt-3 text-sm text-rose-400">Insufficient funds to cover amount + fee. Reduce amount or click Max.</div>
                )}
              </div>
            </div>
          )}
          <ActivitySection usdPrice={data.usdPrice} />
        </div>
      )}
    </div>
  );
}

function ConfirmFee({ amountSol, to, usdPrice, balanceSol, onEstimate }: { amountSol: number; to: string; usdPrice: number | null; balanceSol: number; onEstimate?: (e: { feeSol: number; canSend: boolean }) => void }) {
  const [fee, setFee] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const lamports = Math.floor((amountSol || 0) * 1e9);
        const r = await fetch(`/api/wallet/fee?to=${encodeURIComponent(to)}&lamports=${lamports}`, { cache: 'no-store' });
        const j = await r.json();
        if (typeof j?.feeLamports === 'number') {
          const raw = j.feeLamports / 1e9;
          const f = Math.max(raw * 5, raw + 0.0003, 0.0005);
          setFee(f);
          if (onEstimate) onEstimate({ feeSol: f, canSend: (amountSol + f) <= balanceSol });
        }
      } catch {}
    })();
  }, [amountSol, to, balanceSol]);
  const total = amountSol + (fee || 0);
  return (
    <div className="text-sm mb-4 space-y-1">
      <div className="flex items-center justify-between"><div className="text-white/70">Amount</div><div>{amountSol.toFixed(6)} SOL {usdPrice ? `(≈ $${(amountSol*usdPrice).toFixed(2)})` : ''}</div></div>
      <div className="flex items-center justify-between"><div className="text-white/70">Estimated fee</div><div>{fee === null ? '…' : `${fee.toFixed(6)} SOL ${usdPrice ? `(≈ $${(fee*usdPrice).toFixed(2)})` : ''}`}</div></div>
      <div className="flex items-center justify-between"><div className="text-white/70">Total</div><div>{fee === null ? '…' : `${total.toFixed(6)} SOL ${usdPrice ? `(≈ $${(total*usdPrice).toFixed(2)})` : ''}`}</div></div>
    </div>
  );
}

function RevealSecretSection() {
  const [revealed, setRevealed] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const decoded = useMemo(() => {
    try {
      if (!secret) return null;
      // Decode base64 to bytes (browser-safe)
      const binary = typeof atob !== 'undefined' ? atob(secret) : Buffer.from(secret, 'base64').toString('binary');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch {
      return null;
    }
  }, [secret]);
  const secretBase58 = useMemo(() => {
    try {
      return decoded ? bs58.encode(decoded) : null;
    } catch {
      return null;
    }
  }, [decoded]);


  const displayValue = secretBase58 || secret || null;
  useEffect(() => {
    if (!revealed) return;
    (async () => {
      try {
        const r = await fetch('/api/account/secret', { cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || 'error');
        setSecret(j.secretKeyB64);
      } catch (e: any) { setErr(e?.message || 'Error'); }
    })();
  }, [revealed]);
  return (
    <div className="mt-2">
      <div className="text-xs text-white/60 mb-1">Private key</div>
      <div className="flex items-center gap-2">
        <div
          className={`flex-1 text-xs break-all border border-white/10 rounded p-2 ${revealed ? 'bg-white/5 text-white/90' : 'bg-white/5 text-white/90 blur-sm hover:blur-none transition'}`}
          onClick={() => setRevealed(v => !v)}
           title={revealed ? 'Click to hide' : 'Click to reveal'}
        >
          {revealed ? (displayValue ?? 'Loading…') : 'Click to reveal'}
        </div>
        {revealed && (
          <button
            onClick={async ()=>{ try { if (displayValue) await navigator.clipboard.writeText(displayValue); } catch {} }}
            className="px-2 h-8 rounded-md border border-white/15 text-xs text-white/80 hover:bg-white/10"
          >Copy</button>
        )}
      </div>
      {err && <div className="text-xs text-rose-400 mt-1">{err}</div>}
    </div>
  );
}

function PnLWidgets({ sol, usdPrice }: { sol: number; usdPrice: number | null }) {
  const baselineKey = "custodial_pnl_baseline_usd";
  const baselineAtKey = "custodial_pnl_baseline_at";
  const currentUsd = usdPrice !== null ? sol * usdPrice : null;
  const [baselineUsd, setBaselineUsd] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/account/baseline', { cache: 'no-store' });
        const j = await r.json();
        if (typeof j?.baselineUsd === 'number') {
          setBaselineUsd(j.baselineUsd);
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(baselineKey, String(j.baselineUsd));
            if (j?.baselineAt) window.localStorage.setItem(baselineAtKey, String(j.baselineAt));
          }
        } else if (typeof window !== 'undefined') {
          const local = Number(window.localStorage.getItem(baselineKey) || '') || null;
          setBaselineUsd(local);
        }
      } catch {
        if (typeof window !== 'undefined') {
          const local = Number(window.localStorage.getItem(baselineKey) || '') || null;
          setBaselineUsd(local);
        }
      }
    })();
  }, []);
  const pnlUsd = currentUsd !== null && baselineUsd !== null ? currentUsd - baselineUsd : null;
  const pnlPct = pnlUsd !== null && baselineUsd ? (pnlUsd / baselineUsd) * 100 : null;
  return (
    <div className="mt-2 text-sm space-y-1">
      <div className="flex items-center justify-between"><div className="text-white/70">USD</div><div className="tabular-nums">{currentUsd === null ? '…' : `$${currentUsd.toFixed(2)}`}</div></div>
      <div className="flex items-center justify-between"><div className="text-white/70">PnL</div><div className={`tabular-nums ${pnlUsd !== null && pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{pnlUsd === null ? '…' : `$${pnlUsd.toFixed(2)}`}</div></div>
      <div className="flex items-center justify-between"><div className="text-white/70">Change</div><div className={`tabular-nums ${pnlPct !== null && pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{pnlPct === null ? '…' : `${pnlPct.toFixed(2)}%`}</div></div>
      <div className="pt-2">
        <button
          onClick={() => {
            (async () => {
              if (currentUsd === null) return;
              try {
                await fetch('/api/account/baseline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baselineUsd: currentUsd }) });
              } catch {}
              if (typeof window !== 'undefined') {
                window.localStorage.setItem(baselineKey, String(currentUsd));
                window.localStorage.setItem(baselineAtKey, String(Date.now()));
                window.location.reload();
              }
            })();
          }}
          className="px-2 h-8 rounded-md border border-white/15 text-xs text-white/80 hover:bg-white/10"
        >Set baseline</button>
      </div>
    </div>
  );
}

function ActivitySection({ usdPrice }: { usdPrice: number | null }) {
  const [list, setList] = useState<Array<{ signature: string; ts: number; solDelta: number; kind: string }>>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/account/activity', { cache: 'no-store' });
      const j = await r.json();
      if (Array.isArray(j?.activity)) setList(j.activity);
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="border border-white/10 rounded p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-white/60">Transfers</div>
        <button onClick={refresh} className="px-2 h-7 rounded-md border border-white/15 text-xs text-white/80 hover:bg-white/10">Refresh</button>
      </div>
      {loading ? (
        <div className="text-white/60 text-sm">Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-white/60 text-sm">No transfers</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-white/50">
            <tr>
              <th className="text-left font-medium py-1">Type</th>
              <th className="text-right font-medium py-1">Amount</th>
              <th className="text-right font-medium py-1">USD</th>
              <th className="text-right font-medium py-1">When</th>
              <th className="text-right font-medium py-1">Signature</th>
            </tr>
          </thead>
          <tbody>
            {list.map((h, i) => (
              <tr key={i} className="border-t border-white/10">
                <td className={`${h.kind==='deposit' ? 'text-emerald-400' : h.kind==='withdraw' ? 'text-rose-400' : 'text-white/80'}`}>{h.kind}</td>
                <td className="text-right tabular-nums">{Math.abs(h.solDelta).toFixed(6)} SOL</td>
                <td className="text-right tabular-nums">{usdPrice ? `$${Math.abs(h.solDelta*usdPrice).toFixed(2)}` : '…'}</td>
                <td className="text-right text-white/60" title={new Date(h.ts).toLocaleString()}>{(function(age){const d=Math.max(0,Date.now()-age);const s=Math.floor(d/1000);if(s<60)return `${s}s`;const m=Math.floor(s/60);if(m<60)return `${m}m`;const h=Math.floor(m/60);if(h<24)return `${h}h`;const dd=Math.floor(h/24);return `${dd}d`;})(h.ts)}</td>
                <td className="text-right">
                  <a className="text-white/70 underline" href={`https://solscan.io/tx/${h.signature}`} target="_blank" rel="noreferrer">View</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

