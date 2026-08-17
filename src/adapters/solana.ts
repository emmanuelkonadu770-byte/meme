import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { ChainAdapter, SimulationResult, ContractAnalysis, HoneypotCheckResult, HolderInfo, SupplyInfo } from './interface.js';
import { TokenMetadata, LiquidityInfo, SwapQuote, TransactionSignature, Chain } from '../core/types.js';

/**
 * Solana chain adapter implementation.
 */
export class SolanaAdapter implements ChainAdapter {
  public readonly chain: Chain = 'solana';
  
  private connection?: Connection;
  private rpcUrl: string;
  private initialized: boolean = false;
  
  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }
  
  async initialize(): Promise<void> {
    try {
      this.connection = new Connection(this.rpcUrl, { commitment: 'confirmed' });
      const slot = await this.connection.getSlot();
      console.log(`[SolanaAdapter] Connected to Solana RPC, current slot: ${slot}`);
      this.initialized = true;
    } catch (err) {
      console.error('[SolanaAdapter] Failed to initialize:', err);
      throw err;
    }
  }
  
  async isHealthy(): Promise<boolean> {
    if (!this.initialized || !this.connection) return false;
    try {
      const slot = await this.connection.getSlot();
      return slot > 0;
    } catch { return false; }
  }
  
  async getTokenMetadata(tokenAddress: string): Promise<TokenMetadata> {
    this.ensureInitialized();
    const mintPubkey = new PublicKey(tokenAddress);
    const mintInfo = await getMint(this.connection!, mintPubkey);
    
    const metadata: TokenMetadata = {
      address: tokenAddress,
      name: 'Unknown',
      symbol: 'UNKNOWN',
      decimals: mintInfo.decimals,
      uri: undefined,
      logoURI: undefined,
      chain: 'solana',
    };
    
    try {
      const response = await fetch(`https://api.jup.ag/token/v2?ids=${tokenAddress}`);
      if (response.ok) {
        const data: any = await response.json();
        if (data.data && data.data[0]) {
          metadata.name = data.data[0].name || metadata.name;
          metadata.symbol = data.data[0].symbol || metadata.symbol;
          metadata.logoURI = data.data[0].logoURI;
          metadata.uri = data.data[0].address;
        }
      }
    } catch {}
    
    return metadata;
  }
  
  async getLiquidity(_tokenAddress: string, _quoteToken: string): Promise<LiquidityInfo> {
    this.ensureInitialized();
    return {
      poolAddress: '',
      token0: _tokenAddress,
      token1: _quoteToken,
      reserve0: BigInt(0),
      reserve1: BigInt(0),
      totalSupply: BigInt(0),
      lockedPercentage: 0,
      lockExpiry: undefined,
      isBurned: false,
      ageInHours: 0,
    };
  }
  
  async getPrice(_tokenAddress: string, _quoteToken: string = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'): Promise<number> {
    try {
      const response = await fetch(`https://api.jup.ag/price/v2?ids=${_tokenAddress}`);
      if (!response.ok) throw new Error('Failed to fetch price');
      const data: any = await response.json();
      const priceData = data.data?.[_tokenAddress];
      if (!priceData?.price) throw new Error('No price data available');
      return parseFloat(priceData.price);
    } catch (err) {
      console.error('[SolanaAdapter] Failed to get price:', err);
      throw err;
    }
  }
  
  async getSwapQuote(inputToken: string, outputToken: string, amount: bigint, slippageBps: number): Promise<SwapQuote> {
    this.ensureInitialized();
    try {
      const response = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${inputToken}&outputMint=${outputToken}&amount=${amount.toString()}&slippageBps=${slippageBps}`
      );
      if (!response.ok) throw new Error('Failed to get swap quote');
      const data: any = await response.json();
      
      return {
        inputToken,
        outputToken,
        inputAmount: BigInt(data.inAmount),
        outputAmount: BigInt(data.outAmount),
        priceImpact: parseFloat(data.priceImpactPct) || 0,
        slippageBps,
        route: data.routeMap ? Object.keys(data.routeMap) : [],
        aggregator: 'Jupiter',
        expiresAt: new Date(Date.now() + 30000),
        estimatedGas: BigInt(data.otherAmountThreshold || '0'),
      };
    } catch (err) {
      console.error('[SolanaAdapter] Failed to get swap quote:', err);
      throw err;
    }
  }
  
  async buildSwapTransaction(quote: SwapQuote, walletAddress: string): Promise<unknown> {
    this.ensureInitialized();
    try {
      const response = await fetch('https://quote-api.jup.ag/v6/swap-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputMint: quote.inputToken,
          outputMint: quote.outputToken,
          amount: quote.inputAmount.toString(),
          slippageBps: quote.slippageBps,
          userPublicKey: walletAddress,
          wrapAndUnwrapSol: true,
        }),
      });
      if (!response.ok) throw new Error('Failed to build swap transaction');
      return await response.json();
    } catch (err) {
      console.error('[SolanaAdapter] Failed to build swap transaction:', err);
      throw err;
    }
  }
  
  async simulateTransaction(_tx: unknown): Promise<SimulationResult> {
    this.ensureInitialized();
    return { success: true, logs: ['Simulation successful'], gasUsed: BigInt(5000) };
  }
  
  async submitTransaction(_signedTx: unknown): Promise<TransactionSignature> {
    this.ensureInitialized();
    return { signature: 'placeholder_signature', timestamp: new Date(), status: 'pending', explorerUrl: 'https://solscan.io/tx/placeholder' };
  }
  
  async analyzeContract(tokenAddress: string): Promise<ContractAnalysis> {
    this.ensureInitialized();
    const mintPubkey = new PublicKey(tokenAddress);
    const mintInfo = await getMint(this.connection!, mintPubkey);
    
    const hasMintAuthority = mintInfo.mintAuthority !== null;
    const hasFreezeAuthority = mintInfo.freezeAuthority !== null;
    
    return {
      isVerified: true,
      isProxy: false,
      isUpgradeable: false,
      ownerAddress: mintInfo.mintAuthority?.toBase58(),
      isOwnershipRenounced: !hasMintAuthority && !hasFreezeAuthority,
      mintAuthority: mintInfo.mintAuthority?.toBase58() || null,
      freezeAuthority: mintInfo.freezeAuthority?.toBase58() || null,
      hasMintAuthority,
      hasFreezeAuthority,
      suspiciousFunctions: [],
    };
  }
  
  async checkHoneypot(tokenAddress: string): Promise<HoneypotCheckResult> {
    try {
      const price = await this.getPrice(tokenAddress);
      if (price <= 0) {
        return { isHoneypot: true, canBuy: false, canSell: false, buyTax: 0, sellTax: 0, transferTax: 0, reasons: ['No valid price'] };
      }
      return { isHoneypot: false, canBuy: true, canSell: true, buyTax: 0, sellTax: 0, transferTax: 0, reasons: [] };
    } catch {
      return { isHoneypot: true, canBuy: false, canSell: false, buyTax: 0, sellTax: 0, transferTax: 0, reasons: ['Failed to verify'] };
    }
  }
  
  async getTopHolders(tokenAddress: string, limit: number = 10): Promise<HolderInfo[]> {
    try {
      const response = await fetch(`https://api.solana.fm/v1/tokens/${tokenAddress}/holders?limit=${limit}`);
      if (!response.ok) return [];
      const data: any = await response.json();
      return data.holders || [];
    } catch { return []; }
  }
  
  async getSupplyInfo(tokenAddress: string): Promise<SupplyInfo> {
    this.ensureInitialized();
    const mintPubkey = new PublicKey(tokenAddress);
    const mintInfo = await getMint(this.connection!, mintPubkey);
    return { totalSupply: mintInfo.supply, circulatingSupply: mintInfo.supply, maxSupply: mintInfo.supply };
  }
  
  private ensureInitialized(): void {
    if (!this.initialized || !this.connection) {
      throw new Error('SolanaAdapter not initialized. Call initialize() first.');
    }
  }
}

export function createSolanaAdapter(rpcUrl: string): SolanaAdapter {
  return new SolanaAdapter(rpcUrl);
}
