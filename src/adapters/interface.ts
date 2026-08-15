import { Chain } from '../config/index.js';
import { TokenMetadata, LiquidityInfo, SwapQuote, TransactionSignature } from '../core/types.js';

/**
 * Abstract interface for chain-specific implementations.
 * All chain adapters must implement this interface.
 */
export interface ChainAdapter {
  /**
   * The chain this adapter handles
   */
  readonly chain: Chain;
  
  /**
   * Initialize the adapter (establish RPC connections, etc.)
   */
  initialize(): Promise<void>;
  
  /**
   * Check if the adapter is healthy and connected
   */
  isHealthy(): Promise<boolean>;
  
  // === Token Operations ===
  
  /**
   * Get token metadata (name, symbol, decimals, etc.)
   */
  getTokenMetadata(tokenAddress: string): Promise<TokenMetadata>;
  
  /**
   * Get liquidity information for a token pair
   */
  getLiquidity(tokenAddress: string, quoteToken: string): Promise<LiquidityInfo>;
  
  /**
   * Get current price of a token
   */
  getPrice(tokenAddress: string, quoteToken?: string): Promise<number>;
  
  // === Swap Operations ===
  
  /**
   * Get a swap quote from a DEX aggregator
   */
  getSwapQuote(
    inputToken: string,
    outputToken: string,
    amount: bigint,
    slippageBps: number
  ): Promise<SwapQuote>;
  
  /**
   * Build a swap transaction (unsigned)
   */
  buildSwapTransaction(
    quote: SwapQuote,
    walletAddress: string
  ): Promise<unknown>;
  
  /**
   * Simulate a transaction without submitting it
   * Returns success status and any error messages
   */
  simulateTransaction(tx: unknown): Promise<SimulationResult>;
  
  /**
   * Submit a signed transaction to the network
   */
  submitTransaction(signedTx: unknown): Promise<TransactionSignature>;
  
  // === Contract Analysis ===
  
  /**
   * Analyze a token contract for rug-pull indicators
   */
  analyzeContract(tokenAddress: string): Promise<ContractAnalysis>;
  
  /**
   * Check if a token is a honeypot (can you actually sell?)
   */
  checkHoneypot(tokenAddress: string): Promise<HoneypotCheckResult>;
  
  // === Holder Analysis ===
  
  /**
   * Get top holders of a token
   */
  getTopHolders(tokenAddress: string, limit?: number): Promise<HolderInfo[]>;
  
  /**
   * Get total supply and circulating supply
   */
  getSupplyInfo(tokenAddress: string): Promise<SupplyInfo>;
}

/**
 * Result of transaction simulation
 */
export interface SimulationResult {
  success: boolean;
  errorMessage?: string;
  logs?: string[];
  gasUsed?: bigint;
}

/**
 * Contract analysis result for risk assessment
 */
export interface ContractAnalysis {
  isVerified: boolean;
  isProxy: boolean;
  isUpgradeable: boolean;
  ownerAddress?: string;
  isOwnershipRenounced: boolean;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  hasMintAuthority: boolean;
  hasFreezeAuthority: boolean;
  suspiciousFunctions: string[];
}

/**
 * Honeypot check result
 */
export interface HoneypotCheckResult {
  isHoneypot: boolean;
  canBuy: boolean;
  canSell: boolean;
  buyTax: number;
  sellTax: number;
  transferTax: number;
  reasons: string[];
}

/**
 * Holder information
 */
export interface HolderInfo {
  address: string;
  balance: bigint;
  percentage: number;
  isContract: boolean;
  label?: string; // e.g., "dev", "bundler", "sniper"
}

/**
 * Supply information
 */
export interface SupplyInfo {
  totalSupply: bigint;
  circulatingSupply: bigint;
  maxSupply?: bigint;
}

/**
 * Factory function type for creating chain adapters
 */
export type ChainAdapterFactory = (rpcUrl: string) => ChainAdapter;

/**
 * Registry for chain adapters
 */
export class AdapterRegistry {
  private adapters: Map<Chain, ChainAdapterFactory> = new Map();
  
  register(chain: Chain, factory: ChainAdapterFactory): void {
    this.adapters.set(chain, factory);
  }
  
  create(chain: Chain, rpcUrl: string): ChainAdapter | null {
    const factory = this.adapters.get(chain);
    if (!factory) {
      return null;
    }
    return factory(rpcUrl);
  }
  
  getSupportedChains(): Chain[] {
    return Array.from(this.adapters.keys());
  }
}

// Global registry instance
export const adapterRegistry = new AdapterRegistry();
