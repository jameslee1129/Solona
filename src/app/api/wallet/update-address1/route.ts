import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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

export async function POST(req: NextRequest) {
  try {
    const userId = getCookie(req, "app_session");
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

    const { address1 } = await req.json();
    
    if (typeof address1 !== "string" || address1.length < 6) {
      return new Response(JSON.stringify({ error: "invalid address1" }), { status: 400 });
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      return new Response(JSON.stringify({ error: "missing_supabase_env" }), { status: 500 });
    }

    const admin = getSupabaseAdmin();
    
    // Update the address_1 column for the user's wallet
    const { error } = await admin
      .from("wallets")
      .update({ address_1: address1 })
      .eq("user_id", userId);

    if (error) {
      console.error('Error updating address_1:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    console.log('Successfully updated address_1 for user:', userId);
    console.log('New address_1 value:', address1);

    return new Response(JSON.stringify({ ok: true, address1 }), { status: 200 });
  } catch (e: any) {
    console.error('Exception in update-address1:', e?.message || 'unknown');
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), { status: 500 });
  }
}
