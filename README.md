# Multi-Chain Memecoin Trading Platform

## Overview

A production-grade, multi-chain memecoin trading platform that combines real-time token discovery, automated risk analysis, execution, and portfolio management into one system.

**⚠️ SAFETY FIRST**: This system defaults to **PAPER TRADING / SIMULATION MODE**. Live execution requires explicit opt-in with minimal default limits.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Dashboard                             │
│              (React - Real-time PnL, Kill Switch)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer                                │
│                    (Express + WebSocket)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌───────────────┐
│   Discovery   │   │  Risk Engine    │   │  Execution    │
│    Module     │──▶│  (Hard Gate)    │──▶│    Engine     │
└───────────────┘   └─────────────────┘   └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Event Bus (Redis Pub/Sub)                   │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌───────────────┐
│   Portfolio   │   │  Copy Trading   │   │  Backtesting  │
│    Tracker    │   │    (Optional)   │   │   Framework   │
└───────────────┘   └─────────────────┘   └───────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Chain Adapters                               │
│   ┌─────────┐  ┌─────────┐  ┌──────┐  ┌──────────┐  ┌─────┐    │
│   │ Solana  │  │Ethereum │  │ Base │  │Arbitrum  │  │ BSC │    │
│   └─────────┘  └─────────┘  └──────┘  └──────────┘  └─────┘    │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                   External RPC / Indexers                        │
└─────────────────────────────────────────────────────────────────┘
```

## Core Modules

### 1. Token Discovery / Scanner
- Watches for new pair creations on DEXs (Jupiter/Raydium, Uniswap, Aerodrome)
- Configurable filters: min liquidity, holder count, token age
- Emits events to internal event bus

### 2. Risk & Rug-Detection Engine ⚠️
**Most critical module - acts as a hard gate**
- Contract analysis (mint/freeze authority, ownership renouncement, honeypot detection)
- Liquidity analysis (locked/burned, LP concentration, pool age)
- Holder analysis (concentration, dev wallet %, sniper detection)
- Composite risk score with transparent breakdown
- Hard blocklist for disqualifying conditions

### 3. Execution Engine
- Routes through DEX aggregators (Jupiter, 0x, 1inch)
- **Simulates every transaction before submission**
- Configurable slippage, gas strategy, MEV protection
- Idempotent order submission with retry/backoff

### 4. Risk Management / Position Sizing
- Hard limits enforced in code:
  - Max position size (% of portfolio)
  - Max concurrent positions
  - Max daily loss (circuit breaker)
  - Per-token exposure cap
- Stop-loss, take-profit, trailing-stop logic
- **Global kill switch** - halts all automated activity

### 5. Wallet Management
- Multiple wallet support with clear separation
- Private keys via environment/secrets manager only
- Explicit per-wallet spend limits

### 6. Copy-Trading (Optional)
- Track specified wallets' on-chain activity
- Mirroring rules routed through risk engine (no bypass)

### 7. Portfolio & PnL Tracking
- Real-time unrealized/realized PnL
- Full trade history with entry/exit reasoning

### 8. Backtesting Framework
- Replay historical data through strategy logic
- Reports: win rate, max drawdown, Sharpe-like metrics

### 9. Alerting
- Telegram/Discord webhooks for key events
- Trade execution, risk blocks, circuit-breaker events

### 10. Logging & Audit Trail
- Append-only, tamper-evident logs
- Every decision reconstructable

## Non-Functional Requirements

| Requirement | Implementation |
|-------------|----------------|
| **Fail Closed** | Any uncertainty blocks trades |
| **Testing** | Unit tests for risk scoring; integration tests on testnet |
| **Config-Driven** | All thresholds in config, not hardcoded |
| **Observability** | Structured logging, metrics, health checks |

## Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# IMPORTANT: Keep TRADING_MODE=paper until ready

# Run database migrations
npm run db:migrate

# Start in development mode
npm run dev
```

## Configuration

See `.env.example` for all configuration options. Key settings:

- `TRADING_MODE`: Must be `paper` (default) or `live` (explicit opt-in)
- `RISK_SCORE_CUTOFF`: Minimum acceptable risk score (0-100)
- `MAX_POSITION_SIZE_PCT`: Maximum % of portfolio per position
- `MAX_DAILY_LOSS_PCT`: Circuit breaker threshold

## Supported Chains

| Chain | Status | Adapter |
|-------|--------|---------|
| Solana | ✅ Implemented | `src/adapters/solana.ts` |
| Ethereum | 🚧 In Progress | `src/adapters/ethereum.ts` |
| Base | 📋 Planned | - |
| Arbitrum | 📋 Planned | - |
| BSC | 📋 Planned | - |

## Safety Features

1. **Paper Trading Default**: System simulates all trades unless explicitly configured otherwise
2. **Simulation Before Submit**: Every transaction is dry-run against chain state
3. **Circuit Breakers**: Automatic halt on excessive losses
4. **Kill Switch**: One-click stop for all automated activity
5. **Audit Trail**: Complete reconstruction of all decisions
6. **No Plaintext Keys**: Secrets via environment or secrets manager only

## Development

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Lint code
npm run lint

# Build for production
npm run build
```

## License

MIT

## Disclaimer

This software is for educational purposes. Trading cryptocurrencies involves substantial risk of loss. Always test thoroughly on testnets/devnets before considering any live deployment.
