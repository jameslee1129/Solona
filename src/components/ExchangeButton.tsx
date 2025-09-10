"use client";

import { useState, useEffect } from "react";
import { useDebouncedToast } from "@/hooks/useDebouncedToast";

type ExchangeRate = {
  fromToken: string;
  toToken: string;
  solPrice: number;
  usdcPrice: number;
  rate: number;
};

type SwapDirection = "SOL_TO_USDC" | "USDC_TO_SOL";

export default function ExchangeButton() {
  const { showSuccess, showError, showWarning } = useDebouncedToast();
  
  const [isOpen, setIsOpen] = useState(false);
  const [solAmount, setSolAmount] = useState("");
  const [usdcAmount, setUsdcAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [loading, setLoading] = useState(false);
  const [balances, setBalances] = useState<{ sol: number; usdc: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeInput, setActiveInput] = useState<"sol" | "usdc">("sol");
  const [swapDirection, setSwapDirection] = useState<SwapDirection>("SOL_TO_USDC");

  // Fetch exchange rate and balances
  const fetchData = async () => {
    try {
      const fromToken = swapDirection === "SOL_TO_USDC" ? "SOL" : "USDC";
      const toToken = swapDirection === "SOL_TO_USDC" ? "USDC" : "SOL";
      
      const [rateResponse, balanceResponse] = await Promise.all([
        fetch(`/api/exchange/rate?from=${fromToken}&to=${toToken}`),
        fetch("/api/wallet/balance")
      ]);

      if (rateResponse.ok) {
        const rateData = await rateResponse.json();
        setExchangeRate(rateData);
      }

      if (balanceResponse.ok) {
        const balanceData = await balanceResponse.json();
        setBalances({
          sol: balanceData.sol || 0,
          usdc: balanceData.usdc || 0
        });
      }
    } catch (error) {
      // Failed to fetch exchange data
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, swapDirection]);

  // Update amounts based on active input and swap direction
  useEffect(() => {
    if (!exchangeRate) return;
    
    if (swapDirection === "SOL_TO_USDC") {
      if (activeInput === "sol" && solAmount) {
        const usdc = parseFloat(solAmount) * exchangeRate.rate;
        setUsdcAmount(usdc.toFixed(6));
      } else if (activeInput === "usdc" && usdcAmount) {
        const sol = parseFloat(usdcAmount) / exchangeRate.rate;
        setSolAmount(sol.toFixed(6));
      }
    } else {
      // USDC_TO_SOL
      if (activeInput === "usdc" && usdcAmount) {
        const sol = parseFloat(usdcAmount) * exchangeRate.rate;
        setSolAmount(sol.toFixed(6));
      } else if (activeInput === "sol" && solAmount) {
        const usdc = parseFloat(solAmount) / exchangeRate.rate;
        setUsdcAmount(usdc.toFixed(6));
      }
    }
  }, [solAmount, usdcAmount, exchangeRate, activeInput, swapDirection]);

  // Check for insufficient funds
  useEffect(() => {
    if (!balances) {
      setErrorMessage("");
      return;
    }

    if (swapDirection === "SOL_TO_USDC") {
      if (solAmount) {
        const amount = parseFloat(solAmount);
        if (amount > balances.sol) {
          setErrorMessage("Insufficient SOL balance");
          showWarning("Insufficient SOL balance for this swap");
        } else {
          setErrorMessage("");
        }
      } else {
        setErrorMessage("");
      }
    } else {
      // USDC_TO_SOL
      if (usdcAmount) {
        const amount = parseFloat(usdcAmount);
        if (amount > balances.usdc) {
          setErrorMessage("Insufficient USDC balance");
          showWarning("Insufficient USDC balance for this swap");
        } else {
          setErrorMessage("");
        }
      } else {
        setErrorMessage("");
      }
    }
  }, [solAmount, usdcAmount, balances, swapDirection]);

  const handleExchange = async () => {
    const solValue = parseFloat(solAmount) || 0;
    const usdcValue = parseFloat(usdcAmount) || 0;
    
    let fromToken: string, toToken: string, amount: number, inputAmount: string;
    
    if (swapDirection === "SOL_TO_USDC") {
      if (solValue <= 0) {
        showError("Please enter a valid SOL amount");
        return;
      }
      if (!balances || solValue > balances.sol) {
        showError("Insufficient SOL balance");
        return;
      }
      fromToken = "SOL";
      toToken = "USDC";
      amount = solValue;
      inputAmount = solAmount;
    } else {
      // USDC_TO_SOL
      if (usdcValue <= 0) {
        showError("Please enter a valid USDC amount");
        return;
      }
      if (!balances || usdcValue > balances.usdc) {
        showError("Insufficient USDC balance");
        return;
      }
      fromToken = "USDC";
      toToken = "SOL";
      amount = usdcValue;
      inputAmount = usdcAmount;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/exchange/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromToken,
          toToken,
          amount,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        showSuccess(`${inputAmount} ${fromToken} → ${result.outputAmount.toFixed(6)} ${toToken}`);
        setSolAmount("");
        setUsdcAmount("");
        await fetchData(); // Refresh balances
      } else {
        showError(`Exchange failed: ${result.error}`);
      }
    } catch (error: any) {
      showError(`Exchange failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const setMaxSol = () => {
    if (balances) {
      // Keep a small amount for transaction fees
      const maxAmount = Math.max(0, balances.sol - 0.01);
      setSolAmount(maxAmount.toFixed(6));
      setActiveInput("sol");
    }
  };

  const setMaxUsdc = () => {
    if (balances) {
      setUsdcAmount(balances.usdc.toFixed(6));
      setActiveInput("usdc");
    }
  };

  const toggleSwapDirection = () => {
    setSwapDirection(prev => prev === "SOL_TO_USDC" ? "USDC_TO_SOL" : "SOL_TO_USDC");
    // Clear amounts when switching direction
    setSolAmount("");
    setUsdcAmount("");
    setErrorMessage("");
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="px-3 h-9 text-sm bg-white/5 hover:bg-white/10 rounded-md border border-white/15 text-white/80 inline-flex items-center justify-center"
      >
        Exchange
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setIsOpen(false)}>
      <div className="bg-black rounded-xl p-6 w-full max-w-md border border-white/20" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">
            Exchange {swapDirection === "SOL_TO_USDC" ? "SOL → USDC" : "USDC → SOL"}
          </h2>
          <button
            onClick={() => setIsOpen(false)}
            className="text-white/60 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {/* Balances */}
        {balances && (
          <div className="mb-6 grid grid-cols-2 gap-3">
            <div className="p-3 bg-white/5 rounded-md border border-white/10">
              <div className="text-xs text-white/60 mb-1">SOL Balance</div>
              <div className="text-sm text-white font-medium">
                {balances.sol.toFixed(4)} SOL
              </div>
            </div>
            <div className="p-3 bg-white/5 rounded-md border border-white/10">
              <div className="text-xs text-white/60 mb-1">USDC Balance</div>
              <div className="text-sm text-white font-medium">
                {balances.usdc.toFixed(2)} USDC
              </div>
            </div>
          </div>
        )}

        {/* Exchange Form */}
        <div className="space-y-2">
          {/* From */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-white/60">
                From ({swapDirection === "SOL_TO_USDC" ? "SOL" : "USDC"})
              </label>
              <button
                onClick={swapDirection === "SOL_TO_USDC" ? setMaxSol : setMaxUsdc}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
              >
                Max
              </button>
            </div>
            <div className="relative">
              <input
                type="number"
                value={swapDirection === "SOL_TO_USDC" ? solAmount : usdcAmount}
                onChange={(e) => {
                  if (swapDirection === "SOL_TO_USDC") {
                    setActiveInput("sol");
                    setSolAmount(e.target.value);
                  } else {
                    setActiveInput("usdc");
                    setUsdcAmount(e.target.value);
                  }
                }}
                onFocus={() => setActiveInput(swapDirection === "SOL_TO_USDC" ? "sol" : "usdc")}
                placeholder="0.0"
                className={`w-full bg-white/5 border rounded-md px-3 py-3 text-white text-sm pr-16 focus:outline-none focus:ring-2 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield] ${
                  errorMessage ? 
                    'border-red-500/50 focus:ring-red-500/50 focus:border-red-500/50' : 
                    'border-white/10 focus:ring-white/20'
                }`}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 text-xs font-medium">
                {swapDirection === "SOL_TO_USDC" ? "SOL" : "USDC"}
              </div>
            </div>
            <div className="mt-1 h-4 text-xs text-red-400">
              {errorMessage}
            </div>
          </div>

          {/* Swap Direction Toggle */}
          <div className="flex justify-center">
            <button
              onClick={toggleSwapDirection}
              className="w-10 h-10 bg-white/10 hover:bg-white/15 rounded-full border border-white/20 text-white transition-colors flex items-center justify-center"
              title={`Switch to ${swapDirection === "SOL_TO_USDC" ? "USDC → SOL" : "SOL → USDC"}`}
            >
              <span className="text-lg">⇅</span>
            </button>
          </div>

          {/* To */}
          <div>
            <label className="text-sm text-white/60 mb-2 block">
              To ({swapDirection === "SOL_TO_USDC" ? "USDC" : "SOL"})
            </label>
            <div className="relative">
              <input
                type="number"
                value={swapDirection === "SOL_TO_USDC" ? usdcAmount : solAmount}
                onChange={(e) => {
                  if (swapDirection === "SOL_TO_USDC") {
                    setActiveInput("usdc");
                    setUsdcAmount(e.target.value);
                  } else {
                    setActiveInput("sol");
                    setSolAmount(e.target.value);
                  }
                }}
                onFocus={() => setActiveInput(swapDirection === "SOL_TO_USDC" ? "usdc" : "sol")}
                placeholder="0.0"
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-3 text-white text-sm pr-16 focus:outline-none focus:ring-2 focus:ring-white/20 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 text-xs font-medium">
                {swapDirection === "SOL_TO_USDC" ? "USDC" : "SOL"}
              </div>
            </div>
          </div>
        </div>

        {/* Exchange Button */}
        <button
          onClick={handleExchange}
          disabled={
            loading || 
            !!errorMessage ||
            (swapDirection === "SOL_TO_USDC" ? (!solAmount || parseFloat(solAmount) <= 0) : (!usdcAmount || parseFloat(usdcAmount) <= 0))
          }
          className="w-full mt-6 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-white/10 disabled:cursor-not-allowed disabled:text-white/40 rounded-md text-white font-medium text-sm transition-colors"
        >
          {loading ? "Exchanging..." : "Exchange"}
        </button>
      </div>
    </div>
      )}
    </>
  );
}
