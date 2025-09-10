import { NextRequest } from "next/server";
import bs58 from "bs58";
import nacl from "tweetnacl";
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

export async function POST(req: NextRequest) {

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      return new Response(JSON.stringify({ error: "missing_supabase_env" }), { status: 500 });
    }
    const { address, signature, message } = await req.json();

    if (typeof address !== "string" || typeof signature !== "string" || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "invalid_payload" }), { status: 400 });
    }

    // Validate nonce from cookie is inside message
    const nonce = getCookie(req, "login_nonce");
    if (!nonce || !message.includes(nonce)) {
      return new Response(JSON.stringify({ error: "invalid_nonce" }), { status: 400 });
    }

    // Verify signature (Solana Ed25519)
    const pubkeyBytes = bs58.decode(address);
    const sigBytes = bs58.decode(signature);
    const msgBytes = new TextEncoder().encode(message);
    const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
    if (!ok) return new Response(JSON.stringify({ error: "bad_signature" }), { status: 401 });

    // Upsert user + wallet
    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();

    /////
  

    // Ensure user row exists in `users` table with user_id = address for simplicity
    const { error: userErr } = await admin.from("users").upsert(
      { id: address, created_at: now },
      { onConflict: "id" }
    );
    if (userErr && !userErr.message.includes("duplicate")) {
      const msg = userErr.message || "users_table_error";
      return new Response(JSON.stringify({ error: msg }), { status: 500 });
    }

    const { error: walletErr } = await admin.from("wallets").upsert(
      { address, user_id: address, last_login_at: now },
      { onConflict: "address" }
    );
    if (walletErr) {
      const msg = walletErr.message || "wallets_table_error";
      return new Response(JSON.stringify({ error: msg }), { status: 500 });
    }

    // Issue a simple session cookie (JWT can be added later)
    const headers = new Headers();
    headers.append("Set-Cookie", `app_session=${encodeURIComponent(address)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    headers.append("Set-Cookie", `login_nonce=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

    return new Response(JSON.stringify({ ok: true, userId: address }), { status: 200, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), { status: 500 });
  }
}

