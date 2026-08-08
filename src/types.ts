export interface BinanceSettings {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  wsUrl: string;
  positionModeChecked?: boolean; // 新增：是否已经检查并修复过仓位模式
}

export interface ScannerSettings {
  stage0: {
    interval: string;
    startTime: string;
    klinePeriod: string;
    minKlines: number;
    maxKlines: number;
    includeTradFi: boolean;
  };
  stage0P: {
    enabled: boolean;
    interval: string;
    startTime: string;
    periods: {
      [key: string]: {
        enabled: boolean;
        count: number;
        threshold: number;
      };
    };
    abnormalMove?: {
      enabled: boolean;
      lookbackHours: number;    // 考察时长 (如 10)
      windowMinutes: number;    // 统计区间 (如 60)
      maxPump: number;         // 最大涨幅 (%)
      maxDrop: number;         // 最大跌幅 (%)
    };
  };
  stage1: {
    interval: string;
    startTime: string;
    minVolumeM1: number;
    priceChangeK1: [number, number];
    whitelist: string[];
    blacklist: string[];
  };
  stage2: {
    enabled?: boolean;
    interval: string;
    startTime: string;
    cooldown: number;
    preferredMode?: 'volume' | 'amp'; // 优选模式
    amplitudeMode?: 'bottomHigh' | 'highLow'; // 振幅计算方式：bottomHigh (底高模式) | highLow (高低模式)
    strategyPriority?: 'amplitude' | 'singleK'; // 策略优先级：amplitude (振幅策略优先) | singleK (单K策略优先)
    sharedTableMode?: 'master_snapshot' | 'independent'; // 目标表指标数据模式：master_snapshot (完全一致模式 - 共享主账户快照) | independent (独立实时模式)
    conditions: {
      amp: { enabled: boolean; range: [number, number] };
      ampSell?: { enabled: boolean; range: [number, number] };
      longShort: { enabled: boolean; buyEnabled: boolean; buy: number; sellEnabled: boolean; sell: number };
      m: { enabled: boolean; range: [number, number] };
      mSell?: { enabled: boolean; range: [number, number] };
      fundingRateOptimization?: {
        enabled: boolean;
        windowMinutes: number;
        shortThreshold: number; // Percent, e.g., -0.3
      };
      fundingRateOptimizationSell?: {
        enabled: boolean;
        windowMinutes: number;
        shortThreshold: number;
      };
    };
    singleK?: {
      enabled: boolean;
      preferredMode: 'volume' | 'change' | 'amp';
      k2: { enabled: boolean; range: [number, number] };
      a: { enabled: boolean; range: [number, number]; mode: 'fixed' | 'linkK' };
      m: { enabled: boolean; range: [number, number] };
      k2Sell?: { enabled: boolean; range: [number, number] };
      aSell?: { enabled: boolean; range: [number, number]; mode: 'fixed' | 'linkK' };
      mSell?: { enabled: boolean; range: [number, number] };
      fundingRateOptimizationSell?: {
        enabled: boolean;
        windowMinutes: number;
        shortThreshold: number;
      };
    };
  };
  timeControl: {
    enabled: boolean;
    hours?: boolean[];
    slots: boolean[];
    weekSlots?: {
      [day: number]: boolean[];
    };
    mode: '+2' | '-2';
  };
}

export interface OrderSettings {
  leverage: number;
  positionRatio: number;
  maxPosition: number;
  tpModeBuy: 'ratio' | 'fixed' | 'amp';
  tpModeSell: 'ratio' | 'fixed' | 'amp';
  tpRatioBuy: number;
  tpRatioSell: number;
  tpFixedBuy: number;
  tpFixedSell: number;
  tpAmpBuy?: number;
  tpAmpSell?: number;
  tpEnabled?: boolean; // 新增：是否开启止盈挂单
  tpBuyEnabled?: boolean;
  tpSellEnabled?: boolean;
  slModeBuy: 'ratio' | 'fixed' | 'amp';
  slModeSell: 'ratio' | 'fixed' | 'amp';
  slRatioBuy: number;
  slRatioSell: number;
  slFixedBuy: number;
  slFixedSell: number;
  slAmpBuy?: number;
  slAmpSell?: number;
  slEnabled?: boolean; // 新增：是否开启止损挂单
  slBuyEnabled?: boolean;
  slSellEnabled?: boolean;
  mLinkEnabled?: boolean; // 新增：关联M生效
  mLinkValue?: number; // 新增：关联M值
  positiveWindow: number;
  maxHoldTime: number;
  kBestPeriod: string;
  kBestWindow: [number, number];
  tpSlCalcMode?: 'closedK' | 'stage2';
  preferredOrderCount?: number; // 优选下单数量限制，默认是2
  sameDirectionOnly?: boolean; // 新增：同向开关 (默认关闭)
  singleKMLinkEnabled?: boolean; // 新增：单K关联M生效
  singleKMLinkValue?: number; // 新增：单K关联M值
  singleKTpEnabled?: boolean; // 新增：单K是否开启止盈挂单
  singleKTpModeBuy?: 'ratio' | 'fixed' | 'amp'; // 新增：单K多单止盈模式
  singleKTpModeSell?: 'ratio' | 'fixed' | 'amp'; // 新增：单K空单止盈模式
  singleKTpBuyEnabled?: boolean; // 新增：单K多单止盈是否启用
  singleKTpSellEnabled?: boolean; // 新增：单K空单止盈是否启用
  singleKTpRatioBuy?: number; // 新增：单K多比例止盈值
  singleKTpRatioSell?: number; // 新增：单K空比例止盈值
  singleKTpFixedBuy?: number; // 新增：单K多固定值止盈
  singleKTpFixedSell?: number; // 新增：单K空固定值止盈
  singleKTpAmpBuy?: number; // 新增：单K多振比止盈
  singleKTpAmpSell?: number; // 新增：单K空振比止盈
  singleKSlEnabled?: boolean; // 新增：单K是否开启止损挂单
  singleKSlModeBuy?: 'ratio' | 'fixed' | 'amp'; // 新增：单K多单止损模式
  singleKSlModeSell?: 'ratio' | 'fixed' | 'amp'; // 新增：单K空单止损模式
  singleKSlBuyEnabled?: boolean; // 新增：单K多单止损是否启用
  singleKSlSellEnabled?: boolean; // 新增：单K空单止损是否启用
  singleKSlRatioBuy?: number; // 新增：单K多比例止损值
  singleKSlRatioSell?: number; // 新增：单K空比例止损值
  singleKSlFixedBuy?: number; // 新增：单K多固定值止损
  singleKSlFixedSell?: number; // 新增：单K空固定值止损
  singleKSlAmpBuy?: number; // 新增：单K多振比止损
  singleKSlAmpSell?: number; // 新增：单K空振比止损
  secondOrderCustomEnabled?: boolean; // 是否对第二个仓单启用独立自定义设置
  secondLeverage?: number; // 第二仓单杠杆倍数
  secondPositionRatio?: number; // 第二仓单仓位比例 (%)
  secondMaxPosition?: number; // 第二仓单最大仓位额 (USDT)
  secondMaxHoldTime?: number; // 第二仓单最大持仓时间 (min)
  secondMLinkEnabled?: boolean; // 第二仓单关联M生效
  secondMLinkValue?: number; // 第二仓单关联M值
  secondTpEnabled?: boolean; // 第二仓单是否开启止盈
  secondTpModeBuy?: 'ratio' | 'fixed' | 'amp';
  secondTpModeSell?: 'ratio' | 'fixed' | 'amp';
  secondTpBuyEnabled?: boolean;
  secondTpSellEnabled?: boolean;
  secondTpRatioBuy?: number;
  secondTpRatioSell?: number;
  secondTpFixedBuy?: number;
  secondTpFixedSell?: number;
  secondTpAmpBuy?: number;
  secondTpAmpSell?: number;
  secondSlEnabled?: boolean; // 第二仓单是否开启止损
  secondSlModeBuy?: 'ratio' | 'fixed' | 'amp';
  secondSlModeSell?: 'ratio' | 'fixed' | 'amp';
  secondSlBuyEnabled?: boolean;
  secondSlSellEnabled?: boolean;
  secondSlRatioBuy?: number;
  secondSlRatioSell?: number;
  secondSlFixedBuy?: number;
  secondSlFixedSell?: number;
  secondSlAmpBuy?: number;
  secondSlAmpSell?: number;
  secondSingleKMLinkEnabled?: boolean;
  secondSingleKMLinkValue?: number;
  secondSingleKTpEnabled?: boolean;
  secondSingleKTpModeBuy?: 'ratio' | 'fixed' | 'amp';
  secondSingleKTpModeSell?: 'ratio' | 'fixed' | 'amp';
  secondSingleKTpBuyEnabled?: boolean;
  secondSingleKTpSellEnabled?: boolean;
  secondSingleKTpRatioBuy?: number;
  secondSingleKTpRatioSell?: number;
  secondSingleKTpFixedBuy?: number;
  secondSingleKTpFixedSell?: number;
  secondSingleKTpAmpBuy?: number;
  secondSingleKTpAmpSell?: number;
  secondSingleKSlEnabled?: boolean;
  secondSingleKSlModeBuy?: 'ratio' | 'fixed' | 'amp';
  secondSingleKSlModeSell?: 'ratio' | 'fixed' | 'amp';
  secondSingleKSlBuyEnabled?: boolean;
  secondSingleKSlSellEnabled?: boolean;
  secondSingleKSlRatioBuy?: number;
  secondSingleKSlRatioSell?: number;
  secondSingleKSlFixedBuy?: number;
  secondSingleKSlFixedSell?: number;
  secondSingleKSlAmpBuy?: number;
  secondSingleKSlAmpSell?: number;
  winStreakThreshold?: number; // 连赢单阈值 (默认 20)
  sweepSkipCount?: number;     // 扫跳次数 (默认 0)
  trailingStartMinutes?: number; // 启动追踪时间 (默认 3分钟)
  trailingCloseRatio?: number;   // 追踪平仓系数 (默认是 0)
  enableExpiryPrice?: boolean;   // 新增：到期价格记录开关 (默认开启)
}

export interface EmailSettings {
  enabled: boolean;
  sender: string;
  receiver: string;
  smtpServer: string;
  smtpPort: number;
  password: string;
  minBalance: number;
  maxConsecutiveLoss: number;
}

export interface WithdrawalSettings {
  withdrawalThreshold: number;
  retentionThreshold: number;
  alarmThreshold: number;
  depositAmount?: number; // 补款金额 (默认 30)
}

export interface AccountConfig {
  id: string;
  name: string;
  enabled: boolean;
  isMasterAccount?: boolean; // 新增：指定为主账户
  binance: BinanceSettings;
  scanner: ScannerSettings;
  order: OrderSettings;
  withdrawal: WithdrawalSettings;
}

export interface RemoteControlSettings {
  enabled: boolean;
  secretKey: string;
  allowedIps: string;
}

export interface AppSettings {
  appName?: string;
  accounts: AccountConfig[];
  email: EmailSettings;
  auth: {
    username: string;
    password: string;
  };
  remoteControl?: RemoteControlSettings;
}

export interface TradeLog {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  leverage: number;
  amount: number;
  entryPrice: number;
  exitPrice: number;
  expiryPrice?: number; // 新增：到期时刻最新价格
  pnl: number;
  fee: number;
  fundingFee: number;
  fundingFeeCheckedCount?: number; // 新增：记录资金费查询次数
  fundingRate?: number; // 新增：当前资金费率
  profitRate: number;
  kBestChange?: number; // 新增：K优涨跌幅
  amp?: number; // 新增：振幅
  mValue?: number; // 新增：M值
  realA?: number; // 新增：真实A
  k2?: number; // 新增：k2值
  openTime: number;
  closeTime: number;
  status: 'OPEN' | 'CLOSED' | 'SKIPPED' | 'TP' | 'SL' | 'TIMEOUT' | 'TRAILING';
  isSkipMark?: boolean;
  tpOrderId?: string; // 关联的止盈单订单号
  slOrderId?: string; // 关联的止损单订单号
  strategyType?: 'amplitude' | 'singleK' | string; // 策略类型：amplitude (振幅) / singleK (单K)
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'info' | 'success' | 'warning' | 'error';
  module: string;
  message: string;
  details?: any;
}

export interface Position {
  symbol: string;
  amount: number;
  entryPrice: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
}

export interface Order {
  symbol: string;
  orderId: number;
  type: string;
  side: string;
  price: string;
  stopPrice?: string;
  timestamp: number;
}

export interface TransferLog {
  id: string;
  asset: string;
  amount: number;
  type: 'IN' | 'OUT'; // IN: Spot to Futures, OUT: Futures to Spot
  status: 'SUCCESS' | 'FAILED';
  timestamp: number;
  message?: string;
}

export interface BalanceLog {
  id: string;
  totalBalance: number;
  timestamp: number;
  spotBalance?: number;
}

export interface Kline {
  symbol: string;
  interval: string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
  change?: number; // 新增：涨跌幅
  amplitude?: number; // 新增：振幅
}
