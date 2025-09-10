"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

type Me = {
  userId: string;
  walletAddress: string;
  custodialPublicKey: string | null;
  lastLoginAt: string | null;
  custodialCreatedAt: string | null;
};

export default function DepositButton() {
  const [me, setMe] = useState<Me | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<"SOL" | "USDC">("SOL");
  const modalRef = useRef<HTMLDivElement>(null);

  // Fetch user data
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (mounted) setMe(json);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  // Generate QR code when modal opens or currency changes
  useEffect(() => {
    if (modalOpen && me?.custodialPublicKey) {
      (async () => {
        try {
          // Create Phantom-compatible URLs that open the wallet directly
          // Use simple format for both SOL and USDC - Phantom will let user choose token
          const addressToEncode = `solana:${me.custodialPublicKey}`;
          
          const svg = await QRCode.toString(addressToEncode, { 
            type: 'svg', 
            margin: 0, 
            width: 180, 
            color: { 
              dark: '#000000', 
              light: '#FFFFFF' 
            } 
          });
          setQrCode(svg);
        } catch (error) {
          // Failed to generate QR code
        }
      })();
    }
  }, [modalOpen, me?.custodialPublicKey, selectedCurrency]);

  // Handle click outside to close modal
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        setModalOpen(false);
      }
    }

    if (modalOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [modalOpen]);

  // Handle escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setModalOpen(false);
      }
    }

    if (modalOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [modalOpen]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // Failed to copy to clipboard
    }
  };



  // Don't render if no custodial wallet
  if (!me?.custodialPublicKey) {
    return null;
  }

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="px-3 h-9 bg-white text-black rounded-md hover:bg-white/90 transition-colors font-medium text-sm inline-flex items-center justify-center whitespace-nowrap"
      >
        Deposit
      </button>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div 
            ref={modalRef}
            className="bg-black border border-white/20 rounded-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Deposit {selectedCurrency}</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-white/60 hover:text-white transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>

            {/* Currency Toggle */}
            <div className="mb-6">
              <div className="flex bg-white/5 rounded-lg p-1">
                <button
                  onClick={() => setSelectedCurrency("SOL")}
                  className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                    selectedCurrency === "SOL" 
                      ? "bg-white text-black" 
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  SOL
                </button>
                <button
                  onClick={() => setSelectedCurrency("USDC")}
                  className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                    selectedCurrency === "USDC" 
                      ? "bg-white text-black" 
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  USDC
                </button>
              </div>
            </div>

            {/* QR Code */}
            <div className="flex flex-col items-center mb-6">
              <div className="bg-white p-3 rounded-lg mb-4 flex items-center justify-center">
                {qrCode ? (
                  <div dangerouslySetInnerHTML={{ __html: qrCode }} />
                ) : (
                  <div className="w-[180px] h-[180px] bg-gray-100 animate-pulse rounded flex items-center justify-center">
                    <span className="text-gray-500 text-sm">Loading QR...</span>
                  </div>
                )}
              </div>
              <p className="text-white/70 text-sm text-center">
                {selectedCurrency === "USDC" 
                  ? "Scan QR code to open Phantom, then select USDC to send"
                  : "Scan QR code to send SOL to your wallet"
                }
              </p>
            </div>

            {/* Wallet Address */}
            <div className="space-y-4">
              <div>
                <label className="block text-white/60 text-sm mb-2">Wallet Address</label>
                <div className="bg-white/5 border border-white/10 rounded-md p-3">
                  <div className="font-mono text-sm text-white break-all">
                    {me.custodialPublicKey}
                  </div>
                </div>
                <button
                  onClick={() => copyToClipboard(me.custodialPublicKey!)}
                  className="mt-2 text-sm text-white/70 hover:text-white transition-colors"
                >
                  Copy Address
                </button>
              </div>



              {/* Warning */}
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3">
                <p className="text-yellow-200 text-sm">
                  {selectedCurrency === "SOL" 
                    ? "Only send SOL to this address. Sending other tokens may result in permanent loss."
                    : "Only send USDC (SPL token) to this address. Sending other tokens may result in permanent loss."
                  }
                </p>
              </div>
            </div>

            {/* Close button */}
            <div className="mt-6 pt-4 border-t border-white/10">
              <button
                onClick={() => setModalOpen(false)}
                className="w-full py-2 bg-white/10 hover:bg-white/20 rounded-md text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
