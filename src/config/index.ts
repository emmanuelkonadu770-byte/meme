import { z } from 'zod';

/**
 * Trading mode - CRITICAL: System defaults to PAPER trading
 */
export const TradingModeSchema = z.enum(['paper', 'live']);
export type TradingMode = z.infer<typeof TradingModeSchema>;

/**
 * Supported blockchain networks
 */
export const ChainSchema = z.enum(['solana', 'ethereum', 'base', 'arbitrum', 'bsc']);
export type Chain = z.infer<typeof ChainSchema>;

/**
 * Risk assessment result
 */
export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical', 'blocked']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/**
 * Configuration schema with all required settings
 */
export const ConfigSchema = z.object({
  // === TRADING MODE (CRITICAL) ===
  tradingMode: TradingModeSchema.default('paper'),
  
  // === Database ===
  databaseUrl: z.string().url(),
  redisUrl: z.string().url(),
  
  // === RPC Endpoints ===
  rpcEndpoints: z.object({
    solana: z.string().url(),
    solanaDevnet: z.string().url().optional(),
    ethereum: z.string().url().optional(),
    base: z.string().url().optional(),
    arbitrum: z.string().url().optional(),
    bsc: z.string().url().optional(),
  }),
  
  // === Risk Management ===
  riskManagement: z.object({
    maxPositionSizePct: z.number().min(0).max(100).default(5),
    maxConcurrentPositions: z.number().int().positive().default(10),
    maxDailyLossPct: z.number().min(0).max(100).default(10),
    maxPerTokenExposurePct: z.number().min(0).max(100).default(15),
    defaultSlippageBps: z.number().int().positive().default(50),
    riskScoreCutoff: z.number().min(0).max(100).default(70),
  }),
  
  // === Alerting ===
  alerting: z.object({
    telegramBotToken: z.string().optional(),
    telegramChatId: z.string().optional(),
    discordWebhookUrl: z.string().url().optional(),
  }),
  
  // === API Server ===
  api: z.object({
    port: z.number().int().positive().default(3000),
    host: z.string().default('localhost'),
  }),
  
  // === Logging ===
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    format: z.enum(['json', 'pretty']).default('json'),
  }),
  
  // === Chains to monitor ===
  enabledChains: z.array(ChainSchema).default(['solana']),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): Config {
  const config = ConfigSchema.parse({
    tradingMode: process.env.TRADING_MODE || 'paper',
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    rpcEndpoints: {
      solana: process.env.SOLANA_RPC_URL,
      solanaDevnet: process.env.SOLANA_DEVNET_RPC_URL,
      ethereum: process.env.ETHEREUM_RPC_URL,
      base: process.env.BASE_RPC_URL,
      arbitrum: process.env.ARBITRUM_RPC_URL,
      bsc: process.env.BSC_RPC_URL,
    },
    riskManagement: {
      maxPositionSizePct: parseFloat(process.env.MAX_POSITION_SIZE_PCT || '5'),
      maxConcurrentPositions: parseInt(process.env.MAX_CONCURRENT_POSITIONS || '10'),
      maxDailyLossPct: parseFloat(process.env.MAX_DAILY_LOSS_PCT || '10'),
      maxPerTokenExposurePct: parseFloat(process.env.MAX_PER_TOKEN_EXPOSURE_PCT || '15'),
      defaultSlippageBps: parseInt(process.env.DEFAULT_SLIPPAGE_BPS || '50'),
      riskScoreCutoff: parseInt(process.env.RISK_SCORE_CUTOFF || '70'),
    },
    alerting: {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    },
    api: {
      port: parseInt(process.env.API_PORT || '3000'),
      host: process.env.API_HOST || 'localhost',
    },
    logging: {
      level: (process.env.LOG_LEVEL as any) || 'info',
      format: (process.env.LOG_FORMAT as any) || 'json',
    },
    enabledChains: process.env.ENABLED_CHAINS?.split(',') || ['solana'],
  });
  
  // CRITICAL SAFETY CHECK: Ensure paper mode is explicit
  if (config.tradingMode === 'live') {
    console.warn('⚠️  WARNING: LIVE TRADING MODE ENABLED - Real funds at risk!');
    console.warn('Ensure you have thoroughly tested in paper mode first.');
  } else {
    console.log('✅ Running in PAPER TRADING mode - No real trades will execute');
  }
  
  return config;
}
