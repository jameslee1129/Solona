import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getInfoClient } from "@/lib/hyperliquid";

export const runtime = "nodejs";

function getCookie(req: NextRequest, name: string): string | undefined {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(/;\s*/);
  for (const p of parts) {
    const [k, ...vals] = p.split("=");
    if (k === name) return decodeURIComponent(vals.join("="));
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      return new Response(JSON.stringify({ error: "missing_supabase_env" }), { status: 500 });
    }
    const userId = getCookie(req, "app_session");
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

    const admin = getSupabaseAdmin();
    const { data: wallet } = await admin
      .from("custodial_wallets")
      .select("public_key")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    const custodialPk = wallet?.public_key as string | undefined;
    const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
    const conn = new Connection(endpoint, "confirmed");

    let lamports = 0;
    let sol = 0;
    let history: Array<{ signature: string; kind: "deposit" | "withdraw"; lamports: number; sol: number; ts: number }> = [];

    if (custodialPk) {
      lamports = await conn.getBalance(new PublicKey(custodialPk));
      sol = lamports / LAMPORTS_PER_SOL;

      try {
        const sigs = await conn.getSignaturesForAddress(new PublicKey(custodialPk), { limit: 30 });
        const parsed = await conn.getParsedTransactions(sigs.map(s => s.signature), { maxSupportedTransactionVersion: 0 });
        parsed.forEach((tx, idx) => {
          if (!tx || !tx.meta || !tx.transaction) return;
          const keys = tx.transaction.message.accountKeys.map(k => (typeof k === 'string' ? k : (k as any).pubkey?.toString?.() || (k as any).pubkey)) as any[];
          const i = keys.findIndex((k: any) => String(k) === String(custodialPk));
          if (i < 0) return;
          const pre = tx.meta!.preBalances?.[i] ?? 0;
          const post = tx.meta!.postBalances?.[i] ?? 0;
          const delta = post - pre;
          if (delta === 0) return;
          history.push({
            signature: sigs[idx].signature,
            kind: delta > 0 ? "deposit" : "withdraw",
            lamports: Math.abs(delta),
            sol: Math.abs(delta) / LAMPORTS_PER_SOL,
            ts: (tx.blockTime || sigs[idx].blockTime || Math.floor(Date.now() / 1000)) * 1000,
          });
        });
        history.sort((a, b) => b.ts - a.ts);
        history = history.slice(0, 20);
      } catch {}
    }

    let usdPrice: number | null = null;
    try {
      const info = getInfoClient();
      const all = await info.allMids();
      const p = Number((all as any).SOL || (all as any)["SOL"]);
      if (Number.isFinite(p)) usdPrice = p;
    } catch {}

    return new Response(
      JSON.stringify({
        userId,
        custodialPublicKey: custodialPk || null,
        lamports,
        sol,
        usdPrice,
        usd: usdPrice !== null ? sol * usdPrice : null,
        history,
      }),
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), { status: 500 });
  }
}

