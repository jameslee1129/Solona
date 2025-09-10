import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { 
  createDriftClient, 
  calculateOrderParams, 
  placeDriftOrder, 
  closeDriftClient,
  convertSizeToBaseAssetAmount,
  convertPriceToDrift,
  initializeDriftUser
} from "@/lib/drift-client";
import { BN } from '@drift-labs/sdk';

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

    // Parse request body
    const body = await req.json();
    const { symbol, side, type, sizeUsd, sizeCoin, price, leverage, cross, reduceOnly, postOnly, ioc } = body;

    // Validate required fields
    if (!symbol || !side || !type || (!sizeUsd && !sizeCoin)) {
      return new Response(JSON.stringify({ error: "missing_required_fields" }), { status: 400 });
    }

    if (!["long", "short"].includes(side)) {
      return new Response(JSON.stringify({ error: "invalid_side" }), { status: 400 });
    }

    if (!["market", "limit"].includes(type)) {
      return new Response(JSON.stringify({ error: "invalid_type" }), { status: 400 });
    }

    if (type === "limit" && !price) {
      return new Response(JSON.stringify({ error: "price_required_for_limit_order" }), { status: 400 });
    }

    // Get user's custodial wallet private key
    const admin = getSupabaseAdmin();
    const { data: custodialWallet, error: walletError } = await admin
      .from("custodial_wallets")
      .select("secret_key_b64, public_key, drift_subaccount")
      .eq("user_id", userId)
      .single();

    if (walletError || !custodialWallet) {
      return new Response(JSON.stringify({ error: "no_custodial_wallet" }), { status: 400 });
    }

    // Create Drift client with proper connection handling
    try {
      driftClient = await createDriftClient(custodialWallet.secret_key_b64);
    } catch (connectionError: any) {
      console.error("Drift connection error:", connectionError);
      return new Response(JSON.stringify({ 
        error: "drift_connection_failed",
        details: connectionError.message 
      }), { status: 500 });
    }

    // Finn lagret subaccount
    const sub = Number.isInteger(custodialWallet.drift_subaccount)
      ? Number(custodialWallet.drift_subaccount)
      : Number(process.env.DRIFT_SUBACCOUNT_ID ?? '1');

    // Sørg for at valgt subaccount er initialisert og lastet i klienten
    try {
      await initializeDriftUser(driftClient, sub);
    } catch (e: any) {
      return new Response(JSON.stringify({
        error: "drift_user_missing",
        details: `Failed to initialize/load Drift user on subaccount ${sub}: ${e.message}`
      }), { status: 500 });
    }

    // Calculate order size and price
    const orderSizeUsd = sizeUsd || sizeCoin * (price || 0);
    if (!orderSizeUsd || orderSizeUsd <= 0) {
      return new Response(JSON.stringify({ error: "invalid_order_size" }), { status: 400 });
    }

    // For markedsordrer trenger vi ikke hente orakelpris via subscribed data
    // La orderPrice være brukerinput for limit; for market holder vi den undefined
    let orderPrice = type === "limit" ? price : undefined;

    // Convert order parameters to Drift format
    const baseAssetAmount = convertSizeToBaseAssetAmount(orderSizeUsd, orderPrice);
    const driftPrice = type === "limit" ? convertPriceToDrift(orderPrice) : new BN(0);

    // Hopper over collateral-validering uten subscribet brukerdata

    // Create order parameters
    const orderParams = calculateOrderParams(
      symbol,
      side,
      type,
      baseAssetAmount,
      driftPrice,
      reduceOnly || false,
      postOnly || false,
      ioc || false
    );

    // Validate order parameters
    if (!orderParams.marketIndex && orderParams.marketIndex !== 0) {
      return new Response(JSON.stringify({ 
        error: "invalid_market_index",
        details: `Market not found for symbol: ${symbol}` 
      }), { status: 400 });
    }

    // Place the order with proper error handling
    let txSignature: string;
    try {
      txSignature = await placeDriftOrder(driftClient, orderParams);
    } catch (orderError: any) {
      console.error("Order placement error:", orderError);
      
      // Handle specific Drift errors
      if (orderError.message.includes("slippage")) {
        return new Response(JSON.stringify({ 
          error: "slippage_error",
          details: "Order would exceed slippage tolerance" 
        }), { status: 400 });
      } else if (orderError.message.includes("oracle")) {
        return new Response(JSON.stringify({ 
          error: "oracle_error",
          details: "Oracle price feed unavailable" 
        }), { status: 500 });
      } else if (orderError.message.includes("insufficient")) {
        return new Response(JSON.stringify({ 
          error: "insufficient_funds",
          details: "Insufficient funds for order" 
        }), { status: 400 });
      } else {
        return new Response(JSON.stringify({ 
          error: "order_placement_failed",
          details: orderError.message 
        }), { status: 500 });
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      txSignature,
      orderParams: {
        symbol,
        side,
        type,
        sizeUsd: orderSizeUsd,
        price: orderPrice,
        marketIndex: orderParams.marketIndex
      }
    }), { 
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });

  } catch (error: any) {
    console.error("Drift trading error:", error);
    
    // Handle different types of errors
    if (error.message.includes("connection")) {
      return new Response(JSON.stringify({ 
        error: "connection_failed",
        details: "Failed to connect to Solana network" 
      }), { status: 503 });
    } else if (error.message.includes("wallet")) {
      return new Response(JSON.stringify({ 
        error: "wallet_error",
        details: "Wallet initialization failed" 
      }), { status: 400 });
    } else {
      return new Response(JSON.stringify({ 
        error: "drift_trading_failed",
        details: error.message 
      }), { status: 500 });
    }
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
