import { DriftClient, BN, Wallet, OrderType, OrderParams, MarketType, PositionDirection, PostOnlyParams, BulkAccountLoader } from '@drift-labs/sdk';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, ConnectionConfig, Transaction } from '@solana/web3.js';

let driftClientSingleton: DriftClient | null = null;

export interface DriftConfig {
  rpcUrl: string;
  privateKey: string;
  env: 'mainnet-beta' | 'devnet';
}

// Drift Protocol configuration
export const DRIFT_CONFIG = {
  MAINNET: {
    programId: new PublicKey('dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH'),
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    env: 'mainnet-beta' as const,
  },
  DEVNET: {
    programId: new PublicKey('dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH'),
    rpcUrl: 'https://api.devnet.solana.com',
    env: 'devnet' as const,
  }
};

export function getDriftConfig(): typeof DRIFT_CONFIG.MAINNET {
  // Drift v2 er i praksis mainnet-only for pålitelighet. Tillat overstyring via ENV.
  const override = process.env.DRIFT_ENV?.toLowerCase();
  if (override === 'devnet') return DRIFT_CONFIG.DEVNET;
  return DRIFT_CONFIG.MAINNET;
}

export async function createDriftClient(privateKeyB64: string): Promise<DriftClient> {
  try {
    const config = getDriftConfig();
    let subAccountId = 0; // Standard subaccount
    const wsEndpoint = process.env.SOLANA_WS_URL || undefined;
    const commitment: ConnectionConfig['commitment'] = 'confirmed';
    const connection = new Connection(config.rpcUrl, {
      commitment,
      wsEndpoint,
    });
    
    // Create wallet from private key (robust decode of Supabase-stored secret)
    const decodeSecretKey = (raw: string): Uint8Array => {
      // 1) Prøv JSON-array ("[1,2,3,...]")
      try {
        if (raw.startsWith('[')) {
          const arr = JSON.parse(raw) as number[];
          if (Array.isArray(arr) && arr.length >= 64) return new Uint8Array(arr);
        }
      } catch {}
      // 2) Prøv base64
      try {
        const b = Buffer.from(raw, 'base64');
        if (b.length >= 64) return new Uint8Array(b);
      } catch {}
      // 3) Prøv base58
      try {
        const b = bs58.decode(raw);
        if (b.length >= 64) return new Uint8Array(b);
      } catch {}
      throw new Error('Unsupported secret key format: expected JSON array, base64, eller base58');
    };
    const privateKeyBytes = decodeSecretKey(privateKeyB64);
    const keypair = Keypair.fromSecretKey(privateKeyBytes);
    const wallet = new Wallet(keypair);

    // Initialize Drift client
    const driftClient = new DriftClient({
      connection,
      wallet,
      programID: config.programId,
      env: config.env,
      activeSubAccountId: subAccountId,
      skipLoadUsers: true,
      // Bruk WebSocket-abonnement; Helius WSS er konfigurert via wsEndpoint
    });

    // Returner klienten uten å subscribe for å unngå WS/polling-feil
    return driftClient;
  } catch (error) {
    console.error('Failed to create Drift client:', error);
    throw new Error(`Drift client initialization failed: ${error}`);
  }
}

export async function initializeDriftUser(
  driftClient: DriftClient,
  subAccountId: number,
  debug: boolean = true
): Promise<number> {
  try {
    // Sjekk at lommeboken har nok SOL til tx-avgifter og rent (konfigurerbar terskel)
    const envMin = Number(process.env.DRIFT_MIN_LAMPORTS || "50000000"); // default ~0.05 SOL
    const minLamportsForFees = Number.isFinite(envMin) && envMin > 0 ? envMin : 50000000;
    const lamports = await driftClient.connection.getBalance(driftClient.wallet.publicKey);
    if (lamports < minLamportsForFees) {
      const needSol = (minLamportsForFees / 1e9).toFixed(3);
      const haveSol = (lamports / 1e9).toFixed(3);
      throw new Error(
        `Insufficient SOL for fees: have ${haveSol} SOL, need at least ${needSol} SOL.`
      );
    }
    // Finn/initialiser første gyldige subaccount (start med ønsket)
    const candidates = Array.from(new Set([subAccountId, 0,1,2,3,4,5,6,7]));

    for (const cand of candidates) {
      if (debug) {
        console.log('[DriftInit] wallet', driftClient.wallet.publicKey.toBase58(), 'try sub', cand);
      }
      const userPk = await driftClient.getUserAccountPublicKey(cand);
      let info = await driftClient.connection.getAccountInfo(userPk, 'confirmed');
      if (!info) {
        // Bygg init-instruksjoner og send transaksjon
        const tx = new Transaction();
        if (cand === 0) {
          try {
            const statsPk = driftClient.getUserStatsAccountPublicKey();
            const statsInfo = await driftClient.connection.getAccountInfo(statsPk, 'confirmed');
            if (!statsInfo) tx.add(await driftClient.getInitializeUserStatsIx());
          } catch {}
        }
        const [, initIx] = await driftClient.getInitializeUserInstructions(cand);
        tx.add(initIx);
        tx.feePayer = driftClient.wallet.publicKey;
        // Simuler først for å få program-logger
        try {
          const latest = await driftClient.connection.getLatestBlockhash('confirmed');
          const simTx = new Transaction({ feePayer: tx.feePayer, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
          simTx.add(...tx.instructions);
          simTx.sign((driftClient as any).wallet.payer);
          const simRes = await driftClient.connection.simulateTransaction(simTx, { sigVerify: false, commitment: 'confirmed' });
          if (debug) console.log('[DriftInit] simulate logs:', simRes.value.logs || []);
          if (simRes.value.err) {
            throw new Error('simulate err: ' + JSON.stringify(simRes.value.err));
          }
        } catch (simErr) {
          if (debug) console.error('[DriftInit] simulate error', simErr);
          // fortsett å prøve å sende likevel for å få full feilmelding
        }
        const sig = await driftClient.connection.sendTransaction(
          tx,
          [(driftClient as any).wallet.payer],
          { skipPreflight: false, preflightCommitment: 'confirmed' }
        );
        if (debug) console.log('[DriftInit] sent tx', sig);
        await driftClient.connection.confirmTransaction(sig, 'confirmed');
        // Poll til konto finnes
        for (let i = 0; i < 10; i++) {
          info = await driftClient.connection.getAccountInfo(userPk, 'confirmed');
          if (info) break;
          await new Promise(r => setTimeout(r, 500));
        }
      }

      if (info) {
        try { driftClient.switchActiveUser(cand); } catch {}
        try { await driftClient.addUser(cand); } catch {}
        if (debug) console.log('[DriftInit] loaded user for sub', cand, 'pda', userPk.toBase58());
        return cand;
      }
    }
    throw new Error('Could not initialize or load any Drift user subaccount (0-7)');
  } catch (error) {
    console.error('Failed to initialize Drift user:', error);
    throw new Error(`Drift user initialization failed: ${error}`);
  }
}

export function getMarketIndexBySymbol(symbol: string): number {
  // Common Drift perpetual market indices
  const marketMap: Record<string, number> = {
    'SOL': 0,
    'BTC': 1,
    'ETH': 2,
    'APT': 3,
    'BNB': 4,
    'MATIC': 5,
    'ARB': 6,
    'DOGE': 7,
    'AVAX': 8,
    'OP': 9,
    'SUI': 10,
    'WIF': 11,
    'JTO': 12,
    'PYTH': 13,
    'TIA': 14,
    'JUP': 15,
    'TNSR': 16,
    'W': 17,
    'ENA': 18,
    'DRIFT': 19,
    'RAY': 20,
    // Add more as needed
  };

  const normalizedSymbol = symbol.replace('-PERP', '').toUpperCase();
  const marketIndex = marketMap[normalizedSymbol];
  
  if (marketIndex === undefined) {
    console.warn(`Market index not found for symbol: ${symbol}, defaulting to SOL (0)`);
    return 0; // Default to SOL
  }
  
  return marketIndex;
}

export function calculateOrderParams(
  symbol: string,
  side: 'long' | 'short',
  type: 'market' | 'limit',
  baseAssetAmount: BN,
  price?: BN,
  reduceOnly: boolean = false,
  postOnly: boolean = false,
  ioc: boolean = false
): OrderParams {
  const marketIndex = getMarketIndexBySymbol(symbol);
  const direction = side === 'long' ? PositionDirection.LONG : PositionDirection.SHORT;
  
  let orderType: OrderType;
  let postOnlyParam: PostOnlyParams | undefined;
  
  if (type === 'market') {
    orderType = OrderType.MARKET;
  } else {
    orderType = OrderType.LIMIT;
    if (postOnly) {
      postOnlyParam = PostOnlyParams.MUST_POST_ONLY;
    } else if (ioc) {
      orderType = OrderType.LIMIT;
      // IOC will be handled by setting immediateOrCancel to true
    }
  }

  const orderParams: OrderParams = {
    orderType,
    marketType: MarketType.PERP,
    marketIndex,
    direction,
    baseAssetAmount,
    price: price || new BN(0),
    reduceOnly,
    postOnly: postOnlyParam,
    immediateOrCancel: ioc,
  };

  return orderParams;
}

export async function placeDriftOrder(
  driftClient: DriftClient,
  orderParams: OrderParams
): Promise<string> {
  try {
    // Bruk en operasjonell WS-klient som garantert har aktiv bruker lastet
    const commitment: ConnectionConfig['commitment'] = 'confirmed';
    const wsConn = new Connection('https://api.mainnet-beta.solana.com', {
      commitment,
      wsEndpoint: 'wss://api.mainnet-beta.solana.com',
    });
    const opClient = new DriftClient({
      connection: wsConn,
      wallet: driftClient['wallet'],
      programID: driftClient.program.programId,
      env: getDriftConfig().env,
      skipLoadUsers: true,
      perpMarketIndexes: [],
      spotMarketIndexes: [],
      oracleInfos: [],
    });

    await opClient.subscribe();

    // Helper for å sikre at bruker-konto finnes og er eid av Drift-programmet
    const ensureUser = async (sub: number): Promise<{ pubkey: PublicKey; ok: boolean }> => {
      const userPk = await opClient.getUserAccountPublicKey(sub);
      let info = await wsConn.getAccountInfo(userPk, commitment);
      if (!info) {
        try {
          const [txSig] = await opClient.initializeUserAccount(sub);
          try { await wsConn.confirmTransaction(txSig, commitment); } catch {}
          for (let i = 0; i < 10; i++) {
            info = await wsConn.getAccountInfo(userPk, commitment);
            if (info) break;
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (e: any) {
          const msg = String(e?.message || e).toLowerCase();
          if (!(msg.includes('already') || msg.includes('exists') || msg.includes('already in use'))) {
            throw e;
          }
          // kan ha blitt opprettet av tidligere forsøk
          info = await wsConn.getAccountInfo(userPk, commitment);
        }
      }
      const ok = !!info && info.owner?.toString?.() === opClient.program.programId.toString();
      return { pubkey: userPk, ok };
    };

    // Prøv subaccount 0, ellers subaccount 1
    let activeSub = 0;
    let res = await ensureUser(0);
    if (!res.ok) {
      activeSub = 1;
      res = await ensureUser(1);
    }

    opClient.switchActiveUser(activeSub);
    try { await opClient.addUser(activeSub); } catch {}
    try { await opClient.fetchAccounts(); } catch {}
    const loadedUser = opClient.getUser(activeSub);
    const loadedUserAccount = loadedUser.getUserAccount();
    if (!loadedUserAccount) {
      throw new Error(`Drift user not loaded after init; try again or check SOL balance`);
    }

    // Plasser ordre på opClient
    const txSig = await opClient.placePerpOrder(orderParams);
    
    console.log('Drift order placed successfully:', txSig);
    return txSig;
  } catch (error) {
    console.error('Failed to place Drift order:', error);
    throw error;
  }
}

export async function closeDriftClient(driftClient: DriftClient): Promise<void> {
  try {
    await driftClient.unsubscribe();
  } catch (error) {
    console.error('Error closing Drift client:', error);
  }
}

// Helper function to convert size from UI to base asset amount
export function convertSizeToBaseAssetAmount(sizeUsd: number, price: number, decimals: number = 9): BN {
  // Calculate coin amount from USD value
  const coinAmount = sizeUsd / price;
  
  // Convert to base asset amount (multiply by 10^decimals)
  const baseAssetAmount = Math.floor(coinAmount * Math.pow(10, decimals));
  
  return new BN(baseAssetAmount);
}

// Helper function to convert price to Drift format
export function convertPriceToDrift(price: number, decimals: number = 6): BN {
  // Drift prices are usually in 6 decimal precision
  const driftPrice = Math.floor(price * Math.pow(10, decimals));
  return new BN(driftPrice);
}

// Export BN from Drift SDK
export { BN } from '@drift-labs/sdk';
