import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";

export const runtime = "nodejs";

function getCookie(req: NextRequest, name: string): string | undefined {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map(c => c.trim());
  const target = cookies.find(c => c.startsWith(`${name}=`));
  return target ? target.substring(name.length + 1) : undefined;
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
    const { fromToken, toToken, amount } = body;

    // Validate required fields
    if (!fromToken || !toToken || !amount) {
      return new Response(JSON.stringify({ error: "missing_required_fields" }), { status: 400 });
    }

    // Validate supported token pairs
    const supportedPairs = [
      { from: "SOL", to: "USDC" },
      { from: "USDC", to: "SOL" }
    ];
    
    const isValidPair = supportedPairs.some(pair => 
      pair.from === fromToken && pair.to === toToken
    );
    
    if (!isValidPair) {
      return new Response(JSON.stringify({ error: "unsupported_token_pair" }), { status: 400 });
    }

    if (amount <= 0) {
      return new Response(JSON.stringify({ error: "invalid_amount" }), { status: 400 });
    }

    // Get user's custodial wallet
    const admin = getSupabaseAdmin();
    const { data: custodialWallet, error: walletError } = await admin
      .from("custodial_wallets")
      .select("secret_key_b64, public_key")
      .eq("user_id", userId)
      .single();

    if (walletError || !custodialWallet) {
      return new Response(JSON.stringify({ error: "no_custodial_wallet" }), { status: 400 });
    }

    // Define mint addresses
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    
    // Determine input and output mints based on token pair
    const inputMint = fromToken === "SOL" ? SOL_MINT : USDC_MINT;
    const outputMint = toToken === "SOL" ? SOL_MINT : USDC_MINT;
    
    // Convert amount to appropriate decimals (SOL has 9 decimals, USDC has 6)
    const inputDecimals = fromToken === "SOL" ? 9 : 6;
    const amountInSmallestUnit = Math.floor(amount * Math.pow(10, inputDecimals));

    // Get quote from Jupiter
    const quoteResponse = await fetch(
      "https://quote-api.jup.ag/v6/quote?" + new URLSearchParams({
        inputMint: inputMint,
        outputMint: outputMint,
        amount: amountInSmallestUnit.toString(),
        slippageBps: "100", // 1% slippage tolerance
      })
    );

    if (!quoteResponse.ok) {
      throw new Error("Failed to get Jupiter quote");
    }

    const quoteData = await quoteResponse.json();

    // Get swap transaction from Jupiter
    const swapResponse = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey: custodialWallet.public_key,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 1000000, // 0.001 SOL priority fee
      }),
    });

    if (!swapResponse.ok) {
      throw new Error("Failed to get swap transaction");
    }

    const { swapTransaction } = await swapResponse.json();

    // Create connection to Solana
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
    );

    // Create keypair from private key
    const privateKeyBuffer = Buffer.from(custodialWallet.secret_key_b64, 'base64');
    const keypair = Keypair.fromSecretKey(privateKeyBuffer);

    // Deserialize and sign transaction
    const transactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuf);
    transaction.sign([keypair]);

    // Send transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, "confirmed");

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${confirmation.value.err}`);
    }

    // Calculate output amount for response (convert from smallest unit to human readable)
    const outputDecimals = toToken === "SOL" ? 9 : 6;
    const outputAmount = parseFloat(quoteData.outAmount) / Math.pow(10, outputDecimals);

    return new Response(JSON.stringify({
      success: true,
      signature: signature,
      inputAmount: amount,
      outputAmount: outputAmount,
      inputToken: fromToken,
      outputToken: toToken,
    }), {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });

  } catch (error: any) {
    console.error("Exchange swap error:", error);
    return new Response(JSON.stringify({ 
      error: error.message || "swap_failed" 
    }), { status: 500 });
  }
}

