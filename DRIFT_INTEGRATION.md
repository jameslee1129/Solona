# Drift Protocol Integration

Dette dokumentet beskriver implementasjonen av Drift Protocol for ordre funksjonalitet i TradeTalk applikasjonen.

## Oversikt

Applikasjonen støtter nå både Hyperliquid og Drift Protocol for perpetual trading. Brukere kan velge mellom protokollene via et protocol selector i TradingPanel.

## Implementerte Komponenter

### 1. Drift Client Library (`src/lib/drift-client.ts`)

Hovedbiblioteket for Drift Protocol integrasjon som inneholder:

- **createDriftClient()**: Oppretter og initialiserer Drift client
- **initializeDriftUser()**: Initialiserer brukerkontoer på Drift
- **getMarketIndexBySymbol()**: Mapper trading symbols til Drift market indices  
- **calculateOrderParams()**: Konverterer UI ordre til Drift format
- **placeDriftOrder()**: Plasserer ordre på Drift Protocol
- **convertSizeToBaseAssetAmount()**: Konverterer USD størrelse til base asset amount
- **convertPriceToDrift()**: Konverterer priser til Drift format

### 2. API Routes

#### Drift Order Placement (`src/app/api/trading/drift-place-order/route.ts`)

Håndterer ordre plassering på Drift med omfattende feilhåndtering:

- Validerer alle ordre parametere
- Sjekker brukerens collateral og kontostatus
- Håndterer oracle price data
- Støtter alle ordre typer (market, limit, post-only, IOC)
- Returnerer transaksjons-signaturer

#### Drift User Initialization (`src/app/api/trading/drift-init-user/route.ts`)

Initialiserer nye Drift brukerkontoer:

- Sjekker om konto allerede eksisterer
- Oppretter ny konto hvis nødvendig
- Håndterer connection og initialization feil

### 3. UI Oppdateringer (`src/components/TradingPanel.tsx`)

TradingPanel har blitt oppdatert med:

- **Protocol Selector**: Velg mellom Hyperliquid og Drift
- **Drift Account Initialization**: Knapp for å initialisere Drift konto
- **Enhanced Error Handling**: Spesifikke feilmeldinger for vanlige problemer
- **Status Indicators**: Viser når Drift konto trenger initialisering

## Feilhåndtering

Implementasjonen håndterer alle vanlige problemer som vist i original bildet:

### 1. Connection Issues
- **drift_connection_failed**: Solana network connection problemer
- **connection_failed**: Generelle connectivity issues

### 2. Account Issues  
- **user_account_not_initialized**: Drift konto må initialiseres først
- **insufficient_collateral**: Ikke nok margin for ordre
- **wallet_error**: Wallet initialization problemer

### 3. Order Issues
- **invalid_market_index**: Unsupported trading pairs
- **oracle_price_unavailable**: Oracle price feed problemer
- **slippage_error**: Ordre ville overstige slippage toleranse

### 4. Validation Errors
- **missing_required_fields**: Manglende ordre parametere
- **price_required_for_limit_order**: Pris påkrevd for limit ordre

## Støttede Trading Pairs

Drift Protocol støtter følgende trading pairs (automatisk mapping):

- SOL-PERP (Index: 0)
- BTC-PERP (Index: 1) 
- ETH-PERP (Index: 2)
- APT-PERP (Index: 3)
- BNB-PERP (Index: 4)
- MATIC-PERP (Index: 5)
- ARB-PERP (Index: 6)
- DOGE-PERP (Index: 7)
- AVAX-PERP (Index: 8)
- OP-PERP (Index: 9)
- SUI-PERP (Index: 10)
- WIF-PERP (Index: 11)
- JTO-PERP (Index: 12)
- PYTH-PERP (Index: 13)
- TIA-PERP (Index: 14)
- JUP-PERP (Index: 15)
- TNSR-PERP (Index: 16)
- W-PERP (Index: 17)
- ENA-PERP (Index: 18)
- DRIFT-PERP (Index: 19)
- RAY-PERP (Index: 20)

Ukjente symbols defaulter til SOL (Index: 0).

## Bruksflyt

### For Nye Drift Brukere:

1. Velg "Drift" protocol i TradingPanel
2. Hvis konto ikke er initialisert, vil "Initialize Drift Account" knapp vises
3. Klikk knappen for å initialisere konto
4. Etter vellykket initialisering kan du plassere ordre

### For Eksisterende Drift Brukere:

1. Velg "Drift" protocol
2. Ordre knappen vil være aktiv umiddelbart
3. Plasser ordre som normalt

## Environment Configuration

Drift client konfigureres automatisk basert på miljø:

- **Production**: Mainnet-beta Solana network
- **Development**: Devnet Solana network

RPC URL hentes fra `SOLANA_RPC_URL` environment variable.

## Dependencies

- `@drift-labs/sdk`: Hovedbibliotek for Drift Protocol
- `@solana/web3.js`: Solana blockchain interaksjon  
- `@solana/spl-token`: SPL token support

## Security

- Alle private keys håndteres sikkert via base64 encoding
- Clients clanes opp automatisk etter bruk
- Proper error handling forhindrer info leakage
- Session-basert autentisering for alle API calls

## Testing

Alle ordre typer er testet og verifisert:

- ✅ Market orders (long/short)
- ✅ Limit orders (long/short) 
- ✅ Post-only orders
- ✅ IOC orders
- ✅ Reduce-only orders
- ✅ Account initialization
- ✅ Error handling for alle scenarios

## Future Enhancements

Mulige fremtidige forbedringer:

- Take Profit / Stop Loss ordre på Drift
- Position management på Drift
- Real-time position updates
- Advanced order types (trailing stops, etc.)
- Multi-collateral support
