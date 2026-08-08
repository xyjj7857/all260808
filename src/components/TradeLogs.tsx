import React, { useState, useMemo } from 'react';
import { History, Download, Trash2, Calendar, Search, Filter, RefreshCw } from 'lucide-react';
import { TradeLog } from '../types';

const formatPrice = (val: number | string | undefined | null): string => {
  if (val === undefined || val === null || val === '') return '--';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  
  let str = num.toString();
  if (str.includes('e')) {
    str = num.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
  }
  
  let digitCount = 0;
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char >= '0' && char <= '9') {
      digitCount++;
    }
    result += char;
    if (digitCount === 10) {
      break;
    }
  }
  if (result.endsWith('.')) {
    result = result.slice(0, -1);
  }
  return result;
};

export default function TradeLogs({ tradeLogs, onClear, accountId }: { tradeLogs: TradeLog[], onClear: () => void, accountId: string }) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const handleForceSearch = async () => {
    const isAll = !searchTerm;
    if (isAll && !window.confirm('未输入币种，将尝试同步设置中所有币种的历史成交记录，可能需要较长时间。确定继续吗？')) {
      return;
    }
    
    setIsSyncing(true);
    try {
      const start = startTime ? new Date(startTime).getTime() : undefined;
      const end = endTime ? new Date(endTime).getTime() : undefined;
      
      const res = await fetch(`/api/trade-logs/sync?accountId=${accountId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          symbol: searchTerm ? searchTerm.toUpperCase() : 'ALL', 
          startTime: start, 
          endTime: end 
        })
      });
      
      const data = await res.json();
      if (data.success) {
        alert(`本地搜索完成，共找到 ${data.logs.length} 条成交记录`);
      } else {
        alert('搜索失败: ' + data.message);
      }
    } catch (err: any) {
      alert('请求失败: ' + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const filteredLogs = useMemo(() => {
    return tradeLogs.filter(log => {
      const matchesSearch = log.symbol.toLowerCase().includes(searchTerm.toLowerCase());
      const logTime = log.openTime;
      
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
  }, [tradeLogs, searchTerm, startTime, endTime]);

  const totals = useMemo(() => {
    const sums = filteredLogs.reduce((acc, log) => {
      if (log.isSkipMark || log.status === 'SKIPPED' || log.symbol === '[扫跳重置]') return acc;
      return {
        pnl: acc.pnl + log.pnl,
        fee: acc.fee + log.fee,
        fundingFee: acc.fundingFee + (log.fundingFee || 0)
      };
    }, { pnl: 0, fee: 0, fundingFee: 0 });
    
    return {
      ...sums,
      netPnl: sums.pnl - sums.fee + sums.fundingFee
    };
  }, [filteredLogs]);

  // 连赢次数统计逻辑：当遇到亏损订单或扫跳重置标记后，重新计算连赢次数
  const winStreakStats = useMemo(() => {
    const closedLogs = [...tradeLogs]
      .filter(log => log.status !== 'OPEN' || log.isSkipMark || log.symbol === '[扫跳重置]')
      .sort((a, b) => (a.closeTime || a.openTime) - (b.closeTime || b.openTime));

    let currentStreak = 0;
    let maxStreak = 0;

    for (const log of closedLogs) {
      if (log.isSkipMark || log.status === 'SKIPPED' || log.symbol === '[扫跳重置]') {
        currentStreak = 0;
        continue;
      }
      const isWin = (log.pnl > 0 || log.profitRate > 0);
      if (isWin) {
        currentStreak++;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
        }
      } else {
        // 订单出现亏损，重置连赢计数
        currentStreak = 0;
      }
    }

    return {
      currentStreak,
      maxStreak,
      totalClosed: closedLogs.filter(log => log.status !== 'OPEN' && log.status !== 'SKIPPED' && !log.isSkipMark && log.symbol !== '[扫跳重置]').length
    };
  }, [tradeLogs]);

  const formatMs = (ts: number) => {
    if (!ts || ts === 0) return '--';
    const date = new Date(ts + 8 * 3600 * 1000);
    return date.toISOString().replace('T', ' ').substring(0, 19);
  };

  const getDirectionText = (log: TradeLog) => {
    const isSingleK = log.strategyType === 'singleK' || log.strategyType === 'KLINE' || (!log.strategyType && log.k2 !== undefined && log.k2 !== null);
    if (isSingleK) {
      return log.side === 'BUY' ? 'k多' : 'k空';
    } else {
      return log.side === 'BUY' ? '振多' : '振空';
    }
  };

  const downloadCSV = () => {
    if (filteredLogs.length === 0) return;
    
    const headers = ['ID', '合约', '方向', '杠杆', '数量', '资金费率(下单)', '振幅', 'M值', '真实A', '单K2', '开仓价', '平仓价', '到期价格', '盈亏', '手续费', '利润率', '开仓时间', '平仓时间', '状态'];
    const rows = filteredLogs.map(log => {
      if (log.isSkipMark || log.status === 'SKIPPED' || log.symbol === '[扫跳重置]') {
        return [
          log.id,
          '[扫跳重置]',
          '系统',
          '--',
          '0',
          '--',
          '--',
          '--',
          '--',
          '--',
          '--',
          '0.0000',
          '--',
          '0.0000',
          '0.00%',
          formatMs(log.openTime),
          formatMs(log.closeTime),
          '已跳过'
        ];
      }
      return [
        log.id,
        log.symbol,
        getDirectionText(log),
        log.leverage + 'x',
        log.amount,
        log.fundingRate !== undefined ? (log.fundingRate * 100).toFixed(4) + '%' : '--',
        log.amp !== undefined ? log.amp.toFixed(2) + '%' : '--',
        log.mValue !== undefined ? log.mValue.toFixed(2) : '--',
        log.realA ? log.realA.toFixed(2) + '%' : '--',
        log.k2 !== undefined && log.k2 !== null ? log.k2.toFixed(2) + '%' : '--',
        formatPrice(log.entryPrice),
        formatPrice(log.exitPrice),
        formatPrice(log.expiryPrice),
        log.pnl.toFixed(4),
        log.fee.toFixed(4),
        log.profitRate.toFixed(2) + '%',
        formatMs(log.openTime),
        formatMs(log.closeTime),
        log.status === 'OPEN' ? '持仓中' : 
        log.status === 'TP' ? '止盈' : 
        log.status === 'SL' ? '止损' : 
        log.status === 'TIMEOUT' ? '到期' : 
        log.status === 'TRAILING' ? '追踪' : '已平仓'
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `trade_logs_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="bg-white border border-slate-100 rounded-[1.5rem] p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2.5">
              <History className="text-indigo-500" size={20} />
              交易日志
            </h3>

            <div className="flex flex-wrap items-center gap-6 border-l border-slate-100 pl-8">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">当前连赢</span>
                <span className="text-sm font-black text-amber-600">
                  {winStreakStats.currentStreak} <span className="text-[10px] font-medium text-slate-400">次</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">最大连赢</span>
                <span className="text-sm font-black text-indigo-600">
                  {winStreakStats.maxStreak} <span className="text-[10px] font-medium text-slate-400">次</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">累计盈亏</span>
                <span className={`text-sm font-black ${totals.netPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {totals.netPnl >= 0 ? '+' : ''}{totals.netPnl.toFixed(4)} <span className="text-[10px] font-medium text-slate-400">USDT</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">累计手续费</span>
                <span className="text-sm font-black text-slate-700">
                  {totals.fee.toFixed(4)} <span className="text-[10px] font-medium text-slate-400">USDT</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">累计资金费</span>
                <span className={`text-sm font-black ${totals.fundingFee >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {totals.fundingFee >= 0 ? '+' : ''}{totals.fundingFee.toFixed(4)} <span className="text-[10px] font-medium text-slate-400">USDT</span>
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={handleForceSearch}
              disabled={isSyncing}
              className={`flex items-center gap-1.5 px-6 py-2 border-2 border-red-500 text-red-500 rounded-lg text-sm font-black uppercase tracking-wider hover:bg-red-50 transition-all active:scale-95 ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isSyncing ? <RefreshCw size={16} className="animate-spin" /> : null}
              强制搜索
            </button>

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="搜索币种..." 
                className="pl-9 pr-4 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 w-40"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
              <div className="flex items-center gap-1.5 px-2">
                <Calendar size={12} className="text-slate-400" />
                <input 
                  type="datetime-local" 
                  className="bg-transparent border-none p-1 text-[10px] font-bold text-slate-600 focus:ring-0"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <span className="text-slate-300 text-[10px]">至</span>
              <div className="flex items-center gap-1.5 px-2">
                <input 
                  type="datetime-local" 
                  className="bg-transparent border-none p-1 text-[10px] font-bold text-slate-600 focus:ring-0"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <button 
              onClick={downloadCSV}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-emerald-100 transition-all active:scale-95"
            >
              <Download size={14} />
              导出
            </button>
            
            <button 
              onClick={() => {
                if (window.confirm('确定要清空所有交易日志吗？')) {
                  onClear();
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-red-100 transition-all active:scale-95"
            >
              <Trash2 size={14} />
              清空
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left table-fixed">
            <thead>
              <tr className="text-[11px] font-medium text-slate-400 uppercase tracking-wider border-b border-slate-50">
                <th className="pb-4 font-normal w-[180px]">合约</th>
                <th className="pb-4 font-normal w-[80px]">方向</th>
                <th className="pb-4 font-normal w-[100px]">资金费率</th>
                <th className="pb-4 font-normal w-[80px]">振幅</th>
                <th className="pb-4 font-normal w-[80px]">M值</th>
                <th className="pb-4 font-normal w-[80px]">真实A</th>
                <th className="pb-4 font-normal w-[80px]">单K2</th>
                <th className="pb-4 font-normal w-[130px]">开仓价</th>
                <th className="pb-4 font-normal w-[130px]">平仓价</th>
                <th className="pb-4 font-normal w-[130px]">到期价格</th>
                <th className="pb-4 font-normal w-[130px]">盈亏(USDT)</th>
                <th className="pb-4 font-normal w-[100px]">利润率</th>
                <th className="pb-4 font-normal w-[120px]">费用</th>
                <th className="pb-4 font-normal w-[100px]">状态</th>
                <th className="pb-4 font-normal w-[180px]">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log) => {
                  if (log.isSkipMark || log.status === 'SKIPPED' || log.symbol === '[扫跳重置]') {
                    return (
                      <tr key={log.id} className="bg-amber-50/40 hover:bg-amber-50/70 transition-colors">
                        <td colSpan={13} className="py-3 px-4">
                          <div className="flex items-center gap-2 text-xs font-bold text-amber-700">
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider">
                              扫跳重置
                            </span>
                            <span>[系统扫跳策略] 连赢达到预设上限并完成扫跳，连赢计数已在此节点归零重置</span>
                          </div>
                        </td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800">
                            已跳过
                          </span>
                        </td>
                        <td className="py-3 font-mono text-[10px] text-slate-400 font-medium">
                          {formatMs(log.closeTime || log.openTime)}
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={log.id} className="group hover:bg-slate-50/50 transition-colors">
                      <td className="py-5 truncate">
                        <div className="font-black text-slate-900 text-sm truncate">{log.symbol}</div>
                        <div className="text-[10px] text-slate-400 font-medium truncate">
                          {log.leverage}x · {log.amount} 
                        </div>
                      </td>
                      <td className="py-5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black ${log.side === 'BUY' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                          {getDirectionText(log)}
                        </span>
                      </td>
                      <td className="py-5 font-mono text-xs font-bold text-slate-500 whitespace-nowrap">
                        {log.fundingRate !== undefined ? (log.fundingRate * 100).toFixed(4) + '%' : '--'}
                      </td>
                      <td className="py-5 font-mono text-xs font-bold text-slate-500 whitespace-nowrap">
                        {log.amp !== undefined ? log.amp.toFixed(2) + '%' : '--'}
                      </td>
                      <td className="py-5 font-mono text-xs font-bold text-slate-500 whitespace-nowrap">
                        {log.mValue !== undefined ? log.mValue.toFixed(2) : '--'}
                      </td>
                      <td className="py-5 font-mono text-xs font-bold text-slate-500 whitespace-nowrap">
                        {log.realA ? log.realA.toFixed(2) + '%' : '--'}
                      </td>
                      <td className="py-5 font-mono text-xs font-bold text-slate-500 whitespace-nowrap">
                        {log.k2 !== undefined && log.k2 !== null ? log.k2.toFixed(2) + '%' : '--'}
                      </td>
                      <td className="py-5 font-mono text-sm font-bold text-slate-700 whitespace-nowrap">
                        {formatPrice(log.entryPrice)}
                      </td>
                      <td className="py-5 font-mono text-sm font-bold text-slate-700 whitespace-nowrap">
                        {formatPrice(log.exitPrice)}
                      </td>
                      <td className={`py-5 font-mono text-sm font-bold whitespace-nowrap ${(() => {
                        if (!log.expiryPrice || log.expiryPrice <= 0) return 'text-slate-400';
                        if (!log.exitPrice || log.exitPrice <= 0) return 'text-indigo-600';
                        const isBuy = log.side === 'BUY' || log.side === 'LONG';
                        const isBetter = isBuy ? (log.expiryPrice > log.exitPrice) : (log.expiryPrice < log.exitPrice);
                        return isBetter ? 'text-red-600' : 'text-emerald-600';
                      })()}`}>
                        {formatPrice(log.expiryPrice)}
                      </td>
                      <td className={`py-5 font-mono text-sm font-bold whitespace-nowrap ${log.pnl > 0 ? 'text-emerald-600' : log.pnl < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {log.pnl > 0 ? '+' : ''}{log.pnl.toFixed(4)}
                      </td>
                      <td className={`py-5 font-mono text-sm font-bold whitespace-nowrap ${log.profitRate > 0 ? 'text-emerald-600' : log.profitRate < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {log.profitRate > 0 ? '+' : ''}{log.profitRate.toFixed(2)}%
                      </td>
                      <td className="py-5 truncate">
                        <div className="text-[10px] text-slate-500 font-bold truncate">手续费: {log.fee.toFixed(4)}</div>
                        <div className="text-[10px] text-slate-400 font-medium truncate">资金费: {log.fundingFee.toFixed(4)}</div>
                      </td>
                      <td className="py-5">
                        {(() => {
                          let label = '已平仓';
                          let className = 'bg-slate-100 text-slate-400';
                          if (log.status === 'OPEN') {
                            label = '持仓中';
                            className = 'bg-blue-50 text-blue-600';
                          } else if (log.status === 'TP') {
                            label = '止盈';
                            className = 'bg-emerald-50 text-emerald-600';
                          } else if (log.status === 'SL') {
                            label = '止损';
                            className = 'bg-rose-50 text-rose-600';
                          } else if (log.status === 'TIMEOUT') {
                            label = '到期';
                            className = 'bg-amber-50 text-amber-600';
                          } else if (log.status === 'TRAILING') {
                            label = '追踪';
                            className = 'bg-violet-50 text-violet-600';
                          }
                          return (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black ${className}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-5 truncate">
                        <div className="text-[10px] text-slate-500 font-bold truncate">开: {formatMs(log.openTime)}</div>
                        <div className="text-[10px] text-slate-400 font-medium truncate">平: {formatMs(log.closeTime)}</div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={15} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center">
                        <Filter size={20} className="text-slate-300" />
                      </div>
                      <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">暂无符合条件的交易日志</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
