import Database from 'better-sqlite3';
import { TradeLog, TransferLog, BalanceLog } from '../types';
import path from 'path';
import fs from 'fs';
import CryptoJS from 'crypto-js';

const DB_SECRET_SALT = process.env.GATEKEEPER_KEY || 'SUPERNODE_2030_DB_AES_SECRET_KEY_SALT_2026';

function encryptVal(value: string): string {
  if (!value || typeof value !== 'string') return value;
  if (value.startsWith('ENC:')) return value;
  try {
    const encrypted = CryptoJS.AES.encrypt(value, DB_SECRET_SALT).toString();
    return `ENC:${encrypted}`;
  } catch (e) {
    return value;
  }
}

function decryptVal(value: string): string {
  if (!value || typeof value !== 'string') return value;
  if (!value.startsWith('ENC:')) return value;
  try {
    const cipherText = value.slice(4);
    const bytes = CryptoJS.AES.decrypt(cipherText, DB_SECRET_SALT);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted || value;
  } catch (e) {
    return value;
  }
}

function processSensitiveFields(obj: any, action: 'encrypt' | 'decrypt'): any {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  const processStr = action === 'encrypt' ? encryptVal : decryptVal;

  if (clone.remoteControl) {
    if (clone.remoteControl.secretKey) {
      clone.remoteControl.secretKey = processStr(clone.remoteControl.secretKey);
    }
    if (clone.remoteControl.allowedIps) {
      if (action === 'decrypt' || clone.remoteControl.allowedIps.startsWith('ENC:')) {
        clone.remoteControl.allowedIps = decryptVal(clone.remoteControl.allowedIps);
      }
    }
  }

  const processAccount = (acc: any) => {
    if (!acc || typeof acc !== 'object') return;
    if (acc.apiKey) acc.apiKey = processStr(acc.apiKey);
    if (acc.secretKey) acc.secretKey = processStr(acc.secretKey);
    if (acc.passphrase) acc.passphrase = processStr(acc.passphrase);
    if (acc.binance) {
      if (acc.binance.apiKey) acc.binance.apiKey = processStr(acc.binance.apiKey);
      if (acc.binance.secretKey) acc.binance.secretKey = processStr(acc.binance.secretKey);
    }
  };

  if (Array.isArray(clone.accounts)) {
    clone.accounts.forEach(processAccount);
  } else if (clone.binance || clone.apiKey) {
    processAccount(clone);
  }

  return clone;
}

export class DatabaseService {
  private db: any = null;
  private dbPath: string;

  constructor() {
    this.dbPath = path.join(process.cwd(), 'data', 'trades.db');
    // Ensure data directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private setupDatabaseTables() {
    console.log('Initializing database at:', this.dbPath);
    this.db = new Database(this.dbPath);
    
    // Set pragmas for performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trade_logs (
        id TEXT PRIMARY KEY,
        accountId TEXT DEFAULT 'default',
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        leverage REAL NOT NULL,
        amount REAL NOT NULL,
        entryPrice REAL NOT NULL,
        exitPrice REAL NOT NULL,
        expiryPrice REAL DEFAULT 0,
        pnl REAL NOT NULL,
        fee REAL NOT NULL,
        fundingFee REAL NOT NULL,
        fundingFeeCheckedCount INTEGER DEFAULT 0,
        fundingRate REAL,
        profitRate REAL NOT NULL,
        kBestChange REAL,
        amp REAL,
        mValue REAL,
        realA REAL,
        k2 REAL DEFAULT 0,
        openTime INTEGER NOT NULL,
        closeTime INTEGER NOT NULL,
        status TEXT NOT NULL,
        tpOrderId TEXT,
        slOrderId TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transfer_logs (
        id TEXT PRIMARY KEY,
        accountId TEXT DEFAULT 'default',
        asset TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        message TEXT
      )
    `);
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS balance_logs (
        id TEXT PRIMARY KEY,
        accountId TEXT DEFAULT 'default',
        totalBalance REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        spotBalance REAL DEFAULT 0
      )
    `);
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS klines (
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        openTime INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        closeTime INTEGER NOT NULL,
        quoteAssetVolume REAL,
        numberOfTrades INTEGER,
        takerBuyBaseAssetVolume REAL,
        takerBuyQuoteAssetVolume REAL,
        change REAL DEFAULT 0,
        amplitude REAL DEFAULT 0,
        PRIMARY KEY (symbol, interval, openTime)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id TEXT PRIMARY KEY,
        accountId TEXT DEFAULT 'default',
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        module TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT
      )
    `);

    // Add indexes for performance
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_logs_accountId ON trade_logs(accountId)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_transfer_logs_accountId ON transfer_logs(accountId)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_balance_logs_accountId ON balance_logs(accountId)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_logs_openTime ON trade_logs(openTime)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_logs_symbol ON trade_logs(symbol)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_transfer_logs_timestamp ON transfer_logs(timestamp)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_balance_logs_timestamp ON balance_logs(timestamp)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_klines_symbol_interval_time ON klines(symbol, interval, openTime)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_system_logs_accountId ON system_logs(accountId)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_system_logs_module ON system_logs(module)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_system_logs_type ON system_logs(type)`);

    // Migration: Add columns to existing tables
    const tradeLogsInfo = this.db.prepare("PRAGMA table_info(trade_logs)").all();
    const tradeLogColumns = tradeLogsInfo.map((col: any) => col.name);
    
    if (!tradeLogColumns.includes('accountId')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN accountId TEXT DEFAULT 'default'`);
    }
    if (!tradeLogColumns.includes('kBestChange')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN kBestChange REAL DEFAULT 0`);
    }
    if (!tradeLogColumns.includes('amp')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN amp REAL DEFAULT 0`);
    }
    if (!tradeLogColumns.includes('mValue')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN mValue REAL DEFAULT 0`);
    }
    if (!tradeLogColumns.includes('realA')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN realA REAL DEFAULT 0`);
    }
    if (!tradeLogColumns.includes('k2')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN k2 REAL DEFAULT 0`);
    }
    if (!tradeLogColumns.includes('fundingRate')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN fundingRate REAL DEFAULT 0`);
    }
    if (!tradeLogColumns.includes('tpOrderId')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN tpOrderId TEXT`);
    }
    if (!tradeLogColumns.includes('slOrderId')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN slOrderId TEXT`);
    }
    if (!tradeLogColumns.includes('strategyType')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN strategyType TEXT`);
    }
    if (!tradeLogColumns.includes('expiryPrice')) {
      this.db.exec(`ALTER TABLE trade_logs ADD COLUMN expiryPrice REAL DEFAULT 0`);
    }

    const transferLogsInfo = this.db.prepare("PRAGMA table_info(transfer_logs)").all();
    const transferLogColumns = transferLogsInfo.map((col: any) => col.name);
    if (!transferLogColumns.includes('accountId')) {
      this.db.exec(`ALTER TABLE transfer_logs ADD COLUMN accountId TEXT DEFAULT 'default'`);
    }

    const balanceLogsInfo = this.db.prepare("PRAGMA table_info(balance_logs)").all();
    const balanceLogColumns = balanceLogsInfo.map((col: any) => col.name);
    if (!balanceLogColumns.includes('accountId')) {
      this.db.exec(`ALTER TABLE balance_logs ADD COLUMN accountId TEXT DEFAULT 'default'`);
    }
    if (!balanceLogColumns.includes('spotBalance')) {
      this.db.exec(`ALTER TABLE balance_logs ADD COLUMN spotBalance REAL DEFAULT 0`);
    }

    const klinesInfo = this.db.prepare("PRAGMA table_info(klines)").all();
    const klineColumns = klinesInfo.map((col: any) => col.name);
    if (!klineColumns.includes('change')) {
      this.db.exec(`ALTER TABLE klines ADD COLUMN change REAL DEFAULT 0`);
    }
    if (!klineColumns.includes('amplitude')) {
      this.db.exec(`ALTER TABLE klines ADD COLUMN amplitude REAL DEFAULT 0`);
    }

    console.log('Database initialized successfully with better-sqlite3.');
  }

  async init() {
    if (this.db) return;
    try {
      this.setupDatabaseTables();
    } catch (error: any) {
      console.error('Failed to initialize database:', error);
      const isCorrupt = error && (error.code === 'SQLITE_CORRUPT' || String(error).includes('malformed') || String(error).includes('disk image'));
      if (isCorrupt) {
        console.warn('Database file is malformed or corrupted. Recreating database to restore operational status...');
        try {
          if (this.db) {
            try { this.db.close(); } catch (_) {}
            this.db = null;
          }
          const backupPath = `${this.dbPath}.corrupt.${Date.now()}`;
          if (fs.existsSync(this.dbPath)) {
            try { fs.renameSync(this.dbPath, backupPath); } catch (_) { fs.unlinkSync(this.dbPath); }
          }
          if (fs.existsSync(`${this.dbPath}-wal`)) try { fs.unlinkSync(`${this.dbPath}-wal`); } catch (_) {}
          if (fs.existsSync(`${this.dbPath}-shm`)) try { fs.unlinkSync(`${this.dbPath}-shm`); } catch (_) {}

          this.setupDatabaseTables();
          console.log('Database recovery complete.');
          return;
        } catch (retryErr) {
          console.error('Database auto-recovery failed:', retryErr);
          this.db = null;
        }
      } else {
        this.db = null;
      }
    }
  }

  async saveTradeLog(log: TradeLog, accountId: string = 'default') {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO trade_logs (
          id, accountId, symbol, side, leverage, amount, entryPrice, exitPrice, expiryPrice, pnl, fee, fundingFee, fundingFeeCheckedCount, fundingRate, profitRate, kBestChange, amp, mValue, realA, k2, openTime, closeTime, status, tpOrderId, slOrderId, strategyType
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        log.id, accountId, log.symbol, log.side, log.leverage, log.amount, log.entryPrice, 
        log.exitPrice, log.expiryPrice || 0, log.pnl, log.fee, log.fundingFee, log.fundingFeeCheckedCount || 0, log.fundingRate || 0, log.profitRate, 
        log.kBestChange || 0, log.amp || 0, log.mValue || 0, log.realA || 0, log.k2 || 0,
        log.openTime, log.closeTime, log.status, log.tpOrderId || null, log.slOrderId || null, log.strategyType || null
      );
    } catch (error) {
      console.error('Failed to save trade log:', error);
    }
  }

  async getTradeLogs(accountId: string = 'default', symbol?: string, startTime?: number, endTime?: number): Promise<TradeLog[]> {
    if (!this.db) return [];
    try {
      let query = `SELECT * FROM trade_logs WHERE accountId = ?`;
      const params: any[] = [accountId];

      if (symbol) {
        query += ` AND symbol = ?`;
        params.push(symbol);
      }
      if (startTime) {
        query += ` AND closeTime >= ?`;
        params.push(startTime);
      }
      if (endTime) {
        query += ` AND closeTime <= ?`;
        params.push(endTime);
      }

      query += ` ORDER BY openTime DESC`;
      return this.db.prepare(query).all(...params) as TradeLog[];
    } catch (error) {
      console.error('Failed to search trade logs:', error);
      return [];
    }
  }

  async getAllTradeLogs(accountId: string = 'default'): Promise<TradeLog[]> {
    if (!this.db) return [];
    try {
      return this.db.prepare(`SELECT * FROM trade_logs WHERE accountId = ? ORDER BY openTime DESC`).all(accountId) as TradeLog[];
    } catch (error) {
      console.error('Failed to get all trade logs:', error);
      return [];
    }
  }

  async clearAllLogs(accountId: string = 'default') {
    if (!this.db) return;
    try {
      this.db.prepare(`DELETE FROM trade_logs WHERE accountId = ?`).run(accountId);
    } catch (error) {
      console.error('Failed to clear all logs:', error);
    }
  }

  async saveTransferLog(log: TransferLog, accountId: string = 'default') {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO transfer_logs (
          id, accountId, asset, amount, type, status, timestamp, message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(log.id, accountId, log.asset, log.amount, log.type, log.status, log.timestamp, log.message || '');
    } catch (error) {
      console.error('Failed to save transfer log:', error);
    }
  }

  async getAllTransferLogs(accountId: string = 'default'): Promise<TransferLog[]> {
    if (!this.db) return [];
    try {
      return this.db.prepare(`SELECT * FROM transfer_logs WHERE accountId = ? ORDER BY timestamp DESC`).all(accountId) as TransferLog[];
    } catch (error) {
      console.error('Failed to get all transfer logs:', error);
      return [];
    }
  }

  async clearAllTransferLogs(accountId: string = 'default') {
    if (!this.db) return;
    try {
      this.db.prepare(`DELETE FROM transfer_logs WHERE accountId = ?`).run(accountId);
    } catch (error) {
      console.error('Failed to clear all transfer logs:', error);
    }
  }

  async saveBalanceLog(log: BalanceLog, accountId: string = 'default') {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO balance_logs (
          id, accountId, totalBalance, timestamp, spotBalance
        ) VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(log.id, accountId, log.totalBalance, log.timestamp, log.spotBalance || 0);
    } catch (error) {
      console.error('Failed to save balance log:', error);
    }
  }

  async getBalanceLogs(accountId: string = 'default', limit: number = 1000): Promise<BalanceLog[]> {
    if (!this.db) return [];
    try {
      const logs = this.db.prepare(`SELECT * FROM balance_logs WHERE accountId = ? ORDER BY timestamp DESC LIMIT ?`).all(accountId, limit) as BalanceLog[];
      return logs.reverse();
    } catch (error) {
      console.error('Failed to get balance logs:', error);
      return [];
    }
  }

  async getBalanceLogsFiltered(accountId: string = 'default', startTime: number, endTime: number, onlySnapshot: boolean = false): Promise<BalanceLog[]> {
    if (!this.db) return [];
    try {
      let query = `SELECT * FROM balance_logs WHERE accountId = ? AND timestamp >= ? AND timestamp <= ?`;
      const params: any[] = [accountId, startTime, endTime];

      if (onlySnapshot) {
        query += ` AND strftime('%H:%M', datetime(timestamp/1000, 'unixepoch', 'localtime')) = '00:18'`;
      }

      query += ` ORDER BY timestamp ASC`;
      return this.db.prepare(query).all(...params) as BalanceLog[];
    } catch (error) {
      console.error('Failed to get filtered balance logs:', error);
      return [];
    }
  }

  async clearAllBalanceLogs(accountId: string = 'default') {
    if (!this.db) return;
    try {
      this.db.prepare(`DELETE FROM balance_logs WHERE accountId = ?`).run(accountId);
    } catch (error) {
      console.error('Failed to clear all balance logs:', error);
    }
  }

  async saveSettings(settings: any, settingsId: string = 'current_settings') {
    if (!this.db) return;
    try {
      const encryptedSettings = processSensitiveFields(settings, 'encrypt');
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO settings (id, data, updatedAt)
        VALUES (?, ?, ?)
      `);
      stmt.run(settingsId, JSON.stringify(encryptedSettings), Date.now());
    } catch (error) {
      console.error('Failed to save settings to database:', error);
    }
  }

  async getSettings(settingsId: string = 'current_settings'): Promise<any | null> {
    if (!this.db) return null;
    try {
      const row = this.db.prepare(`SELECT data FROM settings WHERE id = ?`).get(settingsId);
      if (row && row.data) {
        const parsed = JSON.parse(row.data);
        return processSensitiveFields(parsed, 'decrypt');
      }
      return null;
    } catch (error) {
      console.error('Failed to get settings from database:', error);
      return null;
    }
  }

  async deleteSettings(settingsId: string) {
    if (!this.db) return;
    try {
      this.db.prepare(`DELETE FROM settings WHERE id = ?`).run(settingsId);
    } catch (error) {
      console.error('Failed to delete settings from database:', error);
    }
  }

  async clearAccountData(accountId: string) {
    if (!this.db) return;
    try {
      const transaction = this.db.transaction(() => {
        this.db.prepare(`DELETE FROM trade_logs WHERE accountId = ?`).run(accountId);
        this.db.prepare(`DELETE FROM transfer_logs WHERE accountId = ?`).run(accountId);
        this.db.prepare(`DELETE FROM balance_logs WHERE accountId = ?`).run(accountId);
        this.db.prepare(`DELETE FROM settings WHERE id = ?`).run(`settings_${accountId}`);
      });
      transaction();
    } catch (error) {
      console.error(`Failed to clear all data for account ${accountId}:`, error);
    }
  }
  
  async getAllSettingsIds(): Promise<string[]> {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(`SELECT id FROM settings`).all();
      return rows.map((r: any) => r.id);
    } catch (error) {
      console.error('Failed to get all settings IDs:', error);
      return [];
    }
  }

  async saveKline(kline: any) {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO klines (
          symbol, interval, openTime, open, high, low, close, volume, closeTime, 
          quoteAssetVolume, numberOfTrades, takerBuyBaseAssetVolume, takerBuyQuoteAssetVolume,
          change, amplitude
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        kline.symbol, kline.interval, kline.openTime, kline.open, kline.high, kline.low, kline.close, 
        kline.volume, kline.closeTime, kline.quoteAssetVolume, kline.numberOfTrades, 
        kline.takerBuyBaseAssetVolume, kline.takerBuyQuoteAssetVolume,
        kline.change || 0, kline.amplitude || 0
      );
    } catch (error) {
      console.error('Failed to save kline:', error);
    }
  }

  async saveKlines(klines: any[]) {
    if (!this.db || klines.length === 0) return;
    try {
      const insert = this.db.prepare(`
        INSERT OR REPLACE INTO klines (
          symbol, interval, openTime, open, high, low, close, volume, closeTime, 
          quoteAssetVolume, numberOfTrades, takerBuyBaseAssetVolume, takerBuyQuoteAssetVolume,
          change, amplitude
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const transaction = this.db.transaction((items: any[]) => {
        for (const kline of items) {
          insert.run(
            kline.symbol, kline.interval, kline.openTime, kline.open, kline.high, kline.low, kline.close, 
            kline.volume, kline.closeTime, kline.quoteAssetVolume, kline.numberOfTrades, 
            kline.takerBuyBaseAssetVolume, kline.takerBuyQuoteAssetVolume,
            kline.change || 0, kline.amplitude || 0
          );
        }
      });
      transaction(klines);
    } catch (error) {
      console.error('Failed to save klines batch:', error);
    }
  }

  async getLatestKlineTime(symbol: string, interval: string): Promise<number> {
    if (!this.db) return 0;
    try {
      const row = this.db.prepare(`
        SELECT MAX(openTime) as maxTime FROM klines WHERE symbol = ? AND interval = ?
      `).get(symbol, interval);
      return row?.maxTime || 0;
    } catch (error) {
      console.error('Failed to get latest kline time:', error);
      return 0;
    }
  }

  async getKlines(symbol: string, interval: string, limit: number = 300): Promise<any[]> {
    if (!this.db) return [];
    try {
      return this.db.prepare(`
        SELECT * FROM klines WHERE symbol = ? AND interval = ? ORDER BY openTime DESC LIMIT ?
      `).all(symbol, interval, limit);
    } catch (error) {
      console.error('Failed to get klines:', error);
      return [];
    }
  }

  async pruneKlines(symbol: string, interval: string, keepLimit: number = 300) {
    if (!this.db) return;
    try {
      // Find the cutoff time
      const row = this.db.prepare(`
        SELECT openTime FROM klines 
        WHERE symbol = ? AND interval = ? 
        ORDER BY openTime DESC 
        LIMIT 1 OFFSET ?
      `).get(symbol, interval, keepLimit - 1);

      if (row) {
        this.db.prepare(`
          DELETE FROM klines 
          WHERE symbol = ? AND interval = ? AND openTime < ?
        `).run(symbol, interval, row.openTime);
      }
    } catch (error) {
      console.error('Failed to prune klines:', error);
    }
  }

  async saveSystemLogs(logs: import('../types').LogEntry[], accountId: string = 'default') {
    if (!this.db || logs.length === 0) return;
    try {
      const insert = this.db.prepare(`
        INSERT OR REPLACE INTO system_logs (
          id, accountId, timestamp, type, module, message, details
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const transaction = this.db.transaction((items: any[]) => {
        for (const log of items) {
          insert.run(
            log.id, accountId, log.timestamp, log.type, log.module, log.message, 
            log.details ? JSON.stringify(log.details) : null
          );
        }
      });
      transaction(logs);
    } catch (error) {
      console.error('Failed to save system logs batch:', error);
    }
  }

  async searchSystemLogs(accountId: string = 'default', keyword: string = '', module: string = '', type: string = '', startTime?: number, endTime?: number, limit: number = 200, offset: number = 0): Promise<import('../types').LogEntry[]> {
    if (!this.db) return [];
    try {
      let query = `SELECT * FROM system_logs WHERE accountId = ?`;
      const params: any[] = [accountId];

      if (keyword) {
        query += ` AND message LIKE ?`;
        params.push('%' + keyword + '%');
      }
      if (module) {
        query += ` AND module LIKE ?`;
        params.push('%' + module + '%');
      }
      if (type) {
        query += ` AND type = ?`;
        params.push(type);
      }
      if (startTime) {
        query += ` AND timestamp >= ?`;
        params.push(startTime);
      }
      if (endTime) {
        query += ` AND timestamp <= ?`;
        params.push(endTime);
      }

      query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const rows = this.db.prepare(query).all(...params);
      return rows.map((r: any) => ({
        id: r.id,
        timestamp: r.timestamp,
        type: r.type,
        module: r.module,
        message: r.message,
        details: r.details ? JSON.parse(r.details) : undefined
      }));
    } catch (error) {
      console.error('Failed to search system logs:', error);
      return [];
    }
  }

  async pruneSystemLogs(days: number = 50) {
    if (!this.db) return;
    try {
      const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
      const result = this.db.prepare(`DELETE FROM system_logs WHERE timestamp < ?`).run(cutoffTime);
      if (result.changes > 0) {
        console.log(`Pruned ${result.changes} old system logs.`);
      }
    } catch (error) {
      console.error('Failed to prune system logs:', error);
    }
  }
}

export const dbService = new DatabaseService();
