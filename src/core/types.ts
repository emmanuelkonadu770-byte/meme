import { Chain, RiskLevel } from '../config/index.js';

// Re-export these types so they can be imported from core/types
export { Chain, RiskLevel };

/**
 * Token metadata
 */
export interface TokenMetadata {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  uri?: string;
  logoURI?: string;
  chain: Chain;
}

/**
 * Liquidity pool information
 */
export interface LiquidityInfo {
  poolAddress: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  lockedPercentage?: number;
  lockExpiry?: Date;
  isBurned: boolean;
  ageInHours: number;
}

/**
 * Swap quote from DEX aggregator
 */
export interface SwapQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: bigint;
  outputAmount: bigint;
  priceImpact: number;
  slippageBps: number;
  route: string[]; // Array of intermediate tokens/pools
  aggregator: string; // e.g., "Jupiter", "1inch"
  expiresAt: Date;
  estimatedGas: bigint;
}

/**
 * Transaction signature
 */
export interface TransactionSignature {
  signature: string;
  blockNumber?: number;
  timestamp: Date;
  status: 'pending' | 'confirmed' | 'failed';
  explorerUrl?: string;
}

/**
 * Risk management configuration
 */
export interface RiskManagementConfig {
  maxPositionSizePct: number;
  maxConcurrentPositions: number;
  maxDailyLossPct: number;
  maxPerTokenExposurePct: number;
  defaultSlippageBps: number;
  riskScoreCutoff: number;
}

/**
 * Trade order
 */
export interface TradeOrder {
  id: string;
  chain: Chain;
  type: 'buy' | 'sell';
  inputToken: string;
  outputToken: string;
  amount: bigint;
  minOutput: bigint; // After slippage
  quote: SwapQuote;
  status: 'pending' | 'simulating' | 'submitted' | 'filled' | 'failed' | 'cancelled';
  createdAt: Date;
  submittedAt?: Date;
  filledAt?: Date;
  simulationPassed?: boolean;
  signature?: string;
  failureReason?: string;
  entryPrice?: number; // Price at which position was entered
}

/**
 * Position in a token
 */
export interface Position {
  id: string;
  chain: Chain;
  tokenAddress: string;
  tokenSymbol: string;
  entryPrice: number;
  currentPrice: number;
  amount: bigint;
  valueUsd: number;
  costBasisUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  realizedPnlUsd: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopActive: boolean;
  openedAt: Date;
  lastUpdatedAt: Date;
}

/**
 * Discovered token event from scanner
 */
export interface TokenDiscoveryEvent {
  id: string;
  chain: Chain;
  tokenAddress: string;
  pairAddress: string;
  quoteToken: string;
  liquidityUsd: number;
  priceUsd: number;
  holderCount: number;
  ageInMinutes: number;
  dex: string;
  discoveredAt: Date;
}

/**
 * Risk assessment result with detailed breakdown
 */
export interface RiskAssessment {
  tokenId: string;
  overallScore: number; // 0-100, higher is safer
  riskLevel: RiskLevel;
  isBlocked: boolean;
  blockReasons: string[];
  
  // Detailed breakdown
  contractRisk: ContractRiskScore;
  liquidityRisk: LiquidityRiskScore;
  holderRisk: HolderRiskScore;
  
  assessedAt: Date;
}

export interface ContractRiskScore {
  score: number;
  isVerified: boolean;
  isProxy: boolean;
  isUpgradeable: boolean;
  hasMintAuthority: boolean;
  hasFreezeAuthority: boolean;
  isOwnershipRenounced: boolean;
  suspiciousFunctions: string[];
}

export interface LiquidityRiskScore {
  score: number;
  isLocked: boolean;
  isBurned: boolean;
  lockPercentage: number;
  poolAgeInHours: number;
  lpConcentration: number; // Top LP holder %
}

export interface HolderRiskScore {
  score: number;
  topHolderPercentage: number;
  top10HolderPercentage: number;
  devWalletPercentage: number;
  sniperWalletCount: number;
  bundleDetection: boolean;
}

/**
 * Portfolio summary
 */
export interface PortfolioSummary {
  totalValueUsd: number;
  totalCostBasisUsd: number;
  totalUnrealizedPnlUsd: number;
  totalUnrealizedPnlPct: number;
  totalRealizedPnlUsd: number;
  positionsCount: number;
  positions: Position[];
  dailyPnlUsd: number;
  dailyPnlPct: number;
}

/**
 * Wallet information
 */
export interface WalletInfo {
  id: string;
  chain: Chain;
  address: string;
  label: string;
  type: 'hot' | 'cold' | 'hardware';
  spendLimitUsd: number;
  spentTodayUsd: number;
  isActive: boolean;
}

/**
 * Audit log entry - append-only
 */
export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  module: string;
  action: string;
  entityType: 'token' | 'trade' | 'position' | 'wallet' | 'system';
  entityId: string;
  details: Record<string, unknown>;
  reasoning?: string; // Why this decision was made
  outcome: 'success' | 'failure' | 'blocked';
  error?: string;
}

/**
 * Alert notification
 */
export interface Alert {
  id: string;
  type: 'discovery' | 'trade' | 'risk_block' | 'stop_loss' | 'circuit_breaker' | 'error';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: Date;
  acknowledged: boolean;
}

/**
 * Circuit breaker state
 */
export interface CircuitBreakerState {
  isActive: boolean;
  triggeredAt?: Date;
  reason: string;
  dailyLossPct: number;
  autoResumeAt?: Date;
}

/**
 * Backtest result
 */
export interface BacktestResult {
  strategyName: string;
  period: { start: Date; end: Date };
  initialCapital: number;
  finalCapital: number;
  totalReturnPct: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgWinPct: number;
  avgLossPct: number;
  worstTradePct: number;
  bestTradePct: number;
  trades: BacktestTrade[];
}

export interface BacktestTrade {
  id: string;
  tokenAddress: string;
  type: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  pnlUsd: number;
  enteredAt: Date;
  exitedAt: Date;
  exitReason: string;
}
