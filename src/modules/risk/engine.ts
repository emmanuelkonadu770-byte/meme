import { RiskAssessment, TokenDiscoveryEvent, ContractRiskScore, LiquidityRiskScore, HolderRiskScore, LiquidityInfo } from '../../core/types.js';
import { RiskLevel, Chain } from '../../config/index.js';
import { ChainAdapter, ContractAnalysis, HoneypotCheckResult, HolderInfo } from '../../adapters/interface.js';
import { getAuditLogger } from '../../utils/logger.js';

/**
 * Hard blocklist conditions - if ANY of these are true, the token is automatically blocked
 * regardless of overall risk score.
 * These are used in the checkHardBlocks method below.
 */

/**
 * Risk scoring weights
 */
const WEIGHTS = {
  contractRisk: 0.35,
  liquidityRisk: 0.35,
  holderRisk: 0.30,
};

/**
 * Risk & Rug-Detection Engine
 * 
 * This is the most critical module - it acts as a HARD GATE.
 * No trade can proceed without passing through this engine.
 * 
 * The engine provides:
 * - Transparent scoring (not a black box)
 * - Hard blocklist for disqualifying conditions
 * - Detailed breakdown of each risk factor
 */
export class RiskEngine {
  private riskScoreCutoff: number;
  private auditLogger = getAuditLogger();
  
  constructor(riskScoreCutoff: number = 70) {
    this.riskScoreCutoff = riskScoreCutoff;
  }
  
  /**
   * Perform comprehensive risk assessment on a token
   * This is the main entry point - call this before any trade
   */
  async assessToken(
    tokenAddress: string,
    chain: Chain,
    adapter: ChainAdapter,
    discoveryEvent?: TokenDiscoveryEvent
  ): Promise<RiskAssessment> {
    const tokenId = `${chain}:${tokenAddress}`;
    
    try {
      // Run all analyses in parallel for speed
      const [contractAnalysis, honeypotCheck, topHolders, supplyInfo] = await Promise.allSettled([
        adapter.analyzeContract(tokenAddress),
        adapter.checkHoneypot(tokenAddress),
        adapter.getTopHolders(tokenAddress, 20),
        adapter.getSupplyInfo(tokenAddress),
      ]);
      
      // Handle failures - fail closed (block on uncertainty)
      if (contractAnalysis.status === 'rejected') {
        return this.createBlockedAssessment(
          tokenId,
          'Failed to analyze contract - blocking due to uncertainty'
        );
      }
      
      if (honeypotCheck.status === 'rejected') {
        return this.createBlockedAssessment(
          tokenId,
          'Failed to check honeypot status - blocking due to uncertainty'
        );
      }
      
      const contractData = contractAnalysis.value;
      const honeypotData = honeypotCheck.value;
      const holders = topHolders.status === 'fulfilled' ? topHolders.value : [];
      const supply = supplyInfo.status === 'fulfilled' ? supplyInfo.value : null;
      
      // Build LiquidityInfo from discovery event if available
      let liquidity: LiquidityInfo | null = null;
      if (discoveryEvent) {
        // Create minimal LiquidityInfo from discovery event
        liquidity = {
          poolAddress: discoveryEvent.pairAddress,
          token0: tokenAddress,
          token1: discoveryEvent.quoteToken,
          reserve0: 0n,
          reserve1: 0n,
          totalSupply: 0n,
          isBurned: false,
          ageInHours: discoveryEvent.ageInMinutes / 60,
        };
      }
      
      // Check hard block conditions first
      const blockReasons = this.checkHardBlocks(contractData, honeypotData, holders, supply);
      
      if (blockReasons.length > 0) {
        const assessment = this.createBlockedAssessment(tokenId, blockReasons.join('; '));
        await this.auditLogger.logRiskAssessment({
          tokenId,
          overallScore: assessment.overallScore,
          riskLevel: assessment.riskLevel,
          isBlocked: assessment.isBlocked,
          blockReasons,
          assessedAt: assessment.assessedAt,
        });
        return assessment;
      }
      
      // Calculate detailed risk scores
      const contractRisk = this.scoreContractRisk(contractData);
      const liquidityRisk = this.scoreLiquidityRisk(liquidity, discoveryEvent);
      const holderRisk = this.scoreHolderRisk(holders, supply);
      
      // Calculate overall score (weighted average)
      const overallScore = Math.round(
        contractRisk.score * WEIGHTS.contractRisk +
        liquidityRisk.score * WEIGHTS.liquidityRisk +
        holderRisk.score * WEIGHTS.holderRisk
      );
      
      // Determine risk level
      const riskLevel = this.determineRiskLevel(overallScore);
      
      // Check if below cutoff
      const isBlocked = overallScore < this.riskScoreCutoff;
      
      const assessment: RiskAssessment = {
        tokenId,
        overallScore,
        riskLevel,
        isBlocked,
        blockReasons: isBlocked ? [`Risk score ${overallScore} below cutoff ${this.riskScoreCutoff}`] : [],
        contractRisk,
        liquidityRisk,
        holderRisk,
        assessedAt: new Date(),
      };
      
      // Log assessment
      await this.auditLogger.logRiskAssessment({
        tokenId,
        overallScore,
        riskLevel: riskLevel,
        isBlocked,
        blockReasons: assessment.blockReasons,
        assessedAt: assessment.assessedAt,
      });
      
      return assessment;
    } catch (err) {
      console.error('[RiskEngine] Unexpected error during assessment:', err);
      // Fail closed - block on any unhandled error
      return this.createBlockedAssessment(
        tokenId,
        `Unexpected error during risk assessment: ${(err as Error).message}`
      );
    }
  }
  
  /**
   * Check hard block conditions
   */
  private checkHardBlocks(
    contract: ContractAnalysis,
    honeypot: HoneypotCheckResult,
    holders: HolderInfo[],
    supply: { totalSupply: bigint; circulatingSupply: bigint } | null
  ): string[] {
    const reasons: string[] = [];
    
    // 1. Active mint authority with unlocked liquidity
    if (contract.hasMintAuthority) {
      reasons.push('Active mint authority with unlocked liquidity');
    }
    
    // 2. Active freeze authority
    if (contract.hasFreezeAuthority) {
      reasons.push('Active freeze authority');
    }
    
    // 3. Confirmed honeypot
    if (honeypot.isHoneypot || !honeypot.canSell) {
      reasons.push('Confirmed honeypot (cannot sell)');
    }
    
    // 4. Ownership not renounced with high LP concentration
    if (!contract.isOwnershipRenounced && holders.length > 0) {
      const topHolderPct = holders[0]?.percentage || 0;
      if (topHolderPct > 30) {
        reasons.push('Ownership not renounced with high LP concentration');
      }
    }
    
    // 5. Bundle/sniper detection
    if (supply && holders.length > 0) {
      const top5Supply = holders.slice(0, 5).reduce((sum, h) => sum + h.percentage, 0);
      if (top5Supply > 50) {
        reasons.push('Bundle/sniper detection with >50% supply');
      }
    }
    
    return reasons;
  }
  
  /**
   * Score contract risk (0-100, higher is safer)
   */
  private scoreContractRisk(contract: ContractAnalysis): ContractRiskScore {
    let score = 100;
    const issues: string[] = [];
    
    // Verified contract (+0 penalty)
    if (!contract.isVerified) {
      score -= 20;
      issues.push('Unverified contract');
    }
    
    // Not a proxy (+0 penalty)
    if (contract.isProxy) {
      score -= 15;
      issues.push('Proxy contract');
    }
    
    // Not upgradeable (+0 penalty)
    if (contract.isUpgradeable) {
      score -= 15;
      issues.push('Upgradeable contract');
    }
    
    // Mint authority renounced (+0 penalty)
    if (contract.hasMintAuthority) {
      score -= 30;
      issues.push('Mint authority active');
    }
    
    // Freeze authority renounced (+0 penalty)
    if (contract.hasFreezeAuthority) {
      score -= 25;
      issues.push('Freeze authority active');
    }
    
    // Ownership renounced (+10 bonus already included in base)
    if (!contract.isOwnershipRenounced) {
      score -= 10;
      issues.push('Ownership not renounced');
    }
    
    // Suspicious functions
    if (contract.suspiciousFunctions.length > 0) {
      score -= Math.min(20, contract.suspiciousFunctions.length * 5);
      issues.push(`Suspicious functions: ${contract.suspiciousFunctions.join(', ')}`);
    }
    
    return {
      score: Math.max(0, score),
      isVerified: contract.isVerified,
      isProxy: contract.isProxy,
      isUpgradeable: contract.isUpgradeable,
      hasMintAuthority: contract.hasMintAuthority,
      hasFreezeAuthority: contract.hasFreezeAuthority,
      isOwnershipRenounced: contract.isOwnershipRenounced,
      suspiciousFunctions: contract.suspiciousFunctions,
    };
  }
  
  /**
   * Score liquidity risk (0-100, higher is safer)
   */
  private scoreLiquidityRisk(
    liquidity: LiquidityInfo | null,
    _discoveryEvent?: TokenDiscoveryEvent
  ): LiquidityRiskScore {
    let score = 100;
    
    if (!liquidity) {
      return {
        score: 0,
        isLocked: false,
        isBurned: false,
        lockPercentage: 0,
        poolAgeInHours: 0,
        lpConcentration: 100,
      };
    }
    
    // Liquidity locked or burned
    if (liquidity.isBurned) {
      score += 0; // Good, no penalty
    } else if (liquidity.lockedPercentage && liquidity.lockedPercentage > 80) {
      score -= 5;
    } else if (liquidity.lockedPercentage && liquidity.lockedPercentage > 50) {
      score -= 15;
    } else {
      score -= 30; // Unlocked liquidity
    }
    
    // Pool age - older is safer
    const ageInHours = liquidity.ageInHours || 0;
    if (ageInHours < 1) {
      score -= 25; // Brand new pool
    } else if (ageInHours < 6) {
      score -= 15;
    } else if (ageInHours < 24) {
      score -= 5;
    }
    
    // LP concentration would be checked here
    const lpConcentration = 0; // Placeholder
    
    return {
      score: Math.max(0, score),
      isLocked: !!liquidity.lockedPercentage && liquidity.lockedPercentage > 80,
      isBurned: liquidity.isBurned,
      lockPercentage: liquidity.lockedPercentage || 0,
      poolAgeInHours: ageInHours,
      lpConcentration,
    };
  }
  
  /**
   * Score holder risk (0-100, higher is safer)
   */
  private scoreHolderRisk(
    holders: HolderInfo[],
    _supply: { totalSupply: bigint; circulatingSupply: bigint } | null
  ): HolderRiskScore {
    if (holders.length === 0) {
      return {
        score: 0,
        topHolderPercentage: 100,
        top10HolderPercentage: 100,
        devWalletPercentage: 0,
        sniperWalletCount: 0,
        bundleDetection: true,
      };
    }
    
    let score = 100;
    
    const topHolderPct = holders[0]?.percentage || 0;
    const top10Pct = holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0);
    
    // Top holder concentration
    if (topHolderPct > 50) {
      score -= 40;
    } else if (topHolderPct > 30) {
      score -= 25;
    } else if (topHolderPct > 20) {
      score -= 15;
    } else if (topHolderPct > 10) {
      score -= 5;
    }
    
    // Top 10 concentration
    if (top10Pct > 80) {
      score -= 20;
    } else if (top10Pct > 60) {
      score -= 10;
    }
    
    // Count potential sniper/bundle wallets
    const sniperCount = holders.filter(h => h.label === 'sniper' || h.label === 'bundler').length;
    if (sniperCount > 3) {
      score -= 15;
    }
    
    // Detect bundle distribution
    const bundleDetection = top10Pct > 50 && holders.length < 100;
    if (bundleDetection) {
      score -= 20;
    }
    
    return {
      score: Math.max(0, score),
      topHolderPercentage: topHolderPct,
      top10HolderPercentage: top10Pct,
      devWalletPercentage: holders.find(h => h.label === 'dev')?.percentage || 0,
      sniperWalletCount: sniperCount,
      bundleDetection,
    };
  }
  
  /**
   * Determine risk level from score
   */
  private determineRiskLevel(score: number): RiskLevel {
    if (score >= 80) return 'low';
    if (score >= 60) return 'medium';
    if (score >= 40) return 'high';
    return 'critical';
  }
  
  /**
   * Create a blocked assessment
   */
  private createBlockedAssessment(tokenId: string, reason: string): RiskAssessment {
    const now = new Date();
    return {
      tokenId,
      overallScore: 0,
      riskLevel: 'blocked',
      isBlocked: true,
      blockReasons: [reason],
      contractRisk: {
        score: 0,
        isVerified: false,
        isProxy: false,
        isUpgradeable: false,
        hasMintAuthority: false,
        hasFreezeAuthority: false,
        isOwnershipRenounced: false,
        suspiciousFunctions: [],
      },
      liquidityRisk: {
        score: 0,
        isLocked: false,
        isBurned: false,
        lockPercentage: 0,
        poolAgeInHours: 0,
        lpConcentration: 0,
      },
      holderRisk: {
        score: 0,
        topHolderPercentage: 0,
        top10HolderPercentage: 0,
        devWalletPercentage: 0,
        sniperWalletCount: 0,
        bundleDetection: false,
      },
      assessedAt: now,
    };
  }
  
  /**
   * Update risk score cutoff
   */
  setRiskScoreCutoff(cutoff: number): void {
    if (cutoff < 0 || cutoff > 100) {
      throw new Error('Risk score cutoff must be between 0 and 100');
    }
    this.riskScoreCutoff = cutoff;
    console.log(`[RiskEngine] Updated risk score cutoff to ${cutoff}`);
  }
}
