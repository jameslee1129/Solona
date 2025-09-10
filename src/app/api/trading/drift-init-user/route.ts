import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createDriftClient, initializeDriftUser, closeDriftClient } from "@/lib/drift-client";

export const runtime = "nodejs";

function getCookie(req: NextRequest, name: string): string | undefined {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map(c => c.trim());
  const target = cookies.find(c => c.startsWith(`${name}=`));
  return target ? target.substring(name.length + 1) : undefined;
}

export async function POST(req: NextRequest) {
  let driftClient: any = null;
  
  try {
    // Get user from session
    const userId = getCookie(req, "app_session");
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    // Get user's custodial wallet private key
    const admin = getSupabaseAdmin();
    const { data: custodialWallet, error: walletError } = await admin
      .from("custodial_wallets")
      .select("secret_key_b64, public_key, drift_subaccount, drift_user_pda")
      .eq("user_id", userId)
      .single();

    if (walletError || !custodialWallet) {
      return new Response(JSON.stringify({ error: "no_custodial_wallet" }), { status: 400 });
    }

    // Create Drift client
    try {
      driftClient = await createDriftClient(custodialWallet.secret_key_b64);
    } catch (connectionError: any) {
      console.error("Drift connection error:", connectionError);
      return new Response(JSON.stringify({ 
        error: "drift_connection_failed",
        details: connectionError.message 
      }), { status: 500 });
    }

    // Finn/fastsett subaccount (bruk eksisterende, ellers 1 for å unngå ev. kollisjon på 0)
    const chosenSub = Number.isInteger(custodialWallet.drift_subaccount)
      ? Number(custodialWallet.drift_subaccount)
      : Number(process.env.DRIFT_SUBACCOUNT_ID ?? '1');

    // Initialiser (idempotent) – metoden håndterer "allerede opprettet"
    try {
      const sub = await initializeDriftUser(driftClient, chosenSub);
      // Deriver PDA etter vellykket init (bruk faktisk sub som ble brukt)
      const userPda = await driftClient.getUserAccountPublicKey(sub);
      // Persistér valg i Supabase om ikke satt fra før / eller pda mangler
      if (custodialWallet.drift_subaccount == null || !custodialWallet.drift_user_pda) {
        const { error: upErr } = await admin
          .from('custodial_wallets')
          .update({
            drift_subaccount: sub,
            drift_user_pda: userPda.toBase58(),
          })
          .eq('user_id', userId);
        if (upErr) {
          console.error('Supabase update failed:', upErr);
          return new Response(JSON.stringify({
            error: 'supabase_update_failed',
            details: upErr.message,
          }), { status: 500 });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: "User account is initialized",
        userAccount: custodialWallet.public_key,
        drift_subaccount: sub,
        drift_user_pda: (await driftClient.getUserAccountPublicKey(sub)).toBase58(),
      }), { status: 200 });
    } catch (initError: any) {
      console.error("Drift user initialization error:", initError);
      return new Response(JSON.stringify({
        error: "user_initialization_failed",
        details: initError.message
      }), { status: 500 });
    }

  } catch (error: any) {
    console.error("Drift initialization error:", error);
    return new Response(JSON.stringify({ 
      error: "drift_init_failed",
      details: error.message 
    }), { status: 500 });
  } finally {
    // Always clean up the client connection
    if (driftClient) {
      try {
        await closeDriftClient(driftClient);
      } catch (cleanupError) {
        console.error("Error cleaning up Drift client:", cleanupError);
      }
    }
  }
}
