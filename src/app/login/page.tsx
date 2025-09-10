"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { useSafeWalletConnection } from "@/hooks/useSafeWalletConnection";
import SafeWalletModalProvider from "@/components/SafeWalletModalProvider";

const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";

function LoginInner() {
  const { publicKey, signMessage, isReady } = useSafeWalletConnection();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof document !== 'undefined' && /(?:^|;\s*)app_session=/.test(document.cookie)) {
      window.location.href = "/";
    }
  }, []);

  const handleVerify = async () => {
    try {
      setLoading(true);
      setError(null);
      // 1) Get nonce
      const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" });
      const { nonce } = await nonceRes.json();
      const address = publicKey?.toBase58();
      if (!address) throw new Error("No wallet connected");
      if (!signMessage) throw new Error("Wallet does not support message signing");
      const message = `Sign in to TradeTalk with address ${address}\nNonce: ${nonce}`;
      const sig = await signMessage(new TextEncoder().encode(message));
      const signatureB58 = (await import("bs58")).default.encode(sig);
      // 2) Verify on server and create session
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature: signatureB58, message }),
      });
      if (!verifyRes.ok) {
        const msg = await verifyRes.text();
        throw new Error(msg);
      }
      const { userId } = await verifyRes.json();
      // 3) Create custodial wallet on first login (best-effort)
      try {
        await fetch("/api/wallet/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
      } catch {}
      // 4) Redirect to app
      window.location.href = "/";
    } catch (e: any) {
      setError(e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // Prevent hydration mismatch by not rendering wallet components on server
  if (!mounted) {
    return (
      <div className="w-full bg-black text-white">
        <div className="w-full px-4 md:px-6 lg:px-8 xl:px-10 py-6 flex items-center justify-center">
          <div className="w-full max-w-lg">
            <div className="text-center mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-white">TradeTalk</h1>
              <p className="text-gray-300 text-sm">Hyperliquid Perps - New generation of COD lobbies</p>
            </div>
            <div className="flex justify-center mb-6">
              <img 
                src="https://cdn.discordapp.com/attachments/1278770805521514588/1405371580615229592/Skjermbilde_2025-08-14_kl._04.04.39.png?ex=689e95c7&is=689d4447&hm=dc6b2e75d3a725b6fb4c40ab7913a17eaa96b90eecf830284ae24ca1975a266f&" 
                alt="Demo" 
                className="max-w-full h-auto rounded-lg shadow-lg"
              />
            </div>
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-medium mb-2">Sign in</h2>
                <p className="text-gray-300 text-sm">Connect your wallet and sign a message to continue.</p>
              </div>
              <div className="space-y-4 flex flex-col items-center">
                <div className="w-full max-w-sm h-12 rounded-md bg-gray-600 animate-pulse"></div>
                <div className="w-full max-w-sm h-12 rounded-md bg-gray-600 animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-black text-white">
      <div className="w-full px-4 md:px-6 lg:px-8 xl:px-10 py-6 flex items-center justify-center">
        <div className="w-full max-w-lg">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-white">TradeTalk</h1>
            <p className="text-gray-300 text-sm">Hyperliquid Perps - New generation of COD lobbies</p>
          </div>
          <div className="flex justify-center mb-6">
            <img 
              src="https://cdn.discordapp.com/attachments/1278770805521514588/1405371580615229592/Skjermbilde_2025-08-14_kl._04.04.39.png?ex=689e95c7&is=689d4447&hm=dc6b2e75d3a725b6fb4c40ab7913a17eaa96b90eecf830284ae24ca1975a266f&" 
              alt="Demo" 
              className="max-w-full h-auto rounded-lg shadow-lg"
            />
          </div>
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-medium mb-2">Sign in</h2>
              <p className="text-gray-300 text-sm">Connect your wallet and sign a message to continue.</p>
            </div>
            <div className="space-y-4 flex flex-col items-center">
              {isReady ? (
                <WalletMultiButton className="!bg-white !text-black !hover:bg-white/90 !border !border-white/10 !rounded-md !h-12 !w-full !max-w-sm !font-medium !justify-center" />
              ) : (
                <div className="w-full max-w-sm h-12 rounded-md bg-gray-600 animate-pulse"></div>
              )}
              <button
                disabled={!publicKey || loading || !isReady}
                onClick={handleVerify}
                className="w-full max-w-sm h-12 rounded-md bg-white text-black font-medium hover:bg-white/90 transition disabled:opacity-50 disabled:hover:bg-white"
              >
                {loading ? "Verifying..." : "Continue"}
              </button>
            </div>
            {error && (
              <div className="text-rose-400 text-sm text-center">
                {error}
              </div>
            )}
            <p className="text-xs text-gray-400 text-center">You will be asked to sign a message. This does not incur any fees.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const wallets = useMemo(() => {
    const phantom = new PhantomWalletAdapter();
    const solflare = new SolflareWalletAdapter();
    
    // Add comprehensive error handling to prevent iframe contentWindow errors
    const wrapAdapter = (adapter: any, name: string) => {
      const originalConnect = adapter.connect;
      const originalDisconnect = adapter.disconnect;
      const originalSignMessage = adapter.signMessage;
      
      adapter.connect = async function() {
        try {
          return await originalConnect.call(this);
        } catch (error: any) {
          if (error?.message?.includes('contentWindow') || 
              error?.message?.includes('iframe') ||
              error?.message?.includes('Cannot listen to the event')) {
            // Suppress iframe errors silently
            throw new Error('Wallet connection failed. Please try again.');
          }
          throw error;
        }
      };
      
      adapter.disconnect = async function() {
        try {
          return await originalDisconnect.call(this);
        } catch (error: any) {
          if (error?.message?.includes('contentWindow') || 
              error?.message?.includes('iframe')) {
            // Suppress iframe errors silently
            return;
          }
          throw error;
        }
      };
      
      adapter.signMessage = async function(message: any) {
        try {
          return await originalSignMessage.call(this, message);
        } catch (error: any) {
          if (error?.message?.includes('contentWindow') || 
              error?.message?.includes('iframe')) {
            // Suppress iframe errors silently
            throw new Error('Message signing failed. Please try again.');
          }
          throw error;
        }
      };
      
      return adapter;
    };
    
    return [wrapAdapter(phantom, 'Phantom'), wrapAdapter(solflare, 'Solflare')];
  }, []);
  
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider 
        wallets={wallets} 
        autoConnect={false}
        onError={(error) => {
          if (error?.message?.includes('contentWindow')) {
            console.warn('Wallet iframe error handled:', error.message);
            return; // Don't propagate iframe errors
          }
          console.warn('Wallet adapter error:', error);
        }}
      >
        <SafeWalletModalProvider>
          <LoginInner />
        </SafeWalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

