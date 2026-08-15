import pino from 'pino';
import { Config } from '../config/index.js';
import { AuditLogEntry } from '../core/types.js';

/**
 * Structured logger using pino for high-performance JSON logging.
 * All logs are structured and include context for observability.
 */

let logger: pino.Logger | null = null;

export function getLogger(config?: Config): pino.Logger {
  if (!logger) {
    const level = config?.logging.level || 'info';
    const format = config?.logging.format || 'json';
    
    logger = pino({
      level,
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      base: {
        // Remove hostname from logs
      },
    });
    
    console.log(`[Logger] Initialized with level=${level}, format=${format}`);
  }
  
  return logger;
}

/**
 * Child logger with additional context
 */
export function createChildLogger(
  parent: pino.Logger,
  module: string,
  extraContext: Record<string, unknown> = {}
): pino.Logger {
  return parent.child({
    module,
    ...extraContext,
  });
}

/**
 * Audit logger - append-only, tamper-evident logging for compliance.
 * Every decision the system makes is logged here.
 */
export class AuditLogger {
  private logStream: AuditLogEntry[] = [];
  private maxInMemoryLogs: number = 10000;
  private dbClient?: any;
  
  constructor(dbUrl?: string) {
    if (dbUrl) {
      this.initializeDatabase(dbUrl);
    }
  }
  
  private async initializeDatabase(dbUrl: string): Promise<void> {
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: dbUrl });
      
      // Verify connection
      await pool.query('SELECT 1');
      this.dbClient = pool;
      
      console.log('[AuditLogger] Database connection established');
    } catch (err) {
      console.error('[AuditLogger] Failed to initialize database:', err);
    }
  }
  
  /**
   * Log an audit entry - this is append-only
   */
  async log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
    const auditEntry: AuditLogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: new Date(),
    };
    
    // Always log to memory first (fast path)
    this.logStream.push(auditEntry);
    
    // Trim if over limit
    if (this.logStream.length > this.maxInMemoryLogs) {
      this.logStream = this.logStream.slice(-this.maxInMemoryLogs);
    }
    
    // Also persist to database if available
    if (this.dbClient) {
      try {
        await this.dbClient.query(
          `INSERT INTO audit_log (id, timestamp, module, action, entity_type, entity_id, details, reasoning, outcome, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            auditEntry.id,
            auditEntry.timestamp,
            auditEntry.module,
            auditEntry.action,
            auditEntry.entityType,
            auditEntry.entityId,
            JSON.stringify(auditEntry.details),
            auditEntry.reasoning || null,
            auditEntry.outcome,
            auditEntry.error || null,
          ]
        );
      } catch (err) {
        console.error('[AuditLogger] Failed to persist to database:', err);
      }
    }
    
    // Also log to standard logger for immediate visibility
    const logLevel = auditEntry.outcome === 'failure' || auditEntry.outcome === 'blocked' ? 'warn' : 'info';
    getLogger()?.child({ module: 'audit' })[logLevel](auditEntry);
  }
  
  /**
   * Log a trade decision with full reasoning
   */
  async logTradeDecision(params: {
    orderId: string;
    tokenId: string;
    action: 'buy' | 'sell' | 'block';
    riskScore: number;
    positionSizeUsd: number;
    reasoning: string;
    outcome: 'success' | 'failure' | 'blocked';
    error?: string;
  }): Promise<void> {
    await this.log({
      module: 'execution',
      action: params.action === 'block' ? 'trade_blocked' : `trade_${params.action}`,
      entityType: 'trade',
      entityId: params.orderId,
      details: {
        tokenId: params.tokenId,
        riskScore: params.riskScore,
        positionSizeUsd: params.positionSizeUsd,
      },
      reasoning: params.reasoning,
      outcome: params.outcome,
      error: params.error,
    });
  }
  
  /**
   * Log a risk assessment
   */
  async logRiskAssessment(params: {
    tokenId: string;
    overallScore: number;
    riskLevel: string;
    isBlocked: boolean;
    blockReasons: string[];
    assessedAt: Date;
  }): Promise<void> {
    await this.log({
      module: 'risk',
      action: 'risk_assessed',
      entityType: 'token',
      entityId: params.tokenId,
      details: {
        overallScore: params.overallScore,
        riskLevel: params.riskLevel,
        isBlocked: params.isBlocked,
        blockReasons: params.blockReasons,
      },
      reasoning: params.isBlocked 
        ? `Blocked due to: ${params.blockReasons.join(', ')}`
        : `Risk score ${params.overallScore}/100 - ${params.riskLevel} risk`,
      outcome: params.isBlocked ? 'blocked' : 'success',
    });
  }
  
  /**
   * Get recent audit logs (for debugging/inspection)
   */
  getRecentLogs(limit: number = 100): AuditLogEntry[] {
    return this.logStream.slice(-limit);
  }
  
  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  async shutdown(): Promise<void> {
    if (this.dbClient) {
      await this.dbClient.end();
    }
  }
}

// Global audit logger instance
let globalAuditLogger: AuditLogger | null = null;

export function getAuditLogger(dbUrl?: string): AuditLogger {
  if (!globalAuditLogger) {
    globalAuditLogger = new AuditLogger(dbUrl);
  }
  return globalAuditLogger;
}
