# Multi-Chain Memecoin Trading Platform - Development Guide

## Project Structure

```
/workspace
├── src/
│   ├── config/           # Configuration management with Zod validation
│   │   └── index.ts
│   ├── core/             # Core types, event bus, shared utilities
│   │   ├── types.ts
│   │   └── event-bus.ts
│   ├── adapters/         # Chain-specific implementations
│   │   ├── interface.ts  # ChainAdapter interface
│   │   └── solana.ts     # Solana implementation
│   ├── modules/          # Business logic modules
│   │   ├── discovery/    # Token scanner
│   │   │   └── scanner.ts
│   │   ├── risk/         # Risk engine & position sizing
│   │   │   ├── engine.ts
│   │   │   └── manager.ts
│   │   ├── execution/    # Trade execution
│   │   │   └── engine.ts
│   │   └── portfolio/    # Portfolio tracking (TODO)
│   ├── db/               # Database schema and migrations
│   │   └── schema.sql
│   ├── utils/            # Utilities
│   │   └── logger.ts
│   └── index.ts          # Main entry point
├── tests/
│   ├── unit/             # Unit tests
│   │   ├── risk-engine.test.ts
│   │   └── risk-manager.test.ts
│   └── integration/      # Integration tests (TODO)
├── docs/                 # Documentation
├── package.json
├── tsconfig.json
├── jest.config.js
├── .env.example
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Redis 7+
- Solana RPC endpoint (public or private)

### Installation

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your settings
# IMPORTANT: Keep TRADING_MODE=paper for testing

# Set up database
psql $DATABASE_URL -f src/db/schema.sql

# Run tests
npm test

# Start in development mode
npm run dev
```

## Architecture Overview

### Modular Monolith Design

The system is structured as a modular monolith - a single deployable unit with cleanly separated modules. This provides:

- Simple deployment (single process)
- Easy inter-module communication (event bus)
- Clear boundaries for future microservice extraction if needed

### Data Flow

```
TokenScanner → EventBus → RiskEngine → RiskManager → ExecutionEngine
                                      ↓
                                  (blocked)
                                  
TokenScanner → EventBus → RiskEngine (pass) → ExecutionEngine → Position
```

### Key Safety Features

1. **Paper Trading Default**: System simulates all trades unless explicitly configured for live mode
2. **Fail Closed**: Any uncertainty (RPC failure, stale data, simulation failure) blocks trades
3. **Hard Risk Limits**: Position sizes, daily loss limits enforced in code
4. **Kill Switch**: One action halts all automated activity
5. **Circuit Breaker**: Automatic halt on excessive losses
6. **Audit Trail**: Every decision logged with reasoning

## Module Responsibilities

### Token Scanner (`modules/discovery/scanner.ts`)
- Watches DEXes for new token pairs
- Applies basic filters (liquidity, holders, age)
- Emits `TOKEN_DISCOVERED` events

### Risk Engine (`modules/risk/engine.ts`)
- **HARD GATE** - no trade proceeds without passing
- Contract analysis (mint/freeze authority, ownership)
- Liquidity analysis (locked/burned, pool age)
- Holder analysis (concentration, sniper detection)
- Honeypot detection
- Transparent scoring with breakdown

### Risk Manager (`modules/risk/manager.ts`)
- Position sizing based on portfolio % 
- Max concurrent positions limit
- Daily loss circuit breaker
- Per-token exposure cap
- Stop-loss/take-profit triggers
- Kill switch implementation

### Execution Engine (`modules/execution/engine.ts`)
- Routes through DEX aggregators
- **Simulates EVERY transaction before submit**
- Idempotent order handling
- Paper vs live mode handling

### Chain Adapters (`adapters/`)
- Abstract common operations (getPrice, buildSwap, simulate)
- Chain-specific implementations
- Easy to add new chains

## Configuration

All thresholds are config-driven (not hardcoded):

```bash
# Risk Management
RISK_SCORE_CUTOFF=70        # Minimum acceptable risk score
MAX_POSITION_SIZE_PCT=5     # Max % of portfolio per position
MAX_CONCURRENT_POSITIONS=10
MAX_DAILY_LOSS_PCT=10       # Circuit breaker threshold
MAX_PER_TOKEN_EXPOSURE_PCT=15

# Trading Mode (CRITICAL)
TRADING_MODE=paper          # MUST be 'paper' until ready for live
```

## Testing Strategy

### Unit Tests
- Risk scoring logic against known good/bad tokens
- Position sizing math
- Circuit breaker triggers
- Kill switch behavior

### Integration Tests (TODO)
- Testnet/devnet execution
- End-to-end trade flow
- Event bus communication

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# With coverage
npm test -- --coverage
```

## Adding a New Chain

1. Create adapter implementing `ChainAdapter` interface:
```typescript
// adapters/ethereum.ts
import { ChainAdapter } from './interface.js';

export class EthereumAdapter implements ChainAdapter {
  readonly chain = 'ethereum';
  // Implement all required methods...
}
```

2. Register the adapter:
```typescript
adapterRegistry.register('ethereum', createEthereumAdapter);
```

3. Update scanner to support the chain
4. Add chain-specific tests

## API Endpoints (TODO)

The platform will expose REST + WebSocket APIs for:
- Dashboard data (positions, PnL)
- Kill switch control
- Configuration updates
- Audit log access

## Security Considerations

1. **Private Keys**: Never stored in plaintext. Use environment variables or secrets manager.
2. **Access Control**: API should require authentication
3. **Rate Limiting**: Prevent abuse of endpoints
4. **Input Validation**: All inputs validated with Zod schemas
5. **Audit Logging**: All actions logged for forensics

## Observability

### Logging
- Structured JSON logs via pino
- Module-level context on all logs
- Separate audit log for compliance

### Metrics (TODO)
- Trades executed/blocked
- PnL tracking
- Error rates by module
- Latency percentiles

### Health Checks
- `/health` endpoint
- Per-module health status
- Event bus connectivity

## Deployment

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm run start
```

### Environment Variables

See `.env.example` for all required variables. Critical ones:

- `TRADING_MODE`: Must be `paper` (default) or `live`
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `SOLANA_RPC_URL`: Solana RPC endpoint

## Milestones

- [x] Core architecture + config + types
- [x] Chain adapter interface + Solana adapter
- [x] Risk engine with hard block conditions
- [x] Risk manager with position sizing + kill switch
- [x] Event bus for module communication
- [x] Audit logging
- [x] Token scanner (basic)
- [ ] Execution engine with simulation (in progress)
- [ ] Portfolio tracking
- [ ] Web dashboard
- [ ] EVM chain adapters
- [ ] Backtesting framework
- [ ] Alerting (Telegram/Discord)
- [ ] Copy-trading module

## Contributing

1. Follow existing code style (strict TypeScript)
2. Add tests for new functionality
3. Update documentation
4. Never commit secrets or private keys

## License

MIT

## Disclaimer

This software is for educational purposes. Cryptocurrency trading involves substantial risk of loss. Always test thoroughly on testnets/devnets before any live deployment.
