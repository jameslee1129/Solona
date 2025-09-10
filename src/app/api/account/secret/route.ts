import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import bs58 from "bs58";

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

export const fetchprivateKey = async (userId: string) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
        .from('custodial_wallets')
        .select('secret_key_b64')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();
    
    if (error) {
      console.error('Error fetching private key:', error);
      return null;
    }
    
    if (data?.secret_key_b64) {
      try {
        // Decode base64 to bytes
        const binary = Buffer.from(data.secret_key_b64, 'base64');
        
        // Convert to base58
        const base58Key = bs58.encode(binary);
        
        // Output the base58 encoded private key
        console.log('=== fetchprivateKey Function Output ===');
        console.log('User ID:', userId);
        console.log('Original Base64:', data.secret_key_b64);
        console.log('Encoded Base58:', base58Key);
        console.log('Base58 Length:', base58Key.length);
    
        
        return base58Key;
      } catch (encodeError) {
        console.error('Error encoding to Base58:', encodeError);
        console.log('Original Base64 (fallback):', data.secret_key_b64);
        return { base64: data.secret_key_b64, base58: null };
      }
    }
    
    console.log('No secret_key_b64 found for user:', userId);
    return null;
  } catch (e: any) {
    console.error('Exception in fetchprivateKey:', e?.message || 'unknown');
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = getCookie(req, "app_session");
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('custodial_wallets')
      .select('secret_key_b64')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();

    
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    if (!data?.secret_key_b64) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    
    // Encode base64 to base58 and output
    try {
      const binary = Buffer.from(data.secret_key_b64, 'base64');
      const base58Key = bs58.encode(binary);
      
      console.log('=== GET /api/account/secret Output ===');
      console.log('User ID:', userId);
      console.log('Original Base64:', data.secret_key_b64);
      console.log('Encoded Base58:', base58Key);
      console.log('Base58 Length:', base58Key.length);
      console.log('=====================================');
      
      return new Response(JSON.stringify({ 
        secretKeyB64: data.secret_key_b64,
        secretKeyB58: base58Key 
      }), { status: 200, headers: { "Cache-Control": "no-store" } });
    } catch (encodeError) {
      console.error('Error encoding to Base58 in GET:', encodeError);
      console.log('Original Base64 (fallback):', data.secret_key_b64);
      return new Response(JSON.stringify({ 
        secretKeyB64: data.secret_key_b64,
        secretKeyB58: null 
      }), { status: 200, headers: { "Cache-Control": "no-store" } });
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown' }), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = getCookie(req, "app_session");
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const { passcode } = await req.json();
    if (typeof passcode !== 'string' || passcode.length < 4) {
      return new Response(JSON.stringify({ error: 'invalid_passcode' }), { status: 400 });
    }
    if (process.env.PRIVATE_KEY_VIEW_PASS && passcode !== process.env.PRIVATE_KEY_VIEW_PASS) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    }
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('custodial_wallets')
      .select('secret_key_b64')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    if (!data?.secret_key_b64) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    return new Response(JSON.stringify({ secretKeyB64: data.secret_key_b64 }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown' }), { status: 500 });
  }
}

