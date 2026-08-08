import React, { useState } from 'react';
import { AppSettings } from '../types';
import { Save, Shield, Search, ShoppingCart, Mail, Database, Zap, Clock, Activity, RotateCcw, RefreshCw, User, Plus, Trash2, Play, Pause, Star, Globe, Lock, Key, Terminal, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../constants';

export default function SettingsPanel({  
  settings, 
  onSave, 
  onRefresh, 
  onRestore,
  onAddAccount,
  onDeleteAccount,
  onToggleAccount,
  onSetMasterAccount,
  accounts = []
}: { 
  settings: AppSettings; 
  onSave: (s: AppSettings) => void; 
  onRefresh: () => void; 
  onRestore: () => void;
  onAddAccount: () => void;
  onDeleteAccount: (id: string) => void;
  onToggleAccount: (id: string, currentlyEnabled: boolean) => void;
  onSetMasterAccount: (id: string) => void;
  accounts: any[];
  key?: any 
}) {
  const [localSettings, setLocalSettings] = useState<any>(settings);
  const [activeTab, setActiveTab] = useState('binance');
  const [isSaving, setIsSaving] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isTimeControlExpanded, setIsTimeControlExpanded] = useState(true);
  const [selectedTimeControlDay, setSelectedTimeControlDay] = useState<number>(1);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const res = await fetch('/api/settings/backup/export');
      const data = await res.json();
      if (data.success && data.ciphertext) {
        const blob = new Blob([data.ciphertext], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        // 获取所有账户名称拼接，例如 "账户1账户2账户3"
        let accountNames = (accounts || [])
          .map((acc: any) => (acc.name || '').trim())
          .filter(Boolean)
          .join('');

        if (!accountNames) {
          accountNames = (localSettings?.name || '备份文件').trim();
        }

        // 过滤文件名特殊非法字符
        accountNames = accountNames.replace(/[\\/:*?"<>|]/g, '_');

        a.href = url;
        a.download = `${accountNames}.enc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert(data.message || '导出备份失败');
      }
    } catch (err: any) {
      alert('导出发生错误: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm('您确定要导入此备份文件吗？这将会覆盖当前的所有账户和系统配置，该操作不可逆，引擎将自动重启。')) {
      e.target.value = '';
      return;
    }

    setIsImporting(true);
    try {
      const text = await file.text();
      const res = await fetch('/api/settings/backup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ciphertext: text.trim() })
      });
      const data = await res.json();
      if (data.success) {
        alert('配置备份导入成功！账户与交易引擎已完成热重载。');
        onRefresh();
      } else {
        alert(data.message || '导入备份失败');
      }
    } catch (err: any) {
      alert('导入发生错误: ' + err.message);
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  // Fallback sync
  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(localSettings);
      setTimeout(() => setIsSaving(false), 2000);
    } catch (error) {
      setIsSaving(false);
    }
  };

  const handleRestoreDefaults = async () => {
    setIsSaving(true);
    try {
      await onRestore();
    } finally {
      setIsSaving(false);
    }
  };

  const handleBatchControl = async (action: 'start' | 'stop') => {
    try {
      const res = await fetch('/api/accounts/batch-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (data.success) {
        onRefresh();
      } else {
        alert(data.message || "批量控制失败");
      }
    } catch (err: any) {
      alert("通信失败: " + err.message);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">系统配置中心</h2>
            {localSettings.isMasterAccount && (
              <span className="px-2 py-1 bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest rounded-lg border border-amber-200">
                主账户
              </span>
            )}
          </div>
          <p className="text-slate-400 text-sm mt-1 font-medium">自定义您的交易策略与连接参数</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={onRefresh}
            className="flex items-center gap-2 px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl transition-colors"
          >
            <RefreshCw size={18} />
            <span>刷新参数</span>
          </button>
          <button 
            onClick={handleRestoreDefaults}
            className="flex items-center gap-2 px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl transition-colors"
          >
            <RotateCcw size={18} />
            <span>恢复默认值</span>
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className={`flex items-center gap-2 px-8 py-4 ${isSaving ? 'bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700'} text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl ${isSaving ? '' : 'shadow-emerald-600/20'} disabled:opacity-50`}
          >
            {isSaving ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save size={20} />
            )}
            <span>{isSaving ? '正在保存...' : '保存并同步'}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        {/* Tabs */}
        <div className="flex flex-row w-full overflow-x-auto pb-2 gap-4 scrollbar-hide">
          <TabButton id="binance" icon={<Shield size={18} />} label="Binance API" active={activeTab === 'binance'} onClick={setActiveTab} />
          <TabButton id="scanner" icon={<Search size={18} />} label="扫描策略" active={activeTab === 'scanner'} onClick={setActiveTab} />
          <TabButton id="order" icon={<ShoppingCart size={18} />} label="仓单管理" active={activeTab === 'order'} onClick={setActiveTab} />
          <TabButton id="withdrawal" icon={<Database size={18} />} label="提补款" active={activeTab === 'withdrawal'} onClick={setActiveTab} />
          <TabButton id="accounts" icon={<User size={18} />} label="多账户管理" active={activeTab === 'accounts'} onClick={setActiveTab} />
          <TabButton id="backup" icon={<RotateCcw size={18} />} label="备份与恢复" active={activeTab === 'backup'} onClick={setActiveTab} />
        </div>

        {/* Content */}
        <div className="flex-1 bg-white border border-slate-200 rounded-[2.5rem] p-4 md:p-10 shadow-sm min-h-[600px]">
          {activeTab === 'binance' && (
            <div className="space-y-10">
              <SectionHeader title="账户标识" description="当前正在配置的账户名称及地位" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="当前账户名称" value={localSettings.name || ''} onChange={v => setLocalSettings({...localSettings, name: v})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">设为主账户</label>
                    <p className="text-[10px] text-slate-400 font-medium lowercase italic leading-none">扫描逻辑优先通过主账户进行</p>
                  </div>
                  <Toggle 
                    enabled={!!localSettings.isMasterAccount} 
                    onChange={(val) => {
                      if (val && !localSettings.isMasterAccount) {
                        onSetMasterAccount(localSettings.id);
                      }
                    }} 
                  />
                </div>
              </div>

              <SectionHeader title="基础配置" description="自定义网页标题及报警通知中的名称" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="系统显示名称" value={localSettings.appName || ''} onChange={v => setLocalSettings({...localSettings, appName: v})} />
                </div>
              </div>
              
              <SectionHeader title="Binance API 配置" description="配置您的币安 API 密钥与连接地址" />
              <div className="grid grid-cols-1 gap-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="Binance API Key" value={localSettings.binance?.apiKey || ''} onChange={v => setLocalSettings({...localSettings, binance: {...localSettings.binance, apiKey: v}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="Binance Secret Key" type="password" value={localSettings.binance?.secretKey || ''} onChange={v => setLocalSettings({...localSettings, binance: {...localSettings.binance, secretKey: v}})} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="Base URL" value={localSettings.binance?.baseUrl || ''} onChange={v => setLocalSettings({...localSettings, binance: {...localSettings.binance, baseUrl: v}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="WS URL" value={localSettings.binance?.wsUrl || ''} onChange={v => setLocalSettings({...localSettings, binance: {...localSettings.binance, wsUrl: v}})} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'accounts' && (
            <div className="space-y-10">
              {/* 一键开启/一键关闭所有账户策略控制栏 */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 bg-slate-900 text-white rounded-[2rem] gap-4 shadow-xl shadow-slate-900/10">
                <div>
                  <div className="flex items-center gap-2">
                    <Zap className="text-amber-400" size={22} />
                    <h3 className="text-lg font-black tracking-tight">一键批量控制所有账户</h3>
                  </div>
                  <p className="text-xs text-slate-400 font-medium mt-1">全局快速控制所有账号策略的启动与暂停状态</p>
                </div>
                <div className="flex gap-3 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => handleBatchControl('start')}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-emerald-600/30 transition-all active:scale-95 cursor-pointer"
                  >
                    <Play size={16} fill="currentColor" />
                    <span>一键开启所有策略</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBatchControl('stop')}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-rose-600/30 transition-all active:scale-95 cursor-pointer"
                  >
                    <Pause size={16} fill="currentColor" />
                    <span>一键关闭所有策略</span>
                  </button>
                </div>
              </div>

              <SectionHeader 
                title="账户列表" 
                description="管理您的多个交易账户。您可以点击右侧按钮新增账户。" 
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {accounts.map((acc: any) => (
                  <div key={acc.id} className="relative flex flex-col p-6 bg-slate-50/50 rounded-[2rem] border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/20 transition-all group overflow-hidden">
                    <div className="flex flex-col items-center text-center gap-4 mb-6">
                      <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center border border-slate-100 shadow-sm group-hover:shadow-md transition-shadow">
                        <User className="text-slate-400 group-hover:text-emerald-500 transition-colors" size={32} />
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-black text-slate-900 tracking-tight text-lg line-clamp-1">{acc.name}</h4>
                        <div className="flex items-center justify-center gap-1">
                          <p className="text-[10px] text-slate-400 font-mono tracking-tighter truncate max-w-[100px]">{acc.id}</p>
                          {acc.isMasterAccount && (
                             <span className="px-1 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-black uppercase tracking-widest rounded border border-amber-200">
                               主
                             </span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
                      <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${acc.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                        {acc.enabled ? '运行中' : '已停用'}
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSetMasterAccount(acc.id);
                          }}
                          className={`p-2 rounded-xl transition-all ${acc.isMasterAccount ? 'text-amber-500 bg-amber-50' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50'}`}
                          title={acc.isMasterAccount ? "当前为主账户" : "设为主账户"}
                        >
                          <Star size={20} fill={acc.isMasterAccount ? "currentColor" : "none"} />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleAccount(acc.id, acc.enabled);
                          }}
                          className={`p-2 rounded-xl transition-all ${acc.enabled ? 'text-amber-500 hover:bg-amber-50' : 'text-emerald-500 hover:bg-emerald-50'}`}
                          title={acc.enabled ? "暂停账户" : "启动账户"}
                        >
                          {acc.enabled ? <Pause size={20} /> : <Play size={20} />}
                        </button>
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onDeleteAccount(acc.id);
                          }}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          title="删除账户"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <button 
                  onClick={onAddAccount}
                  className="relative flex flex-col p-6 items-center justify-center gap-4 border-2 border-dashed border-slate-200 rounded-[2rem] text-slate-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all group min-h-[220px]"
                >
                  <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100 group-hover:bg-white group-hover:shadow-sm transition-all">
                    <Plus size={32} />
                  </div>
                  <span className="font-black text-xs uppercase tracking-widest">添加新账户</span>
                </button>
              </div>

              {/* 跨服务器远程控制配置（双重安全锁） */}
              <div className="pt-8 border-t border-slate-200 space-y-6">
                <SectionHeader 
                  title="跨服务器远程控制配置 (双重安全锁)" 
                  description="允许外部数据中心服务器或风云监控系统控制本应用所有账户策略的启动与停止。支持 IP 白名单与密钥双重防护。" 
                />

                <div className="bg-slate-50/70 p-6 md:p-8 rounded-[2rem] border border-slate-200/80 space-y-6">
                  <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center shadow-md">
                        <Globe size={20} />
                      </div>
                      <div>
                        <h4 className="font-black text-slate-900 text-sm">启用远程控制 HTTP API</h4>
                        <p className="text-xs text-slate-400">开启后允许符合 IP 白名单且持有有效密钥的远程程序操控策略</p>
                      </div>
                    </div>
                    <Toggle 
                      enabled={!!localSettings.remoteControl?.enabled} 
                      onChange={(val) => {
                        setLocalSettings({
                          ...localSettings,
                          remoteControl: {
                            ...(localSettings.remoteControl || { secretKey: '', allowedIps: '' }),
                            enabled: val
                          }
                        });
                      }} 
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                          远程控制密钥 (Secret Key)
                        </label>
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          <Shield size={11} /> AES-256 加密落盘
                        </span>
                      </div>
                      <div className="relative">
                        <input
                          type={showSecretKey ? "text" : "password"}
                          value={localSettings.remoteControl?.secretKey || ''}
                          onChange={(e) => setLocalSettings({
                            ...localSettings,
                            remoteControl: {
                              ...(localSettings.remoteControl || { enabled: true, allowedIps: '' }),
                              secretKey: e.target.value
                            }
                          })}
                          placeholder="例：supernode-remote-secret-key-2026"
                          className="w-full bg-white border border-slate-200 rounded-2xl pl-4 pr-11 py-3 font-mono text-sm font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/50"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecretKey(!showSecretKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                          title={showSecretKey ? "隐藏密钥" : "显示密钥"}
                        >
                          {showSecretKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 ml-1">远程请求时需在 Header 中携带 `x-remote-control-key` 或在 Query/Body 中传入 `key`</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                          允许控制的 IP 白名单 (支持内网 IP / 公网 IP)
                        </label>
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          <Shield size={11} /> AES-256 加密落盘
                        </span>
                      </div>
                      <textarea
                        rows={2}
                        value={localSettings.remoteControl?.allowedIps || ''}
                        onChange={(e) => setLocalSettings({
                          ...localSettings,
                          remoteControl: {
                            ...(localSettings.remoteControl || { enabled: true, secretKey: '' }),
                            allowedIps: e.target.value
                          }
                        })}
                        placeholder="例: 127.0.0.1, 192.168.1.100, 47.98.xxx.xxx (多个逗号/换行分隔，填 * 允许任意 IP)"
                        className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 font-mono text-xs font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/50"
                      />
                      <p className="text-[10px] text-slate-400 ml-1">双重防护：若设置了白名单，非白名单 IP 即使拿到密钥也无法操作</p>
                    </div>
                  </div>

                  {/* 调用代码指引卡片 */}
                  <div className="p-5 bg-slate-900 rounded-2xl text-slate-300 font-mono text-xs space-y-3 shadow-xl">
                    <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-2">
                      <span className="flex items-center gap-2 font-black text-emerald-400">
                        <Terminal size={14} /> 远程控制 API 调用示例 (Curl / Node.js)
                      </span>
                      <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">/api/remote/batch-control</span>
                    </div>
                    <div className="space-y-1.5 text-[11px] text-slate-200 overflow-x-auto">
                      <p className="text-slate-400">// 1. 远程开启所有账户策略 (POST)</p>
                      <p className="text-emerald-300">curl -X POST "http://本程序IP:3000/api/remote/batch-control" \</p>
                      <p className="text-emerald-300">  -H "Content-Type: application/json" \</p>
                      <p className="text-emerald-300">  -H "x-remote-control-key: {localSettings.remoteControl?.secretKey || 'YOUR_KEY'}" \</p>
                      <p className="text-emerald-300">  -d '&#123;"action": "start"&#125;'</p>
                      
                      <p className="text-slate-400 mt-2">// 2. 远程关闭所有账户策略 (POST)</p>
                      <p className="text-rose-300">curl -X POST "http://本程序IP:3000/api/remote/batch-control" \</p>
                      <p className="text-rose-300">  -H "Content-Type: application/json" \</p>
                      <p className="text-rose-300">  -H "x-remote-control-key: {localSettings.remoteControl?.secretKey || 'YOUR_KEY'}" \</p>
                      <p className="text-rose-300">  -d '&#123;"action": "stop"&#125;'</p>

                      <p className="text-slate-400 mt-2">// 3. 查询策略状态 (GET)</p>
                      <p className="text-amber-300">curl "http://本程序IP:3000/api/remote/status?key={localSettings.remoteControl?.secretKey || 'YOUR_KEY'}"</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'scanner' && (
            <div className="space-y-10">
              <section className="space-y-6">
                <SectionHeader title="Stage 0 - 全市场初筛" icon={<Clock size={16} className="text-blue-600" />} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="绝对周期 (如 1h)" value={localSettings.scanner?.stage0?.interval || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, interval: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="启动时间" value={localSettings.scanner?.stage0?.startTime || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, startTime: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="K线周期" value={localSettings.scanner?.stage0?.klinePeriod || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, klinePeriod: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="K线数量下限" type="number" value={String(localSettings.scanner?.stage0?.minKlines ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, minKlines: Number(v)}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="K线数量上限" type="number" value={String(localSettings.scanner?.stage0?.maxKlines ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, maxKlines: Number(v)}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TradFi 币对</label>
                    <Toggle enabled={localSettings.scanner?.stage0?.includeTradFi ?? false} onChange={e => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, includeTradFi: e}}})} />
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <SectionHeader title="Stage 0P - 波动率过滤" icon={<Activity size={16} className="text-orange-600" />} noBorder />
                  <Toggle enabled={localSettings.scanner?.stage0P?.enabled ?? false} onChange={e => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, enabled: e}}})} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="0P 绝对周期" value={localSettings.scanner?.stage0P?.interval || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, interval: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="0P 启动时间" value={localSettings.scanner?.stage0P?.startTime || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, startTime: v}}})} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {Object.entries(localSettings.scanner?.stage0P?.periods || {}).map(([period, config]: [string, any]) => (
                    <div key={period} className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">{period} 监控</span>
                        <Toggle enabled={config.enabled} onChange={e => {
                          const newPeriods = { ...localSettings.scanner.stage0P.periods };
                          newPeriods[period].enabled = e;
                          setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, periods: newPeriods}}});
                        }} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <Input label="K线数量" type="number" value={String(config?.count ?? '')} onChange={v => {
                          const newPeriods = { ...localSettings.scanner.stage0P.periods };
                          newPeriods[period].count = Number(v);
                          setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, periods: newPeriods}}});
                        }} />
                        <Input label="阈值 (%)" type="number" value={String(config?.threshold ?? '')} onChange={v => {
                          const newPeriods = { ...localSettings.scanner.stage0P.periods };
                          newPeriods[period].threshold = Number(v);
                          setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, periods: newPeriods}}});
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="p-6 bg-slate-50/50 rounded-[2rem] border border-slate-100 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 bg-white rounded-lg shadow-sm">
                        <Activity size={16} className="text-red-600" />
                      </div>
                      <h4 className="text-sm font-black text-slate-900 tracking-tight uppercase">异动监控</h4>
                    </div>
                    <Toggle 
                      enabled={localSettings.scanner?.stage0P?.abnormalMove?.enabled ?? false} 
                      onChange={e => setLocalSettings({
                        ...localSettings, 
                        scanner: {
                          ...localSettings.scanner, 
                          stage0P: {
                            ...localSettings.scanner.stage0P, 
                            abnormalMove: {
                              ...(localSettings.scanner.stage0P.abnormalMove || { lookbackHours: 10, windowMinutes: 60, maxPump: 25, maxDrop: 30 }),
                              enabled: e
                            }
                          }
                        }
                      })} 
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <Input label="考察时长 (h)" type="number" value={String(localSettings.scanner?.stage0P?.abnormalMove?.lookbackHours ?? 10)} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, abnormalMove: {...(localSettings.scanner.stage0P.abnormalMove || {}), lookbackHours: Number(v)}}}})} />
                    <Input label="窗口 (min)" type="number" value={String(localSettings.scanner?.stage0P?.abnormalMove?.windowMinutes ?? 60)} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, abnormalMove: {...(localSettings.scanner.stage0P.abnormalMove || {}), windowMinutes: Number(v)}}}})} />
                    <Input label="涨幅 (%)" type="number" value={String(localSettings.scanner?.stage0P?.abnormalMove?.maxPump ?? 25)} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, abnormalMove: {...(localSettings.scanner.stage0P.abnormalMove || {}), maxPump: Number(v)}}}})} />
                    <Input label="跌幅 (%)" type="number" value={String(localSettings.scanner?.stage0P?.abnormalMove?.maxDrop ?? 30)} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, abnormalMove: {...(localSettings.scanner.stage0P.abnormalMove || {}), maxDrop: Number(v)}}}})} />
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <SectionHeader title="Stage 1 - 基础过滤" icon={<Filter size={16} className="text-emerald-600" />} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="1 绝对周期" value={localSettings.scanner?.stage1?.interval || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, interval: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="1 启动时间" value={localSettings.scanner?.stage1?.startTime || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, startTime: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="成交额 M1 下限" type="number" value={String(localSettings.scanner?.stage1?.minVolumeM1 ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, minVolumeM1: Number(v)}}})} />
                  </div>
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <div className="grid grid-cols-2 gap-6">
                    <Input label="K1 下限 (%)" type="number" value={String(localSettings.scanner?.stage1?.priceChangeK1?.[0] ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, priceChangeK1: [Number(v), localSettings.scanner.stage1.priceChangeK1[1]]}}})} />
                    <Input label="K1 上限 (%)" type="number" value={String(localSettings.scanner?.stage1?.priceChangeK1?.[1] ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, priceChangeK1: [localSettings.scanner.stage1.priceChangeK1[0], Number(v)]}}})} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="白名单 (空格分隔)" value={localSettings.scanner?.stage1?.whitelist?.join(' ') || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, whitelist: v.split(' ').filter(s => s)}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="黑名单 (空格分隔)" value={localSettings.scanner?.stage1?.blacklist?.join(' ') || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, blacklist: v.split(' ').filter(s => s)}}})} />
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <SectionHeader title="Stage 2 - 形态过滤" icon={<Zap size={16} className="text-purple-600" />} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="2 绝对周期" value={localSettings.scanner?.stage2?.interval || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, interval: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="2 启动时间" value={localSettings.scanner?.stage2?.startTime || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, startTime: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="冷却期 (min)" type="number" value={String(localSettings.scanner?.stage2?.cooldown ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, cooldown: Number(v)}}})} />
                  </div>
                </div>
                 {/* 振幅形态过滤与单K形态过滤的双子卡片结构 */}
                <div className="space-y-6 pt-4">
                  {/* 子区块1：Stage 2 振幅形态过滤 */}
                  <div className="p-6 bg-slate-50/20 border border-slate-100 rounded-[32px] space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-purple-600 animate-pulse" />
                        <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider">Stage 2 振幅形态过滤</h4>
                      </div>
                      <Toggle 
                        enabled={localSettings.scanner?.stage2?.enabled !== false} 
                        onChange={e => setLocalSettings({
                          ...localSettings, 
                          scanner: {
                            ...localSettings.scanner, 
                            stage2: {
                              ...localSettings.scanner.stage2, 
                              enabled: e
                            }
                          }
                        })} 
                      />
                    </div>

                    {(localSettings.scanner?.stage2?.enabled !== false) && (
                      <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                          <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                            <Select 
                              label="目标表指标计算模式" 
                              value={localSettings.scanner?.stage2?.sharedTableMode || 'master_snapshot'} 
                              options={[
                                { label: '完全一致模式 (共享主账户快照)', value: 'master_snapshot' },
                                { label: '独立实时模式 (各自独立计算)', value: 'independent' }
                              ]}
                              onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, sharedTableMode: v as any}}})} 
                            />
                          </div>
                          <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                            <Select 
                              label="优选币对选择方式" 
                              value={localSettings.scanner?.stage2?.preferredMode || 'volume'} 
                              options={[
                                { label: '交易额最高 (M最大)', value: 'volume' },
                                { label: '振幅最大 (波动量最大)', value: 'amp' }
                              ]}
                              onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, preferredMode: v as any}}})} 
                            />
                          </div>
                          <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                            <Select 
                              label="振幅计算规则" 
                              value={localSettings.scanner?.stage2?.amplitudeMode || 'bottomHigh'} 
                              options={[
                                { label: '方式1：底高模式 (1 - 最低价 / 最高价)', value: 'bottomHigh' },
                                { label: '方式2：高低模式 (最高价 / 最低价 - 1)', value: 'highLow' }
                              ]}
                              onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, amplitudeMode: v as any}}})} 
                            />
                          </div>
                          <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                            <Select 
                              label="策略优先级 (同一币对同符振幅与单K时)" 
                              value={localSettings.scanner?.stage2?.strategyPriority || 'amplitude'} 
                              options={[
                                { label: '振幅策略优先 (默认)', value: 'amplitude' },
                                { label: '单K策略优先', value: 'singleK' }
                              ]}
                              onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, strategyPriority: v as any}}})} 
                            />
                          </div>
                        </div>

                        {(() => {
                          const conds = {
                            amp: { enabled: true, range: [10, 30] as [number, number] },
                            ampSell: { enabled: true, range: [10, 30] as [number, number] },
                            longShort: { enabled: true, buyEnabled: true, buy: 80, sellEnabled: true, sell: 20 },
                            m: { enabled: true, range: [2980000, 1000000000] as [number, number] },
                            mSell: { enabled: true, range: [2980000, 1000000000] as [number, number] },
                            fundingRateOptimization: { enabled: true, windowMinutes: 5, shortThreshold: -0.3 },
                            fundingRateOptimizationSell: { enabled: true, windowMinutes: 5, shortThreshold: -0.3 },
                            ...(localSettings.scanner?.stage2?.conditions || {})
                          };
                          if (!conds.ampSell) conds.ampSell = { ...conds.amp };
                          if (!conds.mSell) conds.mSell = { ...conds.m };
                          if (!conds.fundingRateOptimizationSell) conds.fundingRateOptimizationSell = { ...(conds.fundingRateOptimization || { enabled: true, windowMinutes: 5, shortThreshold: -0.3 }) };

                          return (
                            <div className="space-y-6">
                              {/* 多单过滤标题 */}
                              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                <span className="text-xs font-black text-emerald-600 uppercase tracking-wider">📈 多单过滤参数 (BUY)</span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* AMP 过滤 (多) */}
                                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">AMP 过滤 (多)</span>
                                    <Toggle enabled={conds.amp.enabled} onChange={e => {
                                      const newConds = { ...conds, amp: { ...conds.amp, enabled: e } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <Input label="下限" type="number" value={String(conds.amp.range?.[0] ?? '')} onChange={v => {
                                      const newConds = { ...conds, amp: { ...conds.amp, range: [Number(v), conds.amp.range[1]] } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                    <Input label="上限" type="number" value={String(conds.amp.range?.[1] ?? '')} onChange={v => {
                                      const newConds = { ...conds, amp: { ...conds.amp, range: [conds.amp.range[0], Number(v)] } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                </div>

                                {/* 多单 (Buy %) 占比 */}
                                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">多单 (Buy %) 过滤</span>
                                    <Toggle enabled={conds.longShort.buyEnabled !== false} onChange={e => {
                                      const newConds = { ...conds, longShort: { ...conds.longShort, buyEnabled: e } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                  <Input label="多单 (Buy %) 比例阀值" type="number" value={String(conds.longShort.buy ?? '')} onChange={v => {
                                    const newConds = { ...conds, longShort: { ...conds.longShort, buy: Number(v) } };
                                    setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                  }} />
                                </div>

                                {/* M 过滤 (多) */}
                                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">M 过滤 (多)</span>
                                    <Toggle enabled={conds.m.enabled} onChange={e => {
                                      const newConds = { ...conds, m: { ...conds.m, enabled: e } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <Input label="下限" type="number" value={String(conds.m.range?.[0] ?? '')} onChange={v => {
                                      const newConds = { ...conds, m: { ...conds.m, range: [Number(v), conds.m.range[1]] } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                    <Input label="上限" type="number" value={String(conds.m.range?.[1] ?? '')} onChange={v => {
                                      const newConds = { ...conds, m: { ...conds.m, range: [conds.m.range[0], Number(v)] } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                </div>
                              </div>

                              {/* 空单过滤标题 */}
                              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                                <span className="text-xs font-black text-rose-500 uppercase tracking-wider">📉 空单过滤参数 (SELL)</span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* AMP 过滤 (空) */}
                                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">AMP 过滤 (空)</span>
                                    <Toggle enabled={conds.ampSell.enabled} onChange={e => {
                                      const newConds = { ...conds, ampSell: { ...conds.ampSell, enabled: e } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <Input label="下限" type="number" value={String(conds.ampSell.range?.[0] ?? '')} onChange={v => {
                                      const newConds = { ...conds, ampSell: { ...conds.ampSell, range: [Number(v), conds.ampSell.range[1]] } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                    <Input label="上限" type="number" value={String(conds.ampSell.range?.[1] ?? '')} onChange={v => {
                                      const newConds = { ...conds, ampSell: { ...conds.ampSell, range: [conds.ampSell.range[0], Number(v)] } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                </div>

                                {/* 空单 (Sell %) 占比 */}
                                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">空单 (Sell %) 过滤</span>
                                    <Toggle enabled={conds.longShort.sellEnabled ?? false} onChange={e => {
                                      const newConds = { ...conds, longShort: { ...conds.longShort, sellEnabled: e } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                  <Input label="空单 (Sell %) 比例阀值" type="number" value={String(conds.longShort.sell ?? '')} onChange={v => {
                                    const newConds = { ...conds, longShort: { ...conds.longShort, sell: Number(v) } };
                                    setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                  }} />
                                </div>

                                {/* M 过滤 (空) */}
                                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">M 过滤 (空)</span>
                                    <Toggle enabled={conds.mSell.enabled} onChange={e => {
                                      const newConds = { ...conds, mSell: { ...conds.mSell, enabled: e } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <Input label="下限" type="number" value={String(conds.mSell.range?.[0] ?? '')} onChange={v => {
                                      const newConds = { ...conds, mSell: { ...conds.mSell, range: [Number(v), conds.mSell.range[1]] } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                    <Input label="上限" type="number" value={String(conds.mSell.range?.[1] ?? '')} onChange={v => {
                                      const newConds = { ...conds, mSell: { ...conds.mSell, range: [conds.mSell.range[0], Number(v)] } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                </div>

                                {/* 资金费优化 (空) */}
                                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">资金费优化 (空)</span>
                                    <Toggle enabled={conds.fundingRateOptimizationSell.enabled} onChange={e => {
                                      const newConds = { ...conds, fundingRateOptimizationSell: { ...conds.fundingRateOptimizationSell, enabled: e } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <Input label="窗口 (分)" type="number" value={String(conds.fundingRateOptimizationSell?.windowMinutes ?? 5)} onChange={v => {
                                      const newConds = { ...conds, fundingRateOptimizationSell: { ...conds.fundingRateOptimizationSell, windowMinutes: Number(v) } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                    <Input label="空阀值 (%)" type="number" value={String(conds.fundingRateOptimizationSell?.shortThreshold ?? -0.3)} onChange={v => {
                                      const newConds = { ...conds, fundingRateOptimizationSell: { ...conds.fundingRateOptimizationSell, shortThreshold: Number(v) } };
                                      setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConds}}});
                                    }} />
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* 子区块2：Stage 2 单K过滤 */}
                  {(() => {
                    const singleK = {
                      enabled: false,
                      preferredMode: 'volume' as const,
                      k2: { enabled: true, range: [4, 9] as [number, number] },
                      a: { enabled: true, range: [0, 3] as [number, number], mode: 'fixed' as const },
                      m: { enabled: true, range: [6980000, 1000000000] as [number, number] },
                      k2Sell: { enabled: true, range: [4, 9] as [number, number] },
                      aSell: { enabled: true, range: [0, 3] as [number, number], mode: 'fixed' as const },
                      mSell: { enabled: true, range: [6980000, 1000000000] as [number, number] },
                      fundingRateOptimizationSell: { enabled: true, windowMinutes: 5, shortThreshold: -0.3 },
                      ...(localSettings.scanner?.stage2?.singleK || {})
                    };
                    if (!singleK.k2Sell) {
                      singleK.k2Sell = { enabled: true, range: [4, 9] };
                    }
                    if (!singleK.aSell) {
                      singleK.aSell = { enabled: true, range: [0, 3], mode: 'fixed' };
                    }
                    if (!singleK.mSell) {
                      singleK.mSell = { enabled: true, range: [6980000, 1000000000] };
                    }
                    if (!singleK.fundingRateOptimizationSell) {
                      singleK.fundingRateOptimizationSell = { enabled: true, windowMinutes: 5, shortThreshold: -0.3 };
                    }

                    const updateSingleK = (newSingleK: any) => {
                      setLocalSettings({
                        ...localSettings,
                        scanner: {
                          ...localSettings.scanner,
                          stage2: {
                            ...localSettings.scanner.stage2,
                            singleK: newSingleK
                          }
                        }
                      });
                    };

                    return (
                      <div className="p-6 bg-slate-50/20 border border-slate-100 rounded-[32px] space-y-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
                            <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider">Stage 2 单K过滤</h4>
                          </div>
                          <Toggle 
                             enabled={singleK.enabled} 
                             onChange={e => updateSingleK({ ...singleK, enabled: e })} 
                          />
                        </div>

                        {singleK.enabled && (
                          <div className="space-y-6">
                            <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                              <Select 
                                label="优选币对选择方式" 
                                value={singleK.preferredMode || 'volume'} 
                                options={[
                                  { label: '交易额最高 (M最大)', value: 'volume' },
                                  { label: '涨幅最高 (涨跌幅最大)', value: 'change' },
                                  { label: '振幅最大 (波动量最大)', value: 'amp' }
                                ]}
                                onChange={v => updateSingleK({ ...singleK, preferredMode: v as any })} 
                              />
                            </div>

                            {/* 多单过滤标题 */}
                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                              <span className="text-xs font-black text-emerald-600 uppercase tracking-wider">📈 多单过滤参数 (BUY)</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                              {/* K2 过滤 */}
                              <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                  <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">K2 过滤 (多)</span>
                                  <Toggle enabled={singleK.k2.enabled} onChange={e => updateSingleK({ ...singleK, k2: { ...singleK.k2, enabled: e } })} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <Input label="下限" type="number" value={String(singleK.k2.range?.[0] ?? '')} onChange={v => updateSingleK({ ...singleK, k2: { ...singleK.k2, range: [Number(v), singleK.k2.range[1]] } })} />
                                  <Input label="上限" type="number" value={String(singleK.k2.range?.[1] ?? '')} onChange={v => updateSingleK({ ...singleK, k2: { ...singleK.k2, range: [singleK.k2.range[0], Number(v)] } })} />
                                </div>
                              </div>

                              {/* A 过滤 */}
                              <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                  <div className="flex flex-col gap-1">
                                    <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">A 过滤 (多)</span>
                                    <div className="flex bg-slate-200/50 p-0.5 rounded-lg w-fit">
                                      <button 
                                        type="button"
                                        onClick={() => updateSingleK({...singleK, a: {...singleK.a, mode: 'fixed'}})}
                                        className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider transition-all ${singleK.a.mode !== 'linkK' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                                      >固定</button>
                                      <button 
                                        type="button"
                                        onClick={() => updateSingleK({...singleK, a: {...singleK.a, mode: 'linkK'}})}
                                        className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider transition-all ${singleK.a.mode === 'linkK' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                                      >关联K</button>
                                    </div>
                                  </div>
                                  <Toggle enabled={singleK.a.enabled} onChange={e => updateSingleK({ ...singleK, a: { ...singleK.a, enabled: e } })} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <Input label="下限" type="number" value={String(singleK.a.range?.[0] ?? '')} onChange={v => updateSingleK({ ...singleK, a: { ...singleK.a, range: [Number(v), singleK.a.range[1]] } })} />
                                  <Input label="上限" type="number" value={String(singleK.a.range?.[1] ?? '')} onChange={v => updateSingleK({ ...singleK, a: { ...singleK.a, range: [singleK.a.range[0], Number(v)] } })} />
                                </div>
                              </div>

                              {/* M 过滤 */}
                              <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                  <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">M 过滤 (多)</span>
                                  <Toggle enabled={singleK.m.enabled} onChange={e => updateSingleK({ ...singleK, m: { ...singleK.m, enabled: e } })} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <Input label="下限" type="number" value={String(singleK.m.range?.[0] ?? '')} onChange={v => updateSingleK({ ...singleK, m: { ...singleK.m, range: [Number(v), singleK.m.range[1]] } })} />
                                  <Input label="上限" type="number" value={String(singleK.m.range?.[1] ?? '')} onChange={v => updateSingleK({ ...singleK, m: { ...singleK.m, range: [singleK.m.range[0], Number(v)] } })} />
                                </div>
                              </div>
                            </div>

                            {/* 空单过滤标题 */}
                            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                              <span className="text-xs font-black text-rose-500 uppercase tracking-wider">📉 空单过滤参数 (SELL)</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                              {/* K2 过滤 (空) */}
                              <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                  <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">K2 过滤 (空)</span>
                                  <Toggle enabled={singleK.k2Sell.enabled} onChange={e => updateSingleK({ ...singleK, k2Sell: { ...singleK.k2Sell, enabled: e } })} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <Input label="下限" type="number" value={String(singleK.k2Sell.range?.[0] ?? '')} onChange={v => updateSingleK({ ...singleK, k2Sell: { ...singleK.k2Sell, range: [Number(v), singleK.k2Sell.range[1]] } })} />
                                  <Input label="上限" type="number" value={String(singleK.k2Sell.range?.[1] ?? '')} onChange={v => updateSingleK({ ...singleK, k2Sell: { ...singleK.k2Sell, range: [singleK.k2Sell.range[0], Number(v)] } })} />
                                </div>
                              </div>

                              {/* A 过滤 (空) */}
                              <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                  <div className="flex flex-col gap-1">
                                    <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">A 过滤 (空)</span>
                                    <div className="flex bg-slate-200/50 p-0.5 rounded-lg w-fit">
                                      <button 
                                        type="button"
                                        onClick={() => updateSingleK({...singleK, aSell: {...singleK.aSell, mode: 'fixed'}})}
                                        className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider transition-all ${singleK.aSell.mode !== 'linkK' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}
                                      >固定</button>
                                      <button 
                                        type="button"
                                        onClick={() => updateSingleK({...singleK, aSell: {...singleK.aSell, mode: 'linkK'}})}
                                        className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider transition-all ${singleK.aSell.mode === 'linkK' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}
                                      >关联K</button>
                                    </div>
                                  </div>
                                  <Toggle enabled={singleK.aSell.enabled} onChange={e => updateSingleK({ ...singleK, aSell: { ...singleK.aSell, enabled: e } })} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <Input label="下限" type="number" value={String(singleK.aSell.range?.[0] ?? '')} onChange={v => updateSingleK({ ...singleK, aSell: { ...singleK.aSell, range: [Number(v), singleK.aSell.range[1]] } })} />
                                  <Input label="上限" type="number" value={String(singleK.aSell.range?.[1] ?? '')} onChange={v => updateSingleK({ ...singleK, aSell: { ...singleK.aSell, range: [singleK.aSell.range[0], Number(v)] } })} />
                                </div>
                              </div>

                              {/* M 过滤 (空) */}
                              <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                  <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">M 过滤 (空)</span>
                                  <Toggle enabled={singleK.mSell.enabled} onChange={e => updateSingleK({ ...singleK, mSell: { ...singleK.mSell, enabled: e } })} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <Input label="下限" type="number" value={String(singleK.mSell.range?.[0] ?? '')} onChange={v => updateSingleK({ ...singleK, mSell: { ...singleK.mSell, range: [Number(v), singleK.mSell.range[1]] } })} />
                                  <Input label="上限" type="number" value={String(singleK.mSell.range?.[1] ?? '')} onChange={v => updateSingleK({ ...singleK, mSell: { ...singleK.mSell, range: [singleK.mSell.range[0], Number(v)] } })} />
                                </div>
                              </div>

                              {/* 资金费优化 (空) */}
                              <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                  <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">资金费优化 (空)</span>
                                  <Toggle enabled={singleK.fundingRateOptimizationSell.enabled} onChange={e => updateSingleK({ ...singleK, fundingRateOptimizationSell: { ...singleK.fundingRateOptimizationSell, enabled: e } })} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <Input label="时间窗口 (分)" type="number" value={String(singleK.fundingRateOptimizationSell.windowMinutes ?? 5)} onChange={v => updateSingleK({ ...singleK, fundingRateOptimizationSell: { ...singleK.fundingRateOptimizationSell, windowMinutes: Number(v) } })} />
                                  <Input label="空单阈值 (%)" type="number" value={String(singleK.fundingRateOptimizationSell.shortThreshold ?? -0.3)} onChange={v => updateSingleK({ ...singleK, fundingRateOptimizationSell: { ...singleK.fundingRateOptimizationSell, shortThreshold: Number(v) } })} />
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </section>

              <section className="space-y-6">
                {(() => {
                  const tc = localSettings.scanner?.timeControl || { enabled: true, mode: '+2', slots: Array(96).fill(true) };
                  const defaultSlots = (tc.slots && tc.slots.length === 96)
                    ? tc.slots
                    : ((tc.hours && tc.hours.length === 24)
                        ? tc.hours.flatMap((h: boolean) => [h, h, h, h])
                        : Array(96).fill(true));

                  // 构造按周一至周日的映射
                  const weekSlotsMap: Record<number, boolean[]> = {};
                  [1, 2, 3, 4, 5, 6, 0].forEach(d => {
                    if (tc.weekSlots && Array.isArray(tc.weekSlots[d]) && tc.weekSlots[d].length === 96) {
                      weekSlotsMap[d] = tc.weekSlots[d];
                    } else {
                      weekSlotsMap[d] = [...defaultSlots];
                    }
                  });

                  const currentDaySlots = weekSlotsMap[selectedTimeControlDay] || defaultSlots;

                  const updateCurrentDaySlots = (newSlots: boolean[]) => {
                    const newWeekSlots = {
                      ...weekSlotsMap,
                      [selectedTimeControlDay]: newSlots
                    };
                    setLocalSettings({
                      ...localSettings,
                      scanner: {
                        ...localSettings.scanner,
                        timeControl: {
                          ...tc,
                          slots: newSlots, // 保持同步
                          weekSlots: newWeekSlots,
                          hours: Array.from({ length: 24 }).map((_, h) => newSlots.slice(h * 4, h * 4 + 4).some(Boolean))
                        }
                      }
                    });
                  };

                  const syncToAllDays = (slotsToCopy: boolean[]) => {
                    const newWeekSlots: Record<number, boolean[]> = {};
                    [1, 2, 3, 4, 5, 6, 0].forEach(d => {
                      newWeekSlots[d] = [...slotsToCopy];
                    });
                    setLocalSettings({
                      ...localSettings,
                      scanner: {
                        ...localSettings.scanner,
                        timeControl: {
                          ...tc,
                          slots: slotsToCopy,
                          weekSlots: newWeekSlots,
                          hours: Array.from({ length: 24 }).map((_, h) => slotsToCopy.slice(h * 4, h * 4 + 4).some(Boolean))
                        }
                      }
                    });
                  };

                  const weekDaysConfig = [
                    { day: 1, label: '周一' },
                    { day: 2, label: '周二' },
                    { day: 3, label: '周三' },
                    { day: 4, label: '周四' },
                    { day: 5, label: '周五' },
                    { day: 6, label: '周六' },
                    { day: 0, label: '周日' },
                  ];

                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-4 gap-4">
                        <div className="flex items-center gap-4 flex-wrap">
                          <SectionHeader title="时间控制 (按周定制/15分钟周期)" icon={<Clock size={16} className="text-indigo-600" />} noBorder />
                          
                          {/* 向上折叠 / 展开按纽 */}
                          <button
                            type="button"
                            onClick={() => setIsTimeControlExpanded(!isTimeControlExpanded)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-all text-[11px] font-bold"
                          >
                            {isTimeControlExpanded ? (
                              <>
                                <span>向上折叠</span>
                                <ChevronUp size={14} />
                              </>
                            ) : (
                              <>
                                <span>展开设置 ({currentDaySlots.filter(Boolean).length}/96 开启)</span>
                                <ChevronDown size={14} />
                              </>
                            )}
                          </button>

                          <div className="flex bg-slate-100 p-0.5 rounded-lg">
                            <button 
                              type="button"
                              onClick={() => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, timeControl: {...tc, mode: '+2'}}})}
                              className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${tc.mode === '+2' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                            >+2 模式</button>
                            <button 
                              type="button"
                              onClick={() => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, timeControl: {...tc, mode: '-2'}}})}
                              className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${tc.mode === '-2' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                            >-2 模式</button>
                          </div>
                        </div>

                        <Toggle 
                          enabled={tc.enabled ?? true} 
                          onChange={e => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, timeControl: {...tc, enabled: e}}})} 
                        />
                      </div>

                      {isTimeControlExpanded && (
                        <div className="space-y-4 animate-fadeIn">
                          {/* 周一至周日页签及批量快捷按纽 */}
                          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200/80 p-2.5 rounded-2xl">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] font-bold text-slate-500 px-1">选择星期:</span>
                              {weekDaysConfig.map(({ day, label }) => {
                                const daySlots = weekSlotsMap[day] || [];
                                const activeCount = daySlots.filter(Boolean).length;
                                const isSelected = selectedTimeControlDay === day;
                                return (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => setSelectedTimeControlDay(day)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
                                      isSelected
                                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                                    }`}
                                  >
                                    <span>{label}</span>
                                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                                      isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'
                                    }`}>
                                      {activeCount}/96
                                    </span>
                                  </button>
                                );
                              })}
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => updateCurrentDaySlots(Array(96).fill(true))}
                                className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all border border-emerald-200/60"
                              >
                                本日全部开启
                              </button>
                              <button
                                type="button"
                                onClick={() => updateCurrentDaySlots(Array(96).fill(false))}
                                className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-all border border-slate-200"
                              >
                                本日全部关闭
                              </button>
                              <button
                                type="button"
                                onClick={() => syncToAllDays(currentDaySlots)}
                                className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-all border border-indigo-200/80"
                                title="把当前星期的时段配置复制并应用到周一至周日"
                              >
                                复制到全周 (同步7天)
                              </button>
                            </div>
                          </div>

                          {/* 24小时，每小时4个绝对15分钟Slot */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
                            {Array.from({ length: 24 }).map((_, hour) => {
                              const hourStartIdx = hour * 4;
                              const hourSlots = currentDaySlots.slice(hourStartIdx, hourStartIdx + 4);
                              const allHourActive = hourSlots.every(Boolean);
                              const someHourActive = hourSlots.some(Boolean);

                              return (
                                <div key={hour} className="p-3.5 bg-slate-50/70 rounded-2xl border border-slate-100 space-y-2.5 hover:border-slate-200 transition-all">
                                  <div className="flex items-center justify-between border-b border-slate-100/80 pb-2">
                                    <span className="text-[11px] font-black text-slate-800 tracking-wider">
                                      {hour.toString().padStart(2, '0')}:00 - {(hour + 1 === 24 ? '00' : (hour + 1).toString().padStart(2, '0'))}:00
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newSlots = [...currentDaySlots];
                                        const targetVal = !allHourActive;
                                        for (let i = 0; i < 4; i++) {
                                          newSlots[hourStartIdx + i] = targetVal;
                                        }
                                        updateCurrentDaySlots(newSlots);
                                      }}
                                      className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold transition-all ${
                                        allHourActive 
                                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' 
                                          : someHourActive 
                                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                                          : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                                      }`}
                                    >
                                      {allHourActive ? '整点开启' : someHourActive ? '部分开启' : '整点关闭'}
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-4 gap-1.5">
                                    {['00', '15', '30', '45'].map((minuteStr, idx) => {
                                      const slotIdx = hourStartIdx + idx;
                                      const active = currentDaySlots[slotIdx];
                                      return (
                                        <button
                                          key={slotIdx}
                                          type="button"
                                          onClick={() => {
                                            const newSlots = [...currentDaySlots];
                                            newSlots[slotIdx] = !active;
                                            updateCurrentDaySlots(newSlots);
                                          }}
                                          className={`py-1.5 px-1 rounded-xl text-[10px] font-bold tracking-tight transition-all text-center border ${
                                            active
                                              ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/20'
                                              : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
                                          }`}
                                        >
                                          :{minuteStr}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </section>
            </div>
          )}

          {activeTab === 'order' && (
            <div className="space-y-8">
              <SectionHeader title="仓单模块设置" description="配置交易杠杆、仓位及止盈止损逻辑" />
              
              {/* Top Row: Win Streak, Sweep Skip & Trailing Parameters */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-5 bg-amber-50/40 rounded-3xl border border-amber-100/60">
                <Input 
                  label="连赢单阈值" 
                  type="number" 
                  value={String(localSettings.order?.winStreakThreshold ?? 20)} 
                  onChange={v => setLocalSettings({
                    ...localSettings, 
                    order: { ...localSettings.order, winStreakThreshold: Number(v) }
                  })} 
                />
                <Input 
                  label="扫跳次数" 
                  type="number" 
                  value={String(localSettings.order?.sweepSkipCount ?? 0)} 
                  onChange={v => setLocalSettings({
                    ...localSettings, 
                    order: { ...localSettings.order, sweepSkipCount: Number(v) }
                  })} 
                />
                <Input 
                  label="启动追踪时间 (分钟)" 
                  type="number" 
                  value={String(localSettings.order?.trailingStartMinutes ?? 3)} 
                  onChange={v => setLocalSettings({
                    ...localSettings, 
                    order: { ...localSettings.order, trailingStartMinutes: Number(v) }
                  })} 
                />
                <Input 
                  label="追踪平仓系数" 
                  type="number" 
                  value={String(localSettings.order?.trailingCloseRatio ?? 0)} 
                  onChange={v => setLocalSettings({
                    ...localSettings, 
                    order: { ...localSettings.order, trailingCloseRatio: Number(v) }
                  })} 
                />
              </div>

              {/* Row 1: Basic Order Params */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <Input label="杠杆倍数 L" type="number" value={String(localSettings.order?.leverage ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, leverage: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <Input label="仓位比例 CW (%)" type="number" value={String(localSettings.order?.positionRatio ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, positionRatio: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <Input label="最大仓位额 KCMAX (USDT)" type="number" value={String(localSettings.order?.maxPosition ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, maxPosition: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <div className="flex items-end justify-between gap-3">
                    <div className="flex-1">
                      <Input label="优选下单数量限制" type="number" value={String(localSettings.order?.preferredOrderCount ?? 2)} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, preferredOrderCount: Number(v)}})} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setLocalSettings({
                        ...localSettings,
                        order: {
                          ...localSettings.order,
                          sameDirectionOnly: !localSettings.order?.sameDirectionOnly
                        }
                      })}
                      className={`px-3 py-2.5 rounded-2xl font-black text-xs tracking-wider transition-all border shrink-0 cursor-pointer ${
                        localSettings.order?.sameDirectionOnly
                          ? 'bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-500/20'
                          : 'bg-slate-100 text-slate-400 border-slate-200 hover:text-slate-600 hover:bg-slate-200'
                      }`}
                      title={localSettings.order?.sameDirectionOnly ? "同向模式已开启：仅开设与优选币对同方向的订单" : "同向模式已关闭：按优选顺序开启所有符合条件的订单"}
                    >
                      同向
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <h4 className="text-xs font-black text-emerald-600 uppercase tracking-wider mb-1">📈 Stage 2 振幅形态过滤 (常规止盈止损参数)</h4>
              </div>

              {/* Row 2: M Link & TP/SL */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                    <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">关联M设置</span>
                    <Toggle enabled={localSettings.order?.mLinkEnabled ?? false} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, mLinkEnabled: e}})} />
                  </div>
                  <Input label="关联M值" type="number" value={String(localSettings.order?.mLinkValue ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, mLinkValue: Number(v)}})} />
                </div>

                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止盈设置</span>
                      <Toggle enabled={localSettings.order.tpEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, tpEnabled: e}})} />
                    </div>
                  </div>
                  
                  {/* 多单止盈 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-400">多单止盈模式</span>
                        <Toggle enabled={localSettings.order.tpBuyEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, tpBuyEnabled: e}})} />
                      </div>
                      <div className="flex bg-slate-200 p-0.5 rounded-lg">
                        {(['ratio', 'fixed', 'amp'] as const).map(m => (
                          <button key={m} onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, tpModeBuy: m}})}
                            className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.tpModeBuy === m ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>
                            {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {localSettings.order.tpModeBuy === 'ratio' ? (
                      <Input label="多 比例 TPB (%)" type="number" value={String(localSettings.order?.tpRatioBuy ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, tpRatioBuy: Number(v)}})} />
                    ) : localSettings.order.tpModeBuy === 'fixed' ? (
                      <Input label="多 固定值 (%)" type="number" value={String(localSettings.order?.tpFixedBuy ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, tpFixedBuy: Number(v)}})} />
                    ) : (
                      <Input label="多 振比 (%)" type="number" value={String(localSettings.order?.tpAmpBuy ?? 20)} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, tpAmpBuy: Number(v)}})} />
                    )}
                  </div>

                  {/* 空单止盈 */}
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-400">空单止盈模式</span>
                        <Toggle enabled={localSettings.order.tpSellEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, tpSellEnabled: e}})} />
                      </div>
                      <div className="flex bg-slate-200 p-0.5 rounded-lg">
                        {(['ratio', 'fixed', 'amp'] as const).map(m => (
                          <button key={m} onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, tpModeSell: m}})}
                            className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.tpModeSell === m ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>
                            {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {localSettings.order.tpModeSell === 'ratio' ? (
                      <Input label="空 比例 TPB (%)" type="number" value={String(localSettings.order?.tpRatioSell ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, tpRatioSell: Number(v)}})} />
                    ) : localSettings.order.tpModeSell === 'fixed' ? (
                      <Input label="空 固定值 (%)" type="number" value={String(localSettings.order?.tpFixedSell ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, tpFixedSell: Number(v)}})} />
                    ) : (
                      <Input label="空 振比 (%)" type="number" value={String(localSettings.order?.tpAmpSell ?? 20)} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, tpAmpSell: Number(v)}})} />
                    )}
                  </div>
                </div>

                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止损设置</span>
                      <Toggle enabled={localSettings.order.slEnabled ?? false} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, slEnabled: e}})} />
                    </div>
                  </div>

                  {/* 多单止损 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-400">多单止损模式</span>
                        <Toggle enabled={localSettings.order.slBuyEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, slBuyEnabled: e}})} />
                      </div>
                      <div className="flex bg-slate-200 p-0.5 rounded-lg">
                        {(['ratio', 'fixed', 'amp'] as const).map(m => (
                          <button key={m} onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, slModeBuy: m}})}
                            className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.slModeBuy === m ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}>
                            {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {localSettings.order.slModeBuy === 'ratio' ? (
                      <Input label="多 比例 SLB (%)" type="number" value={String(localSettings.order?.slRatioBuy ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, slRatioBuy: Number(v)}})} />
                    ) : localSettings.order.slModeBuy === 'fixed' ? (
                      <Input label="多 固定值 (%)" type="number" value={String(localSettings.order?.slFixedBuy ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, slFixedBuy: Number(v)}})} />
                    ) : (
                      <Input label="多 振比 (%)" type="number" value={String(localSettings.order?.slAmpBuy ?? 55)} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, slAmpBuy: Number(v)}})} />
                    )}
                  </div>

                  {/* 空单止损 */}
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-400">空单止损模式</span>
                        <Toggle enabled={localSettings.order.slSellEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, slSellEnabled: e}})} />
                      </div>
                      <div className="flex bg-slate-200 p-0.5 rounded-lg">
                        {(['ratio', 'fixed', 'amp'] as const).map(m => (
                          <button key={m} onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, slModeSell: m}})}
                            className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.slModeSell === m ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}>
                            {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {localSettings.order.slModeSell === 'ratio' ? (
                      <Input label="空 比例 SLB (%)" type="number" value={String(localSettings.order?.slRatioSell ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, slRatioSell: Number(v)}})} />
                    ) : localSettings.order.slModeSell === 'fixed' ? (
                      <Input label="空 固定值 (%)" type="number" value={String(localSettings.order?.slFixedSell ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, slFixedSell: Number(v)}})} />
                    ) : (
                      <Input label="空 振比 (%)" type="number" value={String(localSettings.order?.slAmpSell ?? 55)} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, slAmpSell: Number(v)}})} />
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <h4 className="text-xs font-black text-rose-500 uppercase tracking-wider mb-1">⚡ Stage 2 单K形态过滤 (单K止盈止损参数)</h4>
              </div>

              {/* Row 2b: Single K M Link & TP/SL */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                    <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">关联M设置 (单K)</span>
                    <Toggle enabled={localSettings.order?.singleKMLinkEnabled ?? false} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, singleKMLinkEnabled: e}})} />
                  </div>
                  <Input label="关联M值" type="number" value={String(localSettings.order?.singleKMLinkValue ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKMLinkValue: Number(v)}})} />
                </div>

                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止盈设置 (单K)</span>
                      <Toggle enabled={localSettings.order.singleKTpEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpEnabled: e}})} />
                    </div>
                  </div>
                  
                  {/* 多单止盈 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-400">多单止盈模式</span>
                        <Toggle enabled={localSettings.order.singleKTpBuyEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpBuyEnabled: e}})} />
                      </div>
                      <div className="flex bg-slate-200 p-0.5 rounded-lg">
                        {(['ratio', 'fixed', 'amp'] as const).map(m => (
                          <button key={m} onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpModeBuy: m}})}
                            className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.singleKTpModeBuy === m ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>
                            {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {localSettings.order.singleKTpModeBuy === 'ratio' ? (
                      <Input label="多 比例 TPB (%)" type="number" value={String(localSettings.order?.singleKTpRatioBuy ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpRatioBuy: Number(v)}})} />
                    ) : localSettings.order.singleKTpModeBuy === 'fixed' ? (
                      <Input label="多 固定值 (%)" type="number" value={String(localSettings.order?.singleKTpFixedBuy ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpFixedBuy: Number(v)}})} />
                    ) : (
                      <Input label="多 振比 (%)" type="number" value={String(localSettings.order?.singleKTpAmpBuy ?? 20)} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpAmpBuy: Number(v)}})} />
                    )}
                  </div>

                  {/* 空单止盈 */}
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-400">空单止盈模式</span>
                        <Toggle enabled={localSettings.order.singleKTpSellEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpSellEnabled: e}})} />
                      </div>
                      <div className="flex bg-slate-200 p-0.5 rounded-lg">
                        {(['ratio', 'fixed', 'amp'] as const).map(m => (
                          <button key={m} onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpModeSell: m}})}
                            className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.singleKTpModeSell === m ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>
                            {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {localSettings.order.singleKTpModeSell === 'ratio' ? (
                      <Input label="空 比例 TPB (%)" type="number" value={String(localSettings.order?.singleKTpRatioSell ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpRatioSell: Number(v)}})} />
                    ) : localSettings.order.singleKTpModeSell === 'fixed' ? (
                      <Input label="空 固定值 (%)" type="number" value={String(localSettings.order?.singleKTpFixedSell ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpFixedSell: Number(v)}})} />
                    ) : (
                      <Input label="空 振比 (%)" type="number" value={String(localSettings.order?.singleKTpAmpSell ?? 20)} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKTpAmpSell: Number(v)}})} />
                    )}
                  </div>
                </div>

                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止损设置 (单K)</span>
                      <Toggle enabled={localSettings.order.singleKSlEnabled ?? false} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlEnabled: e}})} />
                    </div>
                  </div>

                  {/* 多单止损 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-400">多单止损模式</span>
                        <Toggle enabled={localSettings.order.singleKSlBuyEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlBuyEnabled: e}})} />
                      </div>
                      <div className="flex bg-slate-200 p-0.5 rounded-lg">
                        {(['ratio', 'fixed', 'amp'] as const).map(m => (
                          <button key={m} onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlModeBuy: m}})}
                            className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.singleKSlModeBuy === m ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}>
                            {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {localSettings.order.singleKSlModeBuy === 'ratio' ? (
                      <Input label="多 比例 SLB (%)" type="number" value={String(localSettings.order?.singleKSlRatioBuy ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlRatioBuy: Number(v)}})} />
                    ) : localSettings.order.singleKSlModeBuy === 'fixed' ? (
                      <Input label="多 固定值 (%)" type="number" value={String(localSettings.order?.singleKSlFixedBuy ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlFixedBuy: Number(v)}})} />
                    ) : (
                      <Input label="多 振比 (%)" type="number" value={String(localSettings.order?.singleKSlAmpBuy ?? 55)} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlAmpBuy: Number(v)}})} />
                    )}
                  </div>

                  {/* 空单止损 */}
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-400">空单止损模式</span>
                        <Toggle enabled={localSettings.order.singleKSlSellEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlSellEnabled: e}})} />
                      </div>
                      <div className="flex bg-slate-200 p-0.5 rounded-lg">
                        {(['ratio', 'fixed', 'amp'] as const).map(m => (
                          <button key={m} onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlModeSell: m}})}
                            className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.singleKSlModeSell === m ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}>
                            {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {localSettings.order.singleKSlModeSell === 'ratio' ? (
                      <Input label="空 比例 SLB (%)" type="number" value={String(localSettings.order?.singleKSlRatioSell ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlRatioSell: Number(v)}})} />
                    ) : localSettings.order.singleKSlModeSell === 'fixed' ? (
                      <Input label="空 固定值 (%)" type="number" value={String(localSettings.order?.singleKSlFixedSell ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlFixedSell: Number(v)}})} />
                    ) : (
                      <Input label="空 振比 (%)" type="number" value={String(localSettings.order?.singleKSlAmpSell ?? 55)} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, singleKSlAmpSell: Number(v)}})} />
                    )}
                  </div>
                </div>
              </div>

              {/* Row 3: Time Windows & K-Best */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <Input label="正向单窗口 (s)" type="number" value={String(localSettings.order?.positiveWindow ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, positiveWindow: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <Input label="最大持仓时间 (min)" type="number" value={String(localSettings.order?.maxHoldTime ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, maxHoldTime: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                   <Input label="k优收绝对周期" value={localSettings.order?.kBestPeriod || ''} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, kBestPeriod: v}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-between space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">到期价格记录</span>
                    <Toggle 
                      enabled={localSettings.order?.enableExpiryPrice ?? true} 
                      onChange={e => setLocalSettings({
                        ...localSettings, 
                        order: { ...localSettings.order, enableExpiryPrice: e }
                      })} 
                    />
                  </div>
                  <span className="text-[10px] text-slate-400">达到最大持仓时间后，REST API 获取并记录币对最新价格</span>
                </div>
              </div>

              {/* Row 4: Calc Mode Selector & K-Best Window */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-between space-y-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止盈止损计算与挂单触发时机</span>
                    <span className="text-[10px] text-slate-400">设置计算TP/SL及开始挂 limit 单和 algo 委托单的合适时机。</span>
                  </div>
                  <div className="flex bg-slate-200 p-0.5 rounded-lg w-full">
                    <button type="button" onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, tpSlCalcMode: 'closedK'}})}
                      className={`flex-1 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${(!localSettings.order?.tpSlCalcMode || localSettings.order?.tpSlCalcMode === 'closedK') ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>
                      封盘后权威计算 (默认)
                    </button>
                    <button type="button" onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, tpSlCalcMode: 'stage2'}})}
                      className={`flex-1 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${localSettings.order?.tpSlCalcMode === 'stage2' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>
                      Stage 2 扫描即刻挂单
                    </button>
                  </div>
                </div>
                {(!localSettings.order?.tpSlCalcMode || localSettings.order?.tpSlCalcMode === 'closedK') ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="k优收窗口开始 (s)" type="number" value={String(localSettings.order?.kBestWindow?.[0] ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, kBestWindow: [Number(v), localSettings.order.kBestWindow[1]]}})} />
                    <Input label="k优收窗口结束 (s)" type="number" value={String(localSettings.order?.kBestWindow?.[1] ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, kBestWindow: [localSettings.order.kBestWindow[0], Number(v)]}})} />
                  </div>
                ) : (
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-center items-center text-center space-y-1">
                    <span className="text-[11px] font-bold text-emerald-600">Stage 2 立即挂单模式已上线 ⚡</span>
                    <span className="text-[10px] text-slate-500 leading-relaxed max-w-sm font-light">
                      系统将在筛选完毕时，立刻根据当时的指标与成交价，计算止盈止损值并直接开始向交易所挂 limit 单与 algo 止损。无需轮询/探测封盘 K 线数据。
                    </span>
                  </div>
                )}
              </div>

              {/* Row 5: Second Order Customization Settings */}
              {(localSettings.order?.preferredOrderCount ?? 2) >= 2 && (
                <div className="p-6 bg-slate-50/30 rounded-3xl border border-slate-100 space-y-6 mt-6">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div>
                      <h4 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
                        <span>🥈 第二仓单独立自定义参数</span>
                        {localSettings.order?.secondOrderCustomEnabled && (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[9px] font-bold rounded-full border border-emerald-100">已启用</span>
                        )}
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">当优选限制大于等于 2 时，可对第二个成交的仓单单独配置个性化杠杆、仓位、止盈止损及最长持仓时间</p>
                    </div>
                    <Toggle 
                      enabled={localSettings.order?.secondOrderCustomEnabled ?? false} 
                      onChange={e => setLocalSettings({
                        ...localSettings, 
                        order: {
                          ...localSettings.order, 
                          secondOrderCustomEnabled: e
                        }
                      })} 
                    />
                  </div>

                  {localSettings.order?.secondOrderCustomEnabled && (
                    <div className="space-y-6">
                      {/* Row 1: Basic Params */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="p-4 bg-white rounded-2xl border border-slate-100 flex flex-col justify-end">
                          <Input 
                            label="第二仓单杠杆 L2" 
                            type="number" 
                            value={String(localSettings.order?.secondLeverage ?? 5)} 
                            onChange={v => setLocalSettings({
                              ...localSettings, 
                              order: {
                                ...localSettings.order, 
                                secondLeverage: Number(v)
                              }
                            })} 
                          />
                        </div>
                        <div className="p-4 bg-white rounded-2xl border border-slate-100 flex flex-col justify-end">
                          <Input 
                            label="第二仓单仓位比例 CW2 (%)" 
                            type="number" 
                            value={String(localSettings.order?.secondPositionRatio ?? 40)} 
                            onChange={v => setLocalSettings({
                              ...localSettings, 
                              order: {
                                ...localSettings.order, 
                                secondPositionRatio: Number(v)
                              }
                            })} 
                          />
                        </div>
                        <div className="p-4 bg-white rounded-2xl border border-slate-100 flex flex-col justify-end">
                          <Input 
                            label="最大仓位额 KCMAX2 (USDT)" 
                            type="number" 
                            value={String(localSettings.order?.secondMaxPosition ?? 40000)} 
                            onChange={v => setLocalSettings({
                              ...localSettings, 
                              order: {
                                ...localSettings.order, 
                                secondMaxPosition: Number(v)
                              }
                            })} 
                          />
                        </div>
                        <div className="p-4 bg-white rounded-2xl border border-slate-100 flex flex-col justify-end">
                          <Input 
                            label="最大持仓时间2 (MIN)" 
                            type="number" 
                            value={String(localSettings.order?.secondMaxHoldTime ?? 15)} 
                            onChange={v => setLocalSettings({
                              ...localSettings, 
                              order: {
                                ...localSettings.order, 
                                secondMaxHoldTime: Number(v)
                              }
                            })} 
                          />
                        </div>
                      </div>

                      {/* Row 2: M Link & TP/SL */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* 关联M设置 */}
                        <div className="p-5 bg-white rounded-3xl border border-slate-100 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                            <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">关联M设置</span>
                            <Toggle 
                              enabled={localSettings.order?.secondMLinkEnabled ?? false} 
                              onChange={e => setLocalSettings({
                                ...localSettings, 
                                order: {
                                  ...localSettings.order, 
                                  secondMLinkEnabled: e
                                }
                              })} 
                            />
                          </div>
                          <Input 
                            label="关联M值" 
                            type="number" 
                            value={String(localSettings.order?.secondMLinkValue ?? 1800)} 
                            onChange={v => setLocalSettings({
                              ...localSettings, 
                              order: {
                                ...localSettings.order, 
                                secondMLinkValue: Number(v)
                              }
                            })} 
                          />
                        </div>

                        {/* 止盈设置 */}
                        <div className="p-5 bg-white rounded-3xl border border-slate-100 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止盈设置</span>
                              <Toggle 
                                enabled={localSettings.order?.secondTpEnabled ?? true} 
                                onChange={e => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondTpEnabled: e
                                  }
                                })} 
                              />
                            </div>
                          </div>
                          
                          {/* 多单止盈 */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-slate-400">多单止盈模式</span>
                                <Toggle 
                                  enabled={localSettings.order?.secondTpBuyEnabled ?? true} 
                                  onChange={e => setLocalSettings({
                                    ...localSettings, 
                                    order: {
                                      ...localSettings.order, 
                                      secondTpBuyEnabled: e
                                    }
                                  })} 
                                />
                              </div>
                              <div className="flex bg-slate-200 p-0.5 rounded-lg">
                                {(['ratio', 'fixed', 'amp'] as const).map(m => (
                                  <button 
                                    key={m} 
                                    type="button"
                                    onClick={() => setLocalSettings({
                                      ...localSettings, 
                                      order: {
                                        ...localSettings.order, 
                                        secondTpModeBuy: m
                                      }
                                    })}
                                    className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                      (localSettings.order?.secondTpModeBuy ?? 'ratio') === m 
                                        ? 'bg-white text-emerald-600 shadow-sm' 
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {(localSettings.order?.secondTpModeBuy ?? 'ratio') === 'ratio' ? (
                              <Input 
                                label="多 比例 TPB2 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondTpRatioBuy ?? 42)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondTpRatioBuy: Number(v)
                                  }
                                })} 
                              />
                            ) : (localSettings.order?.secondTpModeBuy ?? 'ratio') === 'fixed' ? (
                              <Input 
                                label="多 固定值 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondTpFixedBuy ?? 2)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondTpFixedBuy: Number(v)
                                  }
                                })} 
                              />
                            ) : (
                              <Input 
                                label="多 振比 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondTpAmpBuy ?? 25)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondTpAmpBuy: Number(v)
                                  }
                                })} 
                              />
                            )}
                          </div>

                          {/* 空单止盈 */}
                          <div className="space-y-3 border-t border-slate-100 pt-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-slate-400">空单止盈模式</span>
                                <Toggle 
                                  enabled={localSettings.order?.secondTpSellEnabled ?? true} 
                                  onChange={e => setLocalSettings({
                                    ...localSettings, 
                                    order: {
                                      ...localSettings.order, 
                                      secondTpSellEnabled: e
                                    }
                                  })} 
                                />
                              </div>
                              <div className="flex bg-slate-200 p-0.5 rounded-lg">
                                {(['ratio', 'fixed', 'amp'] as const).map(m => (
                                  <button 
                                    key={m} 
                                    type="button"
                                    onClick={() => setLocalSettings({
                                      ...localSettings, 
                                      order: {
                                        ...localSettings.order, 
                                        secondTpModeSell: m
                                      }
                                    })}
                                    className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                      (localSettings.order?.secondTpModeSell ?? 'ratio') === m 
                                        ? 'bg-white text-emerald-600 shadow-sm' 
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {(localSettings.order?.secondTpModeSell ?? 'ratio') === 'ratio' ? (
                              <Input 
                                label="空 比例 TPS2 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondTpRatioSell ?? 42)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondTpRatioSell: Number(v)
                                  }
                                })} 
                              />
                            ) : (localSettings.order?.secondTpModeSell ?? 'ratio') === 'fixed' ? (
                              <Input 
                                label="空 固定值 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondTpFixedSell ?? 2)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondTpFixedSell: Number(v)
                                  }
                                })} 
                              />
                            ) : (
                              <Input 
                                label="空 振比 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondTpAmpSell ?? 25)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondTpAmpSell: Number(v)
                                  }
                                })} 
                              />
                            )}
                          </div>
                        </div>

                        {/* 止损设置 */}
                        <div className="p-5 bg-white rounded-3xl border border-slate-100 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止损设置</span>
                              <Toggle 
                                enabled={localSettings.order?.secondSlEnabled ?? true} 
                                onChange={e => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSlEnabled: e
                                  }
                                })} 
                              />
                            </div>
                          </div>

                          {/* 多单止损 */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-slate-400">多单止损模式</span>
                                <Toggle 
                                  enabled={localSettings.order?.secondSlBuyEnabled ?? true} 
                                  onChange={e => setLocalSettings({
                                    ...localSettings, 
                                    order: {
                                      ...localSettings.order, 
                                      secondSlBuyEnabled: e
                                    }
                                  })} 
                                />
                              </div>
                              <div className="flex bg-slate-200 p-0.5 rounded-lg">
                                {(['ratio', 'fixed', 'amp'] as const).map(m => (
                                  <button 
                                    key={m} 
                                    type="button"
                                    onClick={() => setLocalSettings({
                                      ...localSettings, 
                                      order: {
                                        ...localSettings.order, 
                                        secondSlModeBuy: m
                                      }
                                    })}
                                    className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                      (localSettings.order?.secondSlModeBuy ?? 'ratio') === m 
                                        ? 'bg-white text-rose-600 shadow-sm' 
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {(localSettings.order?.secondSlModeBuy ?? 'ratio') === 'ratio' ? (
                              <Input 
                                label="多 比例 SLB2 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSlRatioBuy ?? 85)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSlRatioBuy: Number(v)
                                  }
                                })} 
                              />
                            ) : (localSettings.order?.secondSlModeBuy ?? 'ratio') === 'fixed' ? (
                              <Input 
                                label="多 固定值 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSlFixedBuy ?? 20)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSlFixedBuy: Number(v)
                                  }
                                })} 
                              />
                            ) : (
                              <Input 
                                label="多 振比 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSlAmpBuy ?? 85)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSlAmpBuy: Number(v)
                                  }
                                })} 
                              />
                            )}
                          </div>

                          {/* 空单止损 */}
                          <div className="space-y-3 border-t border-slate-100 pt-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-slate-400">空单止损模式</span>
                                <Toggle 
                                  enabled={localSettings.order?.secondSlSellEnabled ?? true} 
                                  onChange={e => setLocalSettings({
                                    ...localSettings, 
                                    order: {
                                      ...localSettings.order, 
                                      secondSlSellEnabled: e
                                    }
                                  })} 
                                />
                              </div>
                              <div className="flex bg-slate-200 p-0.5 rounded-lg">
                                {(['ratio', 'fixed', 'amp'] as const).map(m => (
                                  <button 
                                    key={m} 
                                    type="button"
                                    onClick={() => setLocalSettings({
                                      ...localSettings, 
                                      order: {
                                        ...localSettings.order, 
                                        secondSlModeSell: m
                                      }
                                    })}
                                    className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                      (localSettings.order?.secondSlModeSell ?? 'ratio') === m 
                                        ? 'bg-white text-rose-600 shadow-sm' 
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {(localSettings.order?.secondSlModeSell ?? 'ratio') === 'ratio' ? (
                              <Input 
                                label="空 比例 SLS2 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSlRatioSell ?? 85)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSlRatioSell: Number(v)
                                  }
                                })} 
                              />
                            ) : (localSettings.order?.secondSlModeSell ?? 'ratio') === 'fixed' ? (
                              <Input 
                                label="空 固定值 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSlFixedSell ?? 20)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSlFixedSell: Number(v)
                                  }
                                })} 
                              />
                            ) : (
                              <Input 
                                label="空 振比 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSlAmpSell ?? 85)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSlAmpSell: Number(v)
                                  }
                                })} 
                              />
                            )}
                          </div>
                        </div>

                        {/* Row 3: Stage 2 Single K Form Filtering */}
                        <div className="pt-4 border-t border-slate-100 col-span-1 md:col-span-3">
                          <h4 className="text-xs font-black text-rose-500 uppercase tracking-wider mb-1">⚡ Stage 2 单K形态过滤 (单K止盈止损参数2)</h4>
                        </div>

                        {/* 关联M设置 (单K2) */}
                        <div className="p-5 bg-white rounded-3xl border border-slate-100 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                            <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">关联M设置 (单K2)</span>
                            <Toggle 
                              enabled={localSettings.order?.secondSingleKMLinkEnabled ?? false} 
                              onChange={e => setLocalSettings({
                                ...localSettings, 
                                order: {
                                  ...localSettings.order, 
                                  secondSingleKMLinkEnabled: e
                                }
                              })} 
                            />
                          </div>
                          <Input 
                            label="关联M值" 
                            type="number" 
                            value={String(localSettings.order?.secondSingleKMLinkValue ?? 1800)} 
                            onChange={v => setLocalSettings({
                              ...localSettings, 
                              order: {
                                ...localSettings.order, 
                                secondSingleKMLinkValue: Number(v)
                              }
                            })} 
                          />
                        </div>

                        {/* 止盈设置 (单K2) */}
                        <div className="p-5 bg-white rounded-3xl border border-slate-100 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止盈设置 (单K2)</span>
                              <Toggle 
                                enabled={localSettings.order?.secondSingleKTpEnabled ?? true} 
                                onChange={e => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKTpEnabled: e
                                  }
                                })} 
                              />
                            </div>
                          </div>
                          
                          {/* 多单止盈 */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-slate-400">多单止盈模式</span>
                                <Toggle 
                                  enabled={localSettings.order?.secondSingleKTpBuyEnabled ?? true} 
                                  onChange={e => setLocalSettings({
                                    ...localSettings, 
                                    order: {
                                      ...localSettings.order, 
                                      secondSingleKTpBuyEnabled: e
                                    }
                                  })} 
                                />
                              </div>
                              <div className="flex bg-slate-200 p-0.5 rounded-lg">
                                {(['ratio', 'fixed', 'amp'] as const).map(m => (
                                  <button 
                                    key={m} 
                                    type="button"
                                    onClick={() => setLocalSettings({
                                      ...localSettings, 
                                      order: {
                                        ...localSettings.order, 
                                        secondSingleKTpModeBuy: m
                                      }
                                    })}
                                    className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                      (localSettings.order?.secondSingleKTpModeBuy ?? 'amp') === m 
                                        ? 'bg-white text-emerald-600 shadow-sm' 
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {(localSettings.order?.secondSingleKTpModeBuy ?? 'amp') === 'ratio' ? (
                              <Input 
                                label="多 比例 TPB2 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKTpRatioBuy ?? 25)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKTpRatioBuy: Number(v)
                                  }
                                })} 
                              />
                            ) : (localSettings.order?.secondSingleKTpModeBuy ?? 'amp') === 'fixed' ? (
                              <Input 
                                label="多 固定值 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKTpFixedBuy ?? 2)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKTpFixedBuy: Number(v)
                                  }
                                })} 
                              />
                            ) : (
                              <Input 
                                label="多 振比 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKTpAmpBuy ?? 25)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKTpAmpBuy: Number(v)
                                  }
                                })} 
                              />
                            )}
                          </div>

                          {/* 空单止盈 */}
                          <div className="space-y-3 border-t border-slate-100 pt-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-slate-400">空单止盈模式</span>
                                <Toggle 
                                  enabled={localSettings.order?.secondSingleKTpSellEnabled ?? true} 
                                  onChange={e => setLocalSettings({
                                    ...localSettings, 
                                    order: {
                                      ...localSettings.order, 
                                      secondSingleKTpSellEnabled: e
                                    }
                                  })} 
                                />
                              </div>
                              <div className="flex bg-slate-200 p-0.5 rounded-lg">
                                {(['ratio', 'fixed', 'amp'] as const).map(m => (
                                  <button 
                                    key={m} 
                                    type="button"
                                    onClick={() => setLocalSettings({
                                      ...localSettings, 
                                      order: {
                                        ...localSettings.order, 
                                        secondSingleKTpModeSell: m
                                      }
                                    })}
                                    className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                      (localSettings.order?.secondSingleKTpModeSell ?? 'amp') === m 
                                        ? 'bg-white text-emerald-600 shadow-sm' 
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {(localSettings.order?.secondSingleKTpModeSell ?? 'amp') === 'ratio' ? (
                              <Input 
                                label="空 比例 TPS2 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKTpRatioSell ?? 25)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKTpRatioSell: Number(v)
                                  }
                                })} 
                              />
                            ) : (localSettings.order?.secondSingleKTpModeSell ?? 'amp') === 'fixed' ? (
                              <Input 
                                label="空 固定值 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKTpFixedSell ?? 2)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKTpFixedSell: Number(v)
                                  }
                                })} 
                              />
                            ) : (
                              <Input 
                                label="空 振比 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKTpAmpSell ?? 25)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKTpAmpSell: Number(v)
                                  }
                                })} 
                              />
                            )}
                          </div>
                        </div>

                        {/* 止损设置 (单K2) */}
                        <div className="p-5 bg-white rounded-3xl border border-slate-100 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止损设置 (单K2)</span>
                              <Toggle 
                                enabled={localSettings.order?.secondSingleKSlEnabled ?? true} 
                                onChange={e => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKSlEnabled: e
                                  }
                                })} 
                              />
                            </div>
                          </div>

                          {/* 多单止损 */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-slate-400">多单止损模式</span>
                                <Toggle 
                                  enabled={localSettings.order?.secondSingleKSlBuyEnabled ?? true} 
                                  onChange={e => setLocalSettings({
                                    ...localSettings, 
                                    order: {
                                      ...localSettings.order, 
                                      secondSingleKSlBuyEnabled: e
                                    }
                                  })} 
                                />
                              </div>
                              <div className="flex bg-slate-200 p-0.5 rounded-lg">
                                {(['ratio', 'fixed', 'amp'] as const).map(m => (
                                  <button 
                                    key={m} 
                                    type="button"
                                    onClick={() => setLocalSettings({
                                      ...localSettings, 
                                      order: {
                                        ...localSettings.order, 
                                        secondSingleKSlModeBuy: m
                                      }
                                    })}
                                    className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                      (localSettings.order?.secondSingleKSlModeBuy ?? 'fixed') === m 
                                        ? 'bg-white text-rose-600 shadow-sm' 
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {(localSettings.order?.secondSingleKSlModeBuy ?? 'fixed') === 'ratio' ? (
                              <Input 
                                label="多 比例 SLB2 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKSlRatioBuy ?? 20)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKSlRatioBuy: Number(v)
                                  }
                                })} 
                              />
                            ) : (localSettings.order?.secondSingleKSlModeBuy ?? 'fixed') === 'fixed' ? (
                              <Input 
                                label="多 固定值 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKSlFixedBuy ?? 20)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKSlFixedBuy: Number(v)
                                  }
                                })} 
                              />
                            ) : (
                              <Input 
                                label="多 振比 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKSlAmpBuy ?? 20)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKSlAmpBuy: Number(v)
                                  }
                                })} 
                              />
                            )}
                          </div>

                          {/* 空单止损 */}
                          <div className="space-y-3 border-t border-slate-100 pt-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-slate-400">空单止损模式</span>
                                <Toggle 
                                  enabled={localSettings.order?.secondSingleKSlSellEnabled ?? true} 
                                  onChange={e => setLocalSettings({
                                    ...localSettings, 
                                    order: {
                                      ...localSettings.order, 
                                      secondSingleKSlSellEnabled: e
                                    }
                                  })} 
                                />
                              </div>
                              <div className="flex bg-slate-200 p-0.5 rounded-lg">
                                {(['ratio', 'fixed', 'amp'] as const).map(m => (
                                  <button 
                                    key={m} 
                                    type="button"
                                    onClick={() => setLocalSettings({
                                      ...localSettings, 
                                      order: {
                                        ...localSettings.order, 
                                        secondSingleKSlModeSell: m
                                      }
                                    })}
                                    className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                      (localSettings.order?.secondSingleKSlModeSell ?? 'fixed') === m 
                                        ? 'bg-white text-rose-600 shadow-sm' 
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {m === 'ratio' ? '比例' : m === 'fixed' ? '固定' : '振比'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {(localSettings.order?.secondSingleKSlModeSell ?? 'fixed') === 'ratio' ? (
                              <Input 
                                label="空 比例 SLS2 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKSlRatioSell ?? 20)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKSlRatioSell: Number(v)
                                  }
                                })} 
                              />
                            ) : (localSettings.order?.secondSingleKSlModeSell ?? 'fixed') === 'fixed' ? (
                              <Input 
                                label="空 固定值 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKSlFixedSell ?? 20)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKSlFixedSell: Number(v)
                                  }
                                })} 
                              />
                            ) : (
                              <Input 
                                label="空 振比 (%)" 
                                type="number" 
                                value={String(localSettings.order?.secondSingleKSlAmpSell ?? 20)} 
                                onChange={v => setLocalSettings({
                                  ...localSettings, 
                                  order: {
                                    ...localSettings.order, 
                                    secondSingleKSlAmpSell: Number(v)
                                  }
                                })} 
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'withdrawal' && (
            <div className="space-y-10">
              <SectionHeader title="提补款模块设置" description="配置合约账户与现货账户之间的资金划转逻辑" />
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="提款阈值 (USDT)" type="number" value={String(localSettings.withdrawal?.withdrawalThreshold ?? '')} onChange={v => setLocalSettings({...localSettings, withdrawal: {...localSettings.withdrawal, withdrawalThreshold: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="留存阈值 (USDT)" type="number" value={String(localSettings.withdrawal?.retentionThreshold ?? '')} onChange={v => setLocalSettings({...localSettings, withdrawal: {...localSettings.withdrawal, retentionThreshold: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="余额报警阈值 (USDT)" type="number" value={String(localSettings.withdrawal?.alarmThreshold ?? '')} onChange={v => setLocalSettings({...localSettings, withdrawal: {...localSettings.withdrawal, alarmThreshold: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="补款金额 (USDT)" type="number" value={String(localSettings.withdrawal?.depositAmount ?? 30)} onChange={v => setLocalSettings({...localSettings, withdrawal: {...localSettings.withdrawal, depositAmount: Number(v)}})} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'backup' && (
            <div className="space-y-10">
              <SectionHeader 
                title="系统配置备份与一键恢复" 
                description="导出当前运行环境下的所有账户参数、API 密钥、扫描策略过滤器、仓单与提款阈值等，加密存储以确保安全。" 
              />
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Export Card */}
                <div className="bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100 flex flex-col justify-between h-full min-h-[250px] hover:border-emerald-200 hover:bg-emerald-50/10 transition-all group">
                  <div className="space-y-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shadow-sm group-hover:shadow-md transition-shadow">
                      <Save size={24} />
                    </div>
                    <div>
                      <h4 className="font-black text-slate-900 text-lg tracking-tight">导出加密备份文件</h4>
                      <p className="text-sm text-slate-400 font-medium mt-1 leading-relaxed">
                        生成并下载当前的全局配置备份。备份数据将使用高强度的安全算法进行全面加密，防范外部泄露，保障密钥安全。
                      </p>
                    </div>
                  </div>
                  <div className="mt-6">
                    <button
                      onClick={handleExportBackup}
                      disabled={isExporting}
                      className="flex items-center gap-2 px-6 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-emerald-600/10 transition-colors cursor-pointer"
                    >
                      {isExporting ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Save size={16} />
                      )}
                      <span>{isExporting ? '正在打包...' : '导出加密备份'}</span>
                    </button>
                  </div>
                </div>

                {/* Import Card */}
                <div className="bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100 flex flex-col justify-between h-full min-h-[250px] hover:border-blue-200 hover:bg-blue-50/10 transition-all group">
                  <div className="space-y-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 shadow-sm group-hover:shadow-md transition-shadow">
                      <RotateCcw size={24} />
                    </div>
                    <div>
                      <h4 className="font-black text-slate-900 text-lg tracking-tight">导入加密备份文件</h4>
                      <p className="text-sm text-slate-400 font-medium mt-1 leading-relaxed">
                        上传之前导出的加密备份文件，程序将自动解密并重载所有配置。注意：导入备份将覆盖现有的全部配置与账户信息，并自动重启交易引擎。
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 flex items-center gap-4">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isImporting}
                      className="flex items-center gap-2 px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-blue-600/10 transition-colors cursor-pointer"
                    >
                      {isImporting ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <RotateCcw size={16} />
                      )}
                      <span>{isImporting ? '正在解析...' : '导入加密备份'}</span>
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImportBackup}
                      accept=".enc,.json,.dat"
                      className="hidden"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, description, icon, noBorder }: { title: string; description?: string; icon?: React.ReactNode; noBorder?: boolean }) {
  return (
    <div className={`${noBorder ? '' : 'border-b border-slate-100 pb-6'}`}>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-slate-50 rounded-lg">
          {icon}
        </div>
        <h3 className="text-xl font-black text-slate-900 tracking-tight">{title}</h3>
      </div>
      {description && <p className="text-slate-400 text-sm mt-1 font-medium">{description}</p>}
    </div>
  );
}

function TabButton({ id, icon, label, active, onClick }: { id: string; icon: React.ReactNode; label: string; active: boolean; onClick: (id: string) => void }) {
  return (
    <button 
      onClick={() => onClick(id)}
      className={`flex items-center gap-3 px-6 py-4 rounded-2xl whitespace-nowrap transition-all shrink-0 ${
        active 
          ? 'bg-emerald-600 text-white font-black shadow-xl shadow-emerald-600/20' 
          : 'bg-slate-50 text-slate-400 hover:text-slate-900 hover:bg-slate-100 font-bold'
      }`}
    >
      {icon}
      <span className="text-xs uppercase tracking-widest">{label}</span>
    </button>
  );
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  const [displayValue, setDisplayValue] = React.useState(value);

  React.useEffect(() => {
    setDisplayValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setDisplayValue(v);
    
    if (type === 'number') {
      // Allow empty, minus sign, or decimal point as intermediate states
      if (v === '' || v === '-' || v === '.' || v === '-.') {
        return;
      }
      const num = parseFloat(v);
      if (!isNaN(num)) {
        onChange(v);
      }
    } else {
      onChange(v);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{label}</label>
      <input 
        type={type === 'number' ? 'text' : type} 
        value={displayValue}
        onChange={handleChange}
        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/50 font-mono text-sm text-slate-900 font-bold"
      />
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: { label: string, value: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{label}</label>
      <div className="relative">
        <select 
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/50 font-bold text-sm text-slate-900 appearance-none cursor-pointer"
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (e: boolean) => void }) {
  return (
    <button 
      onClick={() => onChange(!enabled)}
      className={`w-12 h-6 rounded-full relative transition-colors ${enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
    >
      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${enabled ? 'left-7' : 'left-1'}`} />
    </button>
  );
}

function Filter(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
