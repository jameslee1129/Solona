import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function getCookie(req: NextRequest, name: string): string | undefined {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return undefined;
  
  const target = cookieHeader.split("; ").find(row => row.startsWith(`${name}=`));
  return target ? target.substring(name.length + 1) : undefined;
}

export async function GET(req: NextRequest) {
  try {
    // Get user from session
    const userId = getCookie(req, "app_session");
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    // Get user's custodial wallet public key
    const admin = getSupabaseAdmin();
    const { data: custodialWallet, error: walletError } = await admin
      .from("custodial_wallets")
      .select("public_key")
      .eq("user_id", userId)
      .single();

    if (walletError || !custodialWallet) {
      return new Response(JSON.stringify({ error: "no_custodial_wallet" }), { status: 400 });
    }

    // Midlertidig: ikke støtt Hyperliquid her. Returner tom liste.
    return new Response(JSON.stringify({ 
      activeOrders: [],
      totalOrders: 0
    }), { 
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });

  } catch (error: any) {
    console.error("Error fetching active orders:", error);
    return new Response(JSON.stringify({ 
      error: error.message || "failed_to_fetch_active_orders" 
    }), { status: 500 });
  }
}
