import { NextRequest } from "next/server";

export const runtime = "nodejs";

function getCookie(req: NextRequest, name: string): string | undefined {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map(c => c.trim());
  const target = cookies.find(c => c.startsWith(`${name}=`));
  return target ? target.substring(name.length + 1) : undefined;
}

export async function GET(req: NextRequest) {
  try {
    // Get user from session
    const userId = getCookie(req, "app_session");
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    // Get query parameters for direction
    const url = new URL(req.url);
    const fromToken = url.searchParams.get("from") || "SOL";
    const toToken = url.searchParams.get("to") || "USDC";

    // Define mint addresses
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    
    // Determine input and output mints
    const inputMint = fromToken === "SOL" ? SOL_MINT : USDC_MINT;
    const outputMint = toToken === "SOL" ? SOL_MINT : USDC_MINT;
    
    // Use 1 unit of the input token for rate calculation
    const inputDecimals = fromToken === "SOL" ? 9 : 6;
    const baseAmount = Math.pow(10, inputDecimals); // 1 SOL or 1 USDC

    // Get quote from Jupiter API
    const response = await fetch(
      "https://quote-api.jup.ag/v6/quote?" + new URLSearchParams({
        inputMint: inputMint,
        outputMint: outputMint,
        amount: baseAmount.toString(),
        slippageBps: "50", // 0.5% slippage
      })
    );

    if (!response.ok) {
      throw new Error("Failed to fetch Jupiter quote");
    }

    const quoteData = await response.json();
    
    // Calculate rate
    const inputAmount = parseFloat(quoteData.inAmount) / Math.pow(10, inputDecimals);
    const outputDecimals = toToken === "SOL" ? 9 : 6;
    const outputAmount = parseFloat(quoteData.outAmount) / Math.pow(10, outputDecimals);
    const rate = outputAmount / inputAmount;

    return new Response(JSON.stringify({
      fromToken,
      toToken,
      rate: rate,
      solPrice: fromToken === "SOL" ? rate : 1/rate, // For backwards compatibility
      usdcPrice: 1,
      inputMint: quoteData.inputMint,
      outputMint: quoteData.outputMint,
      priceImpactPct: quoteData.priceImpactPct,
    }), {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });

  } catch (error: any) {
    console.error("Exchange rate error:", error);
    return new Response(JSON.stringify({ 
      error: error.message || "failed_to_get_rate" 
    }), { status: 500 });
  }
}

