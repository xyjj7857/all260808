import React, { useState, useMemo, useEffect } from 'react';
import { LineChart as ChartIcon, Download, TrendingUp, ArrowLeftRight, Trash2, Calendar, Search, RefreshCw } from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  Label
} from 'recharts';

interface BalanceLog {
  id: string;
  totalBalance: number;
  timestamp: number;
  spotBalance?: number;
}

interface TransferLog {
  id: string;
  asset: string;
  amount: number;
  type: 'IN' | 'OUT';
  status: 'SUCCESS' | 'FAILED';
  timestamp: number;
  message?: string;
}

function CandlestickChart({ 
  data, 
  transfers = [], 
  width = 800, 
  height = 400 
}: { 
  data: any[], 
  transfers?: any[], 
  width?: number, 
  height?: number 
}) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0 });

  const paddingLeft = 70;
  const paddingRight = 30;
  const paddingTop = 30;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        暂无K线数据
      </div>
    );
  }

  // Get min and max across all candles
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const absMax = Math.max(...highs);
  const absMin = Math.min(...lows);
  const range = absMax - absMin;
  const padding = range * 0.1 || 10;
  
  const yMin = Math.max(0, absMin - padding);
  const yMax = absMax + padding;

  const mapY = (val: number) => {
    return paddingTop + chartHeight - ((val - yMin) / (yMax - yMin)) * chartHeight;
  };

  const cellWidth = chartWidth / data.length;
  const bodyWidth = Math.min(Math.max(cellWidth * 0.5, 6), 36);

  // Generate 4 evenly spaced ticks
  const yTicks = [
    yMin,
    yMin + (yMax - yMin) * 0.333,
    yMin + (yMax - yMin) * 0.666,
    yMax
  ];

  const formatXLabel = (timeStr: string) => {
    const match = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return `${match[2]}/${match[3]}`;
    const weekMatch = timeStr.match(/W(\d+)\s*\(周一\s*(\d{2}-\d{2})\)/);
    if (weekMatch) return `W${weekMatch[1]} (${weekMatch[2]})`;
    return timeStr;
  };

  return (
    <div className="relative w-full h-full select-none" style={{ width, height }}>
      <svg width={width} height={height} className="overflow-visible">
        {/* Horizontal grid lines */}
        {yTicks.map((tick, i) => {
          const y = mapY(tick);
          return (
            <g key={i}>
              <line 
                x1={paddingLeft} 
                y1={y} 
                x2={width - paddingRight} 
                y2={y} 
                stroke="#f8fafc" 
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <text 
                x={paddingLeft - 10} 
                y={y + 4} 
                textAnchor="end" 
                className="fill-slate-400 font-mono text-[10px] font-semibold"
              >
                ${tick.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
              </text>
            </g>
          );
        })}

        {/* X Axis line */}
        <line 
          x1={paddingLeft} 
          y1={height - paddingBottom} 
          x2={width - paddingRight} 
          y2={height - paddingBottom} 
          stroke="#f1f5f9" 
          strokeWidth={1}
        />

        {/* Candles and vertical bars */}
        {data.map((d, i) => {
          const cx = paddingLeft + i * cellWidth + cellWidth / 2;
          const yHigh = mapY(d.high);
          const yLow = mapY(d.low);
          const yOpen = mapY(d.open);
          const yClose = mapY(d.close);
          const isUp = d.close >= d.open;
          const color = isUp ? '#10b981' : '#ef4444';
          const isHovered = hoveredIdx === i;

          return (
            <g 
              key={d.time}
              onMouseEnter={(e) => {
                setHoveredIdx(i);
                setTooltipPos({ x: cx, y: Math.min(yOpen, yClose) });
              }}
              onMouseLeave={() => setHoveredIdx(null)}
              className="cursor-pointer"
            >
              {/* Highlight bar on hover */}
              {isHovered && (
                <rect 
                  x={paddingLeft + i * cellWidth}
                  y={paddingTop}
                  width={cellWidth}
                  height={chartHeight}
                  fill="#f1f5f9"
                  opacity={0.5}
                />
              )}

              {/* Wick */}
              <line 
                x1={cx} 
                y1={yHigh} 
                x2={cx} 
                y2={yLow} 
                stroke={color} 
                strokeWidth={1.5} 
              />

              {/* Candle Body */}
              <rect 
                x={cx - bodyWidth / 2} 
                y={Math.min(yOpen, yClose)} 
                width={bodyWidth} 
                height={Math.max(Math.abs(yOpen - yClose), 2)} 
                fill={color} 
                rx={2}
                className="transition-all duration-150"
                style={{
                  filter: isHovered ? `drop-shadow(0 0 6px ${color}50)` : 'none'
                }}
              />

              {/* X Axis Label */}
              <text 
                x={cx} 
                y={height - paddingBottom + 20} 
                textAnchor="middle" 
                className="fill-slate-500 font-sans text-[10px] font-bold"
              >
                {formatXLabel(d.time)}
              </text>
            </g>
          );
        })}

        {/* Transfer Reference Lines */}
        {transfers.map((t) => {
          if (!t.timestamp) return null;
          
          let targetIndex = -1;
          for (let i = 0; i < data.length; i++) {
            const logs = data[i].logs || [];
            if (logs.length === 0) continue;
            const start = logs[0].timestamp;
            const end = logs[logs.length - 1].timestamp;
            
            if (t.timestamp >= start && t.timestamp <= end) {
              targetIndex = i;
              break;
            }
          }
          
          if (targetIndex === -1) {
            let minDiff = Infinity;
            data.forEach((d, idx) => {
              const logs = d.logs || [];
              if (logs.length > 0) {
                const mid = (logs[0].timestamp + logs[logs.length - 1].timestamp) / 2;
                const diff = Math.abs(t.timestamp - mid);
                if (diff < minDiff) {
                  minDiff = diff;
                  targetIndex = idx;
                }
              }
            });
          }

          if (targetIndex === -1) return null;

          const cx = paddingLeft + targetIndex * cellWidth + cellWidth / 2;
          const strokeColor = t.type === 'IN' ? '#10b981' : '#ef4444';

          return (
            <g key={t.id}>
              <line 
                x1={cx} 
                y1={paddingTop} 
                x2={cx} 
                y2={height - paddingBottom} 
                stroke={strokeColor} 
                strokeDasharray="3 3" 
                strokeWidth={1.5}
              />
              <circle 
                cx={cx} 
                cy={paddingTop + 10} 
                r={4} 
                fill={strokeColor} 
              />
            </g>
          );
        })}
      </svg>

      {/* Floating Tooltip */}
      {hoveredIdx !== null && (
        <div 
          className="absolute z-50 bg-white border border-slate-100 p-4 rounded-2xl shadow-2xl ring-1 ring-black/5 pointer-events-none transition-all duration-75 text-xs font-semibold"
          style={{
            left: `${tooltipPos.x + 15}px`,
            top: `${Math.min(tooltipPos.y, height - 180)}px`,
            transform: tooltipPos.x + 15 + 200 > width ? 'translateX(-230px)' : 'none'
          }}
        >
          <div className="border-b border-slate-100 pb-2 mb-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{data[hoveredIdx].time}</p>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between gap-8">
              <span className="text-slate-500">开盘:</span>
              <span className="font-mono text-slate-800">${data[hoveredIdx].open.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between gap-8">
              <span className="text-slate-500">收盘:</span>
              <span className="font-mono text-slate-800 font-bold">${data[hoveredIdx].close.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between gap-8">
              <span className="text-slate-500">最高:</span>
              <span className="font-mono text-emerald-600">${data[hoveredIdx].high.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between gap-8">
              <span className="text-slate-500">最低:</span>
              <span className="font-mono text-red-500">${data[hoveredIdx].low.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between gap-8 border-t border-slate-50 pt-1 mt-1">
              <span className="text-slate-500">振幅:</span>
              <span className="font-mono text-amber-600 font-bold">{data[hoveredIdx].amplitude.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between gap-8">
              <span className="text-slate-500">涨跌:</span>
              <span className={`font-mono font-bold ${data[hoveredIdx].close >= data[hoveredIdx].open ? 'text-emerald-500' : 'text-red-500'}`}>
                {data[hoveredIdx].close >= data[hoveredIdx].open ? '+' : ''}{data[hoveredIdx].change.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BalanceHistory({ 
  balanceLogs = [], 
  transferLogs = [],
  account,
  onClearTransfers,
  accountId
}: { 
  balanceLogs?: BalanceLog[], 
  transferLogs?: TransferLog[],
  account: any,
  onClearTransfers: () => void,
  accountId: string
}) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Balance Search State
  const [balanceStartTime, setBalanceStartTime] = useState('');
  const [balanceEndTime, setBalanceEndTime] = useState('');
  const [searchResults, setSearchResults] = useState<BalanceLog[] | null>(null);
  const [isSearchingBalance, setIsSearchingBalance] = useState(false);

  // Tabs structure: 'trend' (Continuous trend list) vs 'periods' (Candlestick Analysis)
  const [activeTab, setActiveTab] = useState<'trend' | 'periods'>('trend');
  const [periodType, setPeriodType] = useState<'day' | 'week' | 'month'>('day');
  const [periodViewMode, setPeriodViewMode] = useState<'chart' | 'table'>('chart');

  const totalBalance = account?.totalBalance || '0.00';
  const spotBalance = account?.spotBalance || '0.00';

  // Default view: Last 24 hours of logs
  const displayBalanceLogs = useMemo(() => {
    if (searchResults !== null) return searchResults;
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    return balanceLogs.filter(log => log.timestamp >= twentyFourHoursAgo);
  }, [balanceLogs, searchResults]);

  // Query database: Set onlySnapshot=false to get ALL intermediate hourly logs in order to compute candle H/L accurately
  const handleSearchBalance = async () => {
    if (!balanceStartTime || !balanceEndTime) {
      alert('请选择开始和结束时间');
      return;
    }
    setIsSearchingBalance(true);
    try {
      const start = new Date(balanceStartTime).getTime();
      const end = new Date(balanceEndTime).getTime();
      const res = await fetch(`/api/balance-logs/search?startTime=${start}&endTime=${end}&onlySnapshot=false&accountId=${accountId}`);
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error('Search balance logs error:', err);
      alert('查询失败');
    } finally {
      setIsSearchingBalance(false);
    }
  };

  const resetBalanceSearch = () => {
    setSearchResults(null);
    setBalanceStartTime('');
    setBalanceEndTime('');
  };

  const filteredTransferLogs = useMemo(() => {
    return transferLogs.filter(log => {
      const matchesSearch = log.asset.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           log.message?.toLowerCase().includes(searchTerm.toLowerCase());
      const logTime = log.timestamp;
      
      let matchesTime = true;
      if (startTime) {
        const start = new Date(startTime).getTime();
        if (logTime < start) matchesTime = false;
      }
      if (endTime) {
        const end = new Date(endTime).getTime();
        if (logTime > end) matchesTime = false;
      }
      
      return matchesSearch && matchesTime;
    });
  }, [transferLogs, searchTerm, startTime, endTime]);

  const formatMs = (ts: number) => {
    if (!ts || ts === 0) return '--';
    const date = new Date(ts + 8 * 3600 * 1000);
    return date.toISOString().replace('T', ' ').substring(0, 19);
  };

  const handleExportBalance = () => {
    if (displayBalanceLogs.length === 0) return;
    
    const headers = ['时间', '主要余额(USDT)', '现货余额(USDT)', '总额+现货(USDT)'];
    const rows = displayBalanceLogs.map(log => {
      const liveSpot = log.spotBalance || 0;
      return [
        new Date(log.timestamp).toLocaleString(),
        log.totalBalance.toFixed(2),
        liveSpot.toFixed(2),
        (log.totalBalance + liveSpot).toFixed(2)
      ];
    });
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `balance_history_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadTransferCSV = () => {
    if (filteredTransferLogs.length === 0) return;
    
    const headers = ['ID', '资产', '数量', '类型', '状态', '时间', '备注'];
    const rows = filteredTransferLogs.map(log => [
      log.id,
      log.asset,
      log.amount,
      log.type === 'IN' ? '现货 -> 合约' : '合约 -> 现货',
      log.status === 'SUCCESS' ? '成功' : '失败',
      formatMs(log.timestamp),
      log.message || ''
    ]);
    
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `transfer_logs_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Continuous "总余额 + 现货" rendering data
  const chartData = useMemo(() => {
    return displayBalanceLogs.map(log => {
      const sum = log.totalBalance + (log.spotBalance || 0);
      return {
        time: searchResults 
          ? new Date(log.timestamp).toLocaleDateString([], { month: '2-digit', day: '2-digit' })
          : new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fullTime: new Date(log.timestamp).toLocaleString(),
        balance: parseFloat(sum.toFixed(2)),
        timestamp: log.timestamp
      };
    });
  }, [displayBalanceLogs, searchResults]);

  const currentSumValue = parseFloat(totalBalance) + parseFloat(spotBalance);
  const minBalance = Math.min(...chartData.map(d => d.balance), currentSumValue) * 0.995;
  const maxBalance = Math.max(...chartData.map(d => d.balance), currentSumValue) * 1.005;

  // Grouping algorithm for candle analysis:
  // - A trading day begins at 8:18 AM local time of day N and ends at 8:18 AM local time of day N+1.
  const candlestickData = useMemo(() => {
    if (displayBalanceLogs.length === 0) return [];

    const groups: { [key: string]: BalanceLog[] } = {};

    displayBalanceLogs.forEach(log => {
      const d = new Date(log.timestamp);
      const year = d.getFullYear();
      const month = d.getMonth();
      const date = d.getDate();

      // Anchor daily boundary at 8:18 local time
      const boundaryToday = new Date(year, month, date, 8, 18, 0, 0).getTime();
      let refDate: Date;
      if (log.timestamp < boundaryToday) {
        refDate = new Date(year, month, date - 1);
      } else {
        refDate = new Date(year, month, date);
      }

      let key = '';
      if (periodType === 'day') {
        const y = refDate.getFullYear();
        const m = String(refDate.getMonth() + 1).padStart(2, '0');
        const r = String(refDate.getDate()).padStart(2, '0');
        key = `${y}-${m}-${r}`;
      } else if (periodType === 'week') {
        // Find Monday of the week
        const day = refDate.getDay();
        const diff = refDate.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(refDate.setDate(diff));
        const y = monday.getFullYear();
        const m = String(monday.getMonth() + 1).padStart(2, '0');
        const r = String(monday.getDate()).padStart(2, '0');
        
        // Compute ISO week number
        const dateCopy = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
        dateCopy.setUTCDate(dateCopy.getUTCDate() + 4 - (dateCopy.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(dateCopy.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((dateCopy.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        
        key = `${y} 年 W${weekNo} (周一 ${m}-${r})`;
      } else {
        // month
        const y = refDate.getFullYear();
        const m = String(refDate.getMonth() + 1).padStart(2, '0');
        key = `${y} 年 ${m} 月`;
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(log);
    });

    // Process candle values
    const list = Object.keys(groups).map(key => {
      const sortedLogs = groups[key].sort((a, b) => a.timestamp - b.timestamp);
      const getSum = (item: BalanceLog) => item.totalBalance + (item.spotBalance || 0);

      const firstLog = sortedLogs[0];
      const lastLog = sortedLogs[sortedLogs.length - 1];

      const openVal = getSum(firstLog);
      const closeVal = getSum(lastLog);

      let maxVal = openVal;
      let minVal = openVal;
      sortedLogs.forEach(lg => {
        const sumVal = getSum(lg);
        if (sumVal > maxVal) maxVal = sumVal;
        if (sumVal < minVal) minVal = sumVal;
      });

      const open = parseFloat(openVal.toFixed(2));
      const close = parseFloat(closeVal.toFixed(2));
      const high = parseFloat(maxVal.toFixed(2));
      const low = parseFloat(minVal.toFixed(2));

      // Calculate change is close vs open
      const change = open > 0 ? parseFloat((((close - open) / open) * 100).toFixed(2)) : 0;
      // Calculate amplitude is (high - low) vs open
      const amplitude = open > 0 ? parseFloat((((high - low) / open) * 100).toFixed(2)) : 0;

      return {
        time: key,
        open,
        close,
        high,
        low,
        change,
        amplitude,
        logs: sortedLogs
      };
    });

    // Chronological order based on earliest log timestamp in group
    return list.sort((a, b) => a.logs[0].timestamp - b.logs[0].timestamp);
  }, [displayBalanceLogs, periodType]);

  const chartStartTime = displayBalanceLogs.length > 0 ? displayBalanceLogs[0].timestamp : 0;
  const chartEndTime = displayBalanceLogs.length > 0 ? displayBalanceLogs[displayBalanceLogs.length - 1].timestamp : Date.now();
  const relevantTransfers = transferLogs.filter(t => 
    t.status === 'SUCCESS' && 
    t.timestamp >= chartStartTime && 
    t.timestamp <= chartEndTime
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {/* 1. Balance Chart Section */}
      <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <ChartIcon className="text-blue-500" size={28} />
              账户综合余额历史 (合约 + 现货)
            </h2>
            <p className="text-slate-500 text-sm font-medium mt-1">
              {searchResults ? `自定义历史区间 (${candlestickData.length} 期记录)` : '实时模式 (最近 24 小时记录)'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-slate-100 p-1 rounded-2xl flex">
              <button 
                type="button"
                onClick={() => setActiveTab('trend')}
                className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${activeTab === 'trend' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                趋势折线
              </button>
              <button 
                type="button"
                onClick={() => setActiveTab('periods')}
                className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${activeTab === 'periods' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                K线周月分析
              </button>
            </div>

            {searchResults && (
              <button 
                onClick={resetBalanceSearch}
                className="flex items-center gap-2 px-4 py-1.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95 cursor-pointer"
              >
                <RefreshCw size={14} />
                重置实时
              </button>
            )}
            <button 
              onClick={handleExportBalance}
              className="flex items-center gap-2 px-4 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-100 transition-all active:scale-95 cursor-pointer"
            >
              <Download size={14} />
              导出数据
            </button>
          </div>
        </div>

        {/* Balance Search Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">开始日期</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="date" 
                value={balanceStartTime}
                onChange={(e) => setBalanceStartTime(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">结束日期</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="date" 
                value={balanceEndTime}
                onChange={(e) => setBalanceEndTime(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="flex items-end">
            <button 
              onClick={handleSearchBalance}
              disabled={isSearchingBalance}
              className="w-full py-2 bg-slate-900 text-white rounded-xl font-black uppercase tracking-widest hover:bg-slate-800 shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSearchingBalance ? <RefreshCw className="animate-spin" size={16} /> : <Search size={16} />}
              查询与加载数据
            </button>
          </div>
        </div>

        {activeTab === 'periods' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 p-4 rounded-3xl gap-4 mb-6">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600">展示周期尺度:</span>
                <div className="bg-slate-200 p-0.5 rounded-xl flex gap-1">
                  <button 
                    type="button" 
                    onClick={() => setPeriodType('day')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodType === 'day' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    按日 (Day)
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setPeriodType('week')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodType === 'week' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    按周 (Week)
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setPeriodType('month')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodType === 'month' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    按月 (Month)
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:border-l sm:border-slate-200 sm:pl-6">
                <span className="text-xs font-bold text-slate-600">展示视图模式:</span>
                <div className="bg-slate-200 p-0.5 rounded-xl flex gap-1">
                  <button 
                    type="button" 
                    onClick={() => setPeriodViewMode('chart')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodViewMode === 'chart' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    图表视图
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setPeriodViewMode('table')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodViewMode === 'table' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    表格视图
                  </button>
                </div>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 font-medium sm:text-right">
              基于每日早上 08:18 起讫进行划分
            </div>
          </div>
        )}

        {activeTab === 'trend' ? (
          /* Trend Chart Render */
          <div className="h-[400px] w-full mt-4">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="time" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                    minTickGap={40}
                  />
                  <YAxis 
                    domain={[minBalance, maxBalance]} 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                    tickFormatter={(val) => `$${val.toLocaleString()}`}
                  />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-white border border-slate-100 p-4 rounded-2xl shadow-2xl ring-1 ring-black/5">
                            <p className="text-[10px] font-black text-slate-400 uppercase mb-1">{payload[0].payload.fullTime}</p>
                            <p className="text-sm font-semibold text-slate-600">综合总余额</p>
                            <p className="text-lg font-black text-blue-600">${payload[0].value.toLocaleString()}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  
                  {relevantTransfers.map((transfer) => {
                    const closestPoint = chartData.reduce((prev, curr) => 
                      Math.abs(curr.timestamp - transfer.timestamp) < Math.abs(prev.timestamp - transfer.timestamp) ? curr : prev
                    );
                    
                    return (
                      <ReferenceLine 
                        key={transfer.id}
                        x={closestPoint.time} 
                        stroke={transfer.type === 'IN' ? '#10b981' : '#ef4444'} 
                        strokeDasharray="3 3"
                        strokeWidth={2}
                      >
                        <Label 
                          value={transfer.type === 'IN' ? `+${transfer.amount}` : `-${transfer.amount}`} 
                          position="top" 
                          fill={transfer.type === 'IN' ? '#10b981' : '#ef4444'}
                          fontSize={10}
                          fontWeight="bold"
                        />
                      </ReferenceLine>
                    );
                  })}

                  <Area 
                    type="monotone" 
                    dataKey="balance" 
                    stroke="#3b82f6" 
                    strokeWidth={4}
                    fillOpacity={1} 
                    fill="url(#colorBalance)" 
                    animationDuration={1500}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center">
                  <ChartIcon size={32} className="text-slate-300" />
                </div>
                <p className="text-xs font-bold uppercase tracking-widest">等待记录第一条余额数据...</p>
              </div>
            )}
          </div>
        ) : (
          /* Candlestick / Period analysis render */
          <div className="space-y-6 mt-4">
            {candlestickData.length > 0 ? (
              periodViewMode === 'chart' ? (
                /* Candlestick Chart Render */
                <div className="h-[400px] w-full mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <CandlestickChart data={candlestickData} transfers={relevantTransfers} />
                  </ResponsiveContainer>
                </div>
              ) : (
                /* Candlestick / Period table view */
                <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/80 border-b border-slate-100">
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">周期节点</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">烛线示意</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">开盘 (本期首)</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">收盘 (本期末)</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">最高 record</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">最低 record</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">周期振幅</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">周期涨跌</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-xs">
                        {candlestickData.map((candle, idx) => {
                          const isUp = candle.close >= candle.open;
                          
                          // Compute percentages for interactive candle rendering
                          const rangeVal = candle.high - candle.low;
                          const hasRange = rangeVal > 0;
                          const wickTop = hasRange ? ((candle.high - Math.max(candle.open, candle.close)) / rangeVal) * 100 : 0;
                          const bodyHeight = hasRange ? (Math.abs(candle.open - candle.close) / rangeVal) * 100 : 100;

                          return (
                            <tr key={candle.time} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-4 font-sans font-bold text-slate-700">{candle.time}</td>
                              
                              {/* CSS-driven vector Spark-Candle preview column */}
                              <td className="px-6 py-4">
                                <div className="flex justify-center items-center h-10 w-16 mx-auto relative group" title={`H: ${candle.high}, L: ${candle.low}, O: ${candle.open}, C: ${candle.close}`}>
                                  {hasRange ? (
                                    <>
                                      {/* Wick Line */}
                                      <div className="absolute w-[2px] bg-slate-300 h-full left-1/2 -translate-x-1/2" />
                                      {/* Candle Body */}
                                      <div 
                                        className={`absolute w-3 rounded-sm ${isUp ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]'}`}
                                        style={{
                                          top: `${wickTop}%`,
                                          height: `${Math.max(bodyHeight, 6)}%`
                                        }}
                                      />
                                    </>
                                  ) : (
                                    <div className="w-3 h-1.5 rounded-sm bg-slate-400" />
                                  )}
                                </div>
                              </td>

                              <td className="px-6 py-4 font-bold text-slate-600">${candle.open.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-6 py-4 font-black text-slate-800">${candle.close.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-6 py-4 text-emerald-600">${candle.high.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-6 py-4 text-red-500">${candle.low.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-6 py-4">
                                <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg font-black text-[10px]">
                                  {candle.amplitude.toFixed(2)}%
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded-lg font-black text-[10px] ${isUp ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                                  {isUp ? '+' : ''}{candle.change.toFixed(2)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            ) : (
              <div className="bg-slate-50 rounded-3xl p-12 text-center text-slate-400 flex flex-col items-center justify-center border border-dashed border-slate-200">
                <p className="text-xs font-bold uppercase tracking-widest mb-1">未加载数据</p>
                <p className="text-[11px] text-slate-400">请选择开始与结束日期，并点击 “查询与加载数据” 进行统计分析。</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 flex items-center gap-6 px-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-emerald-500 border-t border-dashed border-emerald-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">资金转入 (Spot {"->"} Futures)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-red-500 border-t border-dashed border-red-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">资金转出 (Futures {"->"} Spot)</span>
          </div>
        </div>
      </div>

      {/* 2. Transfer Logs Section */}
      <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-600/20">
              <ArrowLeftRight className="text-white" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">资金划转日志</h2>
              <p className="text-slate-500 text-sm font-medium">记录系统自动执行的资金划转信息</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={downloadTransferCSV}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 font-bold text-xs uppercase tracking-widest transition-all"
            >
              <Download size={14} />
              导出划转日志
            </button>
            <button 
              onClick={() => {
                if (window.confirm('确定要清空所有资金划转日志吗？此操作不可撤销。')) {
                  onClearTransfers();
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-xl hover:bg-red-100 font-bold text-xs uppercase tracking-widest transition-all"
            >
              <Trash2 size={14} />
              清空日志
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">搜索资产/备注</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">开始时间</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="datetime-local" 
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">结束时间</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="datetime-local" 
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="flex items-end">
            <div className="bg-purple-50 rounded-xl px-4 py-2 border border-purple-100 w-full text-center">
              <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest block">筛选结果</span>
              <span className="text-lg font-black text-purple-700">{filteredTransferLogs.length} <span className="text-xs">条记录</span></span>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200">
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[210px]">时间</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[80px]">资产</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[110px]">数量</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[140px]">类型</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[90px]">状态</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransferLogs.length > 0 ? (
                  filteredTransferLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-700 font-mono whitespace-nowrap">{formatMs(log.timestamp)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-slate-900">{log.asset}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-slate-900 font-mono whitespace-nowrap">{log.amount.toFixed(2)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${
                          log.type === 'IN' 
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                            : 'bg-blue-50 text-blue-600 border border-blue-100'
                        }`}>
                          {log.type === 'IN' ? '现货 -> 合约' : '合约 -> 现货'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${
                          log.status === 'SUCCESS' 
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                            : 'bg-red-50 text-red-600 border border-red-100'
                        }`}>
                          {log.status === 'SUCCESS' ? '成功' : '失败'}
                        </span>
                      </td>
                      <td className="px-6 py-4 truncate">
                        <div className="text-xs text-slate-500 font-medium max-w-xs truncate" title={log.message}>
                          {log.message || '--'}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <ArrowLeftRight className="text-slate-200" size={48} />
                        <p className="text-slate-400 font-bold">暂无划转记录</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
