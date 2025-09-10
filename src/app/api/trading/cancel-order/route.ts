import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createExchangeClient, getInfoClient } from "@/lib/hyperliquid-server";

export const runtime = "nodejs";

function getCookie(req: NextRequest, name: string): string | undefined {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map(c => c.trim());
  const target = cookies.find(c => c.startsWith(`${name}=`));
  return target ? target.substring(name.length + 1) : undefined;
}

async function getCoinAssetId(coin: string): Promise<number> {
  try {
    const infoClient = getInfoClient();
    const metaAndCtx = await infoClient.metaAndAssetCtxs();
    const universe = metaAndCtx[0]?.universe ?? [];
    const assetId = universe.findIndex((u: any) => u.name === coin);
    return assetId >= 0 ? assetId : 0; // Default to 0 if not found
  } catch (error) {
    console.error("Failed to get asset ID for coin:", coin, error);
    return 0; // Default to 0 (usually BTC)
  }
}

export async function POST(req: NextRequest) {
  try {
    // Get user from session
    const userId = getCookie(req, "app_session");
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    // Parse request body
    const body = await req.json();
    const { coin, oid } = body;

    // Validate required fields
    if (!coin || !oid) {
      return new Response(JSON.stringify({ error: "missing_required_fields" }), { status: 400 });
    }

    // Get user's custodial wallet private key and public key
    const admin = getSupabaseAdmin();
    const { data: custodialWallet, error: walletError } = await admin
      .from("custodial_wallets")
      .select("secret_key_b64, public_key")
      .eq("user_id", userId)
      .single();

    if (walletError || !custodialWallet) {
      return new Response(JSON.stringify({ error: "no_custodial_wallet" }), { status: 400 });
    }

    // Create exchange client with user's private key and wallet address
    const privateKeyBuffer = Buffer.from(custodialWallet.secret_key_b64, 'base64');
    const privateKeyHex = privateKeyBuffer.toString('hex');
    const exchangeClient = createExchangeClient(privateKeyHex, custodialWallet.public_key);

    // Get asset ID for the coin
    const assetId = await getCoinAssetId(coin);

    // Cancel the order using correct format
    const cancelResult = await exchangeClient.cancel({
      cancels: [
        {
          a: assetId, // asset ID
          o: parseInt(oid), // order id
        }
      ],
    });

    return new Response(JSON.stringify({ 
      success: true, 
      result: cancelResult
    }), { 
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });

  } catch (error: any) {
    console.error("Cancel order error:", error);
    return new Response(JSON.stringify({ 
      error: error.message || "cancel_failed" 
    }), { status: 500 });
  }
}
