-- Database schema for memecoin trading platform
-- Run with: psql $DATABASE_URL -f src/db/schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- === AUDIT LOG (Append-only, tamper-evident) ===
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('token', 'trade', 'position', 'wallet', 'system')),
    entity_id TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    reasoning TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
    error TEXT
);

-- Index for querying by entity
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_module ON audit_log(module);

-- === TOKENS (Discovered tokens with risk assessments) ===
CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    address TEXT NOT NULL,
    symbol TEXT,
    name TEXT,
    decimals INTEGER,
    
    -- Risk assessment data
    risk_score INTEGER CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical', 'blocked')),
    is_blocked BOOLEAN DEFAULT FALSE,
    block_reasons TEXT[],
    
    -- Contract analysis
    is_verified BOOLEAN,
    has_mint_authority BOOLEAN,
    has_freeze_authority BOOLEAN,
    is_ownership_renounced BOOLEAN,
    
    -- Liquidity data
    liquidity_usd NUMERIC(20, 8),
    pool_address TEXT,
    liquidity_locked_pct NUMERIC(5, 2),
    is_liquidity_burned BOOLEAN,
    
    -- Holder data
    holder_count INTEGER,
    top_holder_pct NUMERIC(5, 2),
    
    -- Metadata
    discovered_at TIMESTAMPTZ,
    last_assessed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(chain, address)
);

CREATE INDEX IF NOT EXISTS idx_tokens_chain ON tokens(chain);
CREATE INDEX IF NOT EXISTS idx_tokens_risk_score ON tokens(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_discovered ON tokens(discovered_at DESC);

-- === TRADES (All trade orders) ===
CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    token_id TEXT REFERENCES tokens(id),
    
    type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
    input_token TEXT NOT NULL,
    output_token TEXT NOT NULL,
    amount_input NUMERIC(36, 18),
    amount_output NUMERIC(36, 18),
    amount_usd NUMERIC(20, 8),
    
    status TEXT NOT NULL CHECK (status IN ('pending', 'simulating', 'submitted', 'filled', 'failed', 'cancelled')),
    
    -- Quote data
    price_impact NUMERIC(10, 8),
    slippage_bps INTEGER,
    
    -- Execution data
    simulation_passed BOOLEAN,
    simulation_error TEXT,
    signature TEXT,
    failure_reason TEXT,
    
    -- Timing
    created_at TIMESTAMPTZ DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    filled_at TIMESTAMPTZ,
    
    -- Reasoning
    risk_score INTEGER,
    reasoning TEXT
);

CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token_id);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);

-- === POSITIONS (Open and closed positions) ===
CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    token_id TEXT REFERENCES tokens(id),
    token_address TEXT NOT NULL,
    token_symbol TEXT,
    
    -- Entry data
    entry_price NUMERIC(36, 18) NOT NULL,
    amount NUMERIC(36, 18) NOT NULL,
    cost_basis_usd NUMERIC(20, 8) NOT NULL,
    
    -- Current state
    current_price NUMERIC(36, 18),
    value_usd NUMERIC(20, 8),
    unrealized_pnl_usd NUMERIC(20, 8) DEFAULT 0,
    unrealized_pnl_pct NUMERIC(10, 8) DEFAULT 0,
    realized_pnl_usd NUMERIC(20, 8) DEFAULT 0,
    
    -- Exit conditions
    stop_loss_price NUMERIC(36, 18),
    take_profit_price NUMERIC(36, 18),
    trailing_stop_active BOOLEAN DEFAULT FALSE,
    
    -- Status
    is_closed BOOLEAN DEFAULT FALSE,
    closed_at TIMESTAMPTZ,
    exit_reason TEXT,
    
    -- Timing
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_open ON positions(is_closed) WHERE NOT is_closed;
CREATE INDEX IF NOT EXISTS idx_positions_token ON positions(token_id);

-- === WALLETS (Trading wallets) ===
CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    address TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('hot', 'cold', 'hardware')),
    
    -- Limits
    spend_limit_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
    spent_today_usd NUMERIC(20, 8) DEFAULT 0,
    last_reset_date DATE,
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(chain, address)
);

CREATE INDEX IF NOT EXISTS idx_wallets_chain ON wallets(chain);
CREATE INDEX IF NOT EXISTS idx_wallets_active ON wallets(is_active);

-- === DAILY_STATS (For circuit breaker tracking) ===
CREATE TABLE IF NOT EXISTS daily_stats (
    date DATE PRIMARY KEY,
    opening_balance_usd NUMERIC(20, 8),
    closing_balance_usd NUMERIC(20, 8),
    total_pnl_usd NUMERIC(20, 8) DEFAULT 0,
    total_pnl_pct NUMERIC(10, 8) DEFAULT 0,
    trades_executed INTEGER DEFAULT 0,
    trades_won INTEGER DEFAULT 0,
    trades_lost INTEGER DEFAULT 0,
    max_drawdown_pct NUMERIC(10, 8) DEFAULT 0,
    circuit_breaker_triggered BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- === ALERTS (Notification history) ===
CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('discovery', 'trade', 'risk_block', 'stop_loss', 'circuit_breaker', 'error')),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_unacknowledged ON alerts(acknowledged) WHERE NOT acknowledged;
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);

-- === BACKTEST_RESULTS (Historical backtest runs) ===
CREATE TABLE IF NOT EXISTS backtest_results (
    id TEXT PRIMARY KEY,
    strategy_name TEXT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    initial_capital NUMERIC(20, 8) NOT NULL,
    final_capital NUMERIC(20, 8) NOT NULL,
    total_return_pct NUMERIC(10, 8),
    win_rate NUMERIC(5, 4),
    total_trades INTEGER,
    max_drawdown_pct NUMERIC(10, 8),
    sharpe_ratio NUMERIC(10, 4),
    trades_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- === Insert default daily stats for today ===
INSERT INTO daily_stats (date, opening_balance_usd)
VALUES (CURRENT_DATE, 0)
ON CONFLICT (date) DO NOTHING;
