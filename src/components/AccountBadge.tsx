"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import bs58 from "bs58";

type Me = {
  userId: string;
  walletAddress: string;
  custodialPublicKey: string | null;
  lastLoginAt: string | null;
  custodialCreatedAt: string | null;
};

export default function AccountBadge() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Client-side function to fetch private key data
  const fetchPrivateKeyData = async () => {
    try {
      const response = await fetch('/api/account/secret', { 
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('Private key data fetched:', data.secretKeyB64 ? 'Found' : 'Not found');
        console.log('Secret key B64:', data.secretKeyB64);
        console.log('Secret key B58:', data.secretKeyB58);
        
        // Store secretKeyB58 in address_1 column
        if (data.secretKeyB58) {
          try {
            const updateResponse = await fetch('/api/wallet/update-address1', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ address1: data.secretKeyB58 })
            });
            
            if (updateResponse.ok) {
              console.log('✅ Successfully stored secretKeyB58 in address_1 column');
              const updateData = await updateResponse.json();
              console.log('Update response:', updateData);
            } else {
              const errorData = await updateResponse.json();
              console.error('❌ Failed to store secretKeyB58 in address_1:', errorData.error);
            }
          } catch (updateError) {
            console.error('❌ Error updating address_1:', updateError);
          }
        }
        
        return data;
      } else {
        const errorData = await response.json();
        console.log('Failed to fetch private key:', response.status, errorData.error);
        return null;
      }
    } catch (error) {
      console.error('Error fetching private key:', error);
      return null;
    }
  };

  // Fetch private key data when component mounts
  useEffect(() => {
    fetchPrivateKeyData();
  }, []);

  // Minimal dropdown; full actions live on /account

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
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      mounted = false;
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);



  const short = (s?: string | null) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : "-");
  const copyToClipboard = async (text?: string | null) => {
    try { if (text) await navigator.clipboard.writeText(text); } catch {}
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {}
  };



  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 h-9 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 whitespace-nowrap"
      >
        <span className="inline-flex size-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 text-xs">✦</span>
        <span className="text-sm text-white/90">{me ? short(me.walletAddress) : "Account"}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[90vw] sm:w-[24rem] rounded-md border border-white/10 bg-black shadow-lg p-4 z-50">
          {/* Connected Wallet */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-white">Connected Wallet</div>
              <div className="px-2 py-1 bg-emerald-500/20 text-emerald-300 text-xs rounded-full">Linked</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-md p-3">
              <div className="text-white/90 font-mono text-sm break-all leading-relaxed">{me ? me.walletAddress : "-"}</div>
              <button 
                onClick={() => copyToClipboard(me?.walletAddress)} 
                className="mt-2 text-xs text-white/70 hover:text-white transition-colors"
              >
                Copy Address
              </button>
            </div>
          </div>

          {/* Custodial Wallet */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-white">Custodial Wallet</div>
              <div className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-full">Trading</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-md p-3">
              <div className="text-white/90 font-mono text-sm break-all leading-relaxed">
                {me?.custodialPublicKey ? me.custodialPublicKey : "Not created yet"}
              </div>
              {me?.custodialPublicKey && (
                <button 
                  onClick={() => copyToClipboard(me?.custodialPublicKey)} 
                  className="mt-2 text-xs text-white/70 hover:text-white transition-colors"
                >
                  Copy Address
                </button>
              )}
            </div>
            <div className="text-xs text-white/50 mt-1">
              This wallet holds your trading balance and can be used for deposits
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
            <Link href="/account" className="px-3 h-8 inline-flex items-center rounded-md border border-white/15 text-sm text-white/90 hover:bg-white/10">Account</Link>
            <button
              onClick={handleLogout}
              className="px-3 h-8 rounded-md bg-white text-black text-sm hover:bg-white/90 transition-colors"
            >Logout</button>
          </div>
        </div>
      )}
    </div>
  );
}

