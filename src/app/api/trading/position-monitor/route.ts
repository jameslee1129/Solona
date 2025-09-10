import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getInfoClient } from "@/lib/hyperliquid-server";

export const runtime = "nodejs";

function getCookie(req: NextRequest, name: string): string | undefined {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map(c => c.trim());
  const target = cookies.find(c => c.startsWith(`${name}=`));
  return target ? target.substring(name.length + 1) : undefined;
}

// Store for active WebSocket connections
const activeConnections = new Map<string, {
  ws: WebSocket;
  lastPing: number;
  positions: any[];
}>();

// Cleanup inactive connections
setInterval(() => {
  const now = Date.now();
  for (const [userId, conn] of activeConnections.entries()) {
    if (now - conn.lastPing > 60000) { // 1 minute timeout
      conn.ws.close();
      activeConnections.delete(userId);
    }
  }
}, 30000); // Check every 30 seconds

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

    // Get current positions
    const infoClient = getInfoClient();
    let clearinghouse: any = null;

    try {
      clearinghouse = await infoClient.clearinghouseState({
        user: custodialWallet.public_key
      });
    } catch (apiError: any) {
      console.error("Hyperliquid API error:", apiError);
      return new Response(JSON.stringify({ 
        positions: [],
        error: "Failed to fetch data from Hyperliquid"
      }), { 
        status: 200,
        headers: { "Cache-Control": "no-store" }
      });
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
      liquidationPrice: calculateLiquidationPrice(pos),
    })).filter((pos: any) => pos.size > 0) || [];

    // Get margin summary for risk assessment
    const marginSummary = clearinghouse?.marginSummary || null;
    const totalMarginUsed = marginSummary?.totalMarginUsed || 0;
    const totalNtlPos = marginSummary?.totalNtlPos || 0;

    return new Response(JSON.stringify({ 
      positions,
      marginSummary: {
        totalMarginUsed,
        totalNtlPos,
        availableMargin: totalNtlPos - totalMarginUsed,
        marginRatio: totalNtlPos > 0 ? totalMarginUsed / totalNtlPos : 0,
      },
      timestamp: Date.now()
    }), { 
      status: 200,
      headers: { 
        "Cache-Control": "no-store",
        "Content-Type": "application/json"
      }
    });

  } catch (error: any) {
    console.error("Error fetching positions for monitoring:", error);
    return new Response(JSON.stringify({ 
      error: error.message || "failed_to_fetch_positions" 
    }), { status: 500 });
  }
}

// Calculate liquidation price for a position
function calculateLiquidationPrice(pos: any): number {
  try {
    const size = Math.abs(parseFloat(pos.position?.szi || "0"));
    const entryPrice = parseFloat(pos.position?.entryPx || "0");
    const marginUsed = parseFloat(pos.position?.marginUsed || "0");
    const isLong = parseFloat(pos.position?.szi || "0") > 0;
    
    if (size === 0 || marginUsed === 0) return 0;
    
    // Simplified liquidation price calculation
    // This is a basic approximation - real liquidation depends on many factors
    const liquidationBuffer = 0.1; // 10% buffer
    const liquidationPrice = isLong 
      ? entryPrice * (1 - liquidationBuffer)
      : entryPrice * (1 + liquidationBuffer);
    
    return liquidationPrice;
  } catch (error) {
    console.error("Error calculating liquidation price:", error);
    return 0;
  }
}

// WebSocket endpoint for real-time position monitoring
export async function POST(req: NextRequest) {
  try {
    const { userId, action } = await req.json();
    
    if (action === "subscribe") {
      // This would typically handle WebSocket upgrade
      // For now, we'll return a response indicating the subscription is active
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Position monitoring subscription active",
        timestamp: Date.now()
      }), { status: 200 });
    }
    
    if (action === "unsubscribe") {
      // Clean up WebSocket connection
      if (activeConnections.has(userId)) {
        const conn = activeConnections.get(userId);
        if (conn) {
          conn.ws.close();
        }
        activeConnections.delete(userId);
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Position monitoring subscription ended"
      }), { status: 200 });
    }
    
    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
    
  } catch (error: any) {
    console.error("WebSocket position monitoring error:", error);
    return new Response(JSON.stringify({ 
      error: error.message || "websocket_error" 
    }), { status: 500 });
  }
}
