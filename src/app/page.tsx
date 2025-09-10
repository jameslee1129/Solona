"use client";

import PerpsPanel from "@/components/PerpsPanel";
// import VoiceChat from "@/components/VoiceChat";
// import SymbolSearch from "@/components/SymbolSearch";
import IntroModal, { type IntroSlide } from "@/components/IntroModal";
import AccountBadge from "@/components/AccountBadge";
import CustodialSummary from "@/components/CustodialSummary";
import DepositButton from "@/components/DepositButton";
import ExchangeButton from "@/components/ExchangeButton";
import PositionNotifications from "@/components/PositionNotifications";
// import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { useState, useEffect } from "react";

export default function Home() {
  

  const [symbol, setSymbol] = useState("BTC");
  const [userId, setUserId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Get user ID from session
  useEffect(() => {
    setMounted(true);
    const fetchUserId = async () => {
      try {
        const response = await fetch('/api/me');
        if (response.ok) {
          const data = await response.json();
          setUserId(data.userId);
        }
      } catch (error) {
        console.error('Error fetching user ID:', error);
      }
    };
    fetchUserId();
  }, []);

  const slides: IntroSlide[] = [
    {
      title: "Hyperliquid Perps",
      description:
        "Trade with a sleek, high‑tech interface. Ultra‑dark theme, crisp typography, built for speed.",
      mediaSrc: "/window.svg",
      mediaAlt: "App preview",
    },
    {
      title: "Blazing Symbol Search",
      description:
        "Find pairs instantly with fuzzy search and keyboard nav. Type, hit Enter, you're there.",
      mediaSrc: "/globe.svg",
      mediaAlt: "Search",
    },
    {
      title: "Precision Charts",
      description:
        "Fast candles with smooth zoom and pan. Clean overlays. Zero distractions.",
      mediaSrc: "/file.svg",
      mediaAlt: "Charts",
    },
    {
      title: "Voice Assistant",
      description:
        "Ask for market context hands‑free. Quick insights while you focus on execution.",
      mediaSrc: "/vercel.svg",
      mediaAlt: "Voice",
    },
  ];
  // Prevent hydration mismatch by not rendering components that depend on client-side state
  if (!mounted) {
    return (
      <div className="min-h-screen w-full bg-black">
        <div className="w-full px-4 md:px-6 lg:px-8 xl:px-10 py-8">
          <header className="flex items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-4 w-full">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">TradeTalk</h1>
                <p className="text-gray-300 text-sm">Hyperliquid Perps - New generation of COD lobbies</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="h-10 w-20 bg-gray-700 animate-pulse rounded"></div>
              <div className="h-10 w-20 bg-gray-700 animate-pulse rounded"></div>
              <div className="h-10 w-32 bg-gray-700 animate-pulse rounded"></div>
              <div className="h-10 w-20 bg-gray-700 animate-pulse rounded"></div>
              <div className="h-10 w-20 bg-gray-700 animate-pulse rounded"></div>
            </div>
          </header>
          <div className="h-96 bg-gray-800 animate-pulse rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-black">
      <IntroModal slides={slides} storageKey="perps_intro_v1" />
      <div className="w-full px-4 md:px-6 lg:px-8 xl:px-10 py-8">
        <header className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4 w-full">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">TradeTalk</h1>
              <p className="text-gray-300 text-sm">Hyperliquid Perps - New generation of COD lobbies</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DepositButton />
            <ExchangeButton />
            <CustodialSummary />
            <PositionNotifications userId={userId} />
            <AccountBadge />
          </div>
        </header>
        <PerpsPanel symbol={symbol} />
        {/* Removed legacy mobile VoiceChat box */}
      </div>
    </div>
  );
}
