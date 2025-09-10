import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { Connection, SystemProgram, Keypair, PublicKey, Transaction, LAMPORTS_PER_SOL, sendAndConfirmRawTransaction } from "@solana/web3.js";

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

export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      return new Response(JSON.stringify({ error: "missing_supabase_env" }), { status: 500 });
    }
    const userId = getCookie(req, "app_session");
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

    const { to, amountSol } = await req.json();
    if (typeof to !== "string" || !to) return new Response(JSON.stringify({ error: "invalid_destination" }), { status: 400 });
    const amount = Number(amountSol);
    if (!Number.isFinite(amount) || amount <= 0) return new Response(JSON.stringify({ error: "invalid_amount" }), { status: 400 });

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("custodial_wallets")
      .select("public_key, secret_key_b64")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    if (!data?.secret_key_b64 || !data.public_key) return new Response(JSON.stringify({ error: "no_custodial_wallet" }), { status: 400 });

    const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
    const conn = new Connection(endpoint, "confirmed");

    let destination: PublicKey;
    try { destination = new PublicKey(to); } catch { return new Response(JSON.stringify({ error: "invalid_destination" }), { status: 400 }); }

    const from = Keypair.fromSecretKey(Buffer.from(data.secret_key_b64, 'base64'));

    const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

    // Check balance
    const balance = await conn.getBalance(from.publicKey);
    if (lamports > balance - 5000) { // naive fee buffer
      return new Response(JSON.stringify({ error: "insufficient_funds", balanceLamports: balance }), { status: 400 });
    }

    const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: destination, lamports });
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: from.publicKey, recentBlockhash: blockhash });
    tx.add(ix);
    tx.sign(from);

    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

    return new Response(JSON.stringify({ ok: true, signature: sig }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), { status: 500 });
  }
}

