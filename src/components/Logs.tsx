import { LogEntry } from '../types';
import { useState } from 'react';
import { Search, RotateCcw } from 'lucide-react';

export default function Logs({ logs, onClear, accountId }: { logs: LogEntry[], onClear: () => void, accountId: string }) {
  const [searchLogs, setSearchLogs] = useState<LogEntry[] | null>(null);
  const [keyword, setKeyword] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Mock logs if empty
  const displayLogs = searchLogs !== null ? searchLogs : (logs.length > 0 ? logs : [
    { id: '1', timestamp: Date.now(), type: 'info', module: '扫描', message: 'Stage 0 完成，扫描 425 个币种，筛选出 150 个币种，耗时 1240ms' },
    { id: '2', timestamp: Date.now() - 5000, type: 'success', module: '系统', message: 'WebSocket 连接已建立' },
  ] as LogEntry[]);

  const formatTime = (ts: number) => {
    const d = new Date(ts + 8 * 3600 * 1000);
    const h = d.getUTCHours().toString().padStart(2, '0');
    const m = d.getUTCMinutes().toString().padStart(2, '0');
    const s = d.getUTCSeconds().toString().padStart(2, '0');
    const ms = (ts % 1000).toString().padStart(3, '0');
    const MM = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = d.getUTCDate().toString().padStart(2, '0');
    return `${MM}-${dd} ${h}:${m}:${s}.${ms}`;
  };

  const parseGmt8Time = (timeStr: string, isEnd: boolean = false): number => {
    if (!timeStr) return NaN;
    // Match YYYY-MM-DDTHH:mm:ss or YYYY-MM-DDTHH:mm or YYYY-MM-DD
    const match = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return NaN;
    
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = match[4] ? parseInt(match[4], 10) : (isEnd ? 23 : 0);
    const minute = match[5] ? parseInt(match[5], 10) : (isEnd ? 59 : 0);
    const second = match[6] ? parseInt(match[6], 10) : (isEnd ? 59 : 0);
    
    const utcMs = Date.UTC(year, month, day, hour, minute, second);
    return utcMs - 8 * 3600 * 1000;
  };

  const handleSearch = async () => {
    setIsSearching(true);
    try {
      const url = new URL(window.location.origin + '/api/logs/search');
      url.searchParams.append('accountId', accountId);
      if (keyword) url.searchParams.append('keyword', keyword);
      if (moduleFilter) url.searchParams.append('module', moduleFilter);
      if (typeFilter) url.searchParams.append('type', typeFilter);
      if (startDate) {
        const startTs = parseGmt8Time(startDate, false);
        if (!isNaN(startTs)) {
          url.searchParams.append('startTime', startTs.toString());
        }
      }
      if (endDate) {
        const endTs = parseGmt8Time(endDate, true);
        if (!isNaN(endTs)) {
          url.searchParams.append('endTime', endTs.toString());
        }
      }
      url.searchParams.append('limit', '500');

      const res = await fetch(url.toString());
      const data = await res.json();
      setSearchLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const resetSearch = () => {
    setSearchLogs(null);
    setKeyword('');
    setModuleFilter('');
    setTypeFilter('');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">系统日志</h2>
        <div className="flex gap-3">
          {searchLogs !== null && (
            <span className="px-4 py-2 text-slate-500 font-medium text-xs flex items-center bg-yellow-50 rounded-xl border border-yellow-100">
              当前为搜索快照 (显示 {searchLogs.length} 条)
            </span>
          )}
          <button 
            onClick={resetSearch}
            className="px-4 py-2 bg-indigo-50 text-indigo-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-indigo-100 border border-indigo-200 flex items-center gap-2"
          >
            <RotateCcw className="w-3 h-3" />
            恢复实时
          </button>
          <button 
            onClick={onClear}
            className="px-4 py-2 bg-slate-100 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-200 border border-slate-200"
          >
            清除日志
          </button>
          <button className="px-4 py-2 bg-slate-100 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-200 border border-slate-200">导出 CSV</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 shadow-sm p-4 rounded-3xl flex gap-4 items-end flex-wrap">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1 ml-1 uppercase tracking-wider">关键词</label>
          <input
            type="text"
            className="w-48 px-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
            placeholder="搜索消息..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1 ml-1 uppercase tracking-wider">模块</label>
          <input
            type="text"
            className="w-32 px-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
            placeholder="例如: 扫描"
            value={moduleFilter}
            onChange={e => setModuleFilter(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <div>
           <label className="block text-xs font-bold text-slate-700 mb-1 ml-1 uppercase tracking-wider">级别</label>
           <select 
              className="w-32 px-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white"
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
           >
              <option value="">全部级别</option>
              <option value="info">INFO</option>
              <option value="success">SUCCESS</option>
              <option value="warning">WARNING</option>
              <option value="error">ERROR</option>
           </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1 ml-1 uppercase tracking-wider">开始时间</label>
          <input
            type="datetime-local"
            step="3600"
            className="w-52 px-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white text-slate-700"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1 ml-1 uppercase tracking-wider">结束时间</label>
          <input
            type="datetime-local"
            step="3600"
            className="w-52 px-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white text-slate-700"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </div>
        <button 
          onClick={handleSearch}
          disabled={isSearching}
          className="px-6 py-2.5 bg-slate-900 text-white font-bold text-sm rounded-xl hover:bg-slate-800 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <Search className="w-4 h-4" />
          {isSearching ? '搜索中...' : '搜索历史 (50天内)'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50/50">
                <th className="px-8 py-5 w-48">时间</th>
                <th className="px-8 py-5 w-32">模块</th>
                <th className="px-8 py-5 w-24">级别</th>
                <th className="px-8 py-5">消息内容</th>
              </tr>
            </thead>
            <tbody className="font-mono text-sm divide-y divide-slate-50">
              {displayLogs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50/50 group">
                  <td className="px-8 py-4 text-slate-400 font-medium whitespace-nowrap">{formatTime(log.timestamp)}</td>
                  <td className="px-8 py-4 whitespace-nowrap">
                    <div className="flex flex-wrap gap-2 items-center">
                      {log.module.includes('[') && log.module.includes(']') ? (
                        <>
                          <span className="bg-slate-900 text-white text-[9px] font-black px-2 py-0.5 rounded-md shadow-sm">
                            {log.module.match(/\[(.*?)\]/)?.[1] || log.module}
                          </span>
                          <span className="text-slate-500 font-bold text-[10px] uppercase tracking-widest px-1">
                            {log.module.split(']').slice(1).join(']').trim()}
                          </span>
                        </>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest ${
                          log.module === '系统' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' :
                          log.module === '扫描' ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                          log.module === '订单' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                          'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {log.module}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-8 py-4 whitespace-nowrap">
                    <span className={`font-black uppercase text-[10px] tracking-widest ${
                      log.type === 'success' ? 'text-emerald-600' :
                      log.type === 'warning' ? 'text-orange-600' :
                      log.type === 'error' ? 'text-red-600' :
                      'text-blue-600'
                    }`}>
                      {log.type}
                    </span>
                  </td>
                  <td className="px-8 py-4 text-slate-700 font-medium group-hover:text-slate-900">{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
