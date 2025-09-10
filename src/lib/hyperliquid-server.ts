import * as hl from "@nktkas/hyperliquid";

let infoClientSingleton: hl.InfoClient | null = null;

export function getInfoClient(): hl.InfoClient {
  if (!infoClientSingleton) {
    infoClientSingleton = new hl.InfoClient({
      transport: new hl.HttpTransport({
        // Fix keepalive error by providing proper fetch options
        fetchOptions: {
          keepalive: false,
          headers: {
            'User-Agent': 'perpsvc-trading-platform/1.0.0',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      }),
    });
  }
  return infoClientSingleton;
}

// For server-side trading operations
export function createExchangeClient(privateKey: string, walletAddress: string): hl.ExchangeClient {
  return new hl.ExchangeClient({
    transport: new hl.HttpTransport({
      // Fix keepalive error by providing proper fetch options
      fetchOptions: {
        keepalive: false,
        headers: {
          'User-Agent': 'perpsvc-trading-platform/1.0.0',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    }),
    wallet: {
      address: walletAddress,
      privateKey: privateKey
    } as any, // Type assertion to handle the wallet interface
  });
}

export type L2Level = { px: string; sz: string };
export type L2Book = { bids: L2Level[]; asks: L2Level[] };
