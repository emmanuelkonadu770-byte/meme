import { RiskManagementConfig as RiskManagementConfigType, CircuitBreakerState, Position } from '../../core/types.js';
import { getEventBus, EventType } from '../../core/event-bus.js';
import { getAuditLogger } from '../../utils/logger.js';

/**
 * Default risk management configuration
 */
const DEFAULT_CONFIG: RiskManagementConfigType = {
  maxPositionSizePct: 5,
  maxConcurrentPositions: 10,
  maxDailyLossPct: 10,
  maxPerTokenExposurePct: 15,
  defaultSlippageBps: 50,
  riskScoreCutoff: 70,
};

// Type for risk management config (extended with trading-specific fields)
export interface RiskManagementConfig extends RiskManagementConfigType {
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopActive: boolean;
  trailingStopDistancePct: number;
}

/**
 * Risk Management & Position Sizing Module
 * 
 * Enforces hard limits on trading activity:
 * - Maximum position sizes
 * - Maximum concurrent positions
 * - Daily loss circuit breaker
 * - Per-token exposure caps
 * - Stop-loss and take-profit logic
 * 
 * All limits are enforced in CODE, not just UI suggestions.
 */
export class RiskManager {
  private config: RiskManagementConfig;
  private circuitBreaker: CircuitBreakerState = { isActive: false, reason: '', dailyLossPct: 0 };
  private killSwitchActive: boolean = false;
  private dailyPnlUsd: number = 0;
  private dailyStartBalance: number = 0;
  private eventBus = getEventBus();
  private auditLogger = getAuditLogger();
  
  constructor(config: Partial<RiskManagementConfig> = {}) {
    this.config = { 
      ...DEFAULT_CONFIG, 
      stopLossPct: 20,
      takeProfitPct: 50,
      trailingStopActive: false,
      trailingStopDistancePct: 10,
      ...config 
    };
    this.dailyStartBalance = 0; // Will be set when first position opens
  }
  
  /**
   * Check if a new trade is allowed under current risk limits
   * Returns approval status with reasoning
   */
  async checkTradeAllowed(
    proposedPositionUsd: number,
    tokenAddress: string,
    portfolioValueUsd: number,
    currentPositions: Position[]
  ): Promise<{ allowed: boolean; reason?: string }> {
    // 1. Check kill switch first (immediate block)
    if (this.killSwitchActive) {
      return {
        allowed: false,
        reason: 'Kill switch is active - all trading halted',
      };
    }
    
    // 2. Check circuit breaker
    if (this.circuitBreaker.isActive) {
      return {
        allowed: false,
        reason: `Circuit breaker active: ${this.circuitBreaker.reason}`,
      };
    }
    
    // 3. Check max concurrent positions
    const openPositions = currentPositions.filter(p => p.unrealizedPnlUsd !== 0);
    if (openPositions.length >= this.config.maxConcurrentPositions) {
      return {
        allowed: false,
        reason: `Max concurrent positions (${this.config.maxConcurrentPositions}) reached`,
      };
    }
    
    // 4. Check position size limit
    const maxPositionUsd = (portfolioValueUsd * this.config.maxPositionSizePct) / 100;
    if (proposedPositionUsd > maxPositionUsd) {
      return {
        allowed: false,
        reason: `Position size ${proposedPositionUsd} exceeds max ${maxPositionUsd} (${this.config.maxPositionSizePct}% of portfolio)`,
      };
    }
    
    // 5. Check per-token exposure cap
    const existingExposure = currentPositions
      .filter(p => p.tokenAddress === tokenAddress)
      .reduce((sum, p) => sum + p.valueUsd, 0);
    
    const maxExposureUsd = (portfolioValueUsd * this.config.maxPerTokenExposurePct) / 100;
    if (existingExposure + proposedPositionUsd > maxExposureUsd) {
      return {
        allowed: false,
        reason: `Total exposure to token would exceed ${this.config.maxPerTokenExposurePct}% limit`,
      };
    }
    
    // 6. Check daily loss limit (circuit breaker threshold)
    if (this.dailyPnlUsd < 0) {
      const dailyLossPct = Math.abs(this.dailyPnlUsd) / this.dailyStartBalance * 100;
      if (dailyLossPct >= this.config.maxDailyLossPct) {
        // Trigger circuit breaker
        await this.triggerCircuitBreaker(`Daily loss ${dailyLossPct.toFixed(2)}% exceeded ${this.config.maxDailyLossPct}% limit`);
        return {
          allowed: false,
          reason: `Daily loss limit (${this.config.maxDailyLossPct}%) exceeded`,
        };
      }
    }
    
    return { allowed: true };
  }
  
  /**
   * Calculate appropriate position size based on portfolio and risk settings
   */
  calculatePositionSize(
    portfolioValueUsd: number,
    tokenAddress: string,
    currentPositions: Position[],
    confidenceScore?: number // Optional: 0-100 score to adjust size
  ): number {
    // Base size is max position percentage
    let baseSize = (portfolioValueUsd * this.config.maxPositionSizePct) / 100;
    
    // Reduce size if we already have exposure to this token
    const existingExposure = currentPositions
      .filter(p => p.tokenAddress === tokenAddress)
      .reduce((sum, p) => sum + p.valueUsd, 0);
    
    const maxExposureUsd = (portfolioValueUsd * this.config.maxPerTokenExposurePct) / 100;
    const remainingExposure = maxExposureUsd - existingExposure;
    
    // Take minimum of base size and remaining exposure
    let adjustedSize = Math.min(baseSize, remainingExposure);
    
    // If confidence score provided, scale position accordingly
    if (confidenceScore !== undefined) {
      const confidenceMultiplier = Math.max(0.2, confidenceScore / 100);
      adjustedSize *= confidenceMultiplier;
    }
    
    return Math.round(adjustedSize * 100) / 100; // Round to 2 decimal places
  }
  
  /**
   * Check if any stop-loss or take-profit levels have been triggered
   * Call this continuously against live price feeds
   */
  async checkExitConditions(position: Position, currentPrice: number): Promise<{ shouldExit: boolean; reason: string; exitType?: 'stop_loss' | 'take_profit' | 'trailing_stop' }> {
    // Stop-loss check
    if (position.stopLossPrice && currentPrice <= position.stopLossPrice) {
      const lossPct = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
      await this.auditLogger.log({
        module: 'risk_manager',
        action: 'stop_loss_triggered',
        entityType: 'position',
        entityId: position.id,
        details: { currentPrice, stopLossPrice: position.stopLossPrice, lossPct },
        reasoning: `Price ${currentPrice} hit stop-loss at ${position.stopLossPrice}`,
        outcome: 'success',
      });
      
      this.eventBus.publish(EventType.STOP_LOSS_TRIGGERED, {
        positionId: position.id,
        lossPct,
      });
      
      return {
        shouldExit: true,
        reason: `Stop-loss triggered at ${currentPrice} (loss: ${lossPct.toFixed(2)}%)`,
        exitType: 'stop_loss',
      };
    }
    
    // Take-profit check
    if (position.takeProfitPrice && currentPrice >= position.takeProfitPrice) {
      const profitPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      await this.auditLogger.log({
        module: 'risk_manager',
        action: 'take_profit_triggered',
        entityType: 'position',
        entityId: position.id,
        details: { currentPrice, takeProfitPrice: position.takeProfitPrice, profitPct },
        reasoning: `Price ${currentPrice} hit take-profit at ${position.takeProfitPrice}`,
        outcome: 'success',
      });
      
      this.eventBus.publish(EventType.TAKE_PROFIT_TRIGGERED, {
        positionId: position.id,
        profitPct,
      });
      
      return {
        shouldExit: true,
        reason: `Take-profit triggered at ${currentPrice} (profit: ${profitPct.toFixed(2)}%)`,
        exitType: 'take_profit',
      };
    }
    
    // Trailing stop check
    if (position.trailingStopActive && position.stopLossPrice) {
      const trailDistance = ((currentPrice - position.stopLossPrice) / currentPrice) * 100;
      const targetTrailDistance = this.config.trailingStopDistancePct || 10;
      
      // If price has moved up enough, update trailing stop
      if (trailDistance > targetTrailDistance) {
        const newStopLoss = currentPrice * (1 - targetTrailDistance / 100);
        // Would update position's stopLossPrice here via portfolio manager
        return {
          shouldExit: false,
          reason: `Trailing stop updated to ${newStopLoss.toFixed(6)}`,
        };
      }
    }
    
    return { shouldExit: false, reason: 'No exit conditions met' };
  }
  
  /**
   * Activate the global kill switch
   * This immediately halts all automated trading
   */
  async activateKillSwitch(triggeredBy: string): Promise<void> {
    this.killSwitchActive = true;
    
    await this.auditLogger.log({
      module: 'risk_manager',
      action: 'kill_switch_activated',
      entityType: 'system',
      entityId: 'global',
      details: { triggeredBy },
      reasoning: 'Manual kill switch activation',
      outcome: 'success',
    });
    
    this.eventBus.publish(EventType.KILL_SWITCH_ACTIVATED, {
      triggeredBy,
      timestamp: new Date(),
    });
    
    console.warn('[RiskManager] KILL SWITCH ACTIVATED - All trading halted');
  }
  
  /**
   * Deactivate the kill switch
   */
  async deactivateKillSwitch(): Promise<void> {
    this.killSwitchActive = false;
    console.log('[RiskManager] Kill switch deactivated');
  }
  
  /**
   * Trigger the circuit breaker due to excessive losses
   */
  private async triggerCircuitBreaker(reason: string): Promise<void> {
    this.circuitBreaker = {
      isActive: true,
      triggeredAt: new Date(),
      reason,
      dailyLossPct: Math.abs(this.dailyPnlUsd) / this.dailyStartBalance * 100,
      autoResumeAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    };
    
    await this.auditLogger.log({
      module: 'risk_manager',
      action: 'circuit_breaker_triggered',
      entityType: 'system',
      entityId: 'global',
      details: { reason, dailyLossPct: this.circuitBreaker.dailyLossPct },
      reasoning: reason,
      outcome: 'success',
    });
    
    this.eventBus.publish(EventType.CIRCUIT_BREAKER_TRIGGERED, {
      reason,
      dailyLossPct: this.circuitBreaker.dailyLossPct,
    });
    
    console.warn(`[RiskManager] CIRCUIT BREAKER TRIGGERED: ${reason}`);
  }
  
  /**
   * Update daily PnL tracking
   */
  updateDailyPnl(pnlUsd: number): void {
    if (this.dailyStartBalance === 0) {
      this.dailyStartBalance = Math.abs(pnlUsd);
    }
    this.dailyPnlUsd = pnlUsd;
  }
  
  /**
   * Reset daily tracking (call at start of each trading day)
   */
  resetDailyTracking(): void {
    this.dailyPnlUsd = 0;
    this.dailyStartBalance = 0;
    if (this.circuitBreaker.isActive) {
      this.circuitBreaker.isActive = false;
      this.circuitBreaker.reason = '';
    }
  }
  
  /**
   * Get current circuit breaker state
   */
  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }
  
  /**
   * Check if kill switch is active
   */
  isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }
  
  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RiskManagementConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[RiskManager] Configuration updated:', newConfig);
  }
  
  /**
   * Get current configuration
   */
  getConfig(): RiskManagementConfig {
    return { ...this.config, stopLossPct: 20, takeProfitPct: 50, trailingStopActive: false, trailingStopDistancePct: 10 } as RiskManagementConfig;
  }
}
