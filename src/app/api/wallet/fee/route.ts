import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

export const runtime = "nodejs";

function getCookie(req: NextRequest, name: string): string | undefined {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(/;\s*/);
  for (const p of parts) {
    const [k, ...vals] = p.split("=");
    if (k === name) return decodeURIComponent(vals.join(""));
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  try {
    const userId = getCookie(req, "app_session");
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const { searchParams } = new URL(req.url);
    const toParam = searchParams.get("to");
    const lamportsParam = Number(searchParams.get("lamports") || "1000");

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("custodial_wallets")
      .select("public_key")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    if (!data?.public_key) return new Response(JSON.stringify({ error: "no_wallet" }), { status: 400 });

    const from = new PublicKey(data.public_key);
    const to = new PublicKey(toParam || data.public_key);
    const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
    const conn = new Connection(endpoint, "confirmed");

    const { blockhash } = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash });
    tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: Math.max(1, lamportsParam) }));
    const feeInfo = await conn.getFeeForMessage(tx.compileMessage());
    const feeLamports = feeInfo?.value ?? 5000;
    return new Response(JSON.stringify({ feeLamports }), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), { status: 500 });
  }
}

