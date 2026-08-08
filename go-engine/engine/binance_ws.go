package engine

import (
	"log"
	"sync"
)

// KlineData 定义K线结构
type KlineData struct {
	Open        float64
	High        float64
	Low         float64
	Close       float64
	Volume      float64
	QuoteVolume float64
	Timestamp   int64
}

// BinanceWS 负责管理全市场的 15m 级别的常驻缓存
type BinanceWS struct {
	cache sync.Map // 并发安全的 K线缓存 map[string]*KlineData
}

func NewBinanceWS() *BinanceWS {
	return &BinanceWS{}
}

func (b *BinanceWS) Start() {
	log.Println("Binance WS stream starting...")
	// TODO: 连接 wss://fstream.binance.com/ws
	// 订阅所有目标币对的 @kline_15m
	// 收到 K 线推送时，更新 b.cache
}

func (b *BinanceWS) GetKline(symbol string) (*KlineData, bool) {
	val, ok := b.cache.Load(symbol)
	if !ok {
		return nil, false
	}
	return val.(*KlineData), true
}

// Snapshot 创建当前内存的隔离快照，保障同一轮次数据绝对一致，且读取过程无锁/零 I/O 阻塞
func (b *BinanceWS) Snapshot() map[string]KlineData {
	snapshot := make(map[string]KlineData)
	b.cache.Range(func(key, value interface{}) bool {
		sym := key.(string)
		kline := value.(*KlineData)
		snapshot[sym] = *kline
		return true
	})
	return snapshot
}
