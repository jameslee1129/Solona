import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

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
    const { data, error } = await admin
      .from("custodial_wallets")
      .select("public_key")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    if (!data?.public_key) return new Response(JSON.stringify({ lamports: 0, sol: 0 }), { status: 200 });

    const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
    const conn = new Connection(endpoint, "confirmed");
    
    // Get SOL balance
    const lamports = await conn.getBalance(new PublicKey(data.public_key));
    const sol = lamports / LAMPORTS_PER_SOL;

    // Get USDC balance
    let usdc = 0;
    try {
      const usdcMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
      const usdcTokenAccount = await getAssociatedTokenAddress(usdcMint, new PublicKey(data.public_key));
      const usdcAccountInfo = await conn.getTokenAccountBalance(usdcTokenAccount);
      if (usdcAccountInfo.value) {
        usdc = parseFloat(usdcAccountInfo.value.amount) / 1e6; // USDC has 6 decimals
      }
    } catch (error) {
      // Token account might not exist yet, which is fine
      // USDC token account not found or error (this is normal)
    }

    return new Response(JSON.stringify({ 
      lamports, 
      sol, 
      usdc,
      publicKey: data.public_key 
    }), { 
      status: 200, 
      headers: { "Cache-Control": "no-store" } 
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), { status: 500 });
  }
}

