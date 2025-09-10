import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getInfoClient } from "@/lib/hyperliquid-server";

export const runtime = "nodejs";

// Simple rate limiting to prevent too many API calls
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_CALLS = 20; // Max 20 calls per minute per user (increased from 10)

function getCookie(req: NextRequest, name: string): string | undefined {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map(c => c.trim());
  const target = cookies.find(c => c.startsWith(`${name}=`));
  return target ? target.substring(name.length + 1) : undefined;
}

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);
  
  if (!userLimit || now > userLimit.resetTime) {
    // Reset or initialize rate limit
    rateLimitMap.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (userLimit.count >= RATE_LIMIT_MAX_CALLS) {
    return false; // Rate limited
  }
  
  userLimit.count++;
  return true;
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
      // Return empty positions for users without custodial wallets (normal for new users)
      return new Response(JSON.stringify({ 
        positions: [],
        openOrders: [],
        marginSummary: null,
        error: "no_custodial_wallet",
        message: "No custodial wallet found. Complete onboarding to start trading."
      }), { 
        status: 200, // Changed to 200 since this is not really an error
        headers: { "Cache-Control": "no-store" }
      });
    }

    // Check rate limit
    if (!checkRateLimit(userId)) {
      console.log("Rate limit exceeded for user:", userId);
      return new Response(JSON.stringify({ 
        positions: [],
        openOrders: [],
        marginSummary: null,
        error: "Rate limit exceeded",
        details: "Too many requests. Please wait before trying again."
      }), { 
        status: 429,
        headers: { "Cache-Control": "no-store" }
      });
    }

    // Validate the public key format
    if (!custodialWallet.public_key || typeof custodialWallet.public_key !== 'string') {
      console.error("Invalid public key format:", custodialWallet.public_key);
      return new Response(JSON.stringify({ 
        positions: [],
        openOrders: [],
        marginSummary: null,
        error: "Invalid wallet public key format"
      }), { status: 400 });
    }

    // Check if the public key is a valid EVM address for Hyperliquid
    const evmAddressRegex = /^0x[0-9a-fA-F]{40}$/;
    let userAddress = custodialWallet.public_key;
    
    // If it doesn't start with 0x, add it
    if (!userAddress.startsWith('0x')) {
      userAddress = `0x${userAddress}`;
    }
    
    // Validate that it's a proper EVM address
    if (!evmAddressRegex.test(userAddress)) {
      console.error("Invalid EVM address format for Hyperliquid:", userAddress);
      console.log("This appears to be a Solana public key, but Hyperliquid requires an EVM address");
      
      // Return empty positions instead of error to prevent frontend crashes
      return new Response(JSON.stringify({ 
        positions: [],
        openOrders: [],
        marginSummary: null,
        error: "Invalid Hyperliquid wallet address",
        details: "The stored public key is not a valid EVM address. Hyperliquid requires an EVM-compatible address (0x followed by 40 hexadecimal characters)."
      }), { 
        status: 200, // Return 200 to prevent frontend error
        headers: { "Cache-Control": "no-store" }
      });
    }

    // Get positions from Hyperliquid
    const infoClient = getInfoClient();
    let clearinghouse: any = null;

    console.log("Fetching positions for user:", userAddress);

    try {
      // Try the primary API call first
      // The clearinghouseState method expects an object with user property
      clearinghouse = await infoClient.clearinghouseState({
        user: userAddress as `0x${string}`
      });
      console.log("Successfully fetched clearinghouse state");
    } catch (apiError: any) {
      console.error("Hyperliquid API error:", apiError);
      
      // Handle different types of errors gracefully
      if (apiError.message && apiError.message.includes('422')) {
        console.log("User may not exist on Hyperliquid - returning empty positions");
        clearinghouse = { assetPositions: [], openOrders: [], marginSummary: null };
      } else if (apiError.message && apiError.message.includes('429')) {
        console.log("Rate limited - returning empty positions to avoid further rate limiting");
        clearinghouse = { assetPositions: [], openOrders: [], marginSummary: null };
      } else {
        // Try a direct fetch as fallback for other API errors
        try {
          console.log("Attempting direct API call as fallback");
          
          const fallbackResponse = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'perpsvc-trading-platform/1.0.0'
            },
            body: JSON.stringify({
              type: 'clearinghouseState',
              user: userAddress
            })
          });
          
          if (fallbackResponse.ok) {
            const fallbackData = await fallbackResponse.json();
            clearinghouse = fallbackData;
            console.log("Fallback API call successful");
          } else {
            // Log the response details for debugging
            const responseText = await fallbackResponse.text();
            console.error("Fallback API failed:", {
              status: fallbackResponse.status,
              statusText: fallbackResponse.statusText,
              responseText: responseText
            });
            
            // Handle specific error cases
            if (fallbackResponse.status === 422) {
              console.log("User may not exist on Hyperliquid - returning empty positions");
              clearinghouse = { assetPositions: [], openOrders: [], marginSummary: null };
            } else if (fallbackResponse.status === 429) {
              console.log("Rate limited - returning empty positions to avoid further rate limiting");
              clearinghouse = { assetPositions: [], openOrders: [], marginSummary: null };
            } else {
              // For other errors, return empty data instead of throwing
              console.log("API error - returning empty positions");
              clearinghouse = { assetPositions: [], openOrders: [], marginSummary: null };
            }
          }
        } catch (fallbackError) {
          console.error("Fallback API also failed:", fallbackError);
          
          // Return empty data instead of error to prevent frontend crashes
          clearinghouse = { assetPositions: [], openOrders: [], marginSummary: null };
        }
      }
    }

    // Format positions data
    const positions = clearinghouse?.assetPositions?.map((pos: any) => ({
      coin: pos.position?.coin || "UNKNOWN",
      side: parseFloat(pos.position?.szi || "0") > 0 ? "long" : "short",
      size: Math.abs(parseFloat(pos.position?.szi || "0")),
      entryPrice: parseFloat(pos.position?.entryPx || "0"),
      unrealizedPnl: parseFloat(pos.position?.unrealizedPnl || "0"),
      leverage: parseFloat(pos.leverage?.value || "1"),
      marginUsed: parseFloat(pos.position?.marginUsed || "0"),
      maxLeverage: parseFloat(pos.leverage?.rawUsd || "1"),
    })).filter((pos: any) => pos.size > 0) || [];

    // Get open orders
    const openOrders = clearinghouse?.openOrders?.map((order: any) => ({
      oid: order.oid || "",
      coin: order.coin || "UNKNOWN",
      side: order.side || "B",
      limitPx: parseFloat(order.limitPx || "0"),
      sz: parseFloat(order.sz || "0"),
      timestamp: order.timestamp || Date.now(),
      reduceOnly: order.reduceOnly || false,
    })) || [];

    return new Response(JSON.stringify({ 
      positions,
      openOrders,
      marginSummary: clearinghouse?.marginSummary || null
    }), { 
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });

  } catch (error: any) {
    console.error("Error fetching positions:", error);
    return new Response(JSON.stringify({ 
      error: error.message || "failed_to_fetch_positions" 
    }), { status: 500 });
  }
}
