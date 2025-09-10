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
    const userId = getCookie(req, "app_session");
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("account_settings")
      .select("pnl_baseline_usd, pnl_baseline_at")
      .eq("user_id", userId)
      .maybeSingle();
    return new Response(JSON.stringify({ baselineUsd: data?.pnl_baseline_usd ?? null, baselineAt: data?.pnl_baseline_at ?? null }), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown' }), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = getCookie(req, "app_session");
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const { baselineUsd } = await req.json();
    if (typeof baselineUsd !== 'number' || !Number.isFinite(baselineUsd)) {
      return new Response(JSON.stringify({ error: 'invalid_baseline' }), { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('account_settings').upsert({ user_id: userId, pnl_baseline_usd: baselineUsd, pnl_baseline_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown' }), { status: 500 });
  }
}

