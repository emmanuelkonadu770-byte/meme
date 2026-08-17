import express, { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory status store (could be replaced with Redis later)
let botStatus = {
  active: true,
  mode: process.env.TRADING_MODE || 'paper',
  chainsScanned: ['solana'],
  tradesExecuted: 0,
  lastScanTime: new Date().toISOString()
};

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API endpoint to get bot status
app.get('/api/status', (_req: Request, res: Response) => {
  res.json(botStatus);
});

// API endpoint to update bot status (for internal use)
app.post('/api/status', (req: Request, res: Response) => {
  const { active, mode, tradesExecuted } = req.body;
  if (active !== undefined) botStatus.active = active;
  if (mode !== undefined) botStatus.mode = mode;
  if (tradesExecuted !== undefined) botStatus.tradesExecuted = tradesExecuted;
  botStatus.lastScanTime = new Date().toISOString();
  res.json(botStatus);
});

// Main dashboard HTML
app.get('/', (_req: Request, res: Response) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Memecoin Trading Platform</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 40px;
      max-width: 600px;
      width: 100%;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    h1 {
      font-size: 2rem;
      margin-bottom: 10px;
      text-align: center;
      background: linear-gradient(90deg, #00d9ff, #00ff88);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      text-align: center;
      color: #888;
      margin-bottom: 30px;
      font-size: 0.9rem;
    }
    .status-card {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 12px;
      padding: 25px;
      margin-bottom: 20px;
    }
    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .status-row:last-child { border-bottom: none; }
    .status-label { color: #aaa; font-size: 0.9rem; }
    .status-value { font-weight: 600; font-size: 1.1rem; }
    .status-active {
      color: #00ff88;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .status-active::before {
      content: '';
      width: 10px;
      height: 10px;
      background: #00ff88;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    .status-inactive { color: #ff4757; }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    .mode-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .mode-paper {
      background: rgba(0, 217, 255, 0.2);
      color: #00d9ff;
      border: 1px solid #00d9ff;
    }
    .mode-live {
      background: rgba(255, 71, 87, 0.2);
      color: #ff4757;
      border: 1px solid #ff4757;
    }
    .chains {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .chain-badge {
      background: rgba(255, 255, 255, 0.1);
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      color: #666;
      font-size: 0.8rem;
    }
    .warning {
      background: rgba(255, 193, 7, 0.1);
      border: 1px solid rgba(255, 193, 7, 0.3);
      border-radius: 8px;
      padding: 15px;
      margin-top: 20px;
      font-size: 0.85rem;
      color: #ffc107;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Memecoin Trading Platform</h1>
    <p class="subtitle">Multi-chain automated trading with risk management</p>
    
    <div class="status-card">
      <div class="status-row">
        <span class="status-label">Bot Status</span>
        <span class="status-value status-active" id="botStatus">Active</span>
      </div>
      <div class="status-row">
        <span class="status-label">Trading Mode</span>
        <span class="status-value"><span class="mode-badge mode-paper" id="tradingMode">PAPER</span></span>
      </div>
      <div class="status-row">
        <span class="status-label">Chains Scanned</span>
        <div class="chains" id="chainsList">
          <span class="chain-badge">☀️ Solana</span>
        </div>
      </div>
      <div class="status-row">
        <span class="status-label">Trades Executed</span>
        <span class="status-value" id="tradesCount">0</span>
      </div>
      <div class="status-row">
        <span class="status-label">Last Scan</span>
        <span class="status-value" id="lastScan" style="font-size: 0.9rem;">-</span>
      </div>
    </div>
    
    <div class="warning">
      ⚠️ Currently running in <strong>PAPER TRADING</strong> mode. No real funds at risk.
    </div>
    
    <div class="footer">
      <p>Real-time updates every 3 seconds</p>
      <p style="margin-top: 8px;">v1.0.0 • Modular Monolith Architecture</p>
    </div>
  </div>
  
  <script>
    async function fetchStatus() {
      try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        document.getElementById('botStatus').textContent = data.active ? 'Active' : 'Inactive';
        document.getElementById('botStatus').className = data.active ? 'status-value status-active' : 'status-value status-inactive';
        
        const modeEl = document.getElementById('tradingMode');
        modeEl.textContent = data.mode.toUpperCase();
        modeEl.className = 'mode-badge ' + (data.mode === 'live' ? 'mode-live' : 'mode-paper');
        
        document.getElementById('tradesCount').textContent = data.tradesExecuted || 0;
        document.getElementById('lastScan').textContent = new Date(data.lastScanTime).toLocaleTimeString();
      } catch (err) {
        console.error('Failed to fetch status:', err);
      }
    }
    
    // Initial fetch and then poll every 3 seconds
    fetchStatus();
    setInterval(fetchStatus, 3000);
  </script>
</body>
</html>
  `;
  res.send(html);
});

export function startServer(): Promise<void> {
  return new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log(`🌐 Dashboard server running on http://localhost:${PORT}`);
      console.log(`📊 Access the dashboard at http://localhost:${PORT}`);
      resolve();
    });
  });
}

export { app };
