import { TokenDiscoveryEvent, Chain } from '../../core/types.js';
import { getEventBus, EventType } from '../../core/event-bus.js';

/**
 * Token Discovery / Scanner Module
 * 
 * Watches for new token pair creations on DEXs:
 * - Solana: Raydium, Orca via Jupiter API
 * - EVM: Uniswap, Aerodrome, etc.
 * 
 * Emits discovery events for downstream modules (risk engine).
 */
export interface ScannerConfig {
  minLiquidityUsd: number;
  minHolderCount: number;
  maxAgeInMinutes: number;
  chains: Chain[];
  dexes: string[];
  scanIntervalMs: number;
}

const DEFAULT_CONFIG: ScannerConfig = {
  minLiquidityUsd: 5000,
  minHolderCount: 10,
  maxAgeInMinutes: 60,
  chains: ['solana'],
  dexes: ['raydium', 'orca'],
  scanIntervalMs: 30000, // 30 seconds
};

export class TokenScanner {
  private config: ScannerConfig;
  private eventBus = getEventBus();
  private scanning: boolean = false;
  private scanInterval?: NodeJS.Timeout;
  private discoveredTokens: Map<string, TokenDiscoveryEvent> = new Map();
  
  constructor(config: Partial<ScannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Start scanning for new tokens
   */
  async start(): Promise<void> {
    if (this.scanning) {
      console.log('[TokenScanner] Already scanning');
      return;
    }
    
    this.scanning = true;
    console.log(`[TokenScanner] Starting scan with config:`, this.config);
    
    // Initial scan
    await this.scanOnce();
    
    // Set up periodic scanning
    this.scanInterval = setInterval(async () => {
      await this.scanOnce();
    }, this.config.scanIntervalMs);
  }
  
  /**
   * Stop scanning
   */
  stop(): void {
    this.scanning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = undefined;
    }
    console.log('[TokenScanner] Stopped scanning');
  }
  
  /**
   * Perform a single scan across all configured chains and DEXes
   */
  private async scanOnce(): Promise<void> {
    try {
      const promises: Promise<void>[] = [];
      
      for (const chain of this.config.chains) {
        if (chain === 'solana') {
          promises.push(this.scanSolana());
        } else if (chain === 'ethereum') {
          promises.push(this.scanEVM('ethereum'));
        } else if (chain === 'base') {
          promises.push(this.scanEVM('base'));
        } else if (chain === 'arbitrum') {
          promises.push(this.scanEVM('arbitrum'));
        } else if (chain === 'bsc') {
          promises.push(this.scanEVM('bsc'));
        }
      }
      
      await Promise.allSettled(promises);
    } catch (err) {
      console.error('[TokenScanner] Error during scan:', err);
    }
  }
  
  /**
   * Scan Solana DEXes for new pairs
   */
  private async scanSolana(): Promise<void> {
    try {
      // In production, would use:
      // 1. Raydium SDK or API for new pool events
      // 2. Jupiter API for new token listings
      // 3. Direct RPC subscription to program logs
      
      // Placeholder: Fetch from Jupiter new tokens endpoint
      // This is a simplified example
      const response = await fetch('https://api.jup.ag/tokens/v2?limit=50&sort=liquidity.desc');
      
      if (!response.ok) {
        return;
      }
      
      const data: any = await response.json();
      const tokens = data.data || [];
      
      for (const token of tokens.slice(0, 10)) {
        // Check if already discovered
        if (this.discoveredTokens.has(`solana:${token.address}`)) {
          continue;
        }
        
        // Apply filters
        const liquidityUsd = token.liquidity?.usd || 0;
        if (liquidityUsd < this.config.minLiquidityUsd) {
          continue;
        }
        
        // Create discovery event
        const event: TokenDiscoveryEvent = {
          id: `solana:${token.address}:${Date.now()}`,
          chain: 'solana',
          tokenAddress: token.address,
          pairAddress: '', // Would get from DEX
          quoteToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
          liquidityUsd,
          priceUsd: token.price || 0,
          holderCount: token.holders || 0,
          ageInMinutes: 0, // Would calculate from first trade
          dex: 'jupiter',
          discoveredAt: new Date(),
        };
        
        // Only emit if passes basic filters
        if (event.holderCount >= this.config.minHolderCount) {
          this.discoveredTokens.set(`solana:${token.address}`, event);
          this.eventBus.publish(EventType.TOKEN_DISCOVERED, event);
          console.log(`[TokenScanner] Discovered new Solana token: ${token.symbol || 'UNKNOWN'} (${token.address})`);
        }
      }
    } catch (err) {
      console.error('[TokenScanner] Solana scan error:', err);
    }
  }
  
  /**
   * Scan EVM chains for new pairs
   * In production, would use:
   * - Uniswap Subgraph
   * - DexScreener API
   * - Direct contract event listening
   */
  private async scanEVM(chain: Chain): Promise<void> {
    // Placeholder for EVM scanning
    // Would implement similar logic to scanSolana but for EVM DEXes
    
    console.log(`[TokenScanner] EVM scan for ${chain} - not yet implemented`);
  }
  
  /**
   * Get recently discovered tokens
   */
  getRecentDiscoveries(limit: number = 50): TokenDiscoveryEvent[] {
    return Array.from(this.discoveredTokens.values())
      .sort((a, b) => b.discoveredAt.getTime() - a.discoveredAt.getTime())
      .slice(0, limit);
  }
  
  /**
   * Clear old discoveries to prevent memory growth
   */
  cleanupOldDiscoveries(maxAgeHours: number = 24): void {
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    
    for (const [key, event] of this.discoveredTokens.entries()) {
      if (event.discoveredAt.getTime() < cutoff) {
        this.discoveredTokens.delete(key);
      }
    }
  }
  
  /**
   * Update scanner configuration
   */
  updateConfig(newConfig: Partial<ScannerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[TokenScanner] Configuration updated:', newConfig);
  }
}
