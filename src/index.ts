import { loadConfig, Config } from './config/index.js';
import { getEventBus, EventType } from './core/event-bus.js';
import { getLogger, getAuditLogger } from './utils/logger.js';
import { RiskEngine } from './modules/risk/engine.js';
import { RiskManager } from './modules/risk/manager.js';
import { ExecutionEngine } from './modules/execution/engine.js';
import { TokenScanner } from './modules/discovery/scanner.js';
import { SolanaAdapter, createSolanaAdapter } from './adapters/solana.js';
import { adapterRegistry } from './adapters/interface.js';
import { startServer } from './server.js';

/**
 * Main application entry point
 * 
 * Initializes all modules and wires them together via the event bus.
 * Defaults to PAPER TRADING mode - live trading requires explicit opt-in.
 */

class TradingPlatform {
  private config: Config;
  private eventBus = getEventBus();
  private logger = getLogger();
  private auditLogger = getAuditLogger();
  
  // Core modules
  private riskEngine!: RiskEngine;
  private riskManager!: RiskManager;
  private tokenScanner!: TokenScanner;
  
  // Chain adapters
  private solanaAdapter!: SolanaAdapter;
  
  // State
  private running: boolean = false;
  private shutdownHandlers: Array<() => Promise<void>> = [];
  
  constructor(config?: Config) {
    this.config = config || loadConfig();
  }
  
  /**
   * Initialize all modules and register event handlers
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing Memecoin Trading Platform...');
    console.log(`📄 Mode: ${this.config.tradingMode.toUpperCase()} TRADING`);
    
    if (this.config.tradingMode === 'live') {
      console.warn('⚠️  ⚠️  ⚠️  LIVE TRADING MODE - REAL FUNDS AT RISK  ⚠️  ⚠️  ⚠️');
    }
    
    // 1. Initialize chain adapters
    console.log('🔌 Initializing chain adapters...');
    await this.initializeAdapters();
    
    // 2. Initialize risk management
    console.log('🛡️  Initializing risk management...');
    this.riskEngine = new RiskEngine(this.config.riskManagement.riskScoreCutoff);
    this.riskManager = new RiskManager({
      maxPositionSizePct: this.config.riskManagement.maxPositionSizePct,
      maxConcurrentPositions: this.config.riskManagement.maxConcurrentPositions,
      maxDailyLossPct: this.config.riskManagement.maxDailyLossPct,
      maxPerTokenExposurePct: this.config.riskManagement.maxPerTokenExposurePct,
      defaultSlippageBps: this.config.riskManagement.defaultSlippageBps,
    });
    
    // 3. Initialize execution engine
    console.log('⚡ Initializing execution engine...');
    new ExecutionEngine(
      this.config.tradingMode,
      this.riskEngine,
      this.riskManager
    );
    
    // 4. Initialize token scanner
    console.log('🔍 Initializing token scanner...');
    this.tokenScanner = new TokenScanner({
      minLiquidityUsd: 5000,
      minHolderCount: 10,
      chains: this.config.enabledChains,
      scanIntervalMs: 30000,
    });
    
    // 5. Wire up event handlers
    console.log('🔗 Wiring up event handlers...');
    this.setupEventHandlers();
    
    // 6. Register shutdown handlers
    this.registerShutdownHandlers();
    
    console.log('✅ Platform initialization complete');
  }
  
  /**
   * Initialize chain adapters and register them
   */
  private async initializeAdapters(): Promise<void> {
    // Initialize Solana adapter
    if (this.config.enabledChains.includes('solana')) {
      this.solanaAdapter = createSolanaAdapter(this.config.rpcEndpoints.solana);
      await this.solanaAdapter.initialize();
      adapterRegistry.register('solana', createSolanaAdapter);
      console.log('✅ Solana adapter initialized');
    }
    
    // EVM adapters would be initialized here
    // Ethereum, Base, Arbitrum, BSC
  }
  
  /**
   * Set up event handlers for inter-module communication
   */
  private setupEventHandlers(): void {
    // Handle new token discoveries
    this.eventBus.subscribe(EventType.TOKEN_DISCOVERED, async (event) => {
      this.logger?.info({
        module: 'discovery',
        event: 'token_discovered',
        token: event.tokenAddress,
        chain: event.chain,
        liquidity: event.liquidityUsd,
      });
      
      // Automatically run risk assessment on discovered tokens
      // In production, you might want more sophisticated filtering first
      await this.handleDiscoveredToken(event);
    });
    
    // Handle risk blocks
    this.eventBus.subscribe(EventType.RISK_BLOCKED, async (payload) => {
      this.logger?.warn({
        module: 'risk',
        event: 'token_blocked',
        token: payload.tokenId,
        reasons: payload.reasons,
      });
    });
    
    // Handle order fills
    this.eventBus.subscribe(EventType.ORDER_FILLED, async (payload) => {
      this.logger?.info({
        module: 'execution',
        event: 'order_filled',
        orderId: payload.orderId,
        signature: payload.signature,
      });
    });
    
    // Handle stop-loss triggers
    this.eventBus.subscribe(EventType.STOP_LOSS_TRIGGERED, async (payload) => {
      this.logger?.warn({
        module: 'risk_manager',
        event: 'stop_loss_triggered',
        positionId: payload.positionId,
        lossPct: payload.lossPct,
      });
    });
    
    // Handle circuit breaker
    this.eventBus.subscribe(EventType.CIRCUIT_BREAKER_TRIGGERED, async (payload) => {
      this.logger?.error({
        module: 'risk_manager',
        event: 'circuit_breaker',
        reason: payload.reason,
        dailyLossPct: payload.dailyLossPct,
      });
    });
    
    // Handle health check
    this.eventBus.subscribe(EventType.HEALTH_CHECK, async (payload) => {
      this.logger?.debug({
        module: 'system',
        event: 'health_check',
        healthy: payload.healthy,
      });
    });
  }
  
  /**
   * Handle a newly discovered token - run through risk engine and potentially execute
   */
  private async handleDiscoveredToken(event: { 
    tokenAddress: string; 
    chain: string; 
    liquidityUsd: number;
  }): Promise<void> {
    try {
      // Get appropriate adapter for the chain
      const adapter = event.chain === 'solana' ? this.solanaAdapter : null;
      
      if (!adapter) {
        this.logger?.warn({
          module: 'discovery',
          event: 'no_adapter_for_chain',
          chain: event.chain,
        });
        return;
      }
      
      // Run risk assessment
      const assessment = await this.riskEngine.assessToken(
        event.tokenAddress,
        event.chain as any,
        adapter,
        undefined // Would pass full discovery event
      );
      
      if (assessment.isBlocked) {
        this.logger?.info({
          module: 'discovery',
          event: 'token_blocked_by_risk',
          token: event.tokenAddress,
          score: assessment.overallScore,
          reasons: assessment.blockReasons,
        });
        return;
      }
      
      // If risk passes threshold, consider executing
      // In production, you'd have more sophisticated strategy logic here
      if (assessment.overallScore >= this.config.riskManagement.riskScoreCutoff) {
        this.logger?.info({
          module: 'discovery',
          event: 'token_passed_risk',
          token: event.tokenAddress,
          score: assessment.overallScore,
          action: 'considering_execution',
        });
        
        // Would call execution engine here based on strategy signals
        // For now, just log the opportunity
      }
    } catch (err) {
      this.logger?.error({
        module: 'discovery',
        event: 'error_handling_discovery',
        error: (err as Error).message,
      });
    }
  }
  
  /**
   * Start the platform
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('Platform is already running');
      return;
    }
    
    this.running = true;
    console.log('▶️  Platform started');
    
    // Start web server
    await startServer();
    
    // Sync bot status with server periodically
    this.syncBotStatus();
    
    // Start token scanner
    await this.tokenScanner.start();
    
    // Emit health check periodically
    setInterval(() => {
      this.eventBus.publish(EventType.HEALTH_CHECK, {
        module: 'platform',
        healthy: true,
      });
    }, 60000); // Every minute
  }
  
  /**
   * Sync bot status with web server periodically
   */
  private syncBotStatus(): void {
    import('http').then((http) => {
      setInterval(() => {
        const status = this.getStatus();
        const data = JSON.stringify({
          active: status.running && !status.killSwitchActive && !status.circuitBreakerActive,
          mode: status.mode,
          tradesExecuted: 0, // Would track actual trades
        });
        
        const req = http.default.request(
          `http://localhost:${process.env.PORT || 3000}/api/status`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': data.length,
            },
          },
          () => {}
        );
        
        req.on('error', () => {}); // Ignore errors
        req.write(data);
        req.end();
      }, 3000); // Every 3 seconds
    });
  }
  
  /**
   * Stop the platform gracefully
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    
    console.log('⏹️  Stopping platform...');
    this.running = false;
    
    // Stop scanner
    this.tokenScanner.stop();
    
    // Run shutdown handlers
    for (const handler of this.shutdownHandlers) {
      try {
        await handler();
      } catch (err) {
        console.error('Error in shutdown handler:', err);
      }
    }
    
    // Shutdown event bus
    await this.eventBus.shutdown();
    
    // Shutdown audit logger
    await this.auditLogger.shutdown();
    
    console.log('✅ Platform stopped');
  }
  
  /**
   * Register shutdown handlers for graceful cleanup
   */
  private registerShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // Handle uncaught errors
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err);
      this.auditLogger.log({
        module: 'system',
        action: 'uncaught_exception',
        entityType: 'system',
        entityId: 'global',
        details: { message: err.message },
        reasoning: 'Unhandled exception',
        outcome: 'failure',
        error: err.message,
      });
    });
    
    // Handle unhandled rejections
    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled rejection:', reason);
    });
  }
  
  /**
   * Get platform status
   */
  getStatus(): {
    running: boolean;
    mode: 'paper' | 'live';
    enabledChains: string[];
    riskScoreCutoff: number;
    killSwitchActive: boolean;
    circuitBreakerActive: boolean;
  } {
    return {
      running: this.running,
      mode: this.config.tradingMode,
      enabledChains: this.config.enabledChains,
      riskScoreCutoff: this.config.riskManagement.riskScoreCutoff,
      killSwitchActive: this.riskManager?.isKillSwitchActive() || false,
      circuitBreakerActive: this.riskManager?.getCircuitBreakerState().isActive || false,
    };
  }
  
  /**
   * Activate kill switch
   */
  async activateKillSwitch(triggeredBy: string): Promise<void> {
    await this.riskManager.activateKillSwitch(triggeredBy);
  }
  
  /**
   * Deactivate kill switch
   */
  async deactivateKillSwitch(): Promise<void> {
    await this.riskManager.deactivateKillSwitch();
  }
}

// Main entry point
async function main(): Promise<void> {
  try {
    const platform = new TradingPlatform();
    await platform.initialize();
    await platform.start();
    
    console.log('\n========================================');
    console.log('  Memecoin Trading Platform Running');
    console.log('========================================');
    console.log(`Mode: ${platform.getStatus().mode.toUpperCase()}`);
    console.log(`Chains: ${platform.getStatus().enabledChains.join(', ')}`);
    console.log('Press Ctrl+C to stop\n');
    
  } catch (err) {
    console.error('Failed to start platform:', err);
    process.exit(1);
  }
}

// Export for programmatic use
export { TradingPlatform };

// Run if executed directly
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  main();
}
