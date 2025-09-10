import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import nacl from "tweetnacl";
import bs58 from "bs58";

export const runtime = "nodejs";

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (typeof userId !== 'string' || userId.length < 6) {
      return new Response(JSON.stringify({ error: 'invalid_user' }), { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // If a custodial wallet already exists, return it (idempotent)
    const { data: existing, error: selErr } = await admin
      .from('custodial_wallets')
      .select('public_key, created_at')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (selErr) {
      return new Response(JSON.stringify({ error: selErr.message }), { status: 500 });
    }
    if (existing) {
      return new Response(JSON.stringify({ ok: true, publicKey: existing.public_key, existed: true }), { status: 200 });
    }

    // Create a custodial wallet (ed25519 keypair)
    const seed = randomBytes(32);
    const kp = nacl.sign.keyPair.fromSeed(seed);
    const secretKey = Buffer.from(kp.secretKey).toString('base64');
    const publicKey = bs58.encode(Buffer.from(kp.publicKey));

    const now = new Date().toISOString();

    // Store custodial wallet in `custodial_wallets` with encrypted/encoded secret
    const { error } = await admin.from('custodial_wallets').insert({
      user_id: userId,
      public_key: publicKey,
      secret_key_b64: secretKey,
      created_at: now,
    });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    return new Response(JSON.stringify({ ok: true, publicKey }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown' }), { status: 500 });
  }
}

