import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";


export async function POST(req: NextRequest) {
  console.log( "upsert route =>>>>>>>>>>>>>>>>" , req.json());

  try {
    const { address } = await req.json();
    
    if (typeof address !== "string" || address.length < 6) {
      return new Response(JSON.stringify({ error: "invalid address" }), { status: 400 });
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      return new Response(JSON.stringify({ error: "missing_supabase_env" }), { status: 500 });
    }
    const admin = getSupabaseAdmin();
    // Minimal path: write to wallets(address) table
    const { error } = await admin.from("wallets").upsert({ address });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), { status: 500 });
  }
}

