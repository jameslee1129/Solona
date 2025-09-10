"use client";

import { useEffect, useState } from "react";
import { getInfoClient } from "@/lib/hyperliquid";
import CoinIcon from "./CoinIcon";
import { useDebouncedToast } from "@/hooks/useDebouncedToast";
 
export type DemoOrder = {
  symbol: string;
  side: "long" | "short";
  type: "market" | "limit";
  sizeUsd: number;
  sizeCoin?: number;
  price?: number;
  leverage: number;
  cross: boolean;
  tpPrice?: number;
  slPrice?: number;
  reduceOnly?: boolean;
  postOnly?: boolean;
  orderRole?: 'entry' | 'tp' | 'sl' | 'trailing';
  groupId?: string;
  trailing?: { mode: 'percent' | 'usd'; value: number } | null;
  ts: number;
};

type Props = {
  symbol: string;
  currentPrice?: number;
  onOrderPlaced?: () => void;
  onTpSlChanged?: (tpPrice?: number, slPrice?: number) => void;
};

export default function TradingPanel({ symbol, currentPrice, onOrderPlaced, onTpSlChanged }: Props) {
  const { showSuccess, showError, showWarning, showLoading } = useDebouncedToast();
  
  const [side, setSide] = useState<"long" | "short">("long");
  const [type, setType] = useState<"market" | "limit">("market");
  const [quantityCoin, setQuantityCoin] = useState<string>("");
  const [orderValueUsdc, setOrderValueUsdc] = useState<string>("");
  const [lastEditedField, setLastEditedField] = useState<'quantity' | 'orderValue'>('quantity');
  const [price, setPrice] = useState<string>("");
  const [leverage, setLeverage] = useState<number>(5);
  const [cross, setCross] = useState<boolean>(true);
  const [maxLev, setMaxLev] = useState<number | null>(null);
  const [initialLev, setInitialLev] = useState<number>(5);
  const [showLeverageSlider, setShowLeverageSlider] = useState<boolean>(false);
  const [protocol, setProtocol] = useState<"hyperliquid" | "drift">("hyperliquid");

  const [showTpSl, setShowTpSl] = useState<boolean>(false);
  const [tp, setTp] = useState<string>("");
  const [sl, setSl] = useState<string>("");

  const [tpMode, setTpMode] = useState<'price' | 'percent'>("price");
  const [slMode, setSlMode] = useState<'price' | 'percent'>("price");
  const [tpDisplayMode, setTpDisplayMode] = useState<'roi' | 'pnl'>("roi");
  const [slDisplayMode, setSlDisplayMode] = useState<'roi' | 'pnl'>("roi");
  const [sizeFocused, setSizeFocused] = useState<boolean>(false);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [quantityErrorMessage, setQuantityErrorMessage] = useState("");
  const [lastWarningShown, setLastWarningShown] = useState<string | null>(null);

  // Order execution options
  const [postOnly, setPostOnly] = useState<boolean>(false);
  const [ioc, setIoc] = useState<boolean>(false);
  const [reduceOnly, setReduceOnly] = useState<boolean>(false);
  
  // Drift account initialization
  const [driftAccountInitialized, setDriftAccountInitialized] = useState<boolean | null>(null);
  const [initializingDrift, setInitializingDrift] = useState<boolean>(false);

  



  // Helper to robustly extract a leverage cap from a ctx object
  function extractMaxLev(ctx: Record<string, unknown> | undefined): number | null {
    if (!ctx || typeof ctx !== "object") return null;
    // Prioritized exact keys
    const direct = [
      (ctx as any).maxLeverage,
      (ctx as any).maxLev,
      (ctx as any).levCap,
      (ctx as any).max_leverage,
    ].find((v) => typeof v === "number" || typeof v === "string");
    const parsedDirect = typeof direct === "string" ? Number(direct) : (direct as number | undefined);
    if (Number.isFinite(parsedDirect) && (parsedDirect as number) > 0) return parsedDirect as number;

    // Heuristic: scan any numeric field that looks like leverage (contains "lev")
    try {
      const candidates: number[] = [];
      for (const [k, v] of Object.entries(ctx)) {
        if (/lev/i.test(k) && (typeof v === "number" || typeof v === "string")) {
          const n = typeof v === "string" ? Number(v) : (v as number);
          if (Number.isFinite(n) && n >= 1 && n <= 200) candidates.push(n);
        }
      }
      if (candidates.length > 0) {
        // Prefer the max that is reasonable
        return Math.max(...candidates);
      }
    } catch {}
    return null;
  }

  function fallbackMaxLev(symbol: string): number {
    const s = (symbol || "").toUpperCase();
    const table: Record<string, number> = {
      BTC: 40,
      ETH: 25,
      SOL: 20,
      HYPE: 10,
      XRP: 20,
    };
    if (table[s]) return table[s];
    // Generic fallback by category
    if (["BNB", "AVAX", "MATIC", "DOT", "UNI", "LINK", "LTC", "AAVE", "MKR", "CRV"].includes(s)) return 20;
    return 10;
  }

  // Fetch max leverage for current symbol from Hyperliquid meta/ctx
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const info = getInfoClient();
        const metaAndCtx = await info.metaAndAssetCtxs();
        const universe: Array<{ name: string }> = metaAndCtx?.[0]?.universe ?? [];
        const ctxs: Array<any> = metaAndCtx?.[1] ?? [];
        const idx = universe.findIndex((u) => u.name === symbol);
        if (idx >= 0) {
          const ctx = ctxs[idx] ?? {};
          const parsed = extractMaxLev(ctx);
          if (active) {
            const capFromApi = Number.isFinite(parsed) && (parsed as number) > 0 ? (parsed as number) : null;
            const cap = capFromApi ?? fallbackMaxLev(symbol);
            setMaxLev(cap);
            setInitialLev((prev) => Math.min(cap, prev));
            setLeverage((prev) => Math.min(prev, cap));
          }
        } else {
          if (active) {
            const cap = fallbackMaxLev(symbol);
            setMaxLev(cap);
            setLeverage((prev) => Math.min(prev, cap));
          }
        }
      } catch {
        if (active) {
          const cap = fallbackMaxLev(symbol);
          setMaxLev(cap);
          setLeverage((prev) => Math.min(prev, cap));
        }
      }
    })();
    return () => { active = false; };
  }, [symbol]);

  // Don't auto-fill price - let user see current price as placeholder

  // Fetch USDC balance
  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const response = await fetch("/api/wallet/balance");
        if (response.ok) {
          const data = await response.json();
          setUsdcBalance(data.usdc || 0);
        }
      } catch (error) {
        // Ignore USDC balance fetch errors
      }
    };

    fetchBalance();
  }, []);

  // Calculate order value in USDC based on coin quantity and price
  const calculateOrderValueFromQuantity = (): string => {
    if (!quantityCoin || !currentPrice) return "0";
    const coinAmount = parseFloat(quantityCoin);
    const effectivePrice = type === "limit" && price ? parseFloat(price) : currentPrice;
    if (!effectivePrice || coinAmount <= 0) return "0";
    
    let orderValue = coinAmount * effectivePrice;
    
    // CRITICAL FIX: Cap order value to what we can actually afford
    if (usdcBalance) {
      const feeRate = type === "limit" ? 0.00025 : 0.0005;
      const maxAffordableOrderValue = usdcBalance / (1 + feeRate) - 0.005; // Small buffer
      orderValue = Math.min(orderValue, maxAffordableOrderValue);
    }
    
    return orderValue.toFixed(2);
  };

  // Calculate coin quantity based on USDC order value and price
  const calculateQuantityFromOrderValue = (): string => {
    if (!orderValueUsdc || !currentPrice) return "0";
    const usdcAmount = parseFloat(orderValueUsdc);
    const effectivePrice = type === "limit" && price ? parseFloat(price) : currentPrice;
    if (!effectivePrice || usdcAmount <= 0) return "0";
    const quantity = usdcAmount / effectivePrice;
    return quantity.toFixed(6);
  };

  // Calculate trading fees (0.025% for maker, 0.05% for taker - using taker for safety)
  const calculateTradingFee = (orderValue: number): number => {
    const feeRate = type === "limit" ? 0.00025 : 0.0005; // 0.025% maker, 0.05% taker
    return orderValue * feeRate;
  };

  // Get maximum coin quantity based on USDC balance and current price
  const getMaxCoinQuantity = (): number => {
    if (!usdcBalance || !currentPrice) return 0;
    const effectivePrice = type === "limit" && price ? parseFloat(price) : currentPrice;
    if (!effectivePrice) return 0;
    
    // CORRECT logic: We need to find max order value such that:
    // orderValue + fee(orderValue) <= balance
    // Since fee = orderValue * feeRate:
    // orderValue + (orderValue * feeRate) <= balance
    // orderValue * (1 + feeRate) <= balance
    // orderValue <= balance / (1 + feeRate)
    
    const feeRate = type === "limit" ? 0.00025 : 0.0005; // 0.025% maker, 0.05% taker
    
    // Calculate theoretical maximum
    const theoreticalMax = usdcBalance / (1 + feeRate);
    
    // Subtract small safety buffer for rounding errors
    const maxOrderValue = Math.max(0, theoreticalMax - 0.005);
    
    return maxOrderValue / effectivePrice;
  };

  // Sync values when one field changes
  useEffect(() => {
    if (lastEditedField === 'quantity') {
      if (quantityCoin && quantityCoin.trim() !== "" && parseFloat(quantityCoin) > 0) {
        const calculatedOrderValue = calculateOrderValueFromQuantity();
        if (calculatedOrderValue !== orderValueUsdc) {
          setOrderValueUsdc(calculatedOrderValue);
        }
      } else if (!quantityCoin || quantityCoin.trim() === "" || parseFloat(quantityCoin || "0") <= 0) {
        // If quantity is cleared/invalid, clear order value too
        setOrderValueUsdc("");
      }
    } else if (lastEditedField === 'orderValue') {
      if (orderValueUsdc && orderValueUsdc.trim() !== "" && parseFloat(orderValueUsdc) > 0) {
        const calculatedQuantity = calculateQuantityFromOrderValue();
        if (calculatedQuantity !== quantityCoin) {
          setQuantityCoin(calculatedQuantity);
        }
      } else if (!orderValueUsdc || orderValueUsdc.trim() === "" || parseFloat(orderValueUsdc || "0") <= 0) {
        // If order value is cleared/invalid, clear quantity too
        setQuantityCoin("");
      }
    }
  }, [quantityCoin, orderValueUsdc, currentPrice, price, type, lastEditedField]);

  // Notify parent when TP/SL values change
  useEffect(() => {
    if (onTpSlChanged) {
      const tpPrice = computeTpPrice();
      const slPrice = computeSlPrice();
      onTpSlChanged(tpPrice, slPrice);
    }
  }, [tp, sl, tpMode, slMode, currentPrice, price, side]);

  // Close leverage slider when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.leverage-slider-container')) {
        setShowLeverageSlider(false);
      }
    };

    if (showLeverageSlider) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showLeverageSlider]);

  // Check for insufficient funds (including fees)
  useEffect(() => {
    const currentOrderValue = orderValueUsdc || "0";
    if (currentOrderValue && parseFloat(currentOrderValue) > 0 && usdcBalance !== null) {
      const amount = parseFloat(currentOrderValue);
      const estimatedFee = calculateTradingFee(amount);
      const totalNeeded = amount + estimatedFee;
      
      if (totalNeeded > usdcBalance) {
        setQuantityErrorMessage("Insufficient funds");
        // Only show warning if it hasn't been shown recently
        const warningKey = "insufficient_usdc_balance";
        if (lastWarningShown !== warningKey) {
          showWarning("Insufficient USDC balance for this order");
          setLastWarningShown(warningKey);
        }
      } else {
        setQuantityErrorMessage("");
        setLastWarningShown(null);
      }
    } else {
      setQuantityErrorMessage("");
    }
  }, [orderValueUsdc, usdcBalance, type]);

  // Clamp helper
  const clampLev = (x: number) => {
    const cap = maxLev ?? 50;
    if (!Number.isFinite(x)) return 1;
    return Math.max(1, Math.min(cap, Math.round(x)));
  };

  function computeTpPrice(): number | undefined {
    if (!currentPrice) return Number(tp) || undefined;
    if (tpMode === 'price') return Number(tp) || undefined;
    const pct = Number(tp);
    if (!Number.isFinite(pct)) return undefined;
    const factor = side === 'long' ? 1 + pct/100 : 1 - pct/100;
    return currentPrice * factor;
  }

  function computeSlPrice(): number | undefined {
    if (!currentPrice) return Number(sl) || undefined;
    if (slMode === 'price') return Number(sl) || undefined;
    const pct = Number(sl);
    if (!Number.isFinite(pct)) return undefined;
    const factor = side === 'long' ? 1 - pct/100 : 1 + pct/100;
    return currentPrice * factor;
  }

  // Calculate ROI for TP/SL
  function calculateTpRoi(): string {
    const tpPrice = computeTpPrice();
    if (!tpPrice || !currentPrice || !leverage) return "0.00";
    const priceChange = side === 'long' ? (tpPrice - currentPrice) / currentPrice : (currentPrice - tpPrice) / currentPrice;
    const roi = priceChange * leverage * 100;
    return roi.toFixed(2);
  }

  function calculateSlRoi(): string {
    const slPrice = computeSlPrice();
    if (!slPrice || !currentPrice || !leverage) return "0.00";
    const priceChange = side === 'long' ? (slPrice - currentPrice) / currentPrice : (currentPrice - slPrice) / currentPrice;
    const roi = priceChange * leverage * 100;
    // SL ROI should always be negative (loss)
    return (-Math.abs(roi)).toFixed(2);
  }

  // Calculate PnL for TP/SL in USDC
  function calculateTpPnl(): string {
    const tpPrice = computeTpPrice();
    if (!tpPrice || !currentPrice || !orderValueUsdc) return "0.00";
    const orderValue = parseFloat(orderValueUsdc);
    if (!orderValue) return "0.00";
    const priceChange = side === 'long' ? (tpPrice - currentPrice) / currentPrice : (currentPrice - tpPrice) / currentPrice;
    const pnl = priceChange * leverage * orderValue;
    return pnl.toFixed(2);
  }

  function calculateSlPnl(): string {
    const slPrice = computeSlPrice();
    if (!slPrice || !currentPrice || !orderValueUsdc) return "0.00";
    const orderValue = parseFloat(orderValueUsdc);
    if (!orderValue) return "0.00";
    const priceChange = side === 'long' ? (slPrice - currentPrice) / currentPrice : (currentPrice - slPrice) / currentPrice;
    const pnl = priceChange * leverage * orderValue;
    // SL PnL should always be negative (loss)
    return (-Math.abs(pnl)).toFixed(2);
  }

  // Validate numeric input (only numbers and one decimal point)
  function isValidNumericInput(value: string): boolean {
    // Allow empty string, numbers, and one decimal point
    return /^(\d*\.?\d*)$/.test(value);
  }

  // Handle numeric input change with validation
  function handleNumericInputChange(value: string, setter: (value: string) => void): void {
    if (isValidNumericInput(value)) {
      setter(value);
    }
  }

  // Check if order is valid for submission
  function isValidOrder(): boolean {
    const hasValidQuantity = Boolean(quantityCoin && quantityCoin.trim() !== "" && parseFloat(quantityCoin) > 0);
    const hasValidOrderValue = Boolean(orderValueUsdc && orderValueUsdc.trim() !== "" && parseFloat(orderValueUsdc) > 0);
    
    // Must have at least one valid value
    return hasValidQuantity && hasValidOrderValue;
  }

  // Initialize Drift account
  async function initializeDriftAccount() {
    setInitializingDrift(true);
    try {
      const response = await fetch("/api/trading/drift-init-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();

      if (response.ok) {
        setDriftAccountInitialized(true);
        alert("Drift account initialized successfully! You can now place orders.");
      } else {
        throw new Error(result.details || result.error || "Failed to initialize Drift account");
      }
    } catch (error: any) {
      alert(`Failed to initialize Drift account: ${error.message}`);
    } finally {
      setInitializingDrift(false);
    }
  }

  // Check Drift account status when protocol changes
  useEffect(() => {
    if (protocol === "drift") {
      // Reset status when switching to Drift
      setDriftAccountInitialized(null);
    }
  }, [protocol]);

  async function submit() {
    // Validate input fields
    if (!quantityCoin && !orderValueUsdc) {
      showError("Please enter either a coin quantity or USDC amount");
      return;
    }

    if (quantityCoin && parseFloat(quantityCoin) <= 0) {
      showError("Please enter a valid coin quantity");
      return;
    }

    if (orderValueUsdc && parseFloat(orderValueUsdc) <= 0) {
      showError("Please enter a valid USDC amount");
      return;
    }

    if (quantityErrorMessage) {
      showError("Insufficient USDC balance");
      return;
    }

    if (type === "limit" && (!price || Number(price) <= 0)) {
      showError("Please enter a valid price for limit order");
      return;
    }

    // Use current values (both should be synced)
    const quantityNum = parseFloat(quantityCoin || "0");
    const orderValueNum = parseFloat(orderValueUsdc || "0");

    if (quantityNum <= 0 || orderValueNum <= 0) {
      showError("Invalid quantities - missing price data");
      return;
    }

    const tpPrice = computeTpPrice();
    const slPrice = computeSlPrice();

    try {
      // Prepare order data with all options
      const orderData = {
        symbol: symbol,
        side: side,
        type: type,
        sizeUsd: orderValueNum, // Send USDC amount
        sizeCoin: quantityNum, // Send coin quantity
        price: type === "limit" ? price : undefined,
        leverage: leverage,
        cross: cross,
        tpPrice: tpPrice?.toString(),
        slPrice: slPrice?.toString(),
        reduceOnly: reduceOnly,
        postOnly: postOnly,
        ioc: ioc,
      };

      // Choose API endpoint based on protocol
      const apiEndpoint = protocol === "drift" 
        ? "/api/trading/drift-place-order"
        : "/api/trading/place-order";

      // Place the order via appropriate API
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderData),
      });

      const result = await response.json();

      if (!response.ok) {
        // Enhanced error handling based on the common issues from the image
        let errorMessage = result.message || result.error || "Failed to place order";
        
        // Map specific error codes to user-friendly messages
        switch (result.error) {
          case "drift_connection_failed":
          case "connection_failed":
            errorMessage = "Connection failed. Please check your internet connection and try again.";
            break;
          case "insufficient_collateral":
          case "insufficient_funds":
            errorMessage = "Insufficient funds for this order. Please check your balance.";
            break;
          case "oracle_price_unavailable":
          case "oracle_data_error":
            errorMessage = "Price data unavailable. Please try again in a moment.";
            break;
          case "user_account_not_initialized":
            errorMessage = "Account not initialized. Please initialize your Drift account first.";
            setDriftAccountInitialized(false);
            break;
          case "invalid_market_index":
            errorMessage = `Market not supported for ${symbol}. Please try a different symbol.`;
            break;
          case "slippage_error":
            errorMessage = "Order would exceed slippage tolerance. Please adjust your order.";
            break;
          case "unauthorized":
            errorMessage = "Please log in to place orders.";
            break;
          case "missing_required_fields":
            errorMessage = result.message || "Please fill in all required fields.";
            break;
          case "price_required_for_limit_order":
            errorMessage = result.message || "Price is required for limit orders.";
            break;
          default:
            if (result.details) {
              errorMessage = `${errorMessage}: ${result.details}`;
            }
        }
        
        throw new Error(errorMessage);
      }

      // Success notification
      const leverageMode = cross ? "cross" : "isolated";
      const protocolName = protocol === "drift" ? "Drift" : "Hyperliquid";
      const action = `${side.toUpperCase()} ${quantityCoin} ${symbol} ($${orderValueUsdc})${type === "limit" ? ` @ ${price}` : " (Market)"} | ${leverageMode} x${leverage}`;
      
      let successMessage = `Order placed successfully on ${protocolName}: ${symbol}-PERP`;
      if (result.txSignature) {
        successMessage += ` (Tx: ${result.txSignature.slice(0, 8)}...)`;
      }
      
      showSuccess(successMessage);

      // Clear form
      setQuantityCoin("");
      setOrderValueUsdc("");
      setPrice("");
      setTp("");
      setSl("");

      // Trigger refresh of real data
      if (onOrderPlaced) {
        onOrderPlaced();
      }

    } catch (error: any) {
      // Enhanced error display with protocol context
      const protocolName = protocol === "drift" ? "Drift" : "Hyperliquid";
      showError(`Failed to place order on ${protocolName}: ${error.message}`);
    }
  }

  return (
    <div className="h-full flex flex-col space-y-4 p-4">
      {/* Protocol Selector */}
      <div className="space-y-2">
        <span className="text-xs text-white/50 uppercase tracking-wider">Protocol</span>
        <div className="flex gap-2">
          <button
            className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
              protocol === "hyperliquid" 
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-black text-white/50 border-gray-600 hover:bg-gray-900"
            }`}
            onClick={() => setProtocol("hyperliquid")}
          >
            Hyperliquid
          </button>
          <button
            className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
              protocol === "drift" 
                ? "bg-purple-500 text-white border-purple-500"
                : "bg-black text-white/50 border-gray-600 hover:bg-gray-900"
            }`}
            onClick={() => setProtocol("drift")}
          >
            Drift
          </button>
        </div>
      </div>

      {/* Long/Short Tabs */}
      <div className="flex gap-2">
        <button
          className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
            side === "long" 
              ? "bg-emerald-500 text-white border-emerald-500"
              : "bg-black text-white/50 border-gray-600 hover:bg-gray-900"
          }`}
          onClick={() => setSide("long")}
        >
          Long
        </button>
        <button
          className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
            side === "short" 
              ? "bg-rose-500 text-white border-rose-500"
              : "bg-black text-white/50 border-gray-600 hover:bg-gray-900"
          }`}
          onClick={() => setSide("short")}
        >
          Short
        </button>
      </div>

      {/* Order Type Tabs and Leverage */}
      <div className="flex justify-between items-center">
        <div className="flex gap-4 text-sm">
          <button
            className={`px-0 py-2 font-medium border-b-2 ${
              type === "limit"
                ? "text-white border-white"
                : "text-white/50 border-transparent hover:text-white/70"
            }`}
            onClick={() => setType("limit")}
          >
            Limit
          </button>
          <button
            className={`px-0 py-2 font-medium border-b-2 ${
              type === "market"
                ? "text-white border-white"
                : "text-white/50 border-transparent hover:text-white/70"
            }`}
            onClick={() => setType("market")}
          >
            Market
          </button>
        </div>

        {/* Leverage Button */}
        <div className="relative leverage-slider-container">
          <button
            onClick={() => setShowLeverageSlider(!showLeverageSlider)}
            className="bg-black border border-gray-600 rounded-lg px-3 py-1 text-white text-sm font-medium outline-none hover:border-gray-500 focus:border-white transition-colors"
          >
            {leverage}x
          </button>

          {/* Leverage Slider Popup */}
          {showLeverageSlider && (
            <>
              {/* Backdrop */}
              <div 
                className="fixed inset-0 bg-black/20 z-40"
                onClick={() => setShowLeverageSlider(false)}
              />
              
              {/* Slider Panel */}
              <div className="absolute right-0 top-full mt-2 w-56 bg-black border border-gray-600 rounded-lg p-4 z-50 shadow-xl">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50 uppercase tracking-wider font-medium">Leverage</span>
                    <span className="text-sm font-bold text-white">{leverage}x</span>
                  </div>
                  
                  {/* Slider */}
                  <div className="space-y-2">
                    <div className="relative px-1">
                      <input
                        type="range"
                        min="1"
                        max={Math.min(maxLev || 10, 50)}
                        value={leverage}
                        onChange={(e) => setLeverage(Number(e.target.value))}
                        className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer focus:outline-none"
                      />
                    </div>
                    
                    {/* Range Labels */}
                    <div className="flex justify-between px-1">
                      <span className="text-xs text-white/50">1x</span>
                      <span className="text-xs text-white/50">{Math.min(maxLev || 10, 50)}x</span>
                    </div>
                    
                    {/* Max Leverage Info */}
                    <div className="text-xs text-white/50 text-center pt-1">
                      Max: {Math.min(maxLev || 10, 50)}x for {symbol}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Available Equity */}
      <div className="flex justify-between items-center">
        <span className="text-xs text-white/50 uppercase tracking-wider">Available Equity</span>
        <span className="text-sm font-medium text-white">${usdcBalance?.toFixed(2) || "0.00"}</span>
      </div>

      {/* Price */}
      {type === "limit" && (
        <div className="space-y-2">
          <span className="text-xs text-white/50 uppercase tracking-wider">Price</span>
          <div className="relative">
            <input
              value={price}
              onChange={(e) => handleNumericInputChange(e.target.value, setPrice)}
              placeholder={currentPrice ? `${currentPrice.toFixed(2)}` : "0.00"}
              className="w-full bg-black border border-gray-600 rounded-lg px-4 py-2 text-white text-sm font-medium outline-none focus:border-white placeholder-gray-400"
            />
            <button className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white text-sm">
              $
            </button>
          </div>
        </div>
      )}

      {/* Quantity (Coin Input) */}
      <div className="space-y-2">
        <span className="text-xs text-white/50 uppercase tracking-wider">Quantity</span>
        <div className="relative">
          <input
            value={quantityCoin}
            onChange={(e) => {
              handleNumericInputChange(e.target.value, setQuantityCoin);
              setLastEditedField('quantity');
            }}
            placeholder="0.000000"
            className="w-full bg-black border border-gray-600 rounded-lg px-4 py-2 text-white text-sm font-medium outline-none focus:border-white placeholder-gray-400"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <CoinIcon symbol={symbol} size={24} />
          </div>
        </div>
        
        {/* Percentage Slider */}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-sm text-white/50">0</span>
          <div className="flex-1 relative">
            <input
              type="range"
              min="0"
              max="100"
              value={quantityCoin && getMaxCoinQuantity() > 0 ? Math.min(100, (parseFloat(quantityCoin) / getMaxCoinQuantity()) * 100) : 0}
              onChange={(e) => {
                const percentage = parseFloat(e.target.value);
                const maxQuantity = getMaxCoinQuantity();
                const newQuantity = (maxQuantity * percentage / 100).toFixed(6);
                setQuantityCoin(newQuantity);
                setLastEditedField('quantity');
              }}
              className="w-full h-2 bg-black border border-gray-600 rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <span className="text-sm text-white/50">100%</span>
        </div>
      </div>

      {/* Order Value (USDC Input) */}
      <div className="space-y-2">
        <span className="text-xs text-white/50 uppercase tracking-wider">Order Value</span>
        <div className="relative">
          <input
            value={orderValueUsdc}
            onChange={(e) => {
              handleNumericInputChange(e.target.value, setOrderValueUsdc);
              setLastEditedField('orderValue');
            }}
            placeholder="0"
            className="w-full bg-black border border-gray-600 rounded-lg px-4 py-2 text-white text-sm font-medium outline-none focus:border-white"
          />
          <button className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white text-sm">
            $
          </button>
        </div>
        
        {/* Error Message */}
        {quantityErrorMessage && (
          <div className="text-red-400 text-xs">
            {quantityErrorMessage}
          </div>
        )}
      </div>



      {/* Margin Required & Est. Liquidation Price */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="text-xs text-white/50 uppercase tracking-wider">Margin Required</span>
          <span className="text-sm font-medium text-white">
            {orderValueUsdc && parseFloat(orderValueUsdc) > 0 && leverage ? `$${(parseFloat(orderValueUsdc) / leverage).toFixed(2)}` : "-"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-white/50 uppercase tracking-wider">Est. Liquidation Price</span>
          <span className="text-sm font-medium text-white">
            {orderValueUsdc && parseFloat(orderValueUsdc) > 0 && currentPrice && leverage ? 
              `$${(currentPrice * (side === "long" ? (1 - 0.9/leverage) : (1 + 0.9/leverage))).toFixed(2)}` : 
              "-"
            }
          </span>
        </div>
      </div>

      {/* TP/SL Section */}
      {showTpSl && (
        <div className="space-y-4">
          {/* TP Trigger Price */}
          <div className="space-y-2">
            <div className="text-xs text-white/50 uppercase tracking-wider font-medium">T/P Trigger Price</div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between min-h-[20px]">
                  <div className="flex items-center gap-1">
                    <select className="bg-transparent border-none text-white/50 text-sm focus:outline-none">
                      <option>Mark</option>
                    </select>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-white/50">
                      <path d="M7 10l5 5 5-5z"/>
                    </svg>
                  </div>
                </div>
                <div className="relative">
                  <input
                    value={tpMode === 'price' ? tp : ''}
                    onChange={(e) => {
                      handleNumericInputChange(e.target.value, setTp);
                      setTpMode('price');
                    }}
                    placeholder="0"
                    className="w-full bg-black border border-gray-600 rounded-lg px-4 py-2 text-white text-sm font-medium outline-none focus:border-white"
                  />
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white text-sm">
                    $
                  </button>
                </div>
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between min-h-[20px]">
                  <div className="flex items-center gap-1">
                    <span className="text-white/50 text-sm">{tpDisplayMode === 'roi' ? 'ROI' : 'PnL'}</span>
                    <button
                      onClick={() => setTpDisplayMode(tpDisplayMode === 'roi' ? 'pnl' : 'roi')}
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6.99 11L3 15L6.99 19V16H14V14H6.99V11ZM21 9L17.01 5V8H10V10H17.01V13L21 9Z"/>
                      </svg>
                    </button>
                  </div>
                  <span className="text-white text-sm">
                    {tpDisplayMode === 'roi' ? '' : ''}
                  </span>
                </div>
                <div className="relative">
                  <input
                    value={tpMode === 'percent' ? tp : ''}
                    onChange={(e) => {
                      handleNumericInputChange(e.target.value, setTp);
                      setTpMode('percent');
                    }}
                    placeholder="0"
                    className="w-full bg-black border border-gray-600 rounded-lg px-4 py-2 text-white text-sm font-medium outline-none focus:border-white"
                  />
                  {tpDisplayMode === 'roi' ? (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 text-sm">
                      %
                    </span>
                  ) : (
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white text-sm">
                      $
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* SL Trigger Price */}
          <div className="space-y-2">
            <div className="text-xs text-white/50 uppercase tracking-wider font-medium">S/L Trigger Price</div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between min-h-[20px]">
                  <div className="flex items-center gap-1">
                    <select className="bg-transparent border-none text-white/50 text-sm focus:outline-none">
                      <option>Mark</option>
                    </select>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-white/50">
                      <path d="M7 10l5 5 5-5z"/>
                    </svg>
                  </div>
                </div>
                <div className="relative">
                  <input
                    value={slMode === 'price' ? sl : ''}
                    onChange={(e) => {
                      handleNumericInputChange(e.target.value, setSl);
                      setSlMode('price');
                    }}
                    placeholder="0"
                    className="w-full bg-black border border-gray-600 rounded-lg px-4 py-2 text-white text-sm font-medium outline-none focus:border-white"
                  />
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white text-sm">
                    $
                  </button>
                </div>
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between min-h-[20px]">
                  <div className="flex items-center gap-1">
                    <span className="text-white/50 text-sm">{slDisplayMode === 'roi' ? 'ROI' : 'PnL'}</span>
                    <button
                      onClick={() => setSlDisplayMode(slDisplayMode === 'roi' ? 'pnl' : 'roi')}
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6.99 11L3 15L6.99 19V16H14V14H6.99V11ZM21 9L17.01 5V8H10V10H17.01V13L21 9Z"/>
                      </svg>
                    </button>
                  </div>
                  <span className="text-white text-sm">
                    {slDisplayMode === 'roi' ? '' : ''}
                  </span>
                </div>
                <div className="relative">
                  <input
                    value={slMode === 'percent' ? sl : ''}
                    onChange={(e) => {
                      handleNumericInputChange(e.target.value, setSl);
                      setSlMode('percent');
                    }}
                    placeholder="0"
                    className="w-full bg-black border border-gray-600 rounded-lg px-4 py-2 text-white text-sm font-medium outline-none focus:border-white"
                  />
                  {slDisplayMode === 'roi' ? (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 text-sm">
                      %
                    </span>
                  ) : (
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white text-sm">
                      $
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Checkboxes */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        {type === "limit" && (
          <>
            <div className="relative group">
              <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={postOnly}
                  onChange={(e) => setPostOnly(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-transparent text-gray-300 focus:ring-0 focus:ring-offset-0 checked:bg-gray-600 checked:border-gray-600 accent-gray-400" 
                />
                Post Only
              </label>
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black border border-gray-600 text-white text-xs font-medium rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none whitespace-nowrap z-50">
                Only maker orders - won't fill immediately
              </div>
            </div>
            <div className="relative group">
              <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={ioc}
                  onChange={(e) => setIoc(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-transparent text-gray-300 focus:ring-0 focus:ring-offset-0 checked:bg-gray-600 checked:border-gray-600 accent-gray-400" 
                />
                IOC
              </label>
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black border border-gray-600 text-white text-xs font-medium rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none whitespace-nowrap z-50">
                Fill immediately or cancel the order
              </div>
            </div>
          </>
        )}
        <div className="relative group">
          <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer">
            <input 
              type="checkbox" 
              checked={reduceOnly}
              onChange={(e) => setReduceOnly(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-transparent text-gray-300 focus:ring-0 focus:ring-offset-0 checked:bg-gray-600 checked:border-gray-600 accent-gray-400" 
            />
            Reduce Only
          </label>
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black border border-gray-600 text-white text-xs font-medium rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none whitespace-nowrap z-50">
            Only reduces existing position size
          </div>
        </div>
        <div className="relative group">
          <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer">
            <input 
              type="checkbox" 
              checked={showTpSl}
              onChange={(e) => setShowTpSl(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-transparent text-gray-300 focus:ring-0 focus:ring-offset-0 checked:bg-gray-600 checked:border-gray-600 accent-gray-400" 
            />
            TP/SL
          </label>
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black border border-gray-600 text-white text-xs font-medium rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none whitespace-nowrap z-50">
            Set automatic profit & loss exit levels
          </div>
        </div>
      </div>

      {/* Drift Account Initialization */}
      {protocol === "drift" && driftAccountInitialized === false && (
        <div className="space-y-2 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
          <div className="text-sm text-white/80">
            Initialize your Drift account to start trading
          </div>
          <button
            onClick={initializeDriftAccount}
            disabled={initializingDrift}
            className="w-full py-2 px-4 bg-purple-500 text-white font-medium rounded-lg transition-colors hover:bg-purple-600 disabled:bg-gray-700 disabled:text-white/50 disabled:cursor-not-allowed"
          >
            {initializingDrift ? "Initializing..." : "Initialize Drift Account"}
          </button>
        </div>
      )}


      {/* Action Buttons - Always at bottom */}
      <div className="space-y-3 mt-auto pt-4">
        <button 
          onClick={submit}
          disabled={!!quantityErrorMessage || !isValidOrder() || (protocol === "drift" && driftAccountInitialized === false)}
          className={`w-full py-2 font-medium rounded-lg transition-colors ${
            (quantityErrorMessage || !isValidOrder() || (protocol === "drift" && driftAccountInitialized === false))
              ? "bg-gray-700 text-white/50 cursor-not-allowed" 
              : side === "long" 
                ? "bg-emerald-500 text-white hover:bg-emerald-600" 
                : "bg-rose-500 text-white hover:bg-rose-600"
          }`}
        >
          {protocol === "drift" && driftAccountInitialized === false 
            ? "Initialize Drift Account First"
            : side === "long" ? "Long" : "Short"
          }
        </button>
      </div>


    </div>
  );
}

