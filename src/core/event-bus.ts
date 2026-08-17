import { EventEmitter } from 'events';
import { TokenDiscoveryEvent, RiskAssessment, TradeOrder, Alert } from '../core/types.js';

/**
 * Internal event bus using Redis Pub/Sub for inter-module communication.
 * Provides loose coupling between modules.
 */

export enum EventType {
  // Discovery events
  TOKEN_DISCOVERED = 'token:discovered',
  TOKEN_ANALYZED = 'token:analyzed',
  
  // Risk events
  RISK_ASSESSED = 'risk:assessed',
  RISK_BLOCKED = 'risk:blocked',
  
  // Execution events
  ORDER_CREATED = 'order:created',
  ORDER_SIMULATED = 'order:simulated',
  ORDER_SUBMITTED = 'order:submitted',
  ORDER_FILLED = 'order:filled',
  ORDER_FAILED = 'order:failed',
  
  // Position events
  POSITION_OPENED = 'position:opened',
  POSITION_UPDATED = 'position:updated',
  POSITION_CLOSED = 'position:closed',
  STOP_LOSS_TRIGGERED = 'position:stop_loss',
  TAKE_PROFIT_TRIGGERED = 'position:take_profit',
  
  // Risk management events
  CIRCUIT_BREAKER_TRIGGERED = 'risk:circuit_breaker',
  KILL_SWITCH_ACTIVATED = 'system:kill_switch',
  
  // System events
  ALERT = 'system:alert',
  HEALTH_CHECK = 'system:health_check',
}

export interface EventPayloadMap {
  [EventType.TOKEN_DISCOVERED]: TokenDiscoveryEvent;
  [EventType.TOKEN_ANALYZED]: { tokenId: string; data: Record<string, unknown> };
  [EventType.RISK_ASSESSED]: RiskAssessment;
  [EventType.RISK_BLOCKED]: { tokenId: string; reasons: string[] };
  [EventType.ORDER_CREATED]: TradeOrder;
  [EventType.ORDER_SIMULATED]: { orderId: string; success: boolean; error?: string };
  [EventType.ORDER_SUBMITTED]: { orderId: string; signature: string };
  [EventType.ORDER_FILLED]: { orderId: string; signature: string; pnlUsd?: number };
  [EventType.ORDER_FAILED]: { orderId: string; reason: string };
  [EventType.POSITION_OPENED]: { positionId: string; tokenId: string; entryPrice: number };
  [EventType.POSITION_UPDATED]: { positionId: string; unrealizedPnlUsd: number };
  [EventType.POSITION_CLOSED]: { positionId: string; realizedPnlUsd: number };
  [EventType.STOP_LOSS_TRIGGERED]: { positionId: string; lossPct: number };
  [EventType.TAKE_PROFIT_TRIGGERED]: { positionId: string; profitPct: number };
  [EventType.CIRCUIT_BREAKER_TRIGGERED]: { reason: string; dailyLossPct: number };
  [EventType.KILL_SWITCH_ACTIVATED]: { triggeredBy: string; timestamp: Date };
  [EventType.ALERT]: Alert;
  [EventType.HEALTH_CHECK]: { module: string; healthy: boolean; details?: Record<string, unknown> };
}

type EventCallback<T extends EventType> = (payload: EventPayloadMap[T]) => void | Promise<void>;

/**
 * Event bus for internal module communication.
 * In production, this would use Redis Pub/Sub for cross-process communication.
 */
export class EventBus {
  private emitter: EventEmitter;
  private redisClient?: any;
  private connected: boolean = false;
  
  constructor(redisUrl?: string) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100); // Allow many listeners
    
    if (redisUrl) {
      this.initializeRedis(redisUrl);
    }
  }
  
  private async initializeRedis(redisUrl: string): Promise<void> {
    try {
      // Lazy import to avoid requiring Redis for tests
      const { Redis } = await import('ioredis');
      this.redisClient = new Redis(redisUrl);
      
      this.redisClient.on('error', (err: Error) => {
        console.error('[EventBus] Redis error:', err.message);
        this.connected = false;
      });
      
      this.redisClient.on('connect', () => {
        console.log('[EventBus] Connected to Redis');
        this.connected = true;
      });
      
      // Subscribe to all channels we care about
      await this.redisClient.subscribe(Object.values(EventType));
      
      // Handle incoming messages from Redis
      this.redisClient.on('message', (channel: string, message: string) => {
        try {
          const payload = JSON.parse(message);
          this.emitter.emit(channel as EventType, payload);
        } catch (err) {
          console.error('[EventBus] Failed to parse Redis message:', err);
        }
      });
    } catch (err) {
      console.warn('[EventBus] Failed to initialize Redis, using in-memory only:', err);
    }
  }
  
  /**
   * Publish an event to all subscribers
   */
  publish<T extends EventType>(event: T, payload: EventPayloadMap[T]): void {
    // Emit locally
    this.emitter.emit(event, payload);
    
    // Also publish to Redis if connected (for cross-process communication)
    if (this.connected && this.redisClient) {
      this.redisClient.publish(event, JSON.stringify(payload)).catch((err: Error) => {
        console.error('[EventBus] Failed to publish to Redis:', err);
      });
    }
  }
  
  /**
   * Subscribe to an event
   */
  subscribe<T extends EventType>(event: T, callback: EventCallback<T>): () => void {
    this.emitter.on(event, callback);
    
    // Return unsubscribe function
    return () => {
      this.emitter.off(event, callback);
    };
  }
  
  /**
   * Subscribe to an event once
   */
  once<T extends EventType>(event: T, callback: EventCallback<T>): () => void {
    this.emitter.once(event, callback);
    
    return () => {
      this.emitter.off(event, callback);
    };
  }
  
  /**
   * Check if the event bus is healthy
   */
  isHealthy(): boolean {
    return this.connected || this.emitter.listenerCount(EventType.HEALTH_CHECK) > 0;
  }
  
  /**
   * Gracefully shutdown
   */
  async shutdown(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.unsubscribe(Object.values(EventType));
      await this.redisClient.quit();
    }
    this.emitter.removeAllListeners();
  }
}

// Global event bus instance
let globalEventBus: EventBus | null = null;

export function getEventBus(redisUrl?: string): EventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus(redisUrl);
  }
  return globalEventBus;
}

export function resetEventBus(): void {
  globalEventBus = null;
}
