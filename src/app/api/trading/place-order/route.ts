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
    const { symbol, side, type, sizeUsd, sizeCoin, price, leverage, cross, tpPrice, slPrice, reduceOnly, postOnly, ioc } = body;

    // Validate required fields
    if (!symbol || !side || !type || (!sizeUsd && !sizeCoin)) {
      return new Response(JSON.stringify({ 
        error: "missing_required_fields",
        message: "Please fill in all required fields (symbol, side, type, and size)"
      }), { status: 400 });
    }

    if (!["long", "short"].includes(side)) {
      return new Response(JSON.stringify({ 
        error: "invalid_side",
        message: "Side must be either 'long' or 'short'"
      }), { status: 400 });
    }

    if (!["market", "limit"].includes(type)) {
      return new Response(JSON.stringify({ 
        error: "invalid_type",
        message: "Order type must be either 'market' or 'limit'"
      }), { status: 400 });
    }

    if (type === "limit" && !price) {
      return new Response(JSON.stringify({ 
        error: "price_required_for_limit_order",
        message: "Price is required for limit orders"
      }), { status: 400 });
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
    const coinSymbol = symbol.replace('-PERP', ''); // Remove -PERP suffix if present
    const assetId = await getCoinAssetId(coinSymbol);

    // Use sizeCoin if provided, otherwise use sizeUsd (this should be converted by frontend)
    const orderSize = sizeCoin || sizeUsd;

    // Determine order type with execution options
    let orderType: any;
    if (type === "market") {
      orderType = { market: {} };
    } else {
      // Limit order with execution options
      if (postOnly && ioc) {
        return new Response(JSON.stringify({ error: "Cannot use both Post Only and IOC" }), { status: 400 });
      }
      
      if (postOnly) {
        orderType = { limit: { tif: "Alo" } }; // Add Liquidity Only (Post Only)
      } else if (ioc) {
        orderType = { limit: { tif: "Ioc" } }; // Immediate or Cancel
      } else {
        orderType = { limit: { tif: "Gtc" } }; // Good Till Cancel (default)
      }
    }

    // Prepare order data
    const orderData: any = {
      coin: coinSymbol,
      assetId: assetId,
      is_buy: side === "long",
      sz: parseFloat(orderSize.toString()),
      limit_px: type === "limit" ? parseFloat(price) : undefined,
      order_type: orderType,
      reduce_only: reduceOnly || false,
    };

    // Set leverage if provided
    if (leverage && leverage !== 1) {
      await exchangeClient.updateLeverage({
        asset: assetId,
        isCross: cross !== false,
        leverage: leverage,
      });
    }

    // Place the main order using correct format
    const orderResult = await exchangeClient.order({
      orders: [
        {
          a: assetId, // asset ID
          b: orderData.is_buy, // is_buy
          p: orderData.limit_px?.toString() || "0", // price
          s: orderData.sz.toString(), // size
          r: orderData.reduce_only, // reduce_only
          t: orderData.order_type, // order_type
        }
      ],
      grouping: "na",
    });

    // Handle TP/SL orders if provided
    const additionalOrders = [];
    
    if (tpPrice) {
      try {
        const tpResult = await exchangeClient.order({
          orders: [
            {
              a: assetId, // asset ID
              b: !orderData.is_buy, // opposite direction for TP
              p: parseFloat(tpPrice).toString(), // price
              s: orderData.sz.toString(), // size
              r: true, // reduce_only
              t: { limit: { tif: "Gtc" } }, // order_type
            }
          ],
          grouping: "na",
        });
        additionalOrders.push({ type: "take_profit", result: tpResult });
      } catch (tpError) {
        console.error("Failed to place TP order:", tpError);
      }
    }

    if (slPrice) {
      try {
        const slResult = await exchangeClient.order({
          orders: [
            {
              a: assetId, // asset ID
              b: !orderData.is_buy, // opposite direction for SL
              p: parseFloat(slPrice).toString(), // price
              s: orderData.sz.toString(), // size
              r: true, // reduce_only
              t: { limit: { tif: "Gtc" } }, // order_type
            }
          ],
          grouping: "na",
        });
        additionalOrders.push({ type: "stop_loss", result: slResult });
      } catch (slError) {
        console.error("Failed to place SL order:", slError);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      mainOrder: orderResult,
      additionalOrders: additionalOrders
    }), { 
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });

  } catch (error: any) {
    console.error("Trading error:", error);
    return new Response(JSON.stringify({ 
      error: error.message || "trading_failed" 
    }), { status: 500 });
  }
}
