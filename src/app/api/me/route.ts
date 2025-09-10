import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
    const [{ data: wallet }, { data: custodials }] = await Promise.all([
      admin.from("wallets").select("address, user_id, last_login_at").eq("user_id", userId).limit(1).single(),
      admin.from("custodial_wallets").select("public_key, created_at").eq("user_id", userId).order("id", { ascending: true }).limit(1),
    ]);

    const custodial = Array.isArray(custodials) && custodials.length > 0 ? custodials[0] : null;

    const body = {
      userId,
      walletAddress: wallet?.address || userId,
      custodialPublicKey: custodial?.public_key || null,
      lastLoginAt: wallet?.last_login_at || null,
      custodialCreatedAt: custodial?.created_at || null,
    };
    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    return new Response(JSON.stringify(body), { status: 200, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), { status: 500 });
  }
}

