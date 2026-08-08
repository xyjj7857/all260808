import { BinanceService } from './binance';
import { AppSettings, LogEntry, Position, TradeLog, TransferLog, BalanceLog, Kline } from '../types';
import WebSocket from 'ws';
import nodemailer from 'nodemailer';
import { dbService } from './database';
import { APP_NAME, DEFAULT_SETTINGS } from '../constants';

// 辅助函数：获取高精度数值的小数位数
function getDecimalPlaces(num: number): number {
  const str = num.toString();
  if (str.includes('e')) {
    const parts = str.split('e');
    const base = parts[0];
    const exp = parseInt(parts[1], 10);
    const baseDecimals = base.includes('.') ? base.split('.')[1].length : 0;
    return Math.max(0, baseDecimals - exp);
  }
  return str.includes('.') ? str.split('.')[1].length : 0;
}

// 辅助函数：根据 tickSize 对齐价格
function formatPriceWithTickSize(
  targetPrice: number,
  tickSize: number,
  minPrice: number,
  mode: 'floor' | 'ceil' | 'round'
): string {
  const precision = getDecimalPlaces(tickSize);
  const epsilon = tickSize / 10000; // 极小偏移量，修复 JS 浮点精度误差

  let n: number;
  if (mode === 'floor') {
    n = Math.floor((targetPrice - minPrice + epsilon) / tickSize);
  } else if (mode === 'ceil') {
    n = Math.ceil((targetPrice - minPrice - epsilon) / tickSize);
  } else {
    n = Math.round((targetPrice - minPrice) / tickSize);
  }

  const finalPrice = minPrice + n * tickSize;
  return finalPrice.toFixed(precision);
}

// 辅助函数：根据 stepSize 对齐数量
function formatQtyWithStepSize(
  quantity: number,
  stepSize: number,
  minQty: number = 0
): string {
  const precision = getDecimalPlaces(stepSize);
  const epsilon = stepSize / 10000;

  const n = Math.floor((quantity - minQty + epsilon) / stepSize);
  const finalQty = Math.max(minQty, minQty + n * stepSize);
  return finalQty.toFixed(precision);
}

export interface TradeContext {
  engine: StrategyEngine;
  coin: any;
  scanStartTime: number;
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  formattedQuantity: string;
  actualQuantity?: string;
  executionData?: { avgPrice: number; qty: number };
  symbolInfo: any;
  isSecondOrder: boolean;
  formattedTP: string;
  formattedSL: string;
  kBestClose: number;
  entryPrice: number;
}

export class StrategyEngine {
  private binance: BinanceService;
  private settings: any;
  public accountId: string;
  private logs: LogEntry[] = [];
  private tradeLogs: TradeLog[] = [];
  private transferLogs: TransferLog[] = [];
  private balanceLogs: BalanceLog[] = [];
  private lastBalanceRecordHour: number = -1;
  private isRunning: boolean = false;
  private apiConnected: boolean = true;
  private wsConnected: boolean = false;
  private currentPosition: Position | null = null;
  private lastScanTime: number = 0;
  private lastMarketDataTime: number = Date.now();
  private lastS0Run: number = 0;
  private lastS0PRun: number = 0;
  private lastS1Run: number = 0;
  private lastS2Run: number = 0;
  private ws: WebSocket | null = null;
  private marketWss: WebSocket[] = [];
  public static instances: StrategyEngine[] = [];
  public static isGlobalBanned: boolean = false;
  public static globalBanUntil: number = 0;
  private static sharedOrderTargetTable: any[] = []; // 下单目标表 (Stage 2 计算结果)
  private static lastOrderTableUpdateTime: number = 0;
  private static sharedStage0Symbols: string[] = []; // Stage 0 筛选出的基础交易对 (由主账户维护)
  private static sharedStage1Symbols: string[] = []; // Stage 1 筛选出的候选币对
  public static sharedStage1Timestamp: number = 0;
  public static stage1DataMissing: boolean = false;
  public static globalKlineCache: Map<string, any> = new Map();
  private static marketplaceThrottles: Map<string, number> = new Map();
  private wsMessageCounter: Map<number, number> = new Map();
  private marketWsReconnectAttempts: Map<number, number> = new Map();
  private currentScanKlineSnapshot: Map<string, any> | null = null;
  public static primaryWsEngineId: string | null = null;
  private activePositionSymbols: Set<string> = new Set(); // 该账户当前持仓的币种
  private listenKey: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectDelay: number = 60000; // Max 1 minute
  private accountData: any = {
    totalBalance: '0.00',
    availableBalance: '0.00',
    spotBalance: '0.00',
    positions: [],
    openOrders: []
  };

  private stage0Results: any = { data: [], scannedCount: 0, startTime: 0, duration: 0 };
  private stage0PResults: any = { data: [], scannedCount: 0, startTime: 0, duration: 0 };
  private myStage0PQualifiedSymbols: Set<string> = new Set(); // 该账户自主过滤通过的币种 (Stage 0P)
  private stage1Results: any = { data: [], scannedCount: 0, startTime: 0, duration: 0 };
  private stage2Results: any = { data: [], scannedCount: 0, startTime: 0, duration: 0 };
  private isOrdering: boolean = false;
  private pendingOrderSymbol: string | null = null;
  private exchangeInfo: any = null;
  private previousPositions: any[] = [];
  private closedPositionsHistory: Map<string, number> = new Map();
  private pendingCloseSymbols: Map<string, number> = new Map();
  private pendingCloseTradeLogIds: Map<string, string[]> = new Map();
  private activeCloseReasons: Map<string, 'TIMEOUT' | 'TRAILING'> = new Map();
  private lastReplenishmentEmailTime: number = 0;
  private balanceAlertSent: boolean = false;
  private isWithdrawing: boolean = false;
  private isReplenishing: boolean = false;
  private skippedCount: number = 0;
  private winStreakResetTimestamp: number = 0;
  private lastAccountFetchTime: number = 0;

  // 全局跨账户/多币对 3 阶段串行下单调度器
  public static async processGlobalBatchTrades(
    requests: { engine: StrategyEngine; coin: any; scanStartTime: number }[]
  ) {
    if (requests.length === 0) return;

    const contexts: TradeContext[] = [];

    // 阶段 1：所有账户/币对依次开立正常市价单 (正常单)
    for (const req of requests) {
      try {
        const ctx = await req.engine.executeMarketOrder(req.coin, req.scanStartTime);
        if (ctx) {
          contexts.push(ctx);
        }
      } catch (error: any) {
        req.engine.addLog('下单', `[Phase 1] ${req.coin.symbol} 正常单开仓失败: ${error.message}`, 'error');
      }
    }

    // 阶段 2：所有账户/币对依次开立 Limit 止盈单 (limit单)
    for (const ctx of contexts) {
      try {
        await ctx.engine.executeLimitOrder(ctx);
      } catch (error: any) {
        ctx.engine.addLog('下单', `[Phase 2] ${ctx.symbol} limit挂单失败: ${error.message}`, 'error');
      }
    }

    // 阶段 3：所有账户/币对依次开立 Algo 止损条件单 (algo单)
    for (const ctx of contexts) {
      try {
        await ctx.engine.executeAlgoOrder(ctx);
      } catch (error: any) {
        ctx.engine.addLog('下单', `[Phase 3] ${ctx.symbol} algo挂单失败: ${error.message}`, 'error');
      }
    }
  }
  private lastApiCheckTime: number = 0;
  private timeOffset: number = 0;
  private lastTimeSyncTime: number = 0;
  private noOrdersStartTime: number | null = null;
  private emptyAccountStartTime: number | null = null;
  private shouldCheckTransfer: boolean = false;
  private isCancelling: boolean = false;
  private isClosing: boolean = false;
  private fetchAccountTimer: NodeJS.Timeout | null = null;
  private fetchAccountOptions: { skipCleanup?: boolean } = {};
  private isBanned: boolean = false;
  private banUntil: number = 0;
  private lockingSymbols: Set<string> = new Set();
  private notifiedDustSymbols: Set<string> = new Set();
  private isFullMarketMonitoring: boolean = false;
  private lastSubscribedSymbolSet: Set<string> = new Set();
  private onUpdate?: (type: 'log' | 'status' | 'account' | 'logs' | 'tradeLogs' | 'transferLogs' | 'balanceLogs' | 'settings', data: any) => void;
  private logBuffer: LogEntry[] = [];
  private logFlushInterval: NodeJS.Timeout | null = null;
  private logPruneInterval: NodeJS.Timeout | null = null;
  private isWritingLogs: boolean = false;

  private externalMarketSource?: {
    getKline: (symbol: string) => any;
    getStage0Results: () => any;
  };

  private static isGlobalSyncingKlines = false;
  private static lastGlobalSyncTime = 0;
  private static klineSyncPromise: Promise<void> | null = null;

  public static getPrimaryEngine(): StrategyEngine | null {
    const master = StrategyEngine.instances.find(i => i.settings?.isMasterAccount && i.isRunning);
    if (master) return master;
    if (StrategyEngine.primaryWsEngineId) {
      const wsEngine = StrategyEngine.instances.find(i => i.accountId === StrategyEngine.primaryWsEngineId && i.isRunning);
      if (wsEngine) return wsEngine;
    }
    return StrategyEngine.instances.find(i => i.isRunning) || StrategyEngine.instances[0] || null;
  }

  public get isPrimary(): boolean {
    const primary = StrategyEngine.getPrimaryEngine();
    return primary ? primary.accountId === this.accountId : false;
  }

  constructor(accountId: string, settings: any, initialTradeLogs: TradeLog[] = []) {
    this.accountId = accountId;
    this.settings = settings;
    this.tradeLogs = initialTradeLogs;
    this.binance = new BinanceService(settings.binance);
    
    const existingIdx = StrategyEngine.instances.findIndex(i => i.accountId === accountId);
    if (existingIdx >= 0) {
      StrategyEngine.instances[existingIdx] = this;
    } else {
      StrategyEngine.instances.push(this);
    }
  }

  setExternalMarketSource(source: {
    getKline: (symbol: string) => any;
    getStage0Results: () => any;
  }) {
    this.externalMarketSource = source;
  }

  setUpdateCallback(cb: (type: 'log' | 'status' | 'account' | 'logs' | 'tradeLogs' | 'transferLogs' | 'balanceLogs' | 'settings', data: any) => void) {
    this.onUpdate = cb;
  }

  public getCachedKline(symbol: string, expectedTimestamp?: number) {
    let kline: any = undefined;
    if (this.externalMarketSource) {
      kline = this.externalMarketSource.getKline(symbol);
    } else if (this.currentScanKlineSnapshot && this.currentScanKlineSnapshot.has(symbol)) {
      kline = this.currentScanKlineSnapshot.get(symbol);
    } else {
      kline = StrategyEngine.globalKlineCache.get(symbol.toUpperCase());
    }
    
    // 严格检查目标时间戳，避免读取过去周期的旧缓存
    if (kline && expectedTimestamp !== undefined) {
      if (kline.timestamp !== expectedTimestamp) {
        return undefined;
      }
    }
    return kline;
  }

  private hasCachedKline(symbol: string, expectedTimestamp?: number) {
    return this.getCachedKline(symbol, expectedTimestamp) !== undefined;
  }

  private lastLogTimeMap: Map<string, number> = new Map();

  private addLog(module: string, message: string, type: LogEntry['type'] = 'info', details?: any) {
    // 如果引擎已停止，除了核心停止日志外不再接收新日志
    if (!this.isRunning && module !== '系统' && !message.includes('停止')) {
      return;
    }
    
    // 日志系统降温：对特定的高频重复日志进行节流（例如扫描状态、API状态检查等）
    if (type === 'info' && (
      message.includes('扫描') || 
      message.includes('非工作时段') || 
      message.includes('API') || 
      message.includes('Combined Streams') || 
      message.includes('WebSocket') ||
      message.includes('持仓同步')
    )) {
      const logKey = `${module}:${message}`;
      const lastLog = this.lastLogTimeMap.get(logKey) || 0;
      if (Date.now() - lastLog < 30000) { // 同一模块的相同 info 日志 30 秒内仅显示一次
        return;
      }
      this.lastLogTimeMap.set(logKey, Date.now());
    }

    // 屏蔽特定的 WebSocket 技术重连日志（不展示、不存库）
    if (message.includes('检测到死连接') || (message.includes('已断开') && message.includes('尝试重连'))) {
      return;
    }
    
    const accountName = this.settings?.name || this.accountId;
    const log: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      type,
      module: `[${accountName}] ${module}`,
      message,
      details,
    };
    this.logs.unshift(log);
    if (this.logs.length > 500) this.logs.pop(); // 减少 UI 端的内存占用
    
    // 只有非 info 日志或关键模块日志才输出到控制台，减少 stdout 压力
    if (type !== 'info' || module === '下单' || module === '系统' || module === 'WebSocket') {
      console.log(`[${accountName}][${module}] ${message}`);
    }

    this.logBuffer.push(log);
    // keep max 2000 logs in buffer to avoid memory leak
    if (this.logBuffer.length > 2000) this.logBuffer.shift(); 
    
    if (this.onUpdate) {
      this.onUpdate('log', log);
    }
  }

  /**
   * 检查并自动解除封禁状态
   * 如果仍处于封禁期，返回 true；如果已解封或未封禁，返回 false
   */
  private checkBannedStatus(): boolean {
    if (StrategyEngine.isGlobalBanned) {
      if (Date.now() >= StrategyEngine.globalBanUntil) {
        StrategyEngine.isGlobalBanned = false;
        StrategyEngine.globalBanUntil = 0;
        this.addLog('系统', '全局封禁保护期已过，状态已自动恢复正常。', 'success');
        return false;
      }
      return true;
    }
    
    if (!this.isBanned) return false;
    
    if (Date.now() >= this.banUntil) {
      this.isBanned = false;
      this.banUntil = 0;
      this.addLog('系统', '封禁保护期已过，状态已自动恢复正常。', 'success');
      return false;
    }
    
    return true;
  }

  private async flushLogs() {
    if (this.isWritingLogs || this.logBuffer.length === 0) return;

    // Check if within 5 seconds of the absolute 15-minute mark
    const now = Date.now();
    const fifteenMinutesMs = 15 * 60 * 1000;
    const currentPeriodMs = now % fifteenMinutesMs;
    // Condition to avoid writing: 00:14:55 to 00:00:05 (relatively)
    if (currentPeriodMs > fifteenMinutesMs - 5000 || currentPeriodMs < 5000) {
      return; 
    }

    this.isWritingLogs = true;
    // 一次性批量写入更多日志，减少数据库事务次数
    const logsToWrite = this.logBuffer.splice(0, 500); 

    try {
      await dbService.saveSystemLogs(logsToWrite, this.accountId);
    } catch (e) {
      // 失败则退回缓冲区，但由于 batchSize 变大，退回时要注意不去重
      this.logBuffer.unshift(...logsToWrite);
    } finally {
      this.isWritingLogs = false;
    }
  }

  public getCurrentWinStreak(): number {
    const closedLogs = [...this.tradeLogs]
      .filter(log => log.status !== 'OPEN' || log.isSkipMark || log.symbol === '[扫跳重置]')
      .sort((a, b) => (a.closeTime || a.openTime || 0) - (b.closeTime || b.openTime || 0));

    let streak = 0;
    for (const log of closedLogs) {
      if (log.status === 'SKIPPED' || log.isSkipMark || log.symbol === '[扫跳重置]') {
        streak = 0;
        continue;
      }
      const isWin = (log.pnl > 0 || log.profitRate > 0);
      if (isWin) {
        streak++;
      } else {
        streak = 0;
      }
    }
    return streak;
  }

  private addTradeLog(trade: TradeLog) {
    this.tradeLogs.unshift(trade);
    if (this.tradeLogs.length > 5000) this.tradeLogs.pop();
    
    // Persist to database
    dbService.saveTradeLog(trade, this.accountId).catch(err => {
      console.error(`[${this.accountId}] Failed to save trade log to database:`, err);
    });

    if (this.onUpdate) {
      this.onUpdate('tradeLogs', this.tradeLogs);
    }
  }

  private addTransferLog(transfer: TransferLog) {
    this.transferLogs.unshift(transfer);
    if (this.transferLogs.length > 1000) this.transferLogs.pop();
    
    // Persist to database
    dbService.saveTransferLog(transfer, this.accountId).catch(err => {
      console.error(`[${this.accountId}] Failed to save transfer log to database:`, err);
    });

    if (this.onUpdate) {
      this.onUpdate('transferLogs', this.transferLogs);
    }
  }

  private updateTradeLog(id: string, updates: Partial<TradeLog>) {
    const index = this.tradeLogs.findIndex(t => t.id === id);
    if (index !== -1) {
      this.tradeLogs[index] = { ...this.tradeLogs[index], ...updates };
      
      // Persist to database
      dbService.saveTradeLog(this.tradeLogs[index], this.accountId).catch(err => {
        console.error(`[${this.accountId}] Failed to update trade log in database:`, err);
      });

      if (this.onUpdate) {
        this.onUpdate('tradeLogs', this.tradeLogs);
      }
    }
  }

  private scheduleExpiryPriceFetch(trade: TradeLog, isSecondOrder: boolean = false) {
    if (this.settings.order?.enableExpiryPrice === false) return;
    if (trade.expiryPrice && trade.expiryPrice > 0) return;
    if (!trade.openTime || trade.isSkipMark || trade.status === 'SKIPPED' || trade.symbol === '[扫跳重置]') return;

    const maxHoldTimeVal = isSecondOrder 
      ? (this.settings.order?.secondMaxHoldTime ?? this.settings.order?.maxHoldTime ?? 14.9) 
      : (this.settings.order?.maxHoldTime ?? 14.9);

    const maxHoldMs = maxHoldTimeVal * 60 * 1000;
    const expireTime = trade.openTime + maxHoldMs;
    const delay = expireTime - Date.now();

    if (delay <= 0) {
      // 仅当到期时间在过去3分钟以内（如服务重启补算）才获取，超过3分钟前的历史订单不予处理
      if (Date.now() - expireTime < 180000) {
        this.fetchAndRecordExpiryPrice(trade.id, trade.symbol);
      }
    } else {
      setTimeout(() => {
        this.fetchAndRecordExpiryPrice(trade.id, trade.symbol);
      }, delay);
    }
  }

  private async fetchAndRecordExpiryPrice(tradeId: string, symbol: string) {
    if (this.settings.order?.enableExpiryPrice === false) return;
    const trade = this.tradeLogs.find(t => t.id === tradeId);
    if (!trade || (trade.expiryPrice && trade.expiryPrice > 0)) return;

    try {
      const ticker = await this.binance.getTickerPrice(symbol);
      if (ticker && ticker.price) {
        const expiryPrice = parseFloat(ticker.price);
        if (!isNaN(expiryPrice) && expiryPrice > 0) {
          this.updateTradeLog(tradeId, { expiryPrice });
          this.addLog('系统', `[到期价格] 币对 ${symbol} (ID: ${tradeId}) 到期时刻最新价格已记录: ${expiryPrice}`, 'success');
        }
      }
    } catch (error: any) {
      this.addLog('系统', `[到期价格] 获取 ${symbol} 最新价格失败: ${error.message}`, 'warning');
    }
  }

  private mergeSettings(loaded: any): any {
    const accDefault = DEFAULT_SETTINGS.accounts[0];
    return {
      ...accDefault,
      ...loaded,
      binance: { ...accDefault.binance, ...(loaded.binance || {}) },
      scanner: {
        ...accDefault.scanner,
        ...(loaded.scanner || {}),
        stage0: { ...accDefault.scanner.stage0, ...(loaded.scanner?.stage0 || {}) },
        stage0P: { 
          ...accDefault.scanner.stage0P, 
          ...(loaded.scanner?.stage0P || {}),
          periods: { ...accDefault.scanner.stage0P.periods, ...(loaded.scanner?.stage0P?.periods || {}) },
          abnormalMove: { ...accDefault.scanner.stage0P.abnormalMove, ...(loaded.scanner?.stage0P?.abnormalMove || {}) }
        },
        stage1: { ...accDefault.scanner.stage1, ...(loaded.scanner?.stage1 || {}) },
        stage2: { 
          ...accDefault.scanner.stage2, 
          ...(loaded.scanner?.stage2 || {}),
          enabled: loaded.scanner?.stage2?.enabled !== undefined ? loaded.scanner.stage2.enabled : (accDefault.scanner.stage2.enabled !== undefined ? accDefault.scanner.stage2.enabled : true),
          preferredMode: loaded.scanner?.stage2?.preferredMode || accDefault.scanner.stage2.preferredMode,
          amplitudeMode: loaded.scanner?.stage2?.amplitudeMode || accDefault.scanner.stage2.amplitudeMode || 'bottomHigh',
          conditions: {
            ...accDefault.scanner.stage2.conditions,
            ...(loaded.scanner?.stage2?.conditions || {}),
            amp: {
              ...accDefault.scanner.stage2.conditions.amp,
              ...(loaded.scanner?.stage2?.conditions?.amp || {})
            },
            ampSell: {
              ...(accDefault.scanner.stage2.conditions.ampSell || accDefault.scanner.stage2.conditions.amp),
              ...(loaded.scanner?.stage2?.conditions?.ampSell || {})
            },
            longShort: {
              ...accDefault.scanner.stage2.conditions.longShort,
              ...(loaded.scanner?.stage2?.conditions?.longShort || {})
            },
            m: {
              ...accDefault.scanner.stage2.conditions.m,
              ...(loaded.scanner?.stage2?.conditions?.m || {})
            },
            mSell: {
              ...(accDefault.scanner.stage2.conditions.mSell || accDefault.scanner.stage2.conditions.m),
              ...(loaded.scanner?.stage2?.conditions?.mSell || {})
            },
            fundingRateOptimization: {
              ...accDefault.scanner.stage2.conditions.fundingRateOptimization,
              ...(loaded.scanner?.stage2?.conditions?.fundingRateOptimization || {})
            },
            fundingRateOptimizationSell: {
              ...(accDefault.scanner.stage2.conditions.fundingRateOptimizationSell || accDefault.scanner.stage2.conditions.fundingRateOptimization),
              ...(loaded.scanner?.stage2?.conditions?.fundingRateOptimizationSell || {})
            }
          },
          singleK: {
            ...accDefault.scanner.stage2.singleK,
            ...(loaded.scanner?.stage2?.singleK || {}),
            k2: {
              ...(accDefault.scanner.stage2.singleK?.k2 || { enabled: true, range: [4, 9] }),
              ...(loaded.scanner?.stage2?.singleK?.k2 || {})
            },
            a: {
              ...(accDefault.scanner.stage2.singleK?.a || { enabled: true, range: [0, 3], mode: 'fixed' }),
              ...(loaded.scanner?.stage2?.singleK?.a || {})
            },
            m: {
              ...(accDefault.scanner.stage2.singleK?.m || { enabled: true, range: [6980000, 1000000000] }),
              ...(loaded.scanner?.stage2?.singleK?.m || {})
            },
            k2Sell: {
              ...(accDefault.scanner.stage2.singleK?.k2Sell || { enabled: true, range: [4, 9] }),
              ...(loaded.scanner?.stage2?.singleK?.k2Sell || {})
            },
            aSell: {
              ...(accDefault.scanner.stage2.singleK?.aSell || { enabled: true, range: [0, 3], mode: 'fixed' }),
              ...(loaded.scanner?.stage2?.singleK?.aSell || {})
            },
            mSell: {
              ...(accDefault.scanner.stage2.singleK?.mSell || { enabled: true, range: [6980000, 1000000000] }),
              ...(loaded.scanner?.stage2?.singleK?.mSell || {})
            },
            fundingRateOptimizationSell: {
              ...(accDefault.scanner.stage2.singleK?.fundingRateOptimizationSell || { enabled: true, windowMinutes: 5, shortThreshold: -0.3 }),
              ...(loaded.scanner?.stage2?.singleK?.fundingRateOptimizationSell || {})
            }
          }
        },
        timeControl: (() => {
          const rawTc = loaded.scanner?.timeControl || {};
          const baseSlots = Array.isArray(rawTc.slots) && rawTc.slots.length === 96
            ? rawTc.slots
            : (Array.isArray(rawTc.hours) && rawTc.hours.length === 24
                ? rawTc.hours.flatMap((h: boolean) => [h, h, h, h])
                : Array(96).fill(true));

          const rawWeekSlots = rawTc.weekSlots || {};
          const weekSlots: Record<number, boolean[]> = {};
          [1, 2, 3, 4, 5, 6, 0].forEach(d => {
            if (Array.isArray(rawWeekSlots[d]) && rawWeekSlots[d].length === 96) {
              weekSlots[d] = rawWeekSlots[d];
            } else {
              weekSlots[d] = [...baseSlots];
            }
          });

          return {
            ...accDefault.scanner.timeControl,
            ...rawTc,
            mode: (rawTc.mode === '+8') ? '+2' : (rawTc.mode === '-8' ? '-2' : (rawTc.mode || accDefault.scanner.timeControl.mode)),
            slots: baseSlots,
            weekSlots,
          };
        })(),
      },
      order: { ...accDefault.order, ...(loaded.order || {}) },
      withdrawal: { ...accDefault.withdrawal, ...(loaded.withdrawal || {}) },
    };
  }

  async start() {
    console.log("StrategyEngine.start() called. isRunning:", this.isRunning);
    if (this.isRunning) return;
    
    // 启动前检查封禁状态，如果已过期则自动解除
    if (this.checkBannedStatus()) {
      const until = Math.max(this.banUntil, StrategyEngine.globalBanUntil);
      this.addLog('系统', `由于 IP 仍处于封禁期 (至 ${new Date(until).toLocaleString()})，无法启动策略。`, 'warning');
      return;
    }
    
    // Initialize database and load logs
    try {
      await dbService.init();
      
      // Load settings from database first
      const dbSettings = await dbService.getSettings(`settings_${this.accountId}`);
      if (dbSettings) {
        this.settings = this.mergeSettings(dbSettings);
        this.binance = new BinanceService(this.settings.binance);
        this.addLog('系统', '从数据库加载设置成功', 'success');
      }

      const savedLogs = await dbService.getAllTradeLogs(this.accountId);
      if (savedLogs && savedLogs.length > 0) {
        this.tradeLogs = savedLogs;
        console.log(`[${this.accountId}] Loaded ${savedLogs.length} trade logs from database.`);
        
        this.tradeLogs.forEach(trade => {
          if (!trade.expiryPrice && trade.openTime && !trade.isSkipMark && trade.status !== 'SKIPPED' && trade.symbol !== '[扫跳重置]') {
            this.scheduleExpiryPriceFetch(trade);
          }
        });
      }

      const savedTransferLogs = await dbService.getAllTransferLogs(this.accountId);
      if (savedTransferLogs && savedTransferLogs.length > 0) {
        this.transferLogs = savedTransferLogs;
        console.log(`[${this.accountId}] Loaded ${savedTransferLogs.length} transfer logs from database.`);
      }

      const savedBalanceLogs = await dbService.getBalanceLogs(this.accountId, 5000);
      if (savedBalanceLogs && savedBalanceLogs.length > 0) {
        this.balanceLogs = savedBalanceLogs;
        console.log(`[${this.accountId}] Loaded ${savedBalanceLogs.length} balance logs from database.`);
      }
    } catch (error) {
      console.error(`[${this.accountId}] Failed to initialize database or load logs:`, error);
    }

    // Sync Klines from Binance REST API (Rate-limited startup sync)
    this.syncKlines().catch(err => {
      this.addLog('系统', `K线自动补齐时出错: ${err.message}`, 'error');
    });

    this.isRunning = true;
    this.addLog('系统', '策略引擎启动', 'success');
    
    // 启动时如果结果为空，先执行一次初筛
    if (this.stage0Results.data.length === 0) {
      await this.runStage0();
      await this.runStage0P();
    }

    this.runLoop();
    // Initial status check
    this.checkApiStatus();
    // Initial time sync
    await this.syncTime();
    // 确保合约仓位模式为单向持仓 (只在首次检查)
    await this.ensureOneWayPositionMode();
    // Start WebSocket
    this.initWebSocket();
    // Fetch initial account data
    await this.fetchAccountData();
    // 根据当前时间启动市场数据订阅（全市场或仅持仓）
    await this.manageMarketDataStreams();

    if (!this.logFlushInterval) {
      this.logFlushInterval = setInterval(() => this.flushLogs(), 1000);
    }
    if (!this.logPruneInterval) {
      this.logPruneInterval = setInterval(() => {
        dbService.pruneSystemLogs(50);
      }, 24 * 60 * 60 * 1000); // Once a day
    }
  }

  stop() {
    this.isRunning = false;
    this.cleanupWs();
    this.cleanupMarketWs();
    if (this.fetchAccountTimer) {
      clearTimeout(this.fetchAccountTimer);
      this.fetchAccountTimer = null;
    }
    if (this.logFlushInterval) {
      clearInterval(this.logFlushInterval);
      this.logFlushInterval = null;
    }
    if (this.logPruneInterval) {
      clearInterval(this.logPruneInterval);
      this.logPruneInterval = null;
    }
    
    if (StrategyEngine.primaryWsEngineId === this.accountId) {
      StrategyEngine.primaryWsEngineId = null;
    }
    
    this.addLog('系统', '策略引擎停止', 'warning');
  }

  private cleanupWs() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.terminate();
      }
      this.ws = null;
    }
    this.wsConnected = false;
  }

  private async manageMarketDataStreams() {
    // 决定需要订阅行情流的币种：仅包含当前持仓、正在下单中或处于优选k观察期的币种
    const activeSymbols = new Set<string>();
    
    if (this.accountData?.positions) {
      this.accountData.positions.forEach((p: any) => {
        if (p.symbol) activeSymbols.add(p.symbol.toUpperCase());
      });
    }
    
    if (this.currentPosition?.symbol) {
      activeSymbols.add(this.currentPosition.symbol.toUpperCase());
    }

    if (this.pendingOrderSymbol) {
      activeSymbols.add(this.pendingOrderSymbol.toUpperCase());
    }

    const targetSymbols = Array.from(activeSymbols);

    // 对比当前订阅列表，避免频繁重启
    const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(value => b.has(value));
    
    if (!setsEqual(this.lastSubscribedSymbolSet, activeSymbols) || (activeSymbols.size > 0 && this.marketWss.length === 0)) {
      this.cleanupMarketWs();
      if (activeSymbols.size > 0) {
        this.addLog('WebSocket', `[持仓同步] 正在为持仓币种建立 15m K线行情流: [${targetSymbols.join(', ')}]`, 'info');
        // 持仓币种很少，通常 1 个连接足够
        this.createMarketConnection(targetSymbols.map(s => s.toLowerCase()), 0);
        this.lastSubscribedSymbolSet = new Set(activeSymbols);
      } else {
        this.addLog('WebSocket', '[持仓同步] 当前无持仓，已释放行情订阅资源', 'info');
        this.lastSubscribedSymbolSet = new Set();
      }
    }
  }

  private switchToLowBandwidthMonitoring(symbols: string[]) {
    this.cleanupMarketWs();
    this.isFullMarketMonitoring = false;
    
    if (symbols.length > 0) {
      this.addLog('WebSocket', `低带宽模式：仅维持持仓币种 [${symbols.join(', ')}] 的 15m K线订阅`, 'info');
      this.createMarketConnection(symbols, 0);
      this.lastSubscribedSymbolSet = new Set(symbols);
    } else {
      this.addLog('WebSocket', '低带宽模式：当前无持仓，已关闭行情订阅', 'info');
      this.lastSubscribedSymbolSet = new Set();
    }
  }

  private cleanupMarketWs() {
    this.marketWss.forEach(ws => {
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    });
    this.marketWss = [];
  }

  private async initMarketWs() {
    if (!this.isRunning) return;
    
    try {
      // 确保有币种信息
      if (!this.exchangeInfo) {
        this.exchangeInfo = await this.binance.getExchangeInfo();
      }

      const allSymbols = this.exchangeInfo.symbols
        .filter((s: any) => s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL' && s.status === 'TRADING')
        .map((s: any) => s.symbol.toLowerCase());

      if (allSymbols.length === 0) return;

      this.addLog('WebSocket', `正在启动市场数据连接池，总计 ${allSymbols.length} 个币种...`, 'info');

      // 清理旧连接
      this.cleanupMarketWs();

      // 分片逻辑：每 150 个币种开启一个连接 (币安单连接上限 200)
      const chunkSize = 150;
      const chunks = [];
      for (let i = 0; i < allSymbols.length; i += chunkSize) {
        chunks.push(allSymbols.slice(i, i + chunkSize));
      }

      this.addLog('WebSocket', `计划建立 ${chunks.length} 个并行连接以覆盖全市场数据`, 'info');

      // 逐个建立连接
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const connId = i + 1;
        
        // 稍微延迟启动每个连接，避免瞬时并发过高
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.createMarketConnection(chunk, connId);
      }

    } catch (error: any) {
      this.addLog('WebSocket', `初始化市场数据连接池失败: ${error.message}`, 'error');
    }
  }

  private async syncKlines(isForced: boolean = false) {
    // 1、15分钟k线的历史数据只由主账户进行获取
    if (!this.isPrimary) return;

    // 检查全局锁定：如果已有引擎正在同步，则跳过
    const now = Date.now();
    if (StrategyEngine.isGlobalSyncingKlines) {
      return;
    }
    
    // 5 分钟冷却期，避免多账户先后启动造成重复同步。如果是强制补齐（isForced），则忽略冷却期
    if (!isForced && now - StrategyEngine.lastGlobalSyncTime < 300000) {
      return;
    }

    StrategyEngine.isGlobalSyncingKlines = true;
    this.addLog('系统', '启动全局K线同步序列...', 'info');
    
    try {
      if (!this.exchangeInfo) {
        this.exchangeInfo = await this.binance.getExchangeInfo();
      }

      const symbols = this.exchangeInfo.symbols
        .filter((s: any) => s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL' && s.status === 'TRADING')
        .map((s: any) => s.symbol);

      this.addLog('系统', `全市场共有 ${symbols.length} 个活跃U本位永续合约，开始分批校验...`, 'info');

      const fifteenMinMs = 15 * 60 * 1000;
      const lastClosedKlineTime = Math.floor(now / fifteenMinMs) * fifteenMinMs - fifteenMinMs;

      let syncedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < symbols.length; i++) {
        // 关键：如果引擎已停止，立即终止同步
        if (!this.isRunning) {
          console.log(`[${this.accountId}] syncKlines 中断：引擎已停止。`);
          break;
        }

        const symbol = symbols[i];
        
        try {
          // 检查本地最新的一条K线
          const latestLocalTime = await dbService.getLatestKlineTime(symbol, '15m');
          
          if (latestLocalTime < lastClosedKlineTime) {
            const limit = latestLocalTime === 0 ? 300 : Math.min(300, Math.ceil((lastClosedKlineTime - latestLocalTime) / fifteenMinMs));
            
            if (limit > 0) {
              const klinesData = await this.binance.getKlines(symbol, '15m', limit);
              if (Array.isArray(klinesData) && klinesData.length > 0) {
                const klines: Kline[] = klinesData.map((k: any) => {
                  const open = parseFloat(k[1]);
                  const high = parseFloat(k[2]);
                  const low = parseFloat(k[3]);
                  const close = parseFloat(k[4]);
                  return {
                    symbol,
                    interval: '15m',
                    openTime: k[0],
                    open,
                    high,
                    low,
                    close,
                    volume: parseFloat(k[5]),
                    closeTime: k[6],
                    quoteAssetVolume: parseFloat(k[7]),
                    numberOfTrades: k[8],
                    takerBuyBaseAssetVolume: parseFloat(k[9]),
                    takerBuyQuoteAssetVolume: parseFloat(k[10]),
                    change: ((close - open) / open) * 100,
                    amplitude: high > 0 ? (1 - low / high) * 100 : 0
                  };
                });
                
                await dbService.saveKlines(klines);
                await dbService.pruneKlines(symbol, '15m', 300);
                syncedCount++;
              }
            }
          }
        } catch (err: any) {
          errorCount++;
        }

        // 速率控制
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      StrategyEngine.lastGlobalSyncTime = Date.now();
      this.addLog('系统', `全局K线同步完成。共处理 ${symbols.length} 个币种，实际补齐 ${syncedCount} 个，错误 ${errorCount} 个`, 'success');
    } catch (err: any) {
      this.addLog('系统', `获取市场信息失败，跳过K线同步: ${err.message}`, 'error');
    } finally {
      StrategyEngine.isGlobalSyncingKlines = false;
    }
  }

  private createMarketConnection(symbols: string[], id: number) {
    if (!this.isRunning) return;

    // 优化：不再使用 URL 拼接 (Combined Streams)，改用标准基础连接 + SUBSCRIBE 指令
    // 这种方式更稳定，且符合“最普通”的订阅规范
    const wsUrl = `wss://fstream.binance.com/ws`;
    const ws = new WebSocket(wsUrl);
    this.marketWss.push(ws);
    
    this.wsMessageCounter.set(id, 0);

    ws.on('open', () => {
      // 发送订阅指令
      const subscribeMsg = {
        method: "SUBSCRIBE",
        params: symbols.map(s => `${s.toLowerCase()}@kline_15m`),
        id: Date.now() + id
      };
      
      try {
        ws.send(JSON.stringify(subscribeMsg));
        this.marketWsReconnectAttempts.set(id, 0); // 重置重连次数
      } catch (err: any) {
        this.addLog('WebSocket', `[连接#${id}] 订阅指令发送失败: ${err.message}`, 'error');
      }
      
      // 启动心跳检测，间隔放宽至 3 分钟，避免因长时间行情清淡误判
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
          // 检测时间从 60s 延长至 180s
          const count = this.wsMessageCounter.get(id) || 0;
          if (count === 0 && this.isRunning) {
            this.addLog('WebSocket', `[连接#${id}] 检测到死连接（180秒无行情流入），尝试重启该分组...`, 'warning');
            ws.terminate();
            clearInterval(pingInterval);
          }
        } else {
          clearInterval(pingInterval);
        }
      }, 180000);
    });

    ws.on('message', (data: any) => {
      try {
        const rawMsg = JSON.parse(data.toString());
        const msg = rawMsg.data || rawMsg;
        
        // 动态校准时间偏移量，通过 WebSocket 事件时间 (E) 实时对齐服务器时间
        // 这能有效防止本地时钟漂移导致的“时间早跳”或扫描延迟
        if (msg.E) {
          const now = Date.now();
          // 注意：msg.E 是服务器发出该消息的时间戳
          // 虽然存在单向延迟，但以此作为基准能确保 Date.now() + timeOffset 永远不大于服务器当前实际时间
          // 从而从根本上消除“早跳”的可能性
          this.timeOffset = msg.E - now;
        }

        if (msg.e === 'kline') {
          const symbol = msg.s; 
          const k = msg.k;
          const isFinal = k.x;
          const now = Date.now();

          this.wsMessageCounter.set(id, (this.wsMessageCounter.get(id) || 0) + 1);

          // 15m K线节流
          const intervalMs15 = 15 * 60 * 1000;
          const kCloseTime = k.t + intervalMs15;
          const timeToClose = kCloseTime - (now + this.timeOffset);
          
          if (!isFinal && timeToClose > 5000) {
            const lastUpdate = StrategyEngine.marketplaceThrottles.get(symbol) || 0;
            if (now - lastUpdate < 2000) return; 
          }
          
          StrategyEngine.marketplaceThrottles.set(symbol, now);
          const price = parseFloat(k.c);
          
          // 统一存入共享缓存 (Key 为大写)
          StrategyEngine.globalKlineCache.set(symbol.toUpperCase(), {
            open: parseFloat(k.o),
            close: price,
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            quoteVolume: parseFloat(k.q),
            timestamp: k.t,
            isFinal: isFinal
          });

          // 如果K线已收盘，持久化到数据库并剪枝
          if (isFinal) {
            const open = parseFloat(k.o);
            const high = parseFloat(k.h);
            const low = parseFloat(k.l);
            const close = parseFloat(k.c);
            const kline: Kline = {
              symbol,
              interval: '15m',
              openTime: k.t,
              open,
              high,
              low,
              close,
              volume: parseFloat(k.v),
              closeTime: k.T,
              quoteAssetVolume: parseFloat(k.q),
              numberOfTrades: k.n,
              takerBuyBaseAssetVolume: parseFloat(k.V),
              takerBuyQuoteAssetVolume: parseFloat(k.Q),
              change: ((close - open) / open) * 100,
              amplitude: high > 0 ? (1 - low / high) * 100 : 0
            };
            
            dbService.saveKline(kline).then(() => {
              dbService.pruneKlines(symbol, '15m', 300);
            }).catch(err => {
              console.error(`Failed to save closed kline for ${symbol}:`, err);
            });
          }

          this.lastMarketDataTime = Date.now();

          // 如果当前有该币种的持仓，立即更新 accountData 并推送
          if (this.accountData && this.accountData.positions) {
            const posIndex = this.accountData.positions.findIndex((p: any) => p.symbol === symbol);
            if (posIndex !== -1) {
              this.accountData.positions[posIndex].currentPrice = price;
              if (this.onUpdate) {
                this.onUpdate('account', this.accountData);
              }
            }
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    ws.on('error', (err: any) => {
      this.addLog('WebSocket', `[连接#${id}] 错误: ${err.message}`, 'error');
    });

    ws.on('close', (code, reason) => {
      // 从数组中移除
      this.marketWss = this.marketWss.filter(w => w !== ws);
      
      if (this.isRunning) {
        // 实现指数退避重连逻辑，降低重连频率
        const attempts = this.marketWsReconnectAttempts.get(id) || 0;
        // 初始延迟 15s，之后以 1.5 倍递增，最大 5 分钟
        const delay = Math.min(15000 * Math.pow(1.5, attempts), 300000); 
        
        this.addLog('WebSocket', `[连接#${id}] 已断开 (代码: ${code})，${(delay/1000).toFixed(1)}秒后尝试重连...`, 'warning');
        
        setTimeout(() => {
          if (this.isRunning) {
            this.marketWsReconnectAttempts.set(id, attempts + 1);
            this.createMarketConnection(symbols, id);
          }
        }, delay);
      }
    });
  }

  private async initWebSocket() {
    try {
      this.cleanupWs();

      this.listenKey = await this.binance.getListenKey();
      if (!this.listenKey) {
        throw new Error('无法获取 ListenKey');
      }

      const wsUrl = `${this.settings.binance.wsUrl}/${this.listenKey}`;
      this.addLog('WebSocket', `正在连接: ${this.settings.binance.wsUrl}/...`, 'info');
      
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.wsConnected = true;
        this.reconnectAttempts = 0;
        this.addLog('WebSocket', 'Binance User Data Stream 已连接', 'success');
        
        // Start keep alive every 30 minutes
        this.keepAliveInterval = setInterval(async () => {
          if (this.isRunning && this.listenKey) {
            try {
              await this.binance.keepAliveListenKey();
              this.addLog('WebSocket', 'ListenKey 续期成功', 'info');
            } catch (e: any) {
              this.addLog('WebSocket', `ListenKey 续期失败: ${e.message}`, 'error');
            }
          }
        }, 30 * 60 * 1000);

        // Start ping every 30 seconds to keep connection alive
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.ping();
            } catch (e) {
              this.addLog('WebSocket', 'Ping 发送失败', 'warning');
            }
          }
        }, 30000);
      });

      this.ws.on('pong', () => {
        // Pong received, connection is healthy
      });

      this.ws.on('message', (data: string) => {
        try {
          const event = JSON.parse(data);
          this.handleWsEvent(event);
        } catch (e: any) {
          this.addLog('WebSocket', `解析消息失败: ${e.message}`, 'error');
        }
      });

      this.ws.on('error', (error: any) => {
        this.wsConnected = false;
        this.addLog('WebSocket', `连接错误: ${error.message}`, 'error');
      });

      this.ws.on('close', (code, reason) => {
        this.wsConnected = false;
        this.addLog('WebSocket', `连接已关闭 (代码: ${code}, 原因: ${reason})`, 'warning');
        
        this.cleanupWs();

        if (this.isRunning) {
          const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
          this.addLog('WebSocket', `${delay / 1000}秒后尝试重新连接 (尝试次数: ${this.reconnectAttempts + 1})...`, 'info');
          setTimeout(() => {
            if (this.isRunning) {
              this.reconnectAttempts++;
              this.initWebSocket();
            }
          }, delay);
        }
      });

    } catch (error: any) {
      this.addLog('WebSocket', `初始化失败: ${error.message}`, 'error');
      if (this.isRunning) {
        setTimeout(() => {
          if (this.isRunning) this.initWebSocket();
        }, 10000);
      }
    }
  }

  private handleWsEvent(event: any) {
    // WebSocket is only used for account and order updates.
    // Real-time price market data is NOT subscribed to.
    if (event.e === 'ORDER_TRADE_UPDATE' || event.e === 'STRATEGY_ORDER_UPDATE' || event.e === 'ALGO_ORDER_UPDATE') {
      const order = event.o || event.sa || event.ao; // sa for strategy order update, ao for algo
      const symbol = order ? order.s : 'Unknown';
      
      const isFilled = order && order.X === 'FILLED';
      const isPartial = order && order.X === 'PARTIALLY_FILLED';
      
      // 增强日志：检测成交状态
      if (order && (isFilled || isPartial)) {
        const side = order.S === 'BUY' ? '买入' : '卖出';
        const type = order.o === 'MARKET' ? '市价' : (order.o === 'LIMIT' ? '限价' : '算法');
        this.addLog('订单', `[最高] binance仓单成交完成: ${symbol}, 方向: ${side}, 类型: ${type}, 数量: ${order.l}/${order.q}, 价格: ${order.L}`, 'success', event);
        
        // 推送优先：如果是 FILLED 且是平仓方向，立即判定平仓
        if (isFilled) {
          // 尝试通过订单 ID 精确匹配 tradeLog
          let matchedTrade = this.tradeLogs.find(t => 
            t.symbol === symbol && 
            t.status === 'OPEN' && 
            (t.tpOrderId === order.i?.toString() || t.slOrderId === order.i?.toString())
          );
          
          let closeReason: 'TP' | 'SL' | undefined = undefined;
          if (matchedTrade) {
            if (matchedTrade.tpOrderId === order.i?.toString()) {
              closeReason = 'TP';
            } else if (matchedTrade.slOrderId === order.i?.toString()) {
              closeReason = 'SL';
            }
          }
          
          if (!matchedTrade) {
            // 兜底：寻找平仓方向一致的、最早的开放交易日志
            matchedTrade = this.tradeLogs.find(t => 
              t.symbol === symbol && 
              t.status === 'OPEN' && 
              ((t.side === 'BUY' && order.S === 'SELL') || (t.side === 'SELL' && order.S === 'BUY'))
            );
            if (matchedTrade) {
              if (order.o === 'LIMIT') {
                closeReason = 'TP';
              } else {
                closeReason = 'SL';
              }
            }
          }

          if (matchedTrade) {
            this.addLog('订单', `[推送优先] 检测到平仓成交推送: ${symbol}, 匹配交易ID: ${matchedTrade.id}`, 'success');
            this.confirmPositionClosed(symbol, parseFloat(order.L), order.T, matchedTrade.id, closeReason);
          }
        }
      } else {
        this.addLog('订单', `实时推送: ${symbol} ${event.e}`, 'success', event);
      }
      
      // 优化：只有在订单完全成交 (FILLED) 时才触发清理逻辑，减少密集成交时的 API 开销
      // Scheme 2: 在内存中直接映射状态，对 UI 更新，大幅度消减 REST API 热盲查风暴
      if (this.accountData && this.accountData.openOrders) {
        const idx = this.accountData.openOrders.findIndex((ord: any) => ord.orderId === (order ? order.i : undefined));
        if (order && ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(order.X)) {
          if (idx >= 0) this.accountData.openOrders.splice(idx, 1);
        } else if (order && idx >= 0) {
          const oo = this.accountData.openOrders[idx];
          oo.status = order.X;
          oo.executedQty = order.z;
        }
        if (this.onUpdate) this.onUpdate('account', this.accountData);
      }
      
      // 使用拉长防抖处理，由原有 800ms 放大至 3000ms，以内存状态推送为主，REST兜底为辅
      this.fetchAccountDataDebounced({ skipCleanup: !isFilled }); 
    } else if (event.e === 'ACCOUNT_UPDATE') {
      // 账户更新推送：更新内存中的余额和持仓
      if (this.accountData && event.a) {
        // 1. 更新余额 (B 字段)
        if (event.a.B) {
          const usdt = event.a.B.find((b: any) => b.a === 'USDT');
          if (usdt) {
            this.accountData.totalBalance = parseFloat(usdt.wb);
            this.accountData.availableBalance = parseFloat(usdt.cw);
          }
        }
        
        // 2. 更新持仓 (P 字段) - 增量覆盖
        if (event.a.P) {
          event.a.P.forEach((p: any) => {
            const sym = p.s;
            const amount = parseFloat(p.pa);
            const entryPrice = parseFloat(p.ep);
            const side = amount > 0 ? 'LONG' : (amount < 0 ? 'SHORT' : 'NONE');
            
            // 在 accountData.positions 中查找并更新
            const existingIdx = this.accountData.positions.findIndex((pos: any) => pos.symbol === sym);
            if (amount !== 0) {
              const newPos = {
                symbol: sym,
                positionAmt: p.pa,
                entryPrice: p.ep,
                markPrice: p.ep, // 推送中通常不带 markPrice，先用 entryPrice 占位或保留原值
                unRealizedProfit: p.up,
                side: side
              };
              if (existingIdx >= 0) {
                this.accountData.positions[existingIdx] = { ...this.accountData.positions[existingIdx], ...newPos };
              } else {
                this.accountData.positions.push(newPos);
              }
            } else if (existingIdx >= 0) {
              // 仓位归零，移除
              this.accountData.positions.splice(existingIdx, 1);
            }
          });
        }

        if (this.onUpdate) this.onUpdate('account', this.accountData);
        this.addLog('账户', `收到实时状态推送: 余额及 ${event.a.P ? event.a.P.length : 0} 个持仓变动`, 'info');
      }
      
      // 依靠长防抖统一验证对账，由 3000ms 提高到 15000ms，显著降低 API 压力
      this.fetchAccountDataDebounced({ skipCleanup: true });
    } else if (event.e === 'listenKeyExpired') {
      this.addLog('WebSocket', 'ListenKey 已过期，正在重新连接...', 'warning');
      if (this.ws) this.ws.close();
    }
  }

  private fetchAccountDataDebounced(options: { skipCleanup?: boolean } = {}) {
    // 合并选项：如果任何一个请求要求不跳过清理，则最终执行时不跳过
    if (options.skipCleanup === false) {
      this.fetchAccountOptions.skipCleanup = false;
    } else if (this.fetchAccountOptions.skipCleanup === undefined) {
      this.fetchAccountOptions.skipCleanup = options.skipCleanup;
    }

    if (this.fetchAccountTimer) {
      return; // 已经在等待中，不需要重新计时，只需确保选项已合并
    }

    this.fetchAccountTimer = setTimeout(() => {
      const finalOptions = { ...this.fetchAccountOptions };
      this.fetchAccountOptions = {}; // 重置
      this.fetchAccountTimer = null;
      this.fetchAccountData(finalOptions);
    }, 15000); // 防抖大幅拉长至 15000ms：由 WebSocket 内存同步保障实时性，REST 仅用于极低频率对账检测
  }

  private async confirmPositionClosed(
    symbol: string, 
    exitPrice?: number, 
    exitTime?: number, 
    specificTradeLogId?: string,
    reason?: 'TP' | 'SL' | 'TIMEOUT' | 'TRAILING'
  ) {
    // 1. 记录平仓时间用于冷却期
    this.closedPositionsHistory.set(symbol, Date.now());
    this.pendingCloseSymbols.delete(symbol);
    this.pendingCloseTradeLogIds.delete(symbol);

    // 2. 查找并更新交易日志
    const openTrades = specificTradeLogId
      ? this.tradeLogs.filter(t => t.id === specificTradeLogId && t.status === 'OPEN')
      : this.tradeLogs.filter(t => t.symbol === symbol && t.status === 'OPEN');

    if (openTrades.length > 0) {
      this.addLog('订单', `[最高] binance仓单成交完成 (确认平仓): ${symbol}, 共 ${openTrades.length} 个订单需要关闭`, 'success');
      
      try {
        // 优化方案：如果没有传入价格（如通过轮询检测到的平仓），先尝试同步获取当前价格作为占位，防止出现 --
        let priceToUse = exitPrice;
        if (!priceToUse) {
          const currentPrice = await this.fetchCurrentPrice(symbol);
          if (currentPrice !== '--') {
            priceToUse = parseFloat(currentPrice);
          }
        }

        // 获取可能的平仓原因
        const savedReason = this.activeCloseReasons.get(symbol);
        this.activeCloseReasons.delete(symbol); // 清理缓存

        const finalReason = reason || savedReason;

        for (const openTrade of openTrades) {
          let tradeReason: 'CLOSED' | 'TP' | 'SL' | 'TIMEOUT' | 'TRAILING' = finalReason || 'CLOSED';

          if (tradeReason === 'CLOSED') {
            // 根据关联的订单判断是止盈还是止损
            if (openTrade.tpOrderId) {
              const isTpStillOpen = this.accountData?.openOrders?.some((o: any) => o.orderId?.toString() === openTrade.tpOrderId);
              if (!isTpStillOpen) {
                tradeReason = 'TP';
              } else {
                tradeReason = 'SL';
              }
            } else if (openTrade.slOrderId) {
              const isSlStillOpen = this.accountData?.openOrders?.some((o: any) => o.orderId?.toString() === openTrade.slOrderId);
              if (!isSlStillOpen) {
                tradeReason = 'SL';
              } else {
                tradeReason = 'TP';
              }
            }
          }

          // 标记为已关闭
          this.updateTradeLog(openTrade.id, {
            status: tradeReason,
            closeTime: exitTime || Date.now(),
            exitPrice: priceToUse || openTrade.exitPrice
          });

          // 3. 异步补全成交详情
          // 延迟 2 秒获取，给币安 API 一点同步时间
          setTimeout(() => this.fetchAndFillTradeDetails(openTrade.id, symbol, openTrade.openTime), 2000);
        }
      } catch (e: any) {
        this.addLog('系统', `确认平仓失败: ${e.message}`, 'error');
      }
    }

    // 4. 触发一次账户刷新以清理挂单
    // 这里 skipCleanup 为 false，确保清理孤立挂单
    this.fetchAccountDataDebounced({ skipCleanup: false });
  }

  async fetchCurrentPrice(symbol: string): Promise<string> {
    try {
      const ticker = await this.binance.getTickerPrice(symbol);
      return ticker.price;
    } catch (error) {
      return '--';
    }
  }

  public async sendEmail(subject: string, text: string, html?: string) {
    // 邮件通知硬编码
    const emailEnabled = true; // 默认开启
    if (!emailEnabled) return;
    
    // 自动过滤掉所有 USDT 字样
    const cleanSubject = subject.replace(/\s*USDT/gi, '');
    const cleanText = text.replace(/\s*USDT/gi, '');
    const cleanHtml = html ? html.replace(/\s*USDT/gi, '') : undefined;
    
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.qq.com',
        port: 465,
        secure: true,
        auth: {
          user: '67552827@qq.com', // 发送邮箱
          pass: 'qoaferkcewigbhbh', // 授权码
        },
        tls: {
          rejectUnauthorized: false // 忽略证书校验，提高兼容性
        }
      });

      await transporter.sendMail({
        from: `"${this.settings.appName || APP_NAME}" <67552827@qq.com>`,
        to: 'yyb_cq@outlook.com', // 接收邮箱
        subject: cleanSubject,
        text: cleanText,
        html: cleanHtml,
      });
      this.addLog('邮件', `邮件发送成功: ${cleanSubject}`, 'success');
    } catch (e: any) {
      this.addLog('邮件', `邮件发送失败: ${e.message}`, 'error');
    }
  }

  private async checkWithdrawal(balance: number) {
    if (this.isWithdrawing) return;
    
    // 确保在没有持仓且没有正在执行下单逻辑时才进行转账
    if (this.accountData.positions.length > 0 || this.isOrdering) {
      return;
    }

    const { withdrawalThreshold, retentionThreshold } = this.settings.withdrawal;
    
    if (balance > withdrawalThreshold) {
      const amountToTransfer = balance - retentionThreshold;
      if (amountToTransfer > 0) {
        this.isWithdrawing = true;
        this.addLog('系统', `触发提款: 余额 ${balance} > 提款阈值 ${withdrawalThreshold}, 准备转账 ${amountToTransfer.toFixed(2)} 至现货`, 'info');
        try {
          await this.binance.transferToSpot(amountToTransfer.toFixed(2));
          this.addLog('系统', `提款成功: 已转账 ${amountToTransfer.toFixed(2)} USDT 至现货`, 'success');
          this.addTransferLog({
            id: Math.random().toString(36).substr(2, 9),
            asset: 'USDT',
            amount: amountToTransfer,
            type: 'OUT',
            status: 'SUCCESS',
            timestamp: Date.now(),
            message: '自动提款至现货'
          });
          await this.sendEmail('非常好', `转账成功！合约账户余额: ${balance.toFixed(2)}, 已转出: ${amountToTransfer.toFixed(2)} 至现货账户。`);
        } catch (e: any) {
          this.addLog('系统', `提款失败: ${e.message}`, 'error');
          this.addTransferLog({
            id: Math.random().toString(36).substr(2, 9),
            asset: 'USDT',
            amount: amountToTransfer,
            type: 'OUT',
            status: 'FAILED',
            timestamp: Date.now(),
            message: `提款失败: ${e.message}`
          });
        } finally {
          this.isWithdrawing = false;
        }
      }
    }
  }

  private async checkReplenishment(balance: number) {
    const { alarmThreshold, depositAmount = 30 } = this.settings.withdrawal || {};
    if (alarmThreshold !== undefined && balance < alarmThreshold) {
      if (this.isReplenishing) return;
      this.isReplenishing = true;
      const now = Date.now();

      try {
        this.addLog('系统', `触发自动补款: 合约余额 ${balance.toFixed(2)} USDT < 报警阈值 ${alarmThreshold} USDT，准备从现货划转 ${depositAmount} USDT...`, 'warning');
        
        const transferAmtStr = depositAmount.toString();
        await this.binance.transferToFutures(transferAmtStr);
        
        this.addLog('系统', `自动补款成功: 已成功从现货账户划转 ${depositAmount} USDT 至 U本位合约账户`, 'success');
        
        this.addTransferLog({
          id: Math.random().toString(36).substr(2, 9),
          asset: 'USDT',
          amount: depositAmount,
          type: 'IN',
          status: 'SUCCESS',
          timestamp: now,
          message: `自动补款: 现货 -> 合约 (${depositAmount} USDT)`
        });

        if (now - this.lastReplenishmentEmailTime > 3600000) {
          await this.sendEmail('自动补款成功通知', `合约账户余额过低 (当前: ${balance.toFixed(2)} USDT < 阈值: ${alarmThreshold} USDT)。系统已自动从现货账户划转 ${depositAmount} USDT 至合约账户。`);
          this.lastReplenishmentEmailTime = now;
        }

        // 重新获取账户余额以同步最新状态
        await this.fetchAccountData({ force: true });
      } catch (e: any) {
        this.addLog('系统', `自动补款划转失败: ${e.message}`, 'error');
        this.addTransferLog({
          id: Math.random().toString(36).substr(2, 9),
          asset: 'USDT',
          amount: depositAmount,
          type: 'IN',
          status: 'FAILED',
          timestamp: now,
          message: `自动补款失败: ${e.message}`
        });

        if (now - this.lastReplenishmentEmailTime > 3600000) {
          await this.sendEmail('请加码 (补款失败)', `合约账户余额过低 (${balance.toFixed(2)} USDT < 报警阈值: ${alarmThreshold} USDT)，且从现货自动划转 ${depositAmount} USDT 失败: ${e.message}。请尽快处理。`);
          this.lastReplenishmentEmailTime = now;
        }
      } finally {
        this.isReplenishing = false;
      }
    }
  }

  async fetchAccountData(options: { skipCleanup?: boolean; force?: boolean } = {}) {
    if (this.checkBannedStatus()) return;
    
    // 强制刷新频率限制：放宽至 2000 毫秒，避免突发事件击穿
    const now = Date.now();
    if (!options.force && (now - this.lastAccountFetchTime < 2000)) {
      return;
    }
    this.lastAccountFetchTime = now;

    try {
      let targetSymbol: string | undefined = undefined;
      const maxAllowed = this.settings.order?.preferredOrderCount ?? 2;
      if (maxAllowed === 1 && this.currentPosition && this.currentPosition.symbol) {
        targetSymbol = this.currentPosition.symbol;
      }

      // 优化：全并发请求，极大缩短等待时间
      const [account, positions, spotAccount, openOrders, openAlgoOrders] = await Promise.all([
        this.binance.getAccountInfo(),
        this.binance.getPositionRisk(targetSymbol),
        this.binance.getSpotAccountInfo(),
        this.binance.getOpenOrders(targetSymbol),
        this.binance.getOpenAlgoOrders(targetSymbol).catch(() => []) // 容错处理
      ]);

      const activePositions = positions.filter((p: any) => {
        const amount = Math.abs(parseFloat(p.positionAmt));
        if (amount === 0) return false;

        // 计算名义价值 (使用标记价或入场价)
        const price = parseFloat(p.markPrice || p.entryPrice || '0');
        const value = amount * price;

        // 名义价值阈值法：低于 0.1 USDT 视为粉尘仓位
        if (value < 0.1) {
          if (!this.notifiedDustSymbols.has(p.symbol)) {
            this.addLog('系统', `检测到粉尘仓位: ${p.symbol}, 数量: ${p.positionAmt}, 价值: ${value.toFixed(4)} USDT. 将在逻辑中忽略此仓位并发送邮件通知。`, 'warning');
            this.sendEmail('粉尘仓位提醒', `币种: ${p.symbol}\n数量: ${p.positionAmt}\n价值: ${value.toFixed(4)} USDT\n该仓位价值低于 0.1 USDT，系统已在逻辑中将其忽略，以确保下一轮扫描和开仓能正常进行。请手动处理该残余。`)
              .catch(e => console.error('Failed to send dust email:', e));
            this.notifiedDustSymbols.add(p.symbol);
          }
          return false;
        }

        // 如果之前标记过粉尘但现在变大了（比如手动补仓了），移除标记
        if (this.notifiedDustSymbols.has(p.symbol)) {
          this.notifiedDustSymbols.delete(p.symbol);
        }
        
        return true;
      });

      // 映射 Algo 订单到统一格式（提前到此定义，以便后续确认逻辑和防抖逻辑共享使用）
      const mappedAlgoOrders = (Array.isArray(openAlgoOrders) ? openAlgoOrders : (openAlgoOrders?.orders || openAlgoOrders?.data || []))
        .map((o: any) => ({
          ...o,
          isAlgo: true,
          algoId: o.algoId || o.orderId || o.strategyId,
          orderId: o.algoId || o.orderId || o.strategyId,
          origQty: o.quantity || o.origQty || o.totalQuantity,
          price: o.price || '0',
          stopPrice: o.stopPrice || o.triggerPrice || o.activationPrice,
          type: o.algoType || o.strategyType || o.type || 'ALGO',
          time: o.time || o.updateTime || o.createTime
        }));

      const combinedOrders = [...openOrders, ...mappedAlgoOrders];

      // 清理已经彻底消失的粉尘标记
      const currentAllSymbols = new Set(positions.filter((p: any) => parseFloat(p.positionAmt) !== 0).map((p: any) => p.symbol));
      this.notifiedDustSymbols.forEach(sym => {
        if (!currentAllSymbols.has(sym)) {
          this.notifiedDustSymbols.delete(sym);
        }
      });

      const symbolsToCheck = new Set(this.previousPositions.map((p: any) => p.symbol as string));
      for (const sym of this.pendingCloseSymbols.keys()) {
        symbolsToCheck.add(sym);
      }
      // 检查内存中仍然标记为 OPEN 的记录，防止因重启或断联遗漏平仓状态
      this.tradeLogs.filter(t => t.status === 'OPEN').forEach(t => {
        symbolsToCheck.add(t.symbol);
      });

      // 检测仓位关闭 (通过轮询发现)
      symbolsToCheck.forEach(async symbol => {
        const current = activePositions.find((p: any) => p.symbol === symbol);
        if (!current) {
          // 1. 检查冷静期：新开仓 5 秒内不判定消失
          const openTrade = this.tradeLogs.find(t => t.symbol === symbol && t.status === 'OPEN');
          if (openTrade) {
            const age = Date.now() - openTrade.openTime;
            if (age < 5000) {
              this.addLog('系统', `检测到持仓消失但处于冷静期 (${(age/1000).toFixed(1)}s): ${symbol}, 暂不判定平仓`, 'info');
              return;
            }
          }

          // 2. 异步确认逻辑
          const count = (this.pendingCloseSymbols.get(symbol) || 0) + 1;
          if (count === 1) {
            const openTrades = this.tradeLogs.filter(t => t.symbol === symbol && t.status === 'OPEN');
            this.pendingCloseTradeLogIds.set(symbol, openTrades.map(t => t.id));
          }

          if (count >= 2) {
            this.addLog('系统', `持仓轮询为空确认完成，进行平仓: ${symbol}`, 'warning');
            const targetTradeLogIds = this.pendingCloseTradeLogIds.get(symbol) || [];
            if (targetTradeLogIds.length > 0) {
              for (const logId of targetTradeLogIds) {
                await this.confirmPositionClosed(symbol, undefined, undefined, logId);
              }
            } else {
              await this.confirmPositionClosed(symbol);
            }
            this.pendingCloseTradeLogIds.delete(symbol);
          } else {
            this.pendingCloseSymbols.set(symbol, count);
            this.addLog('系统', `检测到持仓消失，进入异步确认期 (第 ${count} 次): ${symbol}`, 'info');
            // 缩短下一次刷新时间以加快确认
            setTimeout(() => this.fetchAccountData(), 2000);
          }
        }
      });

      // 如果持仓重新出现，清除待确认状态
      activePositions.forEach(p => {
        const symbol = p.symbol;
        if (this.pendingCloseSymbols.has(symbol)) {
          // 检查这是否确实是之前待确认平仓的那个交易重新出现（即闪烁），还是说是一个全新的交易
          const openTrades = this.tradeLogs.filter(t => t.symbol === symbol && t.status === 'OPEN');
          const targetTradeLogIds = this.pendingCloseTradeLogIds.get(symbol) || [];
          
          let isFlicker = true;
          for (const logId of targetTradeLogIds) {
            const openTrade = openTrades.find(t => t.id === logId);
            if (openTrade && (openTrade.tpOrderId || openTrade.slOrderId)) {
              const hasOldOrders = combinedOrders.some(o => 
                (openTrade.tpOrderId && o.orderId.toString() === openTrade.tpOrderId) || 
                (openTrade.slOrderId && o.orderId.toString() === openTrade.slOrderId)
              );
              if (!hasOldOrders) {
                isFlicker = false;
                break;
              }
            }
          }

          if (isFlicker) {
            this.addLog('系统', `持仓重新出现且包含旧挂单/无挂单记录，确认为闪烁，取消平仓确认: ${symbol}`, 'info');
            this.pendingCloseSymbols.delete(symbol);
            this.pendingCloseTradeLogIds.delete(symbol);
          } else {
            this.addLog('系统', `持仓重新出现但未包含旧挂单，确认为新开仓，不取消旧仓平仓确认: ${symbol}`, 'info');
          }
        }
      });

      this.previousPositions = activePositions;

      // 幽灵仓单优化：有持仓但无任何委托单 (5秒检测)
      // 排除正在下单中的情况，以及 30 秒内新开的仓位
      const realGhostPositions = activePositions.filter(p => {
        const age = Date.now() - (p.updateTime || 0);
        return age > 30000; // 只有超过 30 秒的仓位才考虑是幽灵
      });

      if (realGhostPositions.length > 0 && combinedOrders.length === 0 && !this.isOrdering) {
        if (this.noOrdersStartTime === null) {
          this.noOrdersStartTime = Date.now();
          this.addLog('订单', '检测到有持仓但无委托单，开始 5 秒观察期...', 'warning');
          // 缩短下一次刷新时间，以便在 5 秒后能及时处理
          setTimeout(() => this.fetchAccountData(), 5000);
        } else {
          const elapsed = Date.now() - this.noOrdersStartTime;
          if (elapsed >= 5000) {
            this.addLog('订单', `检测到有持仓但无委托单已超过 5 秒 (${(elapsed/1000).toFixed(1)}s)，正在立即市价平仓所有无单持仓: ${realGhostPositions.map(p => p.symbol).join(', ')}...`, 'error');
            for (const gp of realGhostPositions) {
              await this.closeCurrentPosition(gp.symbol);
            }
            this.noOrdersStartTime = null;
            // 平仓后立即再次刷新
            setTimeout(() => this.fetchAccountData(), 1000);
            return; // 提前返回，避免后续逻辑干扰
          }
        }
      } else {
        this.noOrdersStartTime = null;
      }

      const totalBalance = account.totalWalletBalance || '0.00';
      const availableBalance = account.availableBalance || '0.00';
      
      // 获取现货 USDT 余额
      let spotBalance = '0.00';
      if (spotAccount && spotAccount.balances) {
        const usdtBalance = spotAccount.balances.find((b: any) => b.asset === 'USDT');
        if (usdtBalance) {
          spotBalance = (parseFloat(usdtBalance.free) + parseFloat(usdtBalance.locked)).toFixed(2);
        }
      }

      this.accountData = {
        totalBalance,
        availableBalance,
        spotBalance,
        positions: activePositions.map((p: any) => {
          const amount = parseFloat(p.positionAmt);
          const entryPrice = parseFloat(p.entryPrice);
          const kline = this.getCachedKline(p.symbol);
          return {
            ...p,
            entryValue: (Math.abs(amount) * entryPrice).toFixed(2),
            currentPrice: kline ? kline.close : (p.markPrice ? parseFloat(p.markPrice) : null)
          };
        }),
        openOrders: combinedOrders
      };

      // 余额阈值检测
      const balance = parseFloat(totalBalance);
      const threshold = this.settings.withdrawal.alarmThreshold;
      const emailEnabled = true; // 默认开启
      if (emailEnabled && balance < threshold) {
        if (!this.balanceAlertSent) {
          this.balanceAlertSent = true;
          this.addLog('系统', `余额提醒: 当前总余额 (${balance}) 低于设定阈值 (${threshold})`, 'warning');
          this.addLog('邮件', `准备发送余额提醒邮件至: yyb_cq@outlook.com`, 'info');
          await this.sendEmail('余额提醒', `当前总余额 (${balance.toFixed(2)}) 低于设定阈值 (${threshold})，请注意。`);
        }
      } else if (balance >= threshold) {
        this.balanceAlertSent = false;
      }

      // 孤立资源清理逻辑 (Orphan Cleanup)
      if (!this.isOrdering && !this.isCancelling && !options.skipCleanup) {
        const positionSymbols = new Set(activePositions.map(p => p.symbol));
        const ordersToCancel: any[] = [];
        
        // 1. 收集孤立挂单：没有持仓的币种不应该有挂单
        const orphanOrders = combinedOrders.filter(o => !positionSymbols.has(o.symbol));
        if (orphanOrders.length > 0) {
          this.addLog('清理', `检测到孤立挂单: ${Array.from(new Set(orphanOrders.map(o => o.symbol))).join(', ')}，准备清理...`, 'warning');
          ordersToCancel.push(...orphanOrders);
        }

        // 2. 收集重复挂单：每个持仓币种只能有一个 Limit 和一个 Algo 委托单，优先基于订单 ID 关联进行精准清理
        for (const symbol of positionSymbols) {
          const symbolOrders = combinedOrders.filter(o => o.symbol === symbol);
          
          const openTradesOfSymbol = this.tradeLogs.filter(t => t.symbol === symbol && t.status === 'OPEN');
          const legitimateOrderIds = new Set<string>();
          let hasPopulatedIds = false;
          
          openTradesOfSymbol.forEach(t => {
            if (t.tpOrderId) {
              legitimateOrderIds.add(t.tpOrderId);
              hasPopulatedIds = true;
            }
            if (t.slOrderId) {
              legitimateOrderIds.add(t.slOrderId);
              hasPopulatedIds = true;
            }
          });

          if (hasPopulatedIds) {
            // 如果有记录的关联订单 ID，精确定位并清理非关联的冗余订单
            const redundantOrders = symbolOrders.filter(o => {
              const oid = (o.algoId || o.orderId || o.strategyId || '').toString();
              return !legitimateOrderIds.has(oid);
            });
            
            if (redundantOrders.length > 0) {
              this.addLog('清理', `[精准清理] 检测到 ${symbol} 有 ${redundantOrders.length} 个非关联的冗余挂单，准备清理...`, 'warning');
              ordersToCancel.push(...redundantOrders);
            }
          } else {
            // 兜底逻辑：显式按时间排序 (升序)，确保索引 0 是最早的订单
            const limitOrders = symbolOrders
              .filter(o => !o.isAlgo)
              .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
              
            const algoOrders = symbolOrders
              .filter(o => o.isAlgo)
              .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));

            if (limitOrders.length > 1) {
              const redundant = limitOrders.slice(1);
              this.addLog('清理', `检测到 ${symbol} 有多个 Limit 挂单 (${limitOrders.length})，将清理 ${redundant.length} 个冗余订单，保留最早的一张。`, 'warning');
              ordersToCancel.push(...redundant);
            }

            if (algoOrders.length > 1) {
              const redundant = algoOrders.slice(1);
              this.addLog('清理', `检测到 ${symbol} 有多个 Algo 挂单 (${algoOrders.length})，将清理 ${redundant.length} 个冗余订单，保留最早的一张。`, 'warning');
              ordersToCancel.push(...redundant);
            }
          }
        }

        // 3. 执行统一撤单
        if (ordersToCancel.length > 0) {
          await this.cancelAllOrdersSequentially(ordersToCancel);
        }

        // 4. 清理多余持仓：清理超出设定下单限制的仓位
        const maxAllowedPositions = this.settings.order?.preferredOrderCount ?? 2;
        if (activePositions.length > maxAllowedPositions) {
          // 按照是否有对应的 OPEN 状态的交易日志进行排序，优先保留有 OPEN 交易日志的仓位
          const sortedPositions = [...activePositions].sort((a, b) => {
            const aOpen = this.tradeLogs.some(t => t.symbol === a.symbol && t.status === 'OPEN') ? 1 : 0;
            const bOpen = this.tradeLogs.some(t => t.symbol === b.symbol && t.status === 'OPEN') ? 1 : 0;
            return bOpen - aOpen; // 1（有日志）排在 0（无日志）前面
          });
          const extraPositions = sortedPositions.slice(maxAllowedPositions);
          
          for (const pos of extraPositions) {
            this.addLog('清理', `检测到多余持仓: ${pos.symbol}，正在强制平仓...`, 'error');
            await this.closeSpecificPosition(pos);
          }
          setTimeout(() => this.fetchAccountData(), 1000);
        }
      }

      // 当无持仓且无挂单时，执行补提款检测 (转账操作只能在没有正向单持仓的时候发生)
      // 优化：仅在“自动补全交易详情”成功后触发检查，避免频繁提示
      if (activePositions.length === 0 && combinedOrders.length === 0 && !this.isOrdering) {
        if (this.shouldCheckTransfer) {
          if (this.emptyAccountStartTime === null) {
            this.emptyAccountStartTime = Date.now();
            this.addLog('划转', '检测到账户已清空，开始 5 秒划转观察期...', 'info');
            // 缩短下一次刷新时间，以便在 5 秒后能及时处理
            setTimeout(() => this.fetchAccountData(), 5000);
          } else {
            const elapsed = Date.now() - this.emptyAccountStartTime;
            if (elapsed >= 5000) {
              await this.checkWithdrawal(balance);
              await this.checkReplenishment(balance);
              this.emptyAccountStartTime = null; // 执行后重置
              this.shouldCheckTransfer = false; // 执行后重置
            }
          }
        }
      } else {
        if (this.emptyAccountStartTime !== null) {
          this.addLog('划转', '检测到新活动，取消划转观察期', 'info');
        }
        this.emptyAccountStartTime = null;
        this.shouldCheckTransfer = false; // 如果账户不为空，重置触发标记
      }

      if (activePositions.length > 0) {
        // 同步所有持仓的开仓价到交易日志
        for (const p of activePositions) {
          const localTrade = this.tradeLogs.find(t => t.symbol === p.symbol && t.status === 'OPEN');
          if (localTrade) {
            const actualEntryPrice = parseFloat(p.entryPrice);
            if (localTrade.entryPrice !== actualEntryPrice && actualEntryPrice > 0) {
              this.addLog('系统', `[开仓价同步] 自动同步 ${p.symbol} 开仓价: ${localTrade.entryPrice} -> 实际持仓开仓均价 ${actualEntryPrice}`, 'info');
              this.updateTradeLog(localTrade.id, { entryPrice: actualEntryPrice });
            }
          }
        }

        const p = activePositions[0];
        const localTrade = this.tradeLogs.find(t => t.symbol === p.symbol && t.status === 'OPEN');
        const openTime = localTrade ? localTrade.openTime : (p.updateTime || Date.now());

        this.currentPosition = {
          symbol: p.symbol,
          amount: parseFloat(p.positionAmt),
          entryPrice: parseFloat(p.entryPrice),
          side: parseFloat(p.positionAmt) > 0 ? 'BUY' : 'SELL',
          timestamp: openTime
        };
      } else {
        this.currentPosition = null;
      }

      if (this.onUpdate) {
        this.onUpdate('account', this.accountData);
      }

      return this.accountData;
    } catch (error: any) {
      if (error.message.includes('Too many requests') || error.status === 429 || error.message.includes('-1003')) {
        this.addLog('系统', '检测到频率限制 (429/Too many requests)，暂停 API 请求 30 秒并发送邮件通知', 'error');
        this.isBanned = true;
        this.banUntil = Date.now() + 30000;
        
        // 发送邮件通知
        this.sendEmail(
          `【限频提醒】${this.settings.appName || '量化系统'} - 接口请求过多 (429)`,
          `系统检测到接口请求过于频繁，已自动暂停 30 秒以保护账户安全。\n\n账户 ID: ${this.accountId}\n触发时间: ${new Date().toLocaleString()}\n错误详情: ${error.message}`
        ).catch(e => console.error("Failed to send 429 email:", e));
      }
      
      if (error.status === 401) {
        this.addLog('账户', '获取账户数据失败: API Key 或 Secret Key 无效，请检查设置', 'error');
      } else {
        this.addLog('账户', `获取账户数据失败: ${error.message}`, 'error');
      }
    }
  }

  private async cancelAllOrdersSequentially(orders: any[]) {
    if (this.isCancelling) return;
    this.isCancelling = true;

    try {
      const limitOrders = orders.filter(o => !o.isAlgo);
      const algoOrders = orders.filter(o => o.isAlgo);

      // 1. 撤销 Limit 委托单
      for (const order of limitOrders) {
        try {
          await this.binance.cancelOrder(order.symbol, order.orderId);
          this.addLog('订单', `[最高] 撤单请求已发送: ${order.symbol} (${order.orderId}), 类型: 普通单`, 'success');
        } catch (e: any) {
          // 如果返回 -2011 (Unknown order)，说明订单已经不存在（可能已撤销或成交），视为成功
          if (e.message.includes('-2011') || e.message.includes('Unknown order')) {
            this.addLog('订单', `[最高] 撤单完成: ${order.symbol} (${order.orderId}), 类型: 普通单 (订单已不存在)`, 'success');
          } else {
            this.addLog('订单', `撤销普通单失败 (${order.symbol}): ${e.message}`, 'error');
          }
        }
      }

      // 2. 撤销 Algo 委托单
      for (const order of algoOrders) {
        try {
          await this.binance.cancelAlgoOrder(order.symbol, order.algoId || order.orderId);
          this.addLog('订单', `[最高] 撤单请求已发送: ${order.symbol} (${order.algoId || order.orderId}), 类型: 算法单`, 'success');
        } catch (e: any) {
          // 如果返回 -2011 (Unknown order)，说明订单已经不存在，视为成功
          if (e.message.includes('-2011') || e.message.includes('Unknown order')) {
            this.addLog('订单', `[最高] 撤单完成: ${order.symbol} (${order.algoId || order.orderId}), 类型: 算法单 (订单已不存在)`, 'success');
          } else {
            this.addLog('订单', `撤销算法单失败 (${order.symbol}): ${e.message}`, 'error');
          }
        }
      }
    } finally {
      this.isCancelling = false;
      // 撤单完成后 2 秒自动刷新账户数据
      setTimeout(() => this.fetchAccountData(), 2000);
    }
  }

  async forceScan(stage: number) {
    if (this.checkBannedStatus()) {
      this.addLog('系统', `IP 封禁中，无法执行强制扫描 (预计解封: ${new Date(this.banUntil).toLocaleString()})`, 'warning');
      return;
    }
    this.addLog('系统', `手动触发 Stage ${stage} 扫描...`, 'info');
    switch (stage) {
      case 0: await this.runStage0(); break;
      case 1: await this.runStage0P(); break;
      case 2: await this.runStage1(); break;
      case 3: await this.runStage2(true); break;
      default: this.addLog('系统', `无效的 Stage: ${stage}`, 'error');
    }
  }

  /**
   * 强制平仓指定币种
   */
  public async forceClosePosition(symbol: string) {
    this.addLog('下单', `准备强制市价平仓: ${symbol}`, 'warning');
    try {
      // 1. 获取该币种的当前持仓情况
      const accountInfo = await this.binance.getAccountInfo();
      const pos = (accountInfo.positions || []).find((p: any) => p.symbol === symbol);
      
      const positionAmt = parseFloat(pos?.positionAmt || '0');
      if (positionAmt === 0) {
        this.addLog('下单', `强制平仓失败: ${symbol} 当前无持仓`, 'error');
        return { success: false, message: '当前无持仓' };
      }

      const amount = Math.abs(positionAmt).toString();
      const side = positionAmt > 0 ? 'SELL' : 'BUY';

      // 2. 撤销所有挂单
      await this.binance.cancelAllOpenOrders(symbol);
      
      // 3. 发送市价反向单平仓
      const result = await this.binance.placeOrder({
        symbol,
        side,
        type: 'MARKET',
        quantity: amount,
        reduceOnly: 'true'
      });

      this.addLog('下单', `强制平仓成功: ${symbol} 方向: ${side} 数量: ${amount}`, 'success');
      
      // 4. 刷新账户数据
      await this.fetchAccountData();
      
      return { success: true, result };
    } catch (error: any) {
      this.addLog('下单', `强制平仓执行异常: ${error.message}`, 'error');
      return { success: false, message: error.message };
    }
  }

  private async ensureOneWayPositionMode() {
    if (this.settings.binance?.positionModeChecked) return;
    
    try {
      const modeResponse = await this.binance.getPositionMode();
      
      // If it's in dual side (hedge) mode, change it to one-way
      if (modeResponse.dualSidePosition === true) {
        this.addLog('系统', '检测到合约仓位模式为双向持仓，正在修改为单向持仓...');
        await this.binance.setPositionMode(false);
        this.addLog('系统', '仓位模式已成功修改为单向持仓', 'success');
      } else {
        this.addLog('系统', '合约仓位模式已是单向持仓', 'info');
      }
      
      // Update settings silently to remember it's checked
      this.settings.binance.positionModeChecked = true;
      await dbService.saveSettings(this.settings, `settings_${this.accountId}`);
      
    } catch (error: any) {
      if (error && error.message && error.message.includes("No need to change position side")) {
        // Already in one-way mode
        this.settings.binance.positionModeChecked = true;
        await dbService.saveSettings(this.settings, `settings_${this.accountId}`);
        this.addLog('系统', '合约仓位模式已是单向持仓', 'info');
      } else {
        this.addLog('系统', `检查或修改仓位模式发生错误: ${error.message}`, 'error');
      }
    }
  }

  async checkApiStatus() {
    if (this.checkBannedStatus()) {
      return { api: 'error', ws: this.wsConnected ? 'ok' : 'error', error: `IP 封禁中 (预计解封: ${new Date(this.banUntil).toLocaleString()})` };
    }

    this.addLog('系统', '正在检测 API 和 WebSocket 状态...', 'info');
    try {
      const startTime = Date.now();
      await this.binance.getExchangeInfo();
      const latency = Date.now() - startTime;
      this.apiConnected = true;
      this.addLog('系统', `API 状态正常 (延迟: ${latency}ms)`, 'success');
      return { api: 'ok', ws: this.wsConnected ? 'ok' : 'error', latency };
    } catch (error: any) {
      this.apiConnected = false;
      this.addLog('系统', `API 检测失败: ${error.message}`, 'error');
      
      // 处理封禁
      if (error.status === 429 || error.status === 418) {
        this.handleBan(error);
      }
      
      return { api: 'error', ws: this.wsConnected ? 'ok' : 'error', error: error.message };
    }
  }

  /**
   * 处理币安 IP 封禁或限频
   */
  private async handleBan(error: any) {
    if (StrategyEngine.isGlobalBanned) return; 
    StrategyEngine.isGlobalBanned = true;

    let retryAfter = 0;
    
    // 1. 从 Header 获取 Retry-After (秒)
    if (error.headers && error.headers['retry-after']) {
      retryAfter = parseInt(error.headers['retry-after']) * 1000;
    }

    // 2. 从 Body 获取截止时间戳 (毫秒)
    // 币安报文示例: {"code":-1003,"msg":"Way too many requests; IP banned until 1681056000000."}
    if (error.data && error.data.msg && error.data.msg.includes('until')) {
      const match = error.data.msg.match(/until (\d+)/);
      if (match) {
        const untilTs = parseInt(match[1]);
        const waitMs = untilTs - Date.now();
        if (waitMs > retryAfter) retryAfter = waitMs;
      }
    }

    // 如果无法获取具体时间，默认等待 10 分钟
    if (retryAfter <= 0) {
      retryAfter = 600000;
    }

    // 封禁截止时间后 1 分钟再启动
    const totalWait = retryAfter + 60000;
    const banUntil = Date.now() + totalWait;
    StrategyEngine.globalBanUntil = banUntil;

    // 立即停止所有账户的策略 (包括 WS 和 REST)
    for (const engine of StrategyEngine.instances) {
       engine.isBanned = true;
       engine.banUntil = banUntil;
       engine.addLog('系统', `全局封禁触发：由于某账户检测到 IP 封禁，已停止所有 API 调用。预计解封时间：${new Date(banUntil).toLocaleString()}`, 'error');
       engine.stop();
    }
    
    // 发送邮件通知
    const banTimeStr = new Date(banUntil).toLocaleString();
    this.sendEmail(
      `【异常警报】${this.settings.appName || '量化系统'} - IP 被封禁或严重限频 (触发账户：${this.accountId})`, 
      `系统检测到 IP 已被币安封禁或严重限频，所有账户策略已强制停止并计划自动按序重启。\n\n触发账户: ${this.accountId}\n预计解封时间: ${banTimeStr}\n错误状态码: ${error.status}\n错误详情: ${error.message || (error.data ? JSON.stringify(error.data) : '未知驱动错误')}`
    ).catch(e => console.error("Failed to send ban email:", e));

    // 计划自动重启
    setTimeout(() => {
      StrategyEngine.isGlobalBanned = false;
      StrategyEngine.globalBanUntil = 0;
      StrategyEngine.restartAllInstances();
    }, totalWait);
  }

  public static async restartAllInstances() {
    const primaryEngines = StrategyEngine.instances.filter(e => e.isPrimary);
    const subEngines = StrategyEngine.instances.filter(e => !e.isPrimary);
    
    // 启动主账户，每次间隔 3 秒
    for (const engine of primaryEngines) {
      engine.isBanned = false;
      engine.banUntil = 0;
      engine.addLog('系统', '封禁保护期已过，主账户尝试自动重新启动策略...', 'success');
      engine.start().catch(e => engine.addLog('系统', `主账户自动重启失败: ${e.message}`, 'error'));
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // 启动子账户，每次间隔 3 秒
    for (const engine of subEngines) {
      engine.isBanned = false;
      engine.banUntil = 0;
      engine.addLog('系统', '封禁保护期已过，子账户尝试自动重新启动策略...', 'success');
      engine.start().catch(e => engine.addLog('系统', `子账户自动重启失败: ${e.message}`, 'error'));
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  private async syncTime() {
    try {
      const startTime = Date.now();
      const serverTime = await this.binance.getServerTime();
      const endTime = Date.now();
      const latency = (endTime - startTime) / 2;
      
      // 考虑往返延迟，计算更精确的偏移量
      this.timeOffset = serverTime + latency - endTime;
      this.lastTimeSyncTime = endTime;
      this.addLog('系统', `服务器时间同步完成: 偏移量 ${this.timeOffset}ms, 延迟 ${latency.toFixed(0)}ms`, 'info');
    } catch (error: any) {
      this.addLog('系统', `时间同步失败: ${error.message}`, 'error');
    }
  }

  private async runLoop() {
    while (this.isRunning) {
      try {
        await this.checkAndScan();
        
        const now = Date.now();
        const hasPosition = this.accountData.positions.length > 0;
        
        // 检查每小时 18 分记录余额
        this.checkAndRecordBalance();

        // 检查持仓超时
        if (hasPosition) {
          await this.checkPositionTimeout();
          await this.checkTrailingStop();
        }
        
        // 动态轮询频率：有仓位缩短至 15 秒一次，无仓位 180 秒一次
        // 业务逻辑现已由 WebSocket 实时更新内存保障，REST 仅作为低频离线对账
        const pollInterval = hasPosition ? 15000 : 180000;
        if (now - this.lastAccountFetchTime > pollInterval) {
          this.fetchAccountData();
        }

        // 行情心跳检测：如果超过 30 秒没有收到任何行情推送，且有持仓，强制刷新一次账户数据
        if (hasPosition && now - this.lastMarketDataTime > 30000) {
          this.lastMarketDataTime = now; 
          this.fetchAccountData();
        }

        // 时间同步 (30 分钟一次)
        if (now - this.lastTimeSyncTime > 1800000) {
          this.syncTime();
        }

        // API 状态检测保持较低频率 (5 分钟一次)
        if (now - this.lastApiCheckTime > 300000) {
          this.lastApiCheckTime = now;
          this.checkApiStatus();
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        this.addLog('系统', `运行循环错误: ${error.message}`, 'error');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private async checkPositionTimeout() {
    if (this.checkBannedStatus() || !this.settings.order?.maxHoldTime) return;

    const openTrades = this.tradeLogs.filter(t => t.status === 'OPEN');
    if (openTrades.length === 0) return;

    const sortedOpenTrades = [...openTrades].sort((a, b) => a.openTime - b.openTime);
    const now = Date.now() + this.timeOffset;

    for (let index = 0; index < sortedOpenTrades.length; index++) {
      const trade = sortedOpenTrades[index];
      const symbol = trade.symbol;
      if (this.lockingSymbols.has(symbol)) continue;

      const isSecond = index === 1 && !!this.settings.order?.secondOrderCustomEnabled;
      const maxHoldTimeVal = isSecond 
        ? (this.settings.order.secondMaxHoldTime ?? this.settings.order.maxHoldTime) 
        : this.settings.order.maxHoldTime;

      const maxHoldTimeMs = maxHoldTimeVal * 60 * 1000;
      const holdTimeMs = now - trade.openTime;

      if (holdTimeMs >= maxHoldTimeMs) {
        this.addLog('策略', `${isSecond ? '第二' : '第一'}仓单持仓时间已达上限 (${maxHoldTimeVal} 分钟)，正在强制平仓并撤销所有订单: ${symbol}`, 'warning');
        await this.closeCurrentPosition(symbol, 'TIMEOUT');
      }
    }
  }

  private async checkTrailingStop() {
    if (this.checkBannedStatus()) return;

    const trailingStartMinutes = this.settings.order?.trailingStartMinutes ?? 3;
    const trailingCloseRatio = this.settings.order?.trailingCloseRatio ?? 0;

    const openTrades = this.tradeLogs.filter(t => t.status === 'OPEN');
    if (openTrades.length === 0) return;

    const now = Date.now() + this.timeOffset;

    for (const trade of openTrades) {
      const symbol = trade.symbol;
      if (this.lockingSymbols.has(symbol)) continue;

      // 检查该币种在 accountData.positions 中是否真的存在
      const pos = (this.accountData?.positions || []).find((p: any) => p.symbol === symbol);
      if (!pos) continue;

      const holdTimeMs = now - trade.openTime;
      const trailingStartMs = trailingStartMinutes * 60 * 1000;

      if (holdTimeMs >= trailingStartMs) {
        // 计算 ROE%
        const amount = parseFloat(pos.positionAmt || '0');
        const entryPrice = parseFloat(pos.entryPrice || '0');
        const currentPrice = pos.currentPrice ? parseFloat(pos.currentPrice) : (pos.markPrice ? parseFloat(pos.markPrice) : 0);

        if (amount === 0 || entryPrice === 0 || currentPrice === 0) continue;

        let pnl = 0;
        if (pos.unRealizedProfit !== undefined && pos.unRealizedProfit !== null) {
          pnl = parseFloat(pos.unRealizedProfit);
        } else {
          pnl = (currentPrice - entryPrice) * amount;
        }

        const entryValue = parseFloat(pos.entryValue || '0') || (Math.abs(amount) * entryPrice);
        const leverage = parseFloat(pos.leverage || '1');
        const margin = entryValue / leverage;
        const roe = margin > 0 ? (pnl / margin) * 100 : 0;

        if (roe < trailingCloseRatio) {
          this.addLog('策略', `检测到 ${symbol} 持仓已达启动追踪时间 ${trailingStartMinutes} 分钟，当前收益率 (ROE%) 为 ${roe.toFixed(2)}%，低于追踪平仓系数 ${trailingCloseRatio}%，触发追踪平仓！`, 'warning');
          await this.closeCurrentPosition(symbol, 'TRAILING');
        }
      }
    }
  }

  private async closeSpecificPosition(pos: any) {
    try {
      const symbol = pos.symbol;
      const amount = parseFloat(pos.positionAmt);
      const closeSide = amount > 0 ? 'SELL' : 'BUY';
      
      this.addLog('清理', `执行孤立仓位平仓: ${symbol}, 数量: ${Math.abs(amount)}`, 'info');
      
      await this.binance.placeOrder({
        symbol,
        side: closeSide,
        type: 'MARKET',
        quantity: Math.abs(amount).toString(),
        reduceOnly: 'true'
      });

      this.addLog('清理', `[最高] 孤立仓位平仓完成: ${symbol}`, 'success');
    } catch (error: any) {
      this.addLog('清理', `孤立仓位平仓失败 (${pos.symbol}): ${error.message}`, 'error');
    }
  }

  private async closeCurrentPosition(targetSymbol?: string, reason?: 'TIMEOUT' | 'TRAILING') {
    const symbol = targetSymbol || this.currentPosition?.symbol;
    if (!symbol) return;

    if (reason) {
      this.activeCloseReasons.set(symbol, reason);
    }
    
    // 从账户持仓数据或 currentPosition 中获取当前持仓金额和方向
    let amount = 0;
    let side: 'BUY' | 'SELL' = 'BUY';
    
    if (this.accountData?.positions) {
      const pos = this.accountData.positions.find((p: any) => p.symbol === symbol);
      if (pos) {
        amount = parseFloat(pos.positionAmt);
        side = amount > 0 ? 'BUY' : 'SELL';
      }
    }
    
    if (amount === 0 && this.currentPosition && this.currentPosition.symbol === symbol) {
      amount = this.currentPosition.amount;
      side = this.currentPosition.side;
    }
    
    if (amount === 0) {
      this.confirmPositionClosed(symbol, undefined, undefined, undefined, reason);
      return;
    }
    
    if (this.lockingSymbols.has(symbol)) return;
    
    this.lockingSymbols.add(symbol);

    try {
      const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
      this.addLog('下单', `执行强制平仓流程: ${symbol}, 方向: ${closeSide}, 数量: ${Math.abs(amount)}`, 'info');
      
      // 1. 撤销该币种所有订单 (包括普通单和算法单)
      // 按照建议：先撤单，再平仓
      try {
        this.addLog('清理', `正在撤销 ${symbol} 的所有委托单...`, 'info');
        
        // 撤销普通单
        try {
          await this.binance.cancelAllOpenOrders(symbol);
          this.addLog('清理', `${symbol} 普通委托单撤销请求已发送`, 'success');
        } catch (e: any) {
          if (e.message.includes('-2011') || e.message.includes('Unknown order')) {
            this.addLog('清理', `${symbol} 无需撤销普通单 (订单已不存在)`, 'info');
          } else {
            throw e;
          }
        }

        // 撤销算法单
        const algoOrders = this.accountData.openOrders.filter((o: any) => o.symbol === symbol && o.isAlgo);
        if (algoOrders.length > 0) {
          this.addLog('清理', `检测到 ${algoOrders.length} 个算法单，正在逐一撤销...`, 'info');
          for (const o of algoOrders) {
            try {
              await this.binance.cancelAlgoOrder(symbol, o.algoId || o.orderId);
            } catch (ae: any) {
              if (!ae.message.includes('-2011') && !ae.message.includes('Unknown order')) {
                this.addLog('清理', `撤销算法单失败: ${ae.message}`, 'warning');
              }
            }
          }
          this.addLog('清理', `${symbol} 算法单清理完成`, 'success');
        }
      } catch (e: any) {
        this.addLog('清理', `平仓前撤单出现异常 (将继续尝试平仓): ${e.message}`, 'warning');
      }
      
      // 2. 下市价平仓单
      try {
        await this.binance.placeOrder({
          symbol,
          side: closeSide,
          type: 'MARKET',
          quantity: Math.abs(amount).toString(),
          reduceOnly: 'true'
        });
        this.addLog('下单', `[最高] binance仓单成交完成 (强制平仓成功): ${symbol}`, 'success');
      } catch (e: any) {
        // 如果报错 -2022 (ReduceOnly rejected)，通常意味着仓位已经没了
        if (e.message.includes('-2022') || e.message.includes('ReduceOnly')) {
          this.addLog('下单', `平仓单被拒绝: ${symbol} (开仓可能在服务器端关闭)`, 'warning');
          // 既然仓位可能没了，我们标记为已关闭
          this.confirmPositionClosed(symbol);
        } else {
          throw e;
        }
      }
      
      // 3. 强制同步账户数据并等待
      this.addLog('系统', `正在强制同步账户数据以确认状态...`, 'info');
      await this.fetchAccountData();
      
    } catch (error: any) {
      this.addLog('下单', `强制平仓流程失败 (${symbol}): ${error.message}`, 'error');
    } finally {
      // 延迟一小段时间再移除锁定，确保数据推送已处理
      setTimeout(() => {
        this.lockingSymbols.delete(symbol);
      }, 3000);
    }
  }

  private async updateFundingFees(specificId?: string) {
    // 查找状态为已平仓且查询次数少于 2 次的订单
    // 只有当资金费为 0 时才继续查询（如果已经有资金费了，说明已经匹配到了）
    const closedStatusList = ['CLOSED', 'TP', 'SL', 'TIMEOUT', 'TRAILING'];
    const pendingLogs = this.tradeLogs.filter(log => {
      // 如果已经有资金费了（非0），说明已经匹配成功，不需要再查
      if (log.fundingFee !== 0) return false;
      
      if (specificId) return log.id === specificId && closedStatusList.includes(log.status) && (log.fundingFeeCheckedCount || 0) < 2;
      return closedStatusList.includes(log.status) && (log.fundingFeeCheckedCount || 0) < 2;
    });

    if (pendingLogs.length === 0) return;

    if (!specificId) {
      this.addLog('系统', `正在检查 ${pendingLogs.length} 个订单的资金费...`, 'info');
    }

    for (const log of pendingLogs) {
      try {
        const currentCount = (log.fundingFeeCheckedCount || 0) + 1;
        
        // 查询资金费流水
        const income = await this.binance.getIncomeHistory({
          symbol: log.symbol,
          incomeType: 'FUNDING_FEE',
          startTime: log.openTime - 1000,
          endTime: log.closeTime + 1000
        });

        let totalFundingFee = 0;
        if (Array.isArray(income) && income.length > 0) {
          totalFundingFee = income.reduce((sum, item) => sum + parseFloat(item.income), 0);
          this.addLog('系统', `订单 ${log.id} (${log.symbol}) 匹配到资金费: ${totalFundingFee.toFixed(4)} USDT`, 'success');
        }

        // 更新日志
        const contractValue = log.amount * log.entryPrice;
        const newProfitRate = contractValue > 0 ? ((log.pnl + totalFundingFee) / contractValue) * 100 : log.profitRate;

        this.updateTradeLog(log.id, {
          fundingFee: totalFundingFee,
          fundingFeeCheckedCount: currentCount,
          profitRate: newProfitRate
        });

        // 稍微停顿，避免触发频率限制
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error: any) {
        console.error(`Failed to update funding fee for ${log.id}:`, error.message);
      }
    }
  }

  /**
   * 自动补全交易详情 (用于处理同步延迟或 API 临时失败)
   */
  private async fetchAndFillTradeDetails(logId: string, symbol: string, openTime: number, retryCount: number = 0) {
    try {
      // 如果重试次数过多，停止
      if (retryCount > 3) {
        this.addLog('系统', `补全交易详情失败次数过多，停止重试: ${symbol}`, 'warning');
        return;
      }

      const log = this.tradeLogs.find(l => l.id === logId);
      if (!log) return;

      // 优化：从开仓时间开始获取该币种的最大 1000 条成交记录，确保能同时涵盖开仓手续费和平仓明细
      const startTime = openTime > 2000 ? openTime - 2000 : undefined;
      const trades = await this.binance.getUserTrades(symbol, 1000, startTime);
      const relevantTrades = trades.filter((t: any) => t.time >= (openTime - 2000));
      
      if (relevantTrades.length === 0) {
        // 如果没查到，可能是币安还没同步，10秒后重试
        this.addLog('系统', `未发现成交详情: ${symbol}, 将在10秒后进行第 ${retryCount + 1} 次重试...`, 'info');
        setTimeout(() => this.fetchAndFillTradeDetails(logId, symbol, openTime, retryCount + 1), 10000);
        return;
      }

      let totalPnl = 0;
      let totalFee = 0;
      let exitTime = 0;
      
      let totalExitQty = 0;
      let totalExitValue = 0;
      
      // 确定平仓方向，做多开仓 BUY 对应 SELL 平仓，做空开仓 SELL 对应 BUY 平仓
      const closeSide = log.side === 'BUY' ? 'SELL' : 'BUY';

      // 确保按照时间升序排列
      relevantTrades.sort((a: any, b: any) => a.time - b.time);

      let currentPositionSize = 0;
      let hasOpened = false;

      for (const t of relevantTrades) {
        const qty = parseFloat(t.qty || '0');
        
        if (t.side === log.side) {
          currentPositionSize += qty;
          hasOpened = true;
        } else if (t.side === closeSide) {
          currentPositionSize -= qty;
        }

        totalPnl += parseFloat(t.realizedPnl || '0');
        totalFee += parseFloat(t.commission || '0');
        
        // 寻找反向单作为平仓单
        if (t.side === closeSide) {
          const price = parseFloat(t.price || '0');
          totalExitQty += qty;
          totalExitValue += qty * price;
          exitTime = Math.max(exitTime, t.time);
        }

        // 以非常微小的阈值判定是否完全平仓，避免浮点数精度问题
        if (hasOpened && currentPositionSize <= 0.0000001) {
          break; // 当前周期计算完毕，退出循环（防止混合到下一次的交易记录中）
        }
      }
      
      // 优化：计算多笔分散平仓成交的加权平均平仓价
      let exitPrice = 0;
      if (totalExitQty > 0) {
        exitPrice = totalExitValue / totalExitQty;
      }

      const contractValue = log.amount * log.entryPrice;
      const profitRate = contractValue > 0 ? (totalPnl / contractValue) * 100 : 0;

      let finalStatus = log.status;
      if (finalStatus === 'OPEN' || finalStatus === 'CLOSED') {
        if (totalPnl > 0) {
          finalStatus = 'TP';
        } else if (totalPnl < 0) {
          finalStatus = 'SL';
        } else {
          finalStatus = 'CLOSED';
        }
      }

      this.updateTradeLog(logId, {
        exitPrice: exitPrice || log.exitPrice,
        pnl: totalPnl,
        fee: totalFee,
        profitRate,
        closeTime: exitTime || Date.now(),
        status: finalStatus
      });
      
      this.addLog('系统', `自动补全交易详情成功: ${symbol} (ID: ${logId})`, 'success');
      
      // 补全详情后，触发一次划转检测
      this.shouldCheckTransfer = true;
      
      // 补全详情后，顺便查一下资金费
      setTimeout(() => this.updateFundingFees(logId), 5000);
    } catch (error: any) {
      this.addLog('系统', `自动补全交易详情异常: ${error.message}, 10秒后重试...`, 'error');
      setTimeout(() => this.fetchAndFillTradeDetails(logId, symbol, openTime, retryCount + 1), 10000);
    }
  }

  private async checkAndScan() {
    if (this.checkBannedStatus()) return;

    // 定期进行 REST 时间校准 (每 10 分钟一次，作为 WebSocket 校准的兜底)
    if (Date.now() - (this.lastTimeSyncTime || 0) > 600000) {
      this.syncTime();
    }

    // 如果未设置主账户，且当前没有任何引擎获得驱动权，则本账号自动晋升为临时主账号 (回归旧逻辑：最快账户为主账户)
    if (!StrategyEngine.primaryWsEngineId && this.isRunning) {
      StrategyEngine.primaryWsEngineId = this.accountId;
      this.addLog('系统', '检测到全局主账号未明确设置，本账号已自动获得扫描驱动权限', 'info');
    }

    // 动态管理 WebSocket 订阅窗口
    await this.manageMarketDataStreams();

    // 性能优化：默认不在这里进行全量快照，改为在各 Stage 内部按需局部采样
    this.currentScanKlineSnapshot = null;

    const now = new Date(Date.now() + this.timeOffset);
    // Align with UTC+8 for scheduling (startTime "00:00:00" will mean 8 AM UTC / 0 AM CST)
    const totalMs = now.getTime() + 8 * 3600 * 1000;
    
    // Helper to parse "HH:mm:ss.SSS" into ms offset
    const parseTimeToMs = (timeStr: string) => {
      const [hms, msPart] = timeStr.split('.');
      const [h, m, s] = hms.split(':').map(Number);
      return ((h * 3600 + m * 60 + s) * 1000) + Number(msPart || 0);
    };

    // Helper to parse "15m", "1h", "1d" into ms
    const parseIntervalToMs = (intervalStr: string) => {
      const value = parseInt(intervalStr);
      const unit = intervalStr.slice(-1);
      if (unit === 'm') return value * 60 * 1000;
      if (unit === 'h') return value * 60 * 60 * 1000;
      if (unit === 'd') return value * 24 * 60 * 60 * 1000;
      return 15 * 60 * 1000;
    };

    const shouldRun = (settings: any, lastRunKey: string) => {
      const intervalMs = parseIntervalToMs(settings.interval);
      const targetOffsetMs = parseTimeToMs(settings.startTime) % intervalMs;
      
      // Current offset in the current interval (aligned with UTC/Epoch)
      const currentOffsetMs = totalMs % intervalMs;
      
      // 严格判定：只有在当前时间确实抵达或进入预定窗口（15s）时才触发
      // 同时增加一个小宽限（-50ms），允许由于 JavaScript 宏任务调度导致的极微小延迟触发，但绝不允许“提前启动”
      const diff = currentOffsetMs - targetOffsetMs;
      
      // 修正“早跳”：如果 diff 为负数（例如 -1ms），说明还在上一个周期的尾部，不应触发。
      // 现在的逻辑要求 diff >= 0，配合精准的 timeOffset，可以确保不会提前启动。
      if (diff >= 0 && diff < 15000) {
        const lastRun = (this as any)[lastRunKey] || 0;
        // 确保同一个扫描周期内不会重复执行
        if (totalMs - lastRun > intervalMs / 2) {
          // 这里暂时只是检测，真正的 Run 放在下面，如果没跑成功不更新 lastRun (后面会优化)
          return true;
        }
      }
      return false;
    };

    // Stage 0: 初筛 
    if (this.externalMarketSource) {
      const extS0 = this.externalMarketSource.getStage0Results();
      if (extS0 && extS0.startTime > this.stage0Results.startTime) {
        this.stage0Results = extS0;
      }
    } else {
      if (shouldRun(this.settings.scanner.stage0, 'lastS0Run')) {
        const success = await this.runStage0();
        if (success) this.lastS0Run = totalMs;
      }
    }

    // 所有账户都会运行自己的 Stage 0P 过滤，只要 Stage 0 结果已准备好
    // 逻辑：基于 stage0Results.data 进行针对性过滤（该数据可能来自本地扫描或主账户同步）
    if (shouldRun(this.settings.scanner.stage0P, 'lastS0PRun')) {
      const success = await this.runStage0P();
      if (success) this.lastS0PRun = totalMs;
    }

    // Stage 1: 基础过滤
    if (shouldRun(this.settings.scanner.stage1, 'lastS1Run')) {
      const success = await this.runStage1();
      if (success) {
        this.lastS1Run = totalMs;
      }
    }

    // Stage 2: 实时形态锁定与下单执行
    if (this.isPrimary) {
      // 主账号计算目标表
      if (shouldRun(this.settings.scanner.stage2, 'lastS2Run')) {
        const success = await this.runStage2();
        if (success) {
          this.lastS2Run = totalMs;
        }
      }
    } else {
      // 子账号定时消费目标表进行“二次拦截”下单
      // 核心修正：使用系统时间 Date.now() 进行共享状态有效期对比，不受 timeOffset 干扰
      const sysNow = Date.now();
      const tableAge = sysNow - StrategyEngine.lastOrderTableUpdateTime;
      
      // 检查目标表是否已经准备好且属于当前周期 (15秒内有效)
      if (StrategyEngine.sharedOrderTargetTable.length > 0 && 
          tableAge < 15000 &&
          totalMs - this.lastS2Run > 30000) { // 至少间隔 30 秒才处理新一轮表单
        
        const success = await this.runStage2(); // 子账号此处执行过滤下单
        if (success) {
          this.lastS2Run = totalMs;
        }
      }
    }
    
    // 清理快照，避免占用内存及影响其他游离逻辑
    this.currentScanKlineSnapshot = null;
  }

  private isCurrentTimeEnabled(): boolean {
    if (!this.settings.scanner.timeControl?.enabled) return true;
    
    // 强制使用北京时间 (UTC+8) 进行时段判断，确保与日志和用户预期一致
    const now = new Date();
    const beijingTimeMs = now.getTime() + 8 * 3600000;
    const mode = this.settings.scanner.timeControl.mode || '+2';
    
    let adjustedTimeMs;
    if (mode === '+2') {
      // +2 模式: 例如 10:02:00 - 10:17:00 属于 10:00 - 10:15 (索引 40) 周期
      adjustedTimeMs = beijingTimeMs - 120000;
    } else {
      // -2 模式: 例如 09:58:00 - 10:13:00 属于 10:00 - 10:15 (索引 40) 周期
      adjustedTimeMs = beijingTimeMs + 120000;
    }
    
    const adjustedDate = new Date(adjustedTimeMs);
    const day = adjustedDate.getUTCDay(); // 0 是周日, 1 是周一 ... 6 是周六
    const hour = adjustedDate.getUTCHours();
    const minute = adjustedDate.getUTCMinutes();
    const slotIndex = hour * 4 + Math.floor(minute / 15);

    const weekSlots = this.settings.scanner.timeControl?.weekSlots;
    if (weekSlots && weekSlots[day] && Array.isArray(weekSlots[day]) && weekSlots[day].length === 96) {
      return weekSlots[day][slotIndex] ?? true;
    }
    
    const slots = this.settings.scanner.timeControl?.slots;
    if (Array.isArray(slots) && slots.length === 96) {
      return slots[slotIndex] ?? true;
    }
    
    const hours = this.settings.scanner.timeControl?.hours;
    if (Array.isArray(hours) && hours.length === 24) {
      return hours[hour] ?? true;
    }
    
    return true;
  }

  private async runStage0(): Promise<boolean> {
    if (!this.isPrimary) return false; // 只有主账户执行扫描
    const startTime = Date.now();
    const startTimeStr = new Date(startTime + 8 * 3600 * 1000).toISOString().split('T')[1].replace('Z', '');
    this.addLog('扫描', `开始 Stage 0 全市场初筛... [启动时间: ${startTimeStr}]`);
    try {
      const exchangeInfo = await this.binance.getExchangeInfo();
      const { minKlines, maxKlines, includeTradFi } = this.settings.scanner.stage0;
      const now = Date.now();
      
      // 15分钟K线毫秒数
      const klineMs = 15 * 60 * 1000;

      const filteredSymbols = exchangeInfo.symbols.filter((s: any) => {
        // 基础过滤
        if (s.quoteAsset !== 'USDT' || s.contractType !== 'PERPETUAL' || s.status !== 'TRADING') {
          return false;
        }

        // TradFi 过滤
        if (!includeTradFi && s.underlyingSubType && s.underlyingSubType.includes('TRADFI')) {
          return false;
        }

        // 上线时长过滤 (K线数量)
        // onboardDate 是上线时间戳（毫秒）
        const ageInMs = now - s.onboardDate;
        const ageInKlines = Math.floor(ageInMs / klineMs);

        return ageInKlines >= minKlines && ageInKlines <= maxKlines;
      });

      const duration = Date.now() - startTime;
      this.stage0Results = {
        data: filteredSymbols.map((s: any) => {
          const ageInKlines = Math.floor((now - s.onboardDate) / klineMs);
          return {
            symbol: s.symbol,
            age: ageInKlines,
            volume: '--',
            change: '--',
            status: 'Stage 0 Pass',
            reason: '符合初筛'
          };
        }),
        scannedCount: exchangeInfo.symbols.length,
        startTime,
        duration
      };

      this.addLog('扫描', `Stage 0 完成，扫描 ${exchangeInfo.symbols.length} 个币种，筛选出 ${filteredSymbols.length} 个币种，耗时 ${duration}ms`);
      
      // [优化] 将 Stage 0 结果同步到全局静态变量，供所有账户进行本地区的 Stage 0P 过滤
      StrategyEngine.sharedStage0Symbols = filteredSymbols.map((s: any) => s.symbol);
      
      return true;
    } catch (error: any) {
      this.addLog('扫描', `Stage 0 失败: ${error.message}`, 'error');
      if (error.status === 429 || error.status === 418 || error.message?.includes('-1003')) {
        this.handleBan(error);
      }
      return false;
    }
  }

  private async runStage0P(): Promise<boolean> {
    if (!this.isRunning) return false;
    if (!this.isCurrentTimeEnabled()) {
      this.addLog('扫描', '当前处于非工作时段，跳过 Stage 0P 扫描', 'info');
      return false;
    }

    // 关键优化 2：主账户在 Stage 0P 启动时刻，确保补齐 15m K线数据到本地数据库
    if (this.isPrimary) {
      // 传入 true 表示强制补齐，不考虑冷却期，确保筛选前数据是最新的
      this.addLog('系统', 'Stage 0P 启动，主账户正在补齐 15m K线数据...', 'info');
      await this.syncKlines(true);
    } else {
      // 子账户如果检测到主账户正在同步，可以稍微等待，确保读取到最新的本地数据库数据
      let waitCount = 0;
      while (StrategyEngine.isGlobalSyncingKlines && waitCount < 30) { // 最多等待 30 秒
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitCount++;
      }
    }

    const startTime = Date.now();
    const startTimeStr = new Date(startTime + 8 * 3600 * 1000).toISOString().split('T')[1].replace('Z', '');
    
    // 获取待过滤名单：无论是主账户还是子账户，都统一使用本实例的 stage0Results.data
    // 如果是子账户，该数据由 checkAndScan 中的 externalMarketSource 逻辑从主账户同步而来
    const symbols = this.stage0Results.data || [];

    if (symbols.length === 0) {
      // 如果名单为空，可能同步还没到位，或者 Stage 0 确实没币，返回 false 触发重试
      return false;
    }

    this.addLog('扫描', `开始 Stage 0P 独立波动率过滤... [启动时间: ${startTimeStr}] (币种数: ${symbols.length})`);
    const scannedCount = symbols.length;

    if (!this.settings.scanner.stage0P.enabled) {
      this.addLog('扫描', '波动率过滤总开关已关闭，本账户自动放行所有币种');
      this.stage0PResults = {
        data: [...symbols].map(r => ({ ...r, status: 'Stage 0P Skip' })),
        scannedCount,
        startTime,
        duration: Date.now() - startTime
      };
      this.myStage0PQualifiedSymbols = new Set(symbols.map(s => s.symbol));
      return true;
    }

    const periods = this.settings.scanner.stage0P.periods;
    const activePeriods = Object.entries(periods).filter(([_, p]: [string, any]) => p.enabled);
    const abMoveCfg = this.settings.scanner.stage0P.abnormalMove;

    if (activePeriods.length === 0 && (!abMoveCfg || !abMoveCfg.enabled)) {
      this.addLog('扫描', '未开启任何具体过滤参数，本账户自动放行所有币种');
      this.stage0PResults = {
        data: [...symbols].map(r => ({ ...r, status: 'Stage 0P Skip' })),
        scannedCount,
        startTime,
        duration: Date.now() - startTime
      };
      this.myStage0PQualifiedSymbols = new Set(symbols.map(s => s.symbol));
      return true;
    }

    const filteredData: any[] = [];
    const batchSize = 10; // 每批处理10个币种，避免触发频率限制
    
    const checkDesc = [
      activePeriods.length > 0 ? `周期过滤: ${activePeriods.map(([k]) => k).join(', ')}` : '',
      (abMoveCfg && abMoveCfg.enabled) ? '异动监控: 开启' : ''
    ].filter(Boolean).join(' | ');

    this.addLog('扫描', `正在进行 Stage 0P 检查 (${checkDesc})，共 ${symbols.length} 个币种`);

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (item) => {
        try {
          let allPassed = true;
          const volatilityInfo: any = {};
          const abMoveCfg = this.settings.scanner.stage0P.abnormalMove;

          // 1. 连续红动能过滤 (原有逻辑)
          for (const [period, config] of activePeriods as [string, any][]) {
            // 从本地数据库获取K线数据
            const closedKlines = await dbService.getKlines(item.symbol, period, config.count);
            
            if (closedKlines.length < config.count) {
              allPassed = false;
              break;
            }

            // 计算每一根 K 线的涨跌幅 (使用数据库中预计算好的字段)
            const candleVolatilities = closedKlines.map((k: any) => k.change);

            // 过滤标准：每一组计算出来的所有数据都不低于参考值才通过
            const periodPassed = candleVolatilities.every(v => v >= config.threshold);
            
            volatilityInfo[period] = candleVolatilities.map(v => v.toFixed(2) + '%').join(' | ');

            if (!periodPassed) {
              allPassed = false;
              break;
            }
          }

          if (!allPassed) return null;

          // 2. 异动监控 (新增滑动窗口逻辑)
          if (abMoveCfg && abMoveCfg.enabled) {
            // 考察 10 小时的数据 (15m K线需要 40 根)
            // 1 小时窗口大约需要 4 根 15m K线
            const lookbackCount = Math.ceil(abMoveCfg.lookbackHours * 60 / 15);
            const windowCount = Math.ceil(abMoveCfg.windowMinutes / 15);
            
            // 获取足够的K线以支撑滑动窗口
            const historyKlines = await dbService.getKlines(item.symbol, '15m', lookbackCount + windowCount);
            // 注意：dbService.getKlines 返回的是 DESC 排序 (最新在前)，计算时建议翻转为时间正序
            const klinesAsc = [...historyKlines].reverse();

            if (klinesAsc.length < lookbackCount) {
               // 数据不足时不予通过，或者你可以选择跳过检查
               return null;
            }

            for (let j = 0; j <= klinesAsc.length - windowCount; j++) {
              const windowOpen = klinesAsc[j].open;
              const windowClose = klinesAsc[j + windowCount - 1].close;
              const windowChange = ((windowClose - windowOpen) / windowOpen) * 100;

              if (windowChange > abMoveCfg.maxPump) {
                this.addLog('扫描', `${item.symbol} 异动拦截: 滑动窗口(约${abMoveCfg.windowMinutes}min)涨幅 ${windowChange.toFixed(2)}% > ${abMoveCfg.maxPump}%`, 'warning');
                allPassed = false;
                break;
              }
              if (windowChange < -abMoveCfg.maxDrop) {
                this.addLog('扫描', `${item.symbol} 异动拦截: 滑动窗口(约${abMoveCfg.windowMinutes}min)跌幅 ${windowChange.toFixed(2)}% < -${abMoveCfg.maxDrop}%`, 'warning');
                allPassed = false;
                break;
              }
            }
          }

          if (allPassed) {
            return {
              ...item,
              status: 'Stage 0P Pass',
              reason: '波动率达标',
              details: volatilityInfo
            };
          }
          return null;
        } catch (error) {
          return null;
        }
      }));

      filteredData.push(...results.filter(r => r !== null));
      
      // 进度更新
      if (i % 50 === 0 && i > 0) {
        this.addLog('扫描', `已检查 ${i}/${symbols.length} 个币种...`);
      }
      
      // 每批之间微小延迟
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const duration = Date.now() - startTime;
    this.stage0PResults = {
      data: filteredData,
      scannedCount,
      startTime,
      duration
    };

    // [核心优化] 维护本实例的 Stage 0P 合格名单，用于后续下单前的“二次拦截”
    this.myStage0PQualifiedSymbols = new Set(filteredData.map(d => d.symbol));

    this.addLog('扫描', `Stage 0P 完成，筛选出 ${filteredData.length} 个币进入本地白名单，耗时 ${duration}ms`);
    return true;
  }

  private async runStage1(retryCount: number = 0): Promise<boolean> {
    if (!this.isPrimary) return false; 

    if (!this.isCurrentTimeEnabled()) {
      this.addLog('扫描', '当前处于非工作时段，跳过 Stage 1 扫描', 'info');
      return false;
    }

    if (retryCount === 0) {
      StrategyEngine.stage1DataMissing = false;
    }

    const startTime = Date.now();
    const startTimeStr = new Date(startTime + 8 * 3600 * 1000).toISOString().split('T')[1].replace('Z', '');
    this.addLog('扫描', `[主账户] 开始 Stage 1 基础过滤 (REST 模式)... [启动时间: ${startTimeStr}]`);
    
    // 获取 Stage 0P 传递下来的目标币种集合
    const targetSymbolsArr = (this.stage0PResults.data || []).map(i => i.symbol);
    const { minVolumeM1, priceChangeK1, whitelist, blacklist } = this.settings.scanner.stage1;
    const [k1Min, k1Max] = priceChangeK1;

    // 计算 15m 的目标起始时间戳
    const intervalMs15 = 15 * 60 * 1000;
    const targetTimeAdjusted = startTime - 1000 + this.timeOffset;
    const expected15mTimestamp = Math.floor(targetTimeAdjusted / intervalMs15) * intervalMs15;
    StrategyEngine.sharedStage1Timestamp = expected15mTimestamp;

    const filteredData: any[] = [];
    let wrongTimestampCount = 0;
    const batchSize = 30; // 适当控制并发

    this.addLog('扫描', `[主账户] 正在通过 REST 同步 ${targetSymbolsArr.length} 个币种的 K线数据...`);

    try {
      for (let i = 0; i < targetSymbolsArr.length; i += batchSize) {
      const batch = targetSymbolsArr.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (symbol) => {
        try {
          if (blacklist.includes(symbol)) return null;
          const item = (this.stage0PResults.data || []).find(d => d.symbol === symbol);
          
          // 通过 REST 获取最新的 15m K线
          const klines = await this.binance.getKlines(symbol, '15m', 1);
          if (!Array.isArray(klines) || klines.length === 0) return whitelist.includes(symbol) ? { ...item, symbol, status: 'Stage 1 Pass', reason: '白名单通过(无数据)' } : null;
          
          const k = klines[0];
          const kTimestamp = parseInt(k[0]);
          
          // 容错：如果 REST 返回的 K线时间戳不对，说明数据还没准备好
          if (!whitelist.includes(symbol) && kTimestamp !== expected15mTimestamp) {
            return { _error: 'wrong_timestamp' };
          }

          const openPrice = parseFloat(k[1]);
          const currentPrice = parseFloat(k[4]);
          const quoteVolume = parseFloat(k[7]);

          if (!whitelist.includes(symbol)) {
            if (quoteVolume < minVolumeM1) return null;

            const k1 = ((currentPrice - openPrice) / openPrice) * 100;
            if (k1 < k1Min || k1 > k1Max) return null;
          }

          const k1 = ((currentPrice - openPrice) / openPrice) * 100;

          // 同步到内存
          StrategyEngine.globalKlineCache.set(symbol.toUpperCase(), {
            open: openPrice,
            close: currentPrice,
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            quoteVolume,
            timestamp: kTimestamp,
            isFinal: false
          });

          return {
            ...item,
            symbol,
            status: 'Stage 1 Pass',
            reason: whitelist.includes(symbol) ? '白名单通过' : `M1:${(quoteVolume/10000).toFixed(1)}w | K1:${k1.toFixed(2)}%`,
            m1: quoteVolume.toFixed(2),
            k1: k1.toFixed(2)
          };
        } catch (e: any) {
          if (e.status === 429 || e.status === 418 || e.message?.includes('-1003')) throw e;
          return null;
        }
      }));

      for (const res of results) {
        if (!res) continue;
        if (res._error === 'wrong_timestamp') {
          wrongTimestampCount++;
        } else {
          filteredData.push(res);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50)); 
    }

    const duration = Date.now() - startTime;
    
    const missingData = targetSymbolsArr.length > 0 && wrongTimestampCount > 0 && filteredData.length === targetSymbolsArr.filter(sym => whitelist.includes(sym)).length;
    
    if (missingData) {
      if (retryCount === 0) {
        this.addLog('扫描', `stage1筛选，未获取到15分钟k线数据。正准备重试一次...`, 'warning');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await this.runStage1(1);
      } else {
        this.addLog('扫描', `stage1未获取15分钟k线数据，跳过stage2筛选。`, 'warning');
        StrategyEngine.stage1DataMissing = true;
        StrategyEngine.sharedStage1Symbols = [];
        return true; 
      }
    }

    this.stage1Results = {
      data: filteredData,
      scannedCount: targetSymbolsArr.length,
      startTime,
      duration
    };

    // 更新全局共享筛选列表
    StrategyEngine.sharedStage1Symbols = filteredData.map(d => d.symbol);

    if (filteredData.length === 0) {
      this.addLog('扫描', `Stage 1 完成，主账户筛选出 0个币作为第二阶段候选，耗时${duration}ms`, 'info');
    } else {
      this.addLog('扫描', `Stage 1 完成，主账户筛选出 ${filteredData.length} 个币作为第二阶段候选，耗时 ${duration}ms`, 'success');
    }
    return true;
    } catch (error: any) {
      this.addLog('扫描', `Stage 1 异常: ${error.message}`, 'error');
      if (error.status === 429 || error.status === 418 || error.message?.includes('-1003')) {
        this.handleBan(error);
      }
      return false;
    }
  }

  private async runStage2(isManual: boolean = false): Promise<boolean> {
    const startTime = Date.now();
    const startTimeStr = new Date(startTime + 8 * 3600 * 1000).toISOString().split('T')[1].replace('Z', '');
    
    if (this.isPrimary) {
      this.addLog('扫描', `[主账户] 正在生成共享目标表...`);
    } else {
      this.addLog('扫描', `[子账户] 正在拉取主账户共享目标表...`);
    }

    this.addLog('扫描', `[主账号/子账号] 正在处理 Stage 2...`);

    try {
      // 共享目标表逻辑开始
      if (this.isPrimary) {
        if (StrategyEngine.stage1DataMissing) {
          this.addLog('扫描', 'stage1未获取15分钟k线数据，跳过stage2筛选。', 'warning');
          return true;
        }
        if (StrategyEngine.sharedStage1Symbols.length === 0) {
          this.addLog('扫描', 'stage1候选币对为0，跳过stage2筛选。', 'info');
          return true;
        }

      let symbolsToFetch = StrategyEngine.sharedStage1Symbols;
      
      if (symbolsToFetch.length > 36) {
        const symbolsWithVolume = symbolsToFetch.map(symbol => {
          const item = (this.stage1Results.data || []).find((d: any) => d.symbol === symbol);
          const volume = item && item.m1 ? parseFloat(item.m1) : 0;
          return { symbol, volume };
        });
        symbolsWithVolume.sort((a, b) => b.volume - a.volume);
        symbolsToFetch = symbolsWithVolume.slice(0, 36).map(x => x.symbol);
        this.addLog('扫描', `[主账户] Stage 1目标币对数(${StrategyEngine.sharedStage1Symbols.length})超过36个，按交易额截取前36个`);
      }

      const expected15mTimestamp = StrategyEngine.sharedStage1Timestamp > 0 ? StrategyEngine.sharedStage1Timestamp : (() => {
        const intervalMs15 = 15 * 60 * 1000;
        return Math.floor((startTime - 500 + this.timeOffset) / intervalMs15) * intervalMs15;
      })();
      
      this.addLog('扫描', `[主账户] 正在高并发生成形态目标表 (${symbolsToFetch.length} 币对)...`);
      
      // 批量获取资金费率 (Option B)
      let fundingRateMap = new Map<string, number>();
      let nextFundingTimeMap = new Map<string, number>();
      try {
        const premiumIndices = await this.binance.getPremiumIndex();
        if (Array.isArray(premiumIndices)) {
          premiumIndices.forEach((item: any) => {
            fundingRateMap.set(item.symbol, parseFloat(item.lastFundingRate));
            nextFundingTimeMap.set(item.symbol, parseInt(item.nextFundingTime));
          });
        }
      } catch (err: any) {
        this.addLog('扫描', `获取资金费率失败: ${err.message}`, 'warning');
      }

      const orderTable: any[] = [];
      const batchSize = 80;
      
      for (let i = 0; i < symbolsToFetch.length; i += batchSize) {
        const batch = symbolsToFetch.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (symbol) => {
          try {
            const k15s = await this.binance.getKlines(symbol, '15m', 1);
            if (!k15s || k15s.length === 0) return null;
            const k = k15s[0];
            if (parseInt(k[0]) !== expected15mTimestamp) return null;

            const open15 = parseFloat(k[1]), high15 = parseFloat(k[2]), low15 = parseFloat(k[3]), current15 = parseFloat(k[4]), volume15 = parseFloat(k[7]);
            const buyRatio = high15 > low15 ? ((current15 - low15) / (high15 - low15)) * 100 : 0;

            const ampBottomHigh = high15 > 0 ? (1 - low15 / high15) * 100 : 0;
            const ampHighLow = low15 > 0 ? (high15 / low15 - 1) * 100 : 0;

            return {
              symbol,
              open15, high15, low15, current15, volume15,
              buyRatio: buyRatio,
              ampBottomHigh,
              ampHighLow,
              amp: ampBottomHigh,
              fundingRate: fundingRateMap.get(symbol) || 0,
              nextFundingTime: nextFundingTimeMap.get(symbol) || 0,
              status: 'Stage 1 Pass',
              timestamp: parseInt(k[0])
            };
          } catch (e: any) {
            if (e.status === 429 || e.status === 418 || e.message?.includes('-1003')) throw e;
            return null;
          }
        }));
        orderTable.push(...results.filter(r => r !== null));
        if (i + batchSize < symbolsToFetch.length) {
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      }

      StrategyEngine.sharedOrderTargetTable = orderTable;
      StrategyEngine.lastOrderTableUpdateTime = Date.now();
      
      if (orderTable.length === 0) {
        this.addLog('扫描', '[主账户] 目标表生成为空，可能是数据同步未完成', 'info');
        return false;
      }

      const tableDuration = Date.now() - startTime;
      this.addLog('扫描', `[主账户] 目标表生成完毕，耗时 ${tableDuration}ms，共享币种 ${orderTable.length} 个`);
    } else {
      let waitStart = Date.now();
      // 等待主账户更新 (最多等 3 秒)
      while ((Date.now() - StrategyEngine.lastOrderTableUpdateTime > 15000) && (Date.now() - waitStart < 3000)) {
        await new Promise(r => setTimeout(r, 100));
      }
      
      const age = Date.now() - StrategyEngine.lastOrderTableUpdateTime;
      if (age > 15000) {
        this.addLog('扫描', `[子账户] 未检测到有效的共享目标表 (有效期超过 15s)，放弃本轮处理`, 'warning');
        return false;
      }
      
      const modeDesc = (this.settings.scanner?.stage2?.sharedTableMode === 'independent') ? '独立实时模式' : '完全一致模式';
      this.addLog('扫描', `[子账户] 已获取主账户共享目标表 (数据新鲜度: ${(age/1000).toFixed(1)}s, 模式: ${modeDesc})，开始本地筛选...`);
    }

    const sharedTable = StrategyEngine.sharedOrderTargetTable;
    const allRequests: { engine: StrategyEngine; coin: any; scanStartTime: number }[] = [];

    if (this.isPrimary) {
      const masterSelected = await this.evaluateSelectedCoinsAsync(sharedTable, isManual, startTime);
      for (const coin of masterSelected) {
        allRequests.push({ engine: this, coin, scanStartTime: startTime });
      }

      const runningSubEngines = StrategyEngine.instances.filter(i => i.isRunning && !i.isPrimary);
      for (const subEngine of runningSubEngines) {
        const subSelected = await subEngine.evaluateSelectedCoinsAsync(sharedTable, isManual, startTime);
        for (const coin of subSelected) {
          allRequests.push({ engine: subEngine, coin, scanStartTime: startTime });
        }
        subEngine.lastS2Run = Date.now();
      }
    } else {
      const mySelected = await this.evaluateSelectedCoinsAsync(sharedTable, isManual, startTime);
      for (const coin of mySelected) {
        allRequests.push({ engine: this, coin, scanStartTime: startTime });
      }
    }

    if (allRequests.length > 0) {
      await StrategyEngine.processGlobalBatchTrades(allRequests);
    }

    return true;
    } catch (error: any) {
      this.addLog('扫描', `Stage 2 异常: ${error.message}`, 'error');
      if (error.status === 429 || error.status === 418 || error.message?.includes('-1003')) {
        this.handleBan(error);
      }
      return false;
    }
  }

  async evaluateSelectedCoinsAsync(sharedTable: any[], isManual: boolean = false, startTime: number = Date.now()): Promise<any[]> {
    const isIndependent = this.settings.scanner?.stage2?.sharedTableMode === 'independent';
    let targetTable = sharedTable;

    if (isIndependent && !this.isPrimary && sharedTable.length > 0) {
      this.addLog('扫描', `[子账户] 当前处于【独立实时模式】，正在抓取最新行情重新计算...`, 'info');
      try {
        let fundingRateMap = new Map<string, number>();
        let nextFundingTimeMap = new Map<string, number>();
        try {
          const premiumIndices = await this.binance.getPremiumIndex();
          if (Array.isArray(premiumIndices)) {
            premiumIndices.forEach((item: any) => {
              fundingRateMap.set(item.symbol, parseFloat(item.lastFundingRate));
              nextFundingTimeMap.set(item.symbol, parseInt(item.nextFundingTime));
            });
          }
        } catch (err: any) {}

        const freshTable: any[] = [];
        for (const item of sharedTable) {
          try {
            const k15s = await this.binance.getKlines(item.symbol, '15m', 1);
            if (k15s && k15s.length > 0) {
              const k = k15s[0];
              const open15 = parseFloat(k[1]), high15 = parseFloat(k[2]), low15 = parseFloat(k[3]), current15 = parseFloat(k[4]), volume15 = parseFloat(k[7]);
              const buyRatio = high15 > low15 ? ((current15 - low15) / (high15 - low15)) * 100 : 0;
              const ampBottomHigh = high15 > 0 ? (1 - low15 / high15) * 100 : 0;
              const ampHighLow = low15 > 0 ? (high15 / low15 - 1) * 100 : 0;

              freshTable.push({
                ...item,
                open15, high15, low15, current15, volume15,
                buyRatio,
                ampBottomHigh,
                ampHighLow,
                amp: ampBottomHigh,
                fundingRate: fundingRateMap.get(item.symbol) ?? item.fundingRate ?? 0,
                nextFundingTime: nextFundingTimeMap.get(item.symbol) ?? item.nextFundingTime ?? 0
              });
            } else {
              freshTable.push(item);
            }
          } catch (e: any) {
            freshTable.push(item);
          }
        }
        targetTable = freshTable;
      } catch (err: any) {
        this.addLog('扫描', `[子账户] 重新抓取行情失败，将使用主账户快照: ${err.message}`, 'warning');
      }
    }

    return this.evaluateSelectedCoins(targetTable, isManual, startTime);
  }

  evaluateSelectedCoins(sharedTable: any[], isManual: boolean = false, startTime: number = Date.now()): any[] {
    const stage2Config = this.settings.scanner.stage2;
    const isAmpEnabled = stage2Config.enabled !== false;
    const isSingleKEnabled = !!stage2Config.singleK?.enabled;
    const { conditions, cooldown, preferredMode = 'volume' } = stage2Config;
    const singleKConfig = stage2Config.singleK;

    const accountResults: any[] = [];

    for (const item of sharedTable) {
      const lastClosed = this.closedPositionsHistory.get(item.symbol);
      if (lastClosed && cooldown > 0 && (Date.now() - lastClosed < cooldown * 60000)) continue;

      let passedAmp = false;
      let failReasonAmp = '';
      let ampSide: 'BUY' | 'SELL' = 'BUY';

      if (isAmpEnabled) {
        let passed = true;
        const lsConfig = conditions.longShort;
        
        // 1. 多空方向及占比判断
        if (lsConfig && lsConfig.enabled) {
          const buyRatio = item.buyRatio;
          const buyEnabled = lsConfig.buyEnabled !== false;
          const sellEnabled = lsConfig.sellEnabled ?? false;
          
          if (buyEnabled || sellEnabled) {
             let isPassLocal = false;
             let localSide: 'BUY' | 'SELL' = 'BUY';

             if (buyEnabled && buyRatio >= lsConfig.buy) {
                isPassLocal = true;
                localSide = 'BUY';
             } else if (sellEnabled && buyRatio <= lsConfig.sell) {
                isPassLocal = true;
                localSide = 'SELL';
             }
             
             if (!isPassLocal) {
                passed = false; 
                failReasonAmp = `多空:${buyRatio.toFixed(2)}`;
             } else {
                ampSide = localSide;
             }
          }
        }

        // 2. 根据确定方向选择多单/空单独立配置进行 AMP、M、资金费率校验
        if (passed) {
          const isBuy = ampSide === 'BUY';
          const ampConfig = isBuy ? conditions.amp : (conditions.ampSell || conditions.amp);
          const mConfig = isBuy ? conditions.m : (conditions.mSell || conditions.m);
          const fundingConfig = isBuy ? conditions.fundingRateOptimization : (conditions.fundingRateOptimizationSell || conditions.fundingRateOptimization);

          if (ampConfig && ampConfig.enabled) {
            const amplitudeMode = stage2Config.amplitudeMode || 'bottomHigh';
            const val = amplitudeMode === 'highLow' ? item.ampHighLow : item.ampBottomHigh;
            const [min, max] = ampConfig.range;
            if (val < min || val > max) {
              passed = false;
              failReasonAmp = `AMP(${isBuy ? '多' : '空'}):${val.toFixed(2)}`;
            }
          }

          if (passed && mConfig && mConfig.enabled) {
            const val = item.volume15;
            const [min, max] = mConfig.range;
            if (val < min || val > max) {
              passed = false;
              failReasonAmp = `M(${isBuy ? '多' : '空'}):${(val/1000000).toFixed(2)}M`;
            }
          }

          if (passed && fundingConfig && fundingConfig.enabled && ampSide === 'SELL') {
            const { windowMinutes, shortThreshold } = fundingConfig;
            const nextTime = (item as any).nextFundingTime || 0;
            const rate = item.fundingRate || 0;
            const remainingMs = nextTime - Date.now();
            
            if (remainingMs > 0 && remainingMs <= windowMinutes * 60000) {
              if (rate * 100 <= shortThreshold) {
                passed = false;
                failReasonAmp = `资金费优化:Rate(${(rate*100).toFixed(3)}%)<=门槛(${shortThreshold}%)`;
              }
            }
          }
        }

        passedAmp = passed;
      }

      let passedSingleK = false;
      let failReasonSingleK = '';
      let singleKSide: 'BUY' | 'SELL' = item.current15 >= item.open15 ? 'BUY' : 'SELL';
      const k2_val = ((item.current15 - item.open15) / item.open15) * 100;
      const A_val = singleKSide === 'BUY' ? ((item.high15 - item.current15) / item.current15) * 100 : ((item.current15 - item.low15) / item.current15) * 100;

      if (isSingleKEnabled && singleKConfig) {
        let passed = true;
        const configK2 = singleKSide === 'BUY' ? singleKConfig.k2 : (singleKConfig.k2Sell || singleKConfig.k2);
        const configA = singleKSide === 'BUY' ? singleKConfig.a : (singleKConfig.aSell || singleKConfig.a);
        const configM = singleKSide === 'BUY' ? singleKConfig.m : (singleKConfig.mSell || singleKConfig.m);

        if (configK2?.enabled) {
          const [min, max] = configK2.range;
          const k2_abs = Math.abs(k2_val);
          if (k2_abs < min || k2_abs > max) {
            passed = false;
            failReasonSingleK = `单K:K2(${k2_abs.toFixed(2)}%)`;
          }
        }
        if (passed && configA?.enabled) {
          const [min, max] = configA.range;
          const mode = configA.mode || 'fixed';
          let isPassA = false;
          const k2_abs = Math.abs(k2_val);
          if (mode === 'fixed') {
            isPassA = A_val >= min && A_val <= max;
          } else {
            isPassA = k2_abs > 0 && (A_val / k2_abs) >= min && (A_val / k2_abs) <= max;
          }
          if (!isPassA) {
            passed = false;
            failReasonSingleK = `单K:A(${A_val.toFixed(2)}%,mode:${mode})`;
          }
        }
        if (passed && configM?.enabled) {
          const [min, max] = configM.range;
          const val = item.volume15;
          if (val < min || val > max) {
            passed = false;
            failReasonSingleK = `单K:M(${(val/1000000).toFixed(2)}M)`;
          }
        }
        if (passed && singleKSide === 'SELL' && singleKConfig.fundingRateOptimizationSell?.enabled) {
          const configFunding = singleKConfig.fundingRateOptimizationSell;
          const nextTime = (item as any).nextFundingTime || 0;
          const rate = item.fundingRate || 0;
          const remainingMs = nextTime - Date.now();
          
          if (remainingMs > 0 && remainingMs <= configFunding.windowMinutes * 60000) {
            if (rate * 100 <= configFunding.shortThreshold) {
              passed = false;
              failReasonSingleK = `单K资金费优化:Rate(${(rate * 100).toFixed(3)}%)<=门槛(${configFunding.shortThreshold}%)`;
            }
          }
        }
        passedSingleK = passed;
      }

      let isPass = false;
      let reason = '';
      let chosenSide: 'BUY' | 'SELL' = 'BUY';
      let sourceMode: 'amplitude' | 'singleK' | 'none' = 'none';

      const strategyPriority = stage2Config.strategyPriority || 'amplitude';

      if (isAmpEnabled && isSingleKEnabled) {
        if (passedAmp && passedSingleK) {
          isPass = true;
          if (strategyPriority === 'singleK') {
            reason = '单K模式通过';
            chosenSide = singleKSide;
            sourceMode = 'singleK';
          } else {
            reason = '振幅模式通过';
            chosenSide = ampSide;
            sourceMode = 'amplitude';
          }
        } else if (passedAmp) {
          isPass = true;
          reason = '振幅模式通过';
          chosenSide = ampSide;
          sourceMode = 'amplitude';
        } else if (passedSingleK) {
          isPass = true;
          reason = '单K模式通过';
          chosenSide = singleKSide;
          sourceMode = 'singleK';
        } else {
          isPass = false;
          reason = (failReasonAmp ? `振幅:${failReasonAmp}` : '') + (failReasonAmp && failReasonSingleK ? ' / ' : '') + (failReasonSingleK ? `单K:${failReasonSingleK}` : '') || '指标不符';
        }
      } else if (isAmpEnabled) {
        isPass = passedAmp;
        reason = passedAmp ? '振幅模式通过' : failReasonAmp;
        chosenSide = ampSide;
        sourceMode = passedAmp ? 'amplitude' : 'none';
      } else if (isSingleKEnabled) {
        isPass = passedSingleK;
        reason = passedSingleK ? '单K模式通过' : failReasonSingleK;
        chosenSide = singleKSide;
        sourceMode = passedSingleK ? 'singleK' : 'none';
      } else {
        isPass = false;
        reason = '未开启任何过滤模式';
      }

      if (isPass && this.settings.scanner.stage0P.enabled && !this.myStage0PQualifiedSymbols.has(item.symbol)) {
        isPass = false;
        reason = 'Stage0P 拦截';
      }

      const amplitudeMode = stage2Config.amplitudeMode || 'bottomHigh';
      const activeAmp = amplitudeMode === 'highLow' ? item.ampHighLow : item.ampBottomHigh;

      accountResults.push({
        ...item,
        status: isPass ? 'Stage 2 Pass' : 'Stage 2 Fail',
        reason: isPass ? reason : '未通过: ' + reason,
        isPass,
        passedAmp: passedAmp && isPass,
        passedSingleK: passedSingleK && isPass,
        side: chosenSide,
        buyRatio: item.buyRatio.toFixed(2),
        m: (item.volume15 / 1000000).toFixed(2), 
        amp: activeAmp.toFixed(2),
        ampBottomHigh: item.ampBottomHigh.toFixed(2),
        ampHighLow: item.ampHighLow.toFixed(2),
        fundingRate: item.fundingRate || 0,
        k2Change: k2_val.toFixed(2),
        realA: A_val.toFixed(2),
        sourceMode
      });
    }

    const activeSortMode = isAmpEnabled ? (stage2Config.preferredMode || 'volume') : (singleKConfig?.preferredMode || 'volume');
    accountResults.sort((a,b) => {
      if (a.isPass && !b.isPass) return -1;
      if (!a.isPass && b.isPass) return 1;
      if (activeSortMode === 'amp') return parseFloat(b.amp) - parseFloat(a.amp);
      if (activeSortMode === 'change') return parseFloat(b.k2Change) - parseFloat(a.k2Change);
      return parseFloat(b.m) - parseFloat(a.m);
    });

    const passedResults = accountResults.filter(r => r.isPass);
    if (passedResults.length > 0) passedResults[0].isPreferred = true;

    for (let i = accountResults.length - 1; i >= 0; i--) {
      const r = accountResults[i];
      const fundingRateStr = (r.fundingRate * 100).toFixed(4) + '%';
      
      let modeName = '';
      if (r.isPass) {
        if (r.sourceMode === 'amplitude') {
          modeName = r.side === 'BUY' ? '振幅多' : '振幅空';
        } else if (r.sourceMode === 'singleK') {
          modeName = r.side === 'BUY' ? '单K多' : '单K空';
        }
      }

      const logMsg = `${r.symbol}: Close=${r.buyRatio}%, AMP底高=${r.ampBottomHigh}%, AMP高低=${r.ampHighLow}%, M=${r.m}M, Funding=${fundingRateStr}, 单K2=${r.k2Change}%, 单A=${r.realA}%. ${r.isPass ? '通过' + (r.isPreferred ? ' (优选)' : '') + (modeName ? ` [${modeName}]` : '') : r.reason}`;
      this.addLog('扫描', logMsg, r.isPass ? 'success' : 'info');
    }

    this.stage2Results = { data: accountResults, scannedCount: sharedTable.length, startTime, duration: Date.now() - startTime };

    const activePositions = (this.accountData?.positions || []).filter((p: any) => Math.abs(parseFloat(p.positionAmt)) > 0.000001);
    const currentActiveCount = activePositions.length;
    const maxAllowed = this.settings.order?.preferredOrderCount ?? 2;

    const tradableResults = passedResults.filter(r => r.passedAmp || r.passedSingleK);

    if (tradableResults.length > 0 && !isManual && this.isRunning && !this.isOrdering && !this.pendingOrderSymbol) {
      if (Date.now() - startTime <= (this.settings.order?.positiveWindow || 2) * 1000) {
        const eligibleResults = tradableResults.filter(r => {
          const isHeld = activePositions.some((p: any) => p.symbol.toUpperCase() === r.symbol.toUpperCase());
          const isLocking = this.lockingSymbols.has(r.symbol.toUpperCase());
          const isPending = this.pendingOrderSymbol?.toUpperCase() === r.symbol.toUpperCase();
          return !isHeld && !isLocking && !isPending;
        });

        const remainingCapacity = maxAllowed - currentActiveCount;
        const sameDirectionOnly = !!this.settings.order?.sameDirectionOnly;
        
        if (remainingCapacity > 0 && eligibleResults.length > 0) {
          let selectedCoins: any[] = [];

          if (sameDirectionOnly) {
            const preferredCoin = eligibleResults[0];
            selectedCoins.push(preferredCoin);
            const preferredSide = preferredCoin.side;

            for (let i = 1; i < eligibleResults.length && selectedCoins.length < remainingCapacity; i++) {
              const candidate = eligibleResults[i];
              if (candidate.side === preferredSide) {
                selectedCoins.push(candidate);
              } else {
                this.addLog('下单', `[同向规则] 币对 ${candidate.symbol} 方向 (${candidate.side}) 与优选币对 ${preferredCoin.symbol} 方向 (${preferredSide}) 不一致，跳过`, 'info');
              }
            }
          } else {
            selectedCoins = eligibleResults.slice(0, remainingCapacity);
          }

          const tradeCount = selectedCoins.length;
          if (tradeCount > 0) {
            const winStreakThreshold = this.settings.order?.winStreakThreshold ?? 20;
            const sweepSkipCount = this.settings.order?.sweepSkipCount ?? 0;
            const currentStreak = this.getCurrentWinStreak();

            if (sweepSkipCount > 0 && currentStreak >= winStreakThreshold) {
              this.skippedCount++;
              const skippedSymbols = selectedCoins.map(c => c.symbol).join(', ');
              this.addLog(
                '下单',
                `[扫跳策略] 当前连赢已达 ${currentStreak} 次 (>= 阈值 ${winStreakThreshold})，触发第 ${this.skippedCount}/${sweepSkipCount} 次跳过开单！跳过币对: [${skippedSymbols}]`,
                'warning'
              );

              if (this.skippedCount >= sweepSkipCount) {
                this.skippedCount = 0;
                this.winStreakResetTimestamp = Date.now();

                const now = Date.now();
                const skipMarkLog: TradeLog = {
                  id: `skip_${now}_${Math.random().toString(36).substring(2, 7)}`,
                  symbol: '[扫跳重置]',
                  side: 'BUY',
                  leverage: 1,
                  amount: 0,
                  entryPrice: 0,
                  exitPrice: 0,
                  pnl: 0,
                  fee: 0,
                  fundingFee: 0,
                  profitRate: 0,
                  openTime: now,
                  closeTime: now,
                  status: 'SKIPPED',
                  isSkipMark: true
                };
                this.addTradeLog(skipMarkLog);

                this.addLog(
                  '下单',
                  `[扫跳策略] 已完成连续 ${sweepSkipCount} 次扫跳，已记录扫跳归零标记，连赢计数已清零重置，恢复后续正常下单。`,
                  'success'
                );
              }
            } else {
              if (currentStreak < winStreakThreshold) {
                this.skippedCount = 0;
              }

              // 时间管制判断：如果开启时间管制，且当前处于禁止下单时间段（且非手动触发）
              const tcEnabled = this.settings.scanner.timeControl?.enabled !== false;
              if (tcEnabled && !this.isCurrentTimeEnabled() && !isManual) {
                const now = Date.now();
                for (const coin of selectedCoins) {
                  const logItem: TradeLog = {
                    id: `tc_skip_${now}_${Math.random().toString(36).substring(2, 7)}`,
                    symbol: coin.symbol,
                    side: coin.side || 'BUY',
                    leverage: this.settings.order?.leverage ?? 20,
                    amount: this.settings.order?.orderAmount ?? 100,
                    entryPrice: coin.current15 ?? 0,
                    exitPrice: coin.current15 ?? 0,
                    pnl: 0,
                    fee: 0,
                    fundingFee: 0,
                    profitRate: 0,
                    amp: parseFloat(coin.amp || '0'),
                    mValue: parseFloat(coin.m || '0'),
                    realA: parseFloat(coin.realA || '0'),
                    k2: parseFloat(coin.k2Change || '0'),
                    fundingRate: coin.fundingRate || 0,
                    openTime: now,
                    closeTime: now,
                    status: 'SKIPPED',
                    strategyType: coin.sourceMode || 'amplitude',
                    isSkipMark: false
                  };
                  this.addTradeLog(logItem);
                  this.addLog(
                    '下单',
                    `[时间管制] 币对 ${coin.symbol} 满足开仓策略，但当前处于禁止下单时间段，已记录交易日志并跳过实际下单`,
                    'warning'
                  );
                }
                return [];
              }

              this.addLog('下单', `检测到当前持仓数量: ${currentActiveCount}, 最大限制: ${maxAllowed}${sameDirectionOnly ? ' [同向过滤:开启]' : ''}, 将对 ${tradeCount} 个符合策略条件的币对下单`, 'info');
              return selectedCoins;
            }
          }
        }
      }
    }
    return [];
  }

  async executeTrade(coin: any, scanStartTime: number) {
    await StrategyEngine.processGlobalBatchTrades([{ engine: this, coin, scanStartTime }]);
  }

  async executeMarketOrder(coin: any, scanStartTime: number): Promise<TradeContext | null> {
    if (this.isOrdering || this.pendingOrderSymbol) return null;
    
    this.isOrdering = true;
    this.pendingOrderSymbol = coin.symbol;
    this.addLog('下单', `[阶段1: 正常单开仓] 准备开仓优选币对: ${coin.symbol}`, 'info');

    this.manageMarketDataStreams().catch(err => {
      this.addLog('WebSocket', `触发持仓行情订阅失败: ${err.message}`, 'error');
    });

    try {
      const [ticker, account] = await Promise.all([
        this.binance.getTickerPrice(coin.symbol),
        this.binance.getAccountInfo()
      ]);

      const currentPrice = parseFloat(ticker.price);
      const balance = parseFloat(account.availableBalance);
      
      const activePositionsCount = (this.accountData?.positions || []).filter((p: any) => Math.abs(parseFloat(p.positionAmt)) > 0.000001).length;
      const openLogsCount = this.tradeLogs.filter(t => t.status === 'OPEN').length;
      const isSecondOrder = (activePositionsCount >= 1 || openLogsCount >= 1) && !!this.settings.order?.secondOrderCustomEnabled;

      const leverage = isSecondOrder 
        ? (this.settings.order.secondLeverage ?? this.settings.order.leverage) 
        : this.settings.order.leverage;
      const positionRatio = (isSecondOrder 
        ? (this.settings.order.secondPositionRatio ?? this.settings.order.positionRatio) 
        : this.settings.order.positionRatio) / 100;
      const maxPosition = isSecondOrder 
        ? (this.settings.order.secondMaxPosition ?? this.settings.order.maxPosition) 
        : this.settings.order.maxPosition;
      
      let targetValue = balance * leverage * positionRatio;
      
      const isSingleK = coin.sourceMode === 'singleK';
      const mLinkEnabled = isSingleK
        ? (isSecondOrder 
          ? (this.settings.order.secondSingleKMLinkEnabled ?? this.settings.order.singleKMLinkEnabled ?? false)
          : (this.settings.order.singleKMLinkEnabled ?? false))
        : (isSecondOrder 
          ? (this.settings.order.secondMLinkEnabled ?? this.settings.order.mLinkEnabled)
          : this.settings.order.mLinkEnabled);
      const mLinkValue = isSingleK
        ? (isSecondOrder
          ? (this.settings.order.secondSingleKMLinkValue ?? this.settings.order.singleKMLinkValue ?? 1800)
          : (this.settings.order.singleKMLinkValue ?? 1800))
        : (isSecondOrder
          ? (this.settings.order.secondMLinkValue ?? this.settings.order.mLinkValue)
          : this.settings.order.mLinkValue);

      if (mLinkEnabled && mLinkValue && mLinkValue > 0) {
        const rawM = parseFloat(coin.m) * 1000000;
        const mLimit = rawM / mLinkValue;
        if (mLimit < targetValue) {
          this.addLog('下单', `${isSecondOrder ? '第二仓单' : ''}关联M触发限额: 原始仓位 ${targetValue.toFixed(2)}, M限制仓位 ${mLimit.toFixed(2)} (M=${coin.m}M, 关联M=${mLinkValue})`, 'info');
          targetValue = mLimit;
        }
      }

      if (targetValue > maxPosition) targetValue = maxPosition;
      let quantity = targetValue / currentPrice;

      if (!this.exchangeInfo) {
        this.exchangeInfo = await this.binance.getExchangeInfo();
      }
      const symbolInfo = this.exchangeInfo.symbols.find((s: any) => s.symbol === coin.symbol);
      if (!symbolInfo) throw new Error(`找不到币种信息: ${coin.symbol}`);

      const lotSizeFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const stepSize = parseFloat(lotSizeFilter.stepSize);
      const minQty = parseFloat(lotSizeFilter.minQty) || 0;
      const formattedQuantity = formatQtyWithStepSize(quantity, stepSize, minQty);

      try {
        await this.binance.setLeverage(coin.symbol, leverage);
        this.addLog('下单', `成功将 ${coin.symbol} 杠杆设置为 ${leverage} 倍${isSecondOrder ? ' (第二仓单独立自定义杠杆)' : ''}`, 'info');
      } catch (e: any) {
        this.addLog('下单', `设置 ${coin.symbol} 杠杆失败 (可能已是目标杠杆或有其他持仓): ${e.message}`, 'warning');
      }

      const side: 'BUY' | 'SELL' = coin.side || 'BUY';
      const sourceMode = coin.sourceMode || (coin.k2Change !== undefined ? 'singleK' : 'amplitude');
      const strategyLabel = sourceMode === 'singleK'
        ? (side === 'BUY' ? '单K多' : '单K空')
        : (side === 'BUY' ? '振幅多' : '振幅空');

      this.addLog('下单', `[最高] 正向单下单: ${coin.symbol} [策略: ${strategyLabel}], 方向: ${side}, 数量: ${formattedQuantity}, 价格: ${currentPrice}${isSecondOrder ? ' (已启用第二仓单自定义比例/最大额度限制)' : ''}`, 'success');

      const order = await this.binance.placeOrder({
        symbol: coin.symbol,
        side,
        type: 'MARKET',
        quantity: formattedQuantity
      });

      const orderIdStr = order.orderId.toString();
      this.addLog('下单', `[最高] 正向单交易完成: ${coin.symbol} [策略: ${strategyLabel}], 订单ID: ${orderIdStr}`, 'success', order);

      const newTradeLog: TradeLog = {
        id: orderIdStr,
        symbol: coin.symbol,
        side,
        leverage,
        amount: parseFloat(formattedQuantity),
        entryPrice: currentPrice,
        exitPrice: 0,
        expiryPrice: 0,
        pnl: 0,
        fee: 0,
        fundingFee: 0,
        fundingFeeCheckedCount: 0,
        fundingRate: coin.fundingRate || 0,
        profitRate: 0,
        kBestChange: 0,
        amp: parseFloat(coin.amp),
        mValue: parseFloat(coin.m),
        k2: coin.k2Change !== undefined ? parseFloat(coin.k2Change) : undefined,
        openTime: Date.now(),
        closeTime: 0,
        status: 'OPEN',
        strategyType: coin.sourceMode || (coin.k2Change !== undefined ? 'singleK' : 'amplitude')
      };

      this.addTradeLog(newTradeLog);
      this.scheduleExpiryPriceFetch(newTradeLog, isSecondOrder);

      const executionData = {
        avgPrice: parseFloat(order.avgPrice || order.price || currentPrice.toString()),
        qty: parseFloat(order.cumQty || formattedQuantity)
      };

      const { formattedTP, formattedSL, kBestClose, entryPrice } = await this.calculateTPSLTargetPrices(
        coin,
        scanStartTime,
        symbolInfo,
        orderIdStr,
        executionData,
        side,
        isSecondOrder
      );

      return {
        engine: this,
        coin,
        scanStartTime,
        orderId: orderIdStr,
        symbol: coin.symbol,
        side,
        formattedQuantity,
        executionData,
        symbolInfo,
        isSecondOrder,
        formattedTP,
        formattedSL,
        kBestClose,
        entryPrice
      };

    } catch (error: any) {
      this.addLog('下单', `开仓流程异常: ${error.message}`, 'error');
      if (error.status === 429 || error.status === 418 || error.message?.includes('-1003')) {
        this.handleBan(error);
      }
      return null;
    } finally {
      this.pendingOrderSymbol = null;
      this.isOrdering = false;
      this.fetchAccountDataDebounced({ skipCleanup: false });
    }
  }

  private async calculateTPSLTargetPrices(
    coin: any,
    scanStartTime: number,
    symbolInfo: any,
    orderId: string,
    executionData?: { avgPrice: number; qty: number },
    side: 'BUY' | 'SELL' = 'BUY',
    isSecondOrder: boolean = false
  ): Promise<{ formattedTP: string; formattedSL: string; kBestClose: number; entryPrice: number }> {
    const symbol = coin.symbol;
    const period = this.settings.order.kBestPeriod || '15m';
    let intervalMs = 15 * 60 * 1000;
    if (period.endsWith('m')) intervalMs = parseInt(period) * 60 * 1000;
    else if (period.endsWith('h')) intervalMs = parseInt(period) * 60 * 60 * 1000;
    else if (period.endsWith('d')) intervalMs = parseInt(period) * 24 * 60 * 60 * 1000;

    const targetTime = scanStartTime - 1000;
    const targetTimeAdjusted = targetTime + this.timeOffset;
    const targetStart = Math.floor(targetTimeAdjusted / intervalMs) * intervalMs;
    const targetEnd = targetStart + intervalMs;
    
    const formatTime = (ts: number) => {
      const d8 = new Date(ts + 8 * 3600 * 1000); // 转换为 UTC+8 显示
      return [
        d8.getUTCHours().toString().padStart(2, '0'),
        d8.getUTCMinutes().toString().padStart(2, '0'),
        d8.getUTCSeconds().toString().padStart(2, '0')
      ].join(':');
    };

    const targetStartStr = formatTime(targetStart);
    const targetEndStr = formatTime(targetEnd);

    let kBestOpen: number;
    let kBestHigh: number;
    let kBestLow: number;
    let kBestClose: number;
    let kBestQuoteVolume: number;

    const calcMode = this.settings.order.tpSlCalcMode || 'closedK';

    try {
      if (calcMode === 'stage2' && coin) {
        this.addLog('下单', `[Stage 2 即刻挂单模式] 立即使用 Stage 2 扫描时刻获取的行情数据进行止盈止损计算`, 'success');
        kBestOpen = parseFloat(coin.open15);
        kBestHigh = parseFloat(coin.high15);
        kBestLow = parseFloat(coin.low15);
        kBestClose = parseFloat(coin.current15);
        kBestQuoteVolume = parseFloat(coin.volume15);
      } else {
        if (calcMode === 'stage2' && !coin) {
          this.addLog('下单', `[Stage 2 即刻挂单模式] 丢失 Stage 2 行情参数，回退至权威封盘数据模式`, 'warning');
        }
        let kBest = null;
        let attempts = 0;
        
        this.addLog('下单', `${symbol} 正在获取 K 优权威封盘数据 (${targetStartStr})...`, 'info');

        // 核心优化：高速探测路径 (优先使用 WebSocket 实时缓存)
        // 在周期切换后的 01s 500ms 之前，高频探测本地缓存是否已收到 isFinal = true 的封盘包
        const apiPollingStartTime = targetEnd + 1500;
        
        while (true) {
          const currentServerTime = Date.now() + this.timeOffset;
          
          // 1. 尝试从缓存获取
          const cached = this.getCachedKline(symbol, targetStart);
          if (cached && cached.isFinal) {
            kBest = [
              cached.timestamp.toString(),
              cached.open.toString(),
              cached.high.toString(),
              cached.low.toString(),
              cached.close.toString(),
              '0', // volume
              (cached.timestamp + intervalMs - 1).toString(),
              cached.quoteVolume.toString()
            ];
            this.addLog('下单', `[高速探测] 通过 WebSocket 实时缓存捕捉到 ${symbol} 封盘数据`, 'success');
            break;
          }

          // 2. 检查是否到达强制切换 API 轮询的时间点 (01s 500ms)
          if (currentServerTime >= apiPollingStartTime) {
            break;
          }

          await new Promise(resolve => setTimeout(resolve, 100)); // 100ms 高频探测
        }

        // 如果高速探测未果，进入常规 API 轮询路径 (此时已过 01s 500ms)
        if (!kBest) {
          this.addLog('下单', `${symbol} 高速探测未命中，于 01s500ms 准时切入 API 轮询模式...`, 'info');
          while (attempts < 30) { 
            // 核心优化：显式指定 startTime 获取目标 K 线及后续 K 线
            const klines = await this.binance.getKlines(symbol, period, 10, { startTime: targetStart });
            kBest = klines.find((k: any) => parseInt(k[0]) === targetStart);
            
            // 关键校验：必须看到下一根 K 线已经在列表里，且由于延时已过，下一根 K 线必须已有成交量 (Volume > 0)
            const nextK = klines.find((k: any) => parseInt(k[0]) === targetStart + intervalMs);
            const nextVol = nextK ? parseFloat(nextK[5]) : 0;

            if (kBest && nextK && nextVol > 0) {
              this.addLog('下单', `[权威] 已确认 ${symbol} 目标周期封盘并获得数据`, 'success');
              break;
            }
            
            if (kBest && attempts > 10) {
              this.addLog('下单', `[警告] ${symbol} 未检测到明确封盘标志，但已重试多次，尝试使用当前获取的值`, 'warning');
              break;
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, 250)); // 轮询间隔 250ms
          }
        }
        
        if (!kBest) {
          throw new Error(`无法获取 ${symbol} 目标区间 (${targetStartStr}) 的 K 线数据`);
        }

        kBestOpen = parseFloat(kBest[1]);
        kBestHigh = parseFloat(kBest[2]);
        kBestLow = parseFloat(kBest[3]);
        kBestClose = parseFloat(kBest[4]);
        kBestQuoteVolume = parseFloat(kBest[7]); // 交易额
        
        this.addLog('下单', `[权威] 获取 K 优数据成功: ${symbol}, 开盘: ${kBestOpen}, 最高: ${kBestHigh}, 最低: ${kBestLow}, 封盘: ${kBestClose}, 交易额: ${kBestQuoteVolume.toFixed(2)}`, 'success');
      }

      const entryPrice = executionData?.avgPrice || (this.currentPosition ? this.currentPosition.entryPrice : kBestClose);
      // 根据用户要求，直接使用计算结果，不取绝对值
      const kBestChange = (kBestClose - kBestOpen) / kBestOpen;
      const amp = kBestHigh > 0 ? (1 - kBestLow / kBestHigh) * 100 : 0;
      
      // 真实A = (最高值 - k优收) / k优收 * 100
      const realA = ((kBestHigh - kBestClose) / kBestClose) * 100;

      // 更新交易日志中的 K 优涨跌幅、M值（交易额，单位：100万）和真实A
      this.updateTradeLog(orderId, { 
        kBestChange,
        amp,
        mValue: parseFloat((kBestQuoteVolume / 1000000).toFixed(2)),
        realA 
      });

      const isSingleK = coin?.sourceMode === 'singleK';

      // 止盈价计算
      let theoreticalTP: number;
      const tpMultiplier = side === 'BUY' ? 1 : -1;
      
      const tpMode = isSingleK
        ? (isSecondOrder
          ? (side === 'BUY' ? (this.settings.order.secondSingleKTpModeBuy ?? this.settings.order.singleKTpModeBuy ?? 'amp') : (this.settings.order.secondSingleKTpModeSell ?? this.settings.order.singleKTpModeSell ?? 'amp'))
          : (side === 'BUY' ? (this.settings.order.singleKTpModeBuy ?? 'amp') : (this.settings.order.singleKTpModeSell ?? 'amp')))
        : (isSecondOrder
          ? (side === 'BUY' ? (this.settings.order.secondTpModeBuy ?? this.settings.order.tpModeBuy) : (this.settings.order.secondTpModeSell ?? this.settings.order.tpModeSell))
          : (side === 'BUY' ? this.settings.order.tpModeBuy : this.settings.order.tpModeSell));

      if (tpMode === 'fixed') {
        let tpFixed: number;
        if (isSingleK) {
          if (isSecondOrder) {
            tpFixed = (side === 'BUY' 
              ? (this.settings.order.secondSingleKTpFixedBuy ?? this.settings.order.singleKTpFixedBuy ?? 2)
              : (this.settings.order.secondSingleKTpFixedSell ?? this.settings.order.singleKTpFixedSell ?? 2));
          } else {
            tpFixed = (side === 'BUY' ? (this.settings.order.singleKTpFixedBuy ?? 2) : (this.settings.order.singleKTpFixedSell ?? 2));
          }
        } else {
          if (isSecondOrder) {
            tpFixed = (side === 'BUY' 
              ? (this.settings.order.secondTpFixedBuy ?? this.settings.order.tpFixedBuy) 
              : (this.settings.order.secondTpFixedSell ?? this.settings.order.tpFixedSell));
          } else {
            tpFixed = (side === 'BUY' ? this.settings.order.tpFixedBuy : this.settings.order.tpFixedSell);
          }
        }
        theoreticalTP = kBestClose * (1 + tpMultiplier * tpFixed / 100);
        if (isSingleK) {
          this.addLog('下单', `${symbol} 单K模式止盈计算应用独立固定止盈: ${tpFixed}%`, 'info');
        } else if (isSecondOrder) {
          this.addLog('下单', `${symbol} 第二仓单止盈计算应用独立固定止盈: ${tpFixed}%`, 'info');
        }
      } else if (tpMode === 'amp') {
        const amplitudeMode = this.settings.scanner.stage2.amplitudeMode || 'bottomHigh';
        const amp = amplitudeMode === 'highLow' && kBestLow > 0
          ? (kBestHigh / kBestLow - 1)
          : (kBestHigh > 0 ? (1 - kBestLow / kBestHigh) : 0);
        let tpAmpVal: number;
        if (isSingleK) {
          if (isSecondOrder) {
            tpAmpVal = (side === 'BUY' 
              ? (this.settings.order.secondSingleKTpAmpBuy ?? this.settings.order.singleKTpAmpBuy ?? 25)
              : (this.settings.order.secondSingleKTpAmpSell ?? this.settings.order.singleKTpAmpSell ?? 25));
          } else {
            tpAmpVal = (side === 'BUY' ? (this.settings.order.singleKTpAmpBuy ?? 25) : (this.settings.order.singleKTpAmpSell ?? 25));
          }
        } else {
          if (isSecondOrder) {
            tpAmpVal = (side === 'BUY' 
              ? (this.settings.order.secondTpAmpBuy ?? this.settings.order.tpAmpBuy) 
              : (this.settings.order.secondTpAmpSell ?? this.settings.order.tpAmpSell));
          } else {
            tpAmpVal = (side === 'BUY' ? this.settings.order.tpAmpBuy : this.settings.order.tpAmpSell);
          }
        }
        theoreticalTP = kBestClose * (1 + tpMultiplier * amp * tpAmpVal / 100);
        if (isSingleK) {
          this.addLog('下单', `${symbol} 单K模式止盈计算应用独立振比止盈: ${tpAmpVal}%`, 'info');
        } else if (isSecondOrder) {
          this.addLog('下单', `${symbol} 第二仓单止盈计算应用独立振比止盈: ${tpAmpVal}%`, 'info');
        }
      } else {
        let tpRatioVal: number;
        if (isSingleK) {
          if (isSecondOrder) {
            tpRatioVal = (side === 'BUY' 
              ? (this.settings.order.secondSingleKTpRatioBuy ?? this.settings.order.singleKTpRatioBuy ?? 25)
              : (this.settings.order.secondSingleKTpRatioSell ?? this.settings.order.singleKTpRatioSell ?? 25));
          } else {
            tpRatioVal = (side === 'BUY' ? (this.settings.order.singleKTpRatioBuy ?? 25) : (this.settings.order.singleKTpRatioSell ?? 25));
          }
        } else {
          if (isSecondOrder) {
            tpRatioVal = (side === 'BUY' 
              ? (this.settings.order.secondTpRatioBuy ?? this.settings.order.tpRatioBuy) 
              : (this.settings.order.secondTpRatioSell ?? this.settings.order.tpRatioSell));
          } else {
            tpRatioVal = (side === 'BUY' ? this.settings.order.tpRatioBuy : this.settings.order.tpRatioSell);
          }
        }
        const tpRatio = tpRatioVal / 100;
        // 采用绝对值并根据方向乘以系数，确保 TP 的方向永远正确
        theoreticalTP = kBestClose * (1 + tpMultiplier * Math.abs(kBestChange) * tpRatio);
        if (isSingleK) {
          this.addLog('下单', `${symbol} 单K模式止盈计算应用独立比例止盈: ${tpRatioVal}%`, 'info');
        } else if (isSecondOrder) {
          this.addLog('下单', `${symbol} 第二仓单止盈计算应用独立比例止盈: ${tpRatioVal}%`, 'info');
        }
      }

      // 止损价计算
      let theoreticalSL: number;
      const slMultiplier = side === 'BUY' ? -1 : 1;
      
      const slMode = isSingleK
        ? (isSecondOrder
          ? (side === 'BUY' ? (this.settings.order.secondSingleKSlModeBuy ?? this.settings.order.singleKSlModeBuy ?? 'fixed') : (this.settings.order.secondSingleKSlModeSell ?? this.settings.order.singleKSlModeSell ?? 'fixed'))
          : (side === 'BUY' ? (this.settings.order.singleKSlModeBuy ?? 'fixed') : (this.settings.order.singleKSlModeSell ?? 'fixed')))
        : (isSecondOrder
          ? (side === 'BUY' ? (this.settings.order.secondSlModeBuy ?? this.settings.order.slModeBuy) : (this.settings.order.secondSlModeSell ?? this.settings.order.slModeSell))
          : (side === 'BUY' ? this.settings.order.slModeBuy : this.settings.order.slModeSell));

      if (slMode === 'fixed') {
        let slFixed: number;
        if (isSingleK) {
          if (isSecondOrder) {
            slFixed = (side === 'BUY' 
              ? (this.settings.order.secondSingleKSlFixedBuy ?? this.settings.order.singleKSlFixedBuy ?? 20)
              : (this.settings.order.secondSingleKSlFixedSell ?? this.settings.order.singleKSlFixedSell ?? 20));
          } else {
            slFixed = (side === 'BUY' ? (this.settings.order.singleKSlFixedBuy ?? 20) : (this.settings.order.singleKSlFixedSell ?? 20));
          }
        } else {
          if (isSecondOrder) {
            slFixed = (side === 'BUY' 
              ? (this.settings.order.secondSlFixedBuy ?? this.settings.order.slFixedBuy) 
              : (this.settings.order.secondSlFixedSell ?? this.settings.order.slFixedSell));
          } else {
            slFixed = (side === 'BUY' ? this.settings.order.slFixedBuy : this.settings.order.slFixedSell);
          }
        }
        theoreticalSL = kBestClose * (1 + slMultiplier * slFixed / 100);
        if (isSingleK) {
          this.addLog('下单', `${symbol} 单K模式止损计算应用独立固定止损: ${slFixed}%`, 'info');
        } else if (isSecondOrder) {
          this.addLog('下单', `${symbol} 第二仓单止损计算应用独立固定止损: ${slFixed}%`, 'info');
        }
      } else if (slMode === 'amp') {
        const amplitudeMode = this.settings.scanner.stage2.amplitudeMode || 'bottomHigh';
        const amp = amplitudeMode === 'highLow' && kBestLow > 0
          ? (kBestHigh / kBestLow - 1)
          : (kBestHigh > 0 ? (1 - kBestLow / kBestHigh) : 0);
        let slAmpVal: number;
        if (isSingleK) {
          if (isSecondOrder) {
            slAmpVal = (side === 'BUY' 
              ? (this.settings.order.secondSingleKSlAmpBuy ?? this.settings.order.singleKSlAmpBuy ?? 20)
              : (this.settings.order.secondSingleKSlAmpSell ?? this.settings.order.singleKSlAmpSell ?? 20));
          } else {
            slAmpVal = (side === 'BUY' ? (this.settings.order.singleKSlAmpBuy ?? 20) : (this.settings.order.singleKSlAmpSell ?? 20));
          }
        } else {
          if (isSecondOrder) {
            slAmpVal = (side === 'BUY' 
              ? (this.settings.order.secondSlAmpBuy ?? this.settings.order.slAmpBuy) 
              : (this.settings.order.secondSlAmpSell ?? this.settings.order.slAmpSell));
          } else {
            slAmpVal = (side === 'BUY' ? this.settings.order.slAmpBuy : this.settings.order.slAmpSell);
          }
        }
        theoreticalSL = kBestClose * (1 + slMultiplier * amp * slAmpVal / 100);
        if (isSingleK) {
          this.addLog('下单', `${symbol} 单K模式止损计算应用独立振比止损: ${slAmpVal}%`, 'info');
        } else if (isSecondOrder) {
          this.addLog('下单', `${symbol} 第二仓单止损计算应用独立振比止损: ${slAmpVal}%`, 'info');
        }
      } else {
        let slRatioVal: number;
        if (isSingleK) {
          if (isSecondOrder) {
            slRatioVal = (side === 'BUY' 
              ? (this.settings.order.secondSingleKSlRatioBuy ?? this.settings.order.singleKSlRatioBuy ?? 20)
              : (this.settings.order.secondSingleKSlRatioSell ?? this.settings.order.singleKSlRatioSell ?? 20));
          } else {
            slRatioVal = (side === 'BUY' ? (this.settings.order.singleKSlRatioBuy ?? 20) : (this.settings.order.singleKSlRatioSell ?? 20));
          }
        } else {
          if (isSecondOrder) {
            slRatioVal = (side === 'BUY' 
              ? (this.settings.order.secondSlRatioBuy ?? this.settings.order.slRatioBuy) 
              : (this.settings.order.secondSlRatioSell ?? this.settings.order.slRatioSell));
          } else {
            slRatioVal = (side === 'BUY' ? this.settings.order.slRatioBuy : this.settings.order.slRatioSell);
          }
        }
        const slRatio = slRatioVal / 100;
        theoreticalSL = kBestClose * (1 + slMultiplier * Math.abs(kBestChange) * slRatio);
        if (isSingleK) {
          this.addLog('下单', `${symbol} 单K模式止损计算应用独立比例止损: ${slRatioVal}%`, 'info');
        } else if (isSecondOrder) {
          this.addLog('下单', `${symbol} 第二仓单止损计算应用独立比例止损: ${slRatioVal}%`, 'info');
        }
      }

      // 安全垫：多单止盈必须高于入场，空单止盈必须低于入场
      const safeTP = side === 'BUY' 
        ? Math.max(theoreticalTP, entryPrice * 1.0001)
        : Math.min(theoreticalTP, entryPrice * 0.9999);
      
      const safeSL = side === 'BUY'
        ? Math.min(theoreticalSL, entryPrice * 0.9999)
        : Math.max(theoreticalSL, entryPrice * 1.0001);

      // 价格精度对齐 (优化版)
      const priceFilter = symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      const tickSize = parseFloat(priceFilter.tickSize);
      const minPrice = parseFloat(priceFilter.minPrice) || 0;
      
      // 止盈：多单向下取整，空单向上取整
      const formattedTP = side === 'BUY'
        ? formatPriceWithTickSize(safeTP, tickSize, minPrice, 'floor')
        : formatPriceWithTickSize(safeTP, tickSize, minPrice, 'ceil');

      // 止损：多单向上取整，空单向下取整
      const formattedSL = side === 'BUY'
        ? formatPriceWithTickSize(safeSL, tickSize, minPrice, 'ceil')
        : formatPriceWithTickSize(safeSL, tickSize, minPrice, 'floor');

      const sourceMode = coin?.sourceMode || (coin?.k2Change !== undefined ? 'singleK' : 'amplitude');
      const strategyLabel = sourceMode === 'singleK'
        ? (side === 'BUY' ? '单K多' : '单K空')
        : (side === 'BUY' ? '振幅多' : '振幅空');

      this.addLog('下单', `[最高] 获取k优开计算完成: ${symbol} [策略: ${strategyLabel}] [${targetStartStr} - ${targetEndStr}] - 入场价: ${entryPrice}, K优开: ${kBestOpen}, K优收: ${kBestClose}, K优高: ${kBestHigh}, K优低: ${kBestLow}, TP: ${formattedTP}, SL: ${formattedSL} (K优振幅: ${amp.toFixed(2)}%)`, 'success');

      return { formattedTP, formattedSL, kBestClose, entryPrice };
    } catch (error: any) {
      this.addLog('下单', `计算止盈止损目标价失败: ${error.message}`, 'error');
      throw error;
    }
  }

  async executeLimitOrder(ctx: TradeContext) {
    const { symbol, formattedQuantity, executionData, symbolInfo, orderId, side, formattedTP, isSecondOrder } = ctx;

    try {
      let posEstablished = false;
      let posAttempts = 0;
      
      if (executionData && executionData.qty > 0) {
        posEstablished = true;
        await this.fetchAccountData({ force: true });
      }

      while (!posEstablished && posAttempts < 20) {
        try {
          const positions = await this.binance.getPositionRisk(symbol);
          const p = positions.find((item: any) => item.symbol === symbol);
          if (p) {
            const amount = Math.abs(parseFloat(p.positionAmt));
            if (amount > 0) {
              await this.fetchAccountData({ force: true });
              posEstablished = true;
              break;
            }
          }
        } catch (err: any) {
          this.addLog('下单', `检查 ${symbol} 持仓异常: ${err.message}`, 'warning');
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        posAttempts++;
      }

      if (!posEstablished) {
        this.addLog('下单', `未检测到 ${symbol} 持仓，取消挂 Limit 止盈单`, 'warning');
        return;
      }

      const lotSizeFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const stepSize = parseFloat(lotSizeFilter.stepSize);
      const minQty = parseFloat(lotSizeFilter.minQty) || 0;
      
      let actualQuantity = formattedQuantity;
      const symbolPos = (this.accountData?.positions || []).find((p: any) => p.symbol === symbol);
      if (symbolPos && Math.abs(parseFloat(symbolPos.positionAmt)) > 0) {
        actualQuantity = formatQtyWithStepSize(Math.abs(parseFloat(symbolPos.positionAmt)), stepSize, minQty);
      } else if (this.currentPosition && this.currentPosition.symbol === symbol && Math.abs(this.currentPosition.amount) > 0) {
        actualQuantity = formatQtyWithStepSize(Math.abs(this.currentPosition.amount), stepSize, minQty);
      } else if (executionData && executionData.qty > 0) {
        actualQuantity = formatQtyWithStepSize(executionData.qty, stepSize, minQty);
      }
      ctx.actualQuantity = actualQuantity;

      const isSingleK = ctx.coin?.sourceMode === 'singleK';
      const tpEnabled = isSingleK
        ? (isSecondOrder
          ? (this.settings.order.secondSingleKTpEnabled ?? this.settings.order.singleKTpEnabled ?? true)
          : (this.settings.order.singleKTpEnabled ?? true))
        : (isSecondOrder 
          ? (this.settings.order.secondTpEnabled ?? this.settings.order.tpEnabled)
          : this.settings.order.tpEnabled);
      const sideTpEnabled = side === 'BUY' 
        ? (this.settings.order.tpEnabledBuy !== false)
        : (this.settings.order.tpEnabledSell !== false);

      if (tpEnabled !== false && sideTpEnabled) {
        const openOrders = await this.binance.getOpenOrders(symbol);
        const limitOrder = openOrders.find((o: any) => o.type === 'LIMIT');

        if (!limitOrder) {
          this.addLog('下单', `[阶段2: Limit 止盈挂单] 正在挂限价止盈单: ${symbol}, 价格: ${formattedTP}, 数量: ${actualQuantity}`);
          const tpOrder = await this.binance.placeOrder({
            symbol,
            side: side === 'BUY' ? 'SELL' : 'BUY',
            type: 'LIMIT',
            quantity: actualQuantity,
            price: formattedTP,
            timeInForce: 'GTC',
            reduceOnly: 'true'
          });
          const tpOrderIdStr = tpOrder.orderId.toString();
          const sourceMode = ctx.coin?.sourceMode || (ctx.coin?.k2Change !== undefined ? 'singleK' : 'amplitude');
          const strategyLabel = sourceMode === 'singleK'
            ? (side === 'BUY' ? '单K多' : '单K空')
            : (side === 'BUY' ? '振幅多' : '振幅空');
          this.addLog('下单', `[最高] limit挂单完成: ${symbol} [策略: ${strategyLabel}], 方向: ${side === 'BUY' ? 'SELL' : 'BUY'}, 价格: ${formattedTP}, 订单ID: ${tpOrderIdStr}`, 'success', tpOrder);
          this.updateTradeLog(orderId, { tpOrderId: tpOrderIdStr });
        } else {
          this.addLog('下单', `${symbol} 已存在 Limit 挂单，跳过重复挂单并绑定当前订单号`, 'info');
          this.updateTradeLog(orderId, { tpOrderId: limitOrder.orderId.toString() });
        }
      } else if (tpEnabled === false) {
        this.addLog('下单', `${symbol} 已关闭止盈挂单功能（全局）`, 'info');
      } else {
        this.addLog('下单', `${symbol} 已关闭 ${side === 'BUY' ? '多' : '空'}单止盈挂单功能`, 'info');
      }

    } catch (error: any) {
      this.addLog('下单', `挂 Limit 止盈单失败: ${error.message}`, 'error');
    }
  }

  async executeAlgoOrder(ctx: TradeContext) {
    const { symbol, formattedTP, formattedSL, orderId, side, isSecondOrder, actualQuantity: ctxActualQty, formattedQuantity } = ctx;

    try {
      const actualQuantity = ctxActualQty || formattedQuantity;
      const isSingleK = ctx.coin?.sourceMode === 'singleK';
      const slEnabled = isSingleK
        ? (isSecondOrder
          ? (this.settings.order.secondSingleKSlEnabled ?? this.settings.order.singleKSlEnabled ?? true)
          : (this.settings.order.singleKSlEnabled ?? true))
        : (isSecondOrder
          ? (this.settings.order.secondSlEnabled ?? this.settings.order.slEnabled)
          : this.settings.order.slEnabled);
      const sideSlEnabled = side === 'BUY'
        ? (this.settings.order.slEnabledBuy !== false)
        : (this.settings.order.slEnabledSell !== false);

      if (slEnabled !== false && sideSlEnabled) {
        const openAlgoOrders = await this.binance.getOpenAlgoOrders(symbol);
        const algoOrder = openAlgoOrders.find((o: any) => o.algoType === 'CONDITIONAL' || o.type === 'STOP_MARKET');

        if (!algoOrder) {
          this.addLog('下单', `[阶段3: Algo 止损挂单] 正在挂策略止损单: ${symbol}, 触发价: ${formattedSL}, 数量: ${actualQuantity}`);
          
          try {
            const ticker = await this.binance.getTickerPrice(symbol);
            const currentPrice = parseFloat(ticker.price);
            const triggerPrice = parseFloat(formattedSL);
            
            if ((side === 'BUY' && currentPrice <= triggerPrice) || (side === 'SELL' && currentPrice >= triggerPrice)) {
              this.addLog('下单', `[Pre-check 预检] 当前价格 (${currentPrice}) 已穿透/触及止损价 (${triggerPrice})，放弃挂止损单，执行紧急平仓`, 'warning');
              await this.closeCurrentPosition();
              return;
            }
          } catch (pCheckErr: any) {
            this.addLog('下单', `预检当前价格异常，将直接尝试提交 Algo 订单: ${pCheckErr.message}`, 'warning');
          }

          try {
            const slOrder = await this.binance.createAlgoOrder({
              symbol,
              side: side === 'BUY' ? 'SELL' : 'BUY',
              algoType: 'CONDITIONAL',
              type: 'STOP_MARKET',
              quantity: actualQuantity,
              stopPrice: formattedSL,
              triggerPrice: formattedSL,
              reduceOnly: 'true'
            });
            const slOrderIdStr = (slOrder.algoId || slOrder.orderId).toString();
            const sourceMode = ctx.coin?.sourceMode || (ctx.coin?.k2Change !== undefined ? 'singleK' : 'amplitude');
            const strategyLabel = sourceMode === 'singleK'
              ? (side === 'BUY' ? '单K多' : '单K空')
              : (side === 'BUY' ? '振幅多' : '振幅空');
            this.addLog('下单', `[最高] algo挂单完成: ${symbol} [策略: ${strategyLabel}], 方向: ${side === 'BUY' ? 'SELL' : 'BUY'}, 触发价: ${formattedSL}, 订单ID: ${slOrderIdStr}`, 'success', slOrder);
            this.updateTradeLog(orderId, { slOrderId: slOrderIdStr });
          } catch (algoError: any) {
            this.addLog('下单', `挂 Algo 止损单失败: ${algoError.message}`, 'error');
            if (algoError.message.includes('-2021') || algoError.message.includes('Order would immediately trigger')) {
              this.addLog('下单', `检测到触发价已被穿过 (${symbol})，执行紧急市价平仓...`, 'warning');
              await this.closeCurrentPosition();
            }
          }
        } else {
          this.addLog('下单', `${symbol} 已存在 Algo 挂单，跳过重复挂单并绑定当前订单号`, 'info');
          const slOrderIdStr = (algoOrder.algoId || algoOrder.orderId).toString();
          this.updateTradeLog(orderId, { slOrderId: slOrderIdStr });
        }
      } else if (slEnabled === false) {
        this.addLog('下单', `${symbol} 已关闭止损挂单功能（全局）`, 'info');
      } else {
        this.addLog('下单', `${symbol} 已关闭 ${side === 'BUY' ? '多' : '空'}单止损挂单功能`, 'info');
      }

    } catch (error: any) {
      this.addLog('下单', `设置 Algo 止损失败: ${error.message}`, 'error');
      if (error.message.includes('-2021') || error.message.includes('Order would immediately trigger')) {
        this.addLog('下单', `检测到触发价已被穿过 (${symbol})，执行紧急市价平仓...`, 'warning');
        await this.closeCurrentPosition();
      }
    }
  }

  private async handleTPAndSL(symbol: string, quantity: string, scanStartTime: number, symbolInfo: any, orderId: string, executionData?: { avgPrice: number, qty: number }, side: 'BUY' | 'SELL' = 'BUY', scannerData?: any, isSecondOrder: boolean = false) {
    const { formattedTP, formattedSL, kBestClose, entryPrice } = await this.calculateTPSLTargetPrices(
      scannerData || { symbol },
      scanStartTime,
      symbolInfo,
      orderId,
      executionData,
      side,
      isSecondOrder
    );

    const ctx: TradeContext = {
      engine: this,
      coin: scannerData || { symbol },
      scanStartTime,
      orderId,
      symbol,
      side,
      formattedQuantity: quantity,
      executionData,
      symbolInfo,
      isSecondOrder,
      formattedTP,
      formattedSL,
      kBestClose,
      entryPrice
    };

    await this.executeLimitOrder(ctx);
    await this.executeAlgoOrder(ctx);
  }
  
  getScanResults(stage: number) {
    switch (stage) {
      case 0: return this.stage0Results;
      case 1: return this.stage0PResults;
      case 2: return this.stage1Results;
      case 3: return this.stage2Results;
      default: return null;
    }
  }

  getAllScanResults() {
    return {
      0: this.stage0Results,
      1: this.stage0PResults,
      2: this.stage1Results,
      3: this.stage2Results
    };
  }

  getSettings() {
    return this.settings;
  }

  async updateSettings(settings: any) {
    const oldBinance = this.settings.binance || {};
    this.settings = settings;
    
    // 如果 API Key 或 Secret Key 发生变化，则重置仓位模式检查标记
    const apiKeyChanged = settings.binance?.apiKey !== oldBinance.apiKey;
    const secretKeyChanged = settings.binance?.secretKey !== oldBinance.secretKey;
    if (apiKeyChanged || secretKeyChanged) {
      this.settings.binance.positionModeChecked = false;
    }
    
    this.binance = new BinanceService(settings.binance);
    
    // Save to database
    await dbService.saveSettings(this.settings, `settings_${this.accountId}`).catch(err => {
      console.error(`Failed to save settings to database for [${this.accountId}]:`, err);
    });

    if (this.onUpdate) {
      this.onUpdate('settings', this.settings);
    }

    this.addLog('系统', '设置已更新并同步至数据库', 'info');

    // 如果引擎正在运行，重新初始化连接以确保配置生效
    if (this.isRunning) {
      if (apiKeyChanged || secretKeyChanged) {
        // 如果更换了API Key，重新检查仓位模式
        this.ensureOneWayPositionMode().catch(e => {
          this.addLog('系统', `更新API Key后检查仓位模式失败: ${e.message}`, 'error');
        });
      }

      this.addLog('系统', '正在重新初始化连接以应用新设置...', 'info');
      // 不使用 await，避免阻塞调用者（如 API 响应）
      this.initWebSocket().catch(e => {
        this.addLog('WebSocket', `更新设置后重连失败: ${e.message}`, 'error');
      });
      this.fetchAccountData().catch(() => {});
      this.checkApiStatus().catch(() => {});
    }
  }

  async searchTradeLogsLocally(symbol?: string, startTime?: number, endTime?: number) {
    this.addLog('系统', `正在从本地数据库搜索交易日志... ${symbol && symbol !== 'ALL' ? '币种: ' + symbol : ''}`, 'info');
    
    try {
      const searchSymbol = symbol === 'ALL' ? undefined : symbol;
      const logs = await dbService.getTradeLogs(this.accountId, searchSymbol, startTime, endTime);
      
      // 更新内存中的日志（合并新发现的日志）
      let addedCount = 0;
      logs.forEach(log => {
        if (!this.tradeLogs.find(t => t.id === log.id)) {
          this.tradeLogs.push(log);
          addedCount++;
        }
      });

      if (addedCount > 0) {
        // 重新排序
        this.tradeLogs.sort((a, b) => b.openTime - a.openTime);
        if (this.onUpdate) {
          this.onUpdate('tradeLogs', this.tradeLogs);
        }
      }

      this.addLog('系统', `本地搜索完成，共找到 ${logs.length} 条记录${addedCount > 0 ? `，其中 ${addedCount} 条已同步到当前视图` : ''}`, 'success');
      return logs;
    } catch (error: any) {
      this.addLog('系统', `本地搜索失败: ${error.message}`, 'error');
      return [];
    }
  }

  getLogs() {
    return this.logs;
  }

  getTradeLogs() {
    return this.tradeLogs;
  }

  getTransferLogs() {
    return this.transferLogs;
  }

  async transferToSpot(amount: string) {
    try {
      const result = await this.binance.transferToSpot(amount);
      this.addLog('划转', `成功划转 ${amount} USDT 到现货账户`, 'success');
      
      // Record in transfer logs
      const log: TransferLog = {
        id: Math.random().toString(36).substr(2, 9),
        asset: 'USDT',
        amount: parseFloat(amount),
        type: 'OUT',
        status: 'SUCCESS',
        timestamp: Date.now(),
        message: '手动划转: 合约 -> 现货'
      };
      this.transferLogs.unshift(log);
      if (this.transferLogs.length > 1000) this.transferLogs.pop();
      dbService.saveTransferLog(log).catch(err => console.error('Failed to save transfer log:', err));
      if (this.onUpdate) this.onUpdate('transferLogs', this.transferLogs);

      this.fetchAccountData();
      return result;
    } catch (error: any) {
      this.addLog('划转', `划转失败: ${error.message}`, 'error');
      
      // Record failed attempt
      const log: TransferLog = {
        id: Math.random().toString(36).substr(2, 9),
        asset: 'USDT',
        amount: parseFloat(amount),
        type: 'OUT',
        status: 'FAILED',
        timestamp: Date.now(),
        message: `手动划转失败: ${error.message}`
      };
      this.transferLogs.unshift(log);
      dbService.saveTransferLog(log).catch(err => console.error('Failed to save transfer log:', err));
      if (this.onUpdate) this.onUpdate('transferLogs', this.transferLogs);
      
      throw error;
    }
  }

  async transferToFutures(amount: string) {
    try {
      const result = await this.binance.transferToFutures(amount);
      this.addLog('划转', `成功划转 ${amount} USDT 到合约账户`, 'success');
      
      // Record in transfer logs
      const log: TransferLog = {
        id: Math.random().toString(36).substr(2, 9),
        asset: 'USDT',
        amount: parseFloat(amount),
        type: 'IN',
        status: 'SUCCESS',
        timestamp: Date.now(),
        message: '手动划转: 现货 -> 合约'
      };
      this.transferLogs.unshift(log);
      if (this.transferLogs.length > 1000) this.transferLogs.pop();
      dbService.saveTransferLog(log).catch(err => console.error('Failed to save transfer log:', err));
      if (this.onUpdate) this.onUpdate('transferLogs', this.transferLogs);

      this.fetchAccountData();
      return result;
    } catch (error: any) {
      this.addLog('划转', `划转失败: ${error.message}`, 'error');

      // Record failed attempt
      const log: TransferLog = {
        id: Math.random().toString(36).substr(2, 9),
        asset: 'USDT',
        amount: parseFloat(amount),
        type: 'IN',
        status: 'FAILED',
        timestamp: Date.now(),
        message: `手动划转失败: ${error.message}`
      };
      this.transferLogs.unshift(log);
      dbService.saveTransferLog(log).catch(err => console.error('Failed to save transfer log:', err));
      if (this.onUpdate) this.onUpdate('transferLogs', this.transferLogs);

      throw error;
    }
  }

  async clearTradeLogs() {
    this.tradeLogs = [];
    await dbService.clearAllLogs().catch(err => {
      console.error('Failed to clear logs from database:', err);
    });
    this.addLog('系统', '交易日志已清空', 'info');
    if (this.onUpdate) {
      this.onUpdate('tradeLogs', this.tradeLogs);
    }
  }

  async clearTransferLogs() {
    this.transferLogs = [];
    await dbService.clearAllTransferLogs().catch(err => {
      console.error('Failed to clear transfer logs from database:', err);
    });
    this.addLog('系统', '资金划转日志已清空', 'info');
    if (this.onUpdate) {
      this.onUpdate('transferLogs', this.transferLogs);
    }
  }

  clearLogs() {
    this.logs = [];
    this.addLog('系统', '日志已清空', 'info');
    if (this.onUpdate) {
      this.onUpdate('logs', this.logs);
    }
  }

  private async checkAndRecordBalance() {
    const now = new Date();
    const minutes = now.getMinutes();
    const hour = now.getHours();

    if (minutes === 18 && this.lastBalanceRecordHour !== hour) {
      const totalBalance = parseFloat(this.accountData.totalBalance);
      if (isNaN(totalBalance) || totalBalance === 0) return;

      const spotPriceBalance = parseFloat(this.accountData.spotBalance || '0');

      this.lastBalanceRecordHour = hour;
      const log: BalanceLog = {
        id: Math.random().toString(36).substr(2, 9),
        totalBalance,
        spotBalance: isNaN(spotPriceBalance) ? 0 : spotPriceBalance,
        timestamp: Date.now()
      };

      this.balanceLogs.push(log);
      if (this.balanceLogs.length > 5000) this.balanceLogs.shift();

      this.addLog('系统', `每小时 18 分余额记录: ${totalBalance.toFixed(2)} USDT`, 'info');

      // Persist to database
      dbService.saveBalanceLog(log, this.accountId).catch(err => {
        console.error(`[${this.accountId}] Failed to save balance log to database:`, err);
      });

      if (this.onUpdate) {
        this.onUpdate('balanceLogs', this.balanceLogs);
      }
    }
  }

  getStage0Results() {
    return this.stage0Results;
  }

  getStage0PResults() {
    return this.stage0PResults;
  }

  getBalanceLogs() {
    return this.balanceLogs;
  }

  async searchBalanceLogs(startTime: number, endTime: number, onlySnapshot: boolean = false) {
    return dbService.getBalanceLogsFiltered(this.accountId, startTime, endTime, onlySnapshot);
  }

  clearBalanceLogs() {
    this.balanceLogs = [];
    dbService.clearAllBalanceLogs().catch(err => {
      console.error('Failed to clear balance logs in database:', err);
    });
    if (this.onUpdate) {
      this.onUpdate('balanceLogs', this.balanceLogs);
    }
  }

  getSystemStatus() {
    const status = {
      isRunning: this.isRunning,
      apiConnected: this.apiConnected,
      wsConnected: this.wsConnected,
      lastScanTime: this.lastScanTime,
      currentPosition: this.currentPosition,
      lastUpdate: Date.now(),
    };
    
    if (this.onUpdate) {
      this.onUpdate('status', status);
    }
    
    return status;
  }

  getAccountData() {
    return this.accountData;
  }
}
