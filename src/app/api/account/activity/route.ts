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

export async function GET(req: NextRequest) {
  try {
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
    const address = data?.public_key as string | undefined;
    if (!address) return new Response(JSON.stringify({ activity: [] }), { status: 200 });

    const apiKey = process.env.HELIUS_API_KEY || process.env.NEXT_PUBLIC_HELIUS_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: "missing_helius_api_key" }), { status: 500 });

    const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${apiKey}&limit=50`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const txt = await res.text();
      return new Response(JSON.stringify({ error: `helius_${res.status}`, details: txt }), { status: 500 });
    }
    const arr = await res.json();
    const list: Array<{ signature: string; ts: number; solDelta: number; kind: string }>=[];
    for (const tx of Array.isArray(arr) ? arr : []) {
      const sig: string = tx.signature || tx.transactionSignature || tx.sig || "";
      const ts: number = (tx.timestamp ? Number(tx.timestamp) : Date.now()/1000) * 1000;
      let deltaLamports = 0;
      const nativeTransfers = Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : [];
      for (const nt of nativeTransfers) {
        try {
          if (nt.toUserAccount === address) deltaLamports += Number(nt.amount || 0);
          if (nt.fromUserAccount === address) deltaLamports -= Number(nt.amount || 0);
        } catch {}
      }
      const solDelta = deltaLamports / 1e9;
      let kind = "other";
      const t = String(tx.type || tx.transactionType || "").toLowerCase();
      if (solDelta > 0.0000001) kind = "deposit";
      else if (solDelta < -0.0000001) kind = "withdraw";
      else if (t.includes("swap") || t.includes("exchange") || Array.isArray(tx.tokenTransfers) && tx.tokenTransfers.some((tt: any)=>tt.toUserAccount===address)) kind = "buy";
      list.push({ signature: sig, ts, solDelta, kind });
    }
    list.sort((a,b)=>b.ts-a.ts);
    return new Response(JSON.stringify({ address, activity: list }), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), { status: 500 });
  }
}

