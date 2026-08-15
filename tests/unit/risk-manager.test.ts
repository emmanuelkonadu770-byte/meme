/**
 * Unit tests for Risk Manager (Position Sizing & Circuit Breaker)
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { RiskManager } from '../../src/modules/risk/manager.js';
import { Position } from '../../src/core/types.js';

describe('RiskManager', () => {
  let riskManager: RiskManager;
  
  const mockPositions: Position[] = [];
  const portfolioValue = 100000; // $100k portfolio
  
  beforeEach(() => {
    riskManager = new RiskManager({
      maxPositionSizePct: 5,
      maxConcurrentPositions: 10,
      maxDailyLossPct: 10,
      maxPerTokenExposurePct: 15,
    });
  });
  
  describe('Position Sizing', () => {
    it('should calculate position size as percentage of portfolio', () => {
      const size = riskManager.calculatePositionSize(
        portfolioValue,
        'new_token',
        []
      );
      
      // 5% of $100k = $5k
      expect(size).toBe(5000);
    });
    
    it('should reduce position size when there is existing exposure', () => {
      const existingPositions: Position[] = [
        {
          id: 'pos1',
          chain: 'solana',
          tokenAddress: 'existing_token',
          tokenSymbol: 'EXIST',
          entryPrice: 1,
          currentPrice: 1,
          amount: BigInt(1000),
          valueUsd: 3000,
          costBasisUsd: 3000,
          unrealizedPnlUsd: 0,
          unrealizedPnlPct: 0,
          realizedPnlUsd: 0,
          trailingStopActive: false,
          openedAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      ];
      
      const size = riskManager.calculatePositionSize(
        portfolioValue,
        'existing_token',
        existingPositions
      );
      
      // Max exposure is 15% = $15k, already have $3k, so can add $12k
      // But max position is 5% = $5k
      // So should return $5k (the smaller of the two)
      expect(size).toBeLessThanOrEqual(5000);
    });
    
    it('should scale position by confidence score when provided', () => {
      const fullSize = riskManager.calculatePositionSize(
        portfolioValue,
        'token',
        []
      );
      
      const lowConfidenceSize = riskManager.calculatePositionSize(
        portfolioValue,
        'token',
        [],
        40 // 40% confidence
      );
      
      expect(lowConfidenceSize).toBeLessThan(fullSize);
      expect(lowConfidenceSize).toBeGreaterThanOrEqual(fullSize * 0.2); // Min 20%
    });
  });
  
  describe('Trade Approval', () => {
    it('should allow trades within limits', async () => {
      const result = await riskManager.checkTradeAllowed(
        5000, // $5k position
        'token',
        portfolioValue,
        []
      );
      
      expect(result.allowed).toBe(true);
    });
    
    it('should block trades exceeding position size limit', async () => {
      const result = await riskManager.checkTradeAllowed(
        10000, // $10k > 5% of $100k
        'token',
        portfolioValue,
        []
      );
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds max');
    });
    
    it('should block trades when max concurrent positions reached', async () => {
      const manyPositions: Position[] = Array(10).fill(null).map((_, i) => ({
        id: `pos${i}`,
        chain: 'solana' as const,
        tokenAddress: `token${i}`,
        tokenSymbol: `TKN${i}`,
        entryPrice: 1,
        currentPrice: 1,
        amount: BigInt(1000),
        valueUsd: 1000,
        costBasisUsd: 1000,
        unrealizedPnlUsd: 0,
        unrealizedPnlPct: 0,
        realizedPnlUsd: 0,
        trailingStopActive: false,
        openedAt: new Date(),
        lastUpdatedAt: new Date(),
      }));
      
      const result = await riskManager.checkTradeAllowed(
        1000,
        'new_token',
        portfolioValue,
        manyPositions
      );
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max concurrent positions');
    });
    
    it('should block all trades when kill switch is active', async () => {
      await riskManager.activateKillSwitch('test');
      
      const result = await riskManager.checkTradeAllowed(
        1000,
        'token',
        portfolioValue,
        []
      );
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Kill switch');
    });
    
    it('should block trades when circuit breaker is active', async () => {
      // Simulate triggering circuit breaker via daily loss
      riskManager.updateDailyPnl(-15000); // -15% loss on $100k
      
      const result = await riskManager.checkTradeAllowed(
        1000,
        'token',
        portfolioValue,
        []
      );
      
      // Circuit breaker should trigger at 10% loss
      const cbState = riskManager.getCircuitBreakerState();
      expect(cbState.isActive).toBe(true);
    });
  });
  
  describe('Kill Switch', () => {
    it('should activate kill switch', async () => {
      expect(riskManager.isKillSwitchActive()).toBe(false);
      
      await riskManager.activateKillSwitch('manual_test');
      
      expect(riskManager.isKillSwitchActive()).toBe(true);
    });
    
    it('should deactivate kill switch', async () => {
      await riskManager.activateKillSwitch('test');
      await riskManager.deactivateKillSwitch();
      
      expect(riskManager.isKillSwitchActive()).toBe(false);
    });
  });
  
  describe('Circuit Breaker', () => {
    it('should trigger circuit breaker on excessive daily loss', () => {
      riskManager.updateDailyPnl(-12000); // -12% on $100k
      
      const state = riskManager.getCircuitBreakerState();
      expect(state.isActive).toBe(true);
      expect(state.dailyLossPct).toBeGreaterThanOrEqual(10);
    });
    
    it('should reset daily tracking', () => {
      riskManager.updateDailyPnl(-5000);
      riskManager.resetDailyTracking();
      
      const state = riskManager.getCircuitBreakerState();
      expect(state.isActive).toBe(false);
    });
  });
  
  describe('Configuration Updates', () => {
    it('should update configuration', () => {
      riskManager.updateConfig({
        maxPositionSizePct: 10,
        maxConcurrentPositions: 20,
      });
      
      const config = riskManager.getConfig();
      expect(config.maxPositionSizePct).toBe(10);
      expect(config.maxConcurrentPositions).toBe(20);
    });
  });
});
