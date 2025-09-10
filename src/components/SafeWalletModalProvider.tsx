"use client";

import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { useEffect } from "react";

// Suppress iframe-related errors from wallet modal
const suppressIframeErrors = () => {
  const originalError = console.error;
  const originalWarn = console.warn;
  
  console.error = (...args: any[]) => {
    const message = args.join(' ');
    if (message.includes('contentWindow') || 
        message.includes('Cannot listen to the event from the provided iframe') ||
        message.includes('iframe') && message.includes('not available')) {
      return; // Suppress iframe errors
    }
    originalError.apply(console, args);
  };
  
  console.warn = (...args: any[]) => {
    const message = args.join(' ');
    if (message.includes('contentWindow') || 
        message.includes('Cannot listen to the event from the provided iframe') ||
        message.includes('iframe') && message.includes('not available')) {
      return; // Suppress iframe warnings
    }
    originalWarn.apply(console, args);
  };
};

export default function SafeWalletModalProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    suppressIframeErrors();
  }, []);

  return (
    <WalletModalProvider>
      {children}
    </WalletModalProvider>
  );
}
