"use client";

import * as hl from "@nktkas/hyperliquid";

let infoClientSingleton: hl.InfoClient | null = null;
let subsClientSingleton: hl.SubscriptionClient | null = null;

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

export function getSubsClient(): hl.SubscriptionClient {
  if (!subsClientSingleton) {
    subsClientSingleton = new hl.SubscriptionClient({
      transport: new hl.WebSocketTransport({}),
    });
  }
  return subsClientSingleton;
}

export type L2Level = { px: string; sz: string };
export type L2Book = { bids: L2Level[]; asks: L2Level[] };

