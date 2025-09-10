import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

export function useSafeWalletConnection() {
  const wallet = useWallet();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Wait for wallet adapter to be fully initialized
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Add error handling for iframe-related issues
  useEffect(() => {
    const handleWalletError = (error: any) => {
      if (error?.message?.includes('contentWindow')) {
        console.warn('Wallet iframe error handled:', error.message);
        // Don't propagate the error to avoid console spam
        return;
      }
      // Let other errors propagate normally
      throw error;
    };

    // Override wallet error handling
    if (wallet.wallet?.adapter) {
      const originalOnError = wallet.wallet.adapter.on;
      if (originalOnError) {
        wallet.wallet.adapter.on = function(event: string, callback: any) {
          if (event === 'error') {
            return originalOnError.call(this, event, (error: any) => {
              handleWalletError(error);
              if (callback) callback(error);
            });
          }
          return originalOnError.call(this, event, callback);
        };
      }
    }
  }, [wallet.wallet]);

  return {
    ...wallet,
    isReady,
  };
}
