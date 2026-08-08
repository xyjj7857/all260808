package main

import (
	"log"
	"net/http"
	"quant-engine/engine"
	// "quant-engine/database"
)

func main() {
	log.Println("Starting Quant Engine (Go Core)...")

	// 1. 初始化 SQLite 数据库连接（与 Node.js 共享 /app/data 挂载卷）
	// database.InitDB("/app/data/trades.db")

	// 2. 启动 Binance WebSocket 监听（15m K线常驻内存）
	klinesWS := engine.NewBinanceWS()
	go klinesWS.Start()

	// 3. 将 WS 数据源注入交易引擎
	tradeEngine := engine.NewTradeEngine(klinesWS)
	
	// 4. 启动周期性扫描与执行循环 (多线程并发)
	go tradeEngine.StartLoop()

	// 5. 启动控制平面 API (供 Node.js 侧前端面板调用)
	http.HandleFunc("/api/v1/reload", tradeEngine.HandleReloadConfig)
	http.HandleFunc("/api/v1/status", tradeEngine.HandleStatus)

	log.Println("Engine API listening on :8080")
	log.Fatal(http.ListenAndServe("0.0.0.0:8080", nil))
}
