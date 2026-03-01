"use client";

import { useEffect, useState, useRef, useMemo } from 'react';

interface KlineData {
    symbol: string;
    openPrice: number;
    closePrice: number;
    openTime: number;
    isFinal: boolean;
}

interface MultiTimeframeData {
    o15m: number;
    o1h: number;
    o4h: number;
}

export function useKlineWebSocket(symbols: string[]) {
    const [kline15m, setKline15m] = useState<Map<string, KlineData>>(new Map());
    const [kline1h, setKline1h] = useState<Map<string, KlineData>>(new Map());
    const [kline4h, setKline4h] = useState<Map<string, KlineData>>(new Map());
    const [isConnected, setIsConnected] = useState(false);
    const [isInitialDataLoaded, setIsInitialDataLoaded] = useState(false);

    const ws15mRef = useRef<WebSocket | null>(null);
    const ws1hRef = useRef<WebSocket | null>(null);
    const ws4hRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    const reconnectAttemptsRef = useRef<Map<string, number>>(new Map()); // 记录每个间隔的重连次数

    // 首次加载：使用 REST API 获取初始数据
    useEffect(() => {
        if (symbols.length === 0 || isInitialDataLoaded) return;

        const loadInitialData = async () => {
            try {
                const response = await fetch('/api/market/multiframe');
                const data: Record<string, { o15m: number, o1h: number, o4h: number }> = await response.json();

                // 转换为 KlineData 格式 (统一使用小写 symbol 作为 key)
                const map15m = new Map<string, KlineData>();
                const map1h = new Map<string, KlineData>();
                const map4h = new Map<string, KlineData>();

                Object.entries(data).forEach(([s, values]) => {
                    const symbol = s.toLowerCase(); // 强制转小写
                    if (values.o15m) {
                        map15m.set(symbol, {
                            symbol,
                            openPrice: values.o15m,
                            closePrice: values.o15m,
                            openTime: Date.now(),
                            isFinal: false,
                        });
                    }
                    if (values.o1h) {
                        map1h.set(symbol, {
                            symbol,
                            openPrice: values.o1h,
                            closePrice: values.o1h,
                            openTime: Date.now(),
                            isFinal: false,
                        });
                    }
                    if (values.o4h) {
                        map4h.set(symbol, {
                            symbol,
                            openPrice: values.o4h,
                            closePrice: values.o4h,
                            openTime: Date.now(),
                            isFinal: false,
                        });
                    }
                });

                setKline15m(map15m);
                setKline1h(map1h);
                setKline4h(map4h);
                setIsInitialDataLoaded(true);
            } catch (error) {
                console.error('Failed to load initial kline data:', error);
            }
        };

        loadInitialData();
    }, [symbols.length, isInitialDataLoaded]);

    useEffect(() => {
        if (symbols.length === 0) return;

        // 限制最多 50 个币种，避免 URL 过长
        const limitedSymbols = symbols.slice(0, 50);

        const connect = (
            interval: string,
            wsRef: React.MutableRefObject<WebSocket | null>,
            setData: (value: React.SetStateAction<Map<string, KlineData>>) => void
        ) => {
            // 如果已经连接，先关闭
            if (wsRef.current) {
                if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
                    wsRef.current.close();
                }
                wsRef.current = null;
            }

            // 构建订阅流 URL (binance stream names should be lowercase, which limitedSymbols already are)
            const streams = limitedSymbols.map(s => `${s}@kline_${interval}`).join('/');
            const wsUrl = `wss://fstream.binance.com/stream?streams=${streams}`;

            try {
                const ws = new WebSocket(wsUrl);
                wsRef.current = ws;

                ws.onopen = () => {
                    setIsConnected(true);
                    // 重置重连计数器
                    reconnectAttemptsRef.current.set(interval, 0);
                };

                // Add buffer for batching updates to prevent excessive re-renders
                const bufferRef = { current: new Map<string, KlineData>() };
                let flushInterval: NodeJS.Timeout;

                ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);

                        if (message.data && message.data.e === 'kline') {
                            const k = message.data.k;
                            const symbol = k.s.toLowerCase(); // 强制转小写

                            const kline: KlineData = {
                                symbol: symbol,
                                openPrice: parseFloat(k.o),
                                closePrice: parseFloat(k.c),
                                openTime: k.t,
                                isFinal: k.x,
                            };

                            // Accumulate in buffer instead of calling setData immediately
                            bufferRef.current.set(symbol, kline);
                        }
                    } catch (error) {
                        console.error(`Error parsing ${interval} message:`, error);
                    }
                };

                // Flush buffer to state every 250ms
                flushInterval = setInterval(() => {
                    if (bufferRef.current.size > 0) {
                        // Creates a shallow copy of the current buffered data
                        const updates = new Map(bufferRef.current);
                        bufferRef.current.clear();

                        // Update React state in bulk
                        setData(prev => {
                            const newMap = new Map(prev);
                            updates.forEach((kline, symbol) => {
                                newMap.set(symbol, kline);
                            });
                            return newMap;
                        });
                    }
                }, 250);

                ws.onerror = (error) => {
                    console.error(`WebSocket ${interval} error:`, error);
                };

                ws.onclose = (event) => {
                    setIsConnected(false);
                    wsRef.current = null;
                    if (flushInterval) clearInterval(flushInterval);

                    // 指数退避重连
                    const attempts = reconnectAttemptsRef.current.get(interval) || 0;
                    const maxAttempts = 10;

                    if (attempts < maxAttempts) {
                        // 计算退避时间：基础 1秒 + 指数增长，最多 30秒
                        const backoffTime = Math.min(1000 * Math.pow(2, attempts), 30000);

                        reconnectAttemptsRef.current.set(interval, attempts + 1);

                        reconnectTimeoutRef.current = setTimeout(() => {
                            connect(interval, wsRef, setData);
                        }, backoffTime);
                    } else {
                        console.warn(`WebSocket ${interval} 超过最大重连次数，停止重连`);
                    }
                };
            } catch (err) {
                console.error(`Failed to create WebSocket for ${interval}:`, err);
            }
        };

        // 连接三个 WebSocket（15m, 1h, 4h）
        connect('15m', ws15mRef, setKline15m);
        connect('1h', ws1hRef, setKline1h);
        connect('4h', ws4hRef, setKline4h);

        // 清理函数
        return () => {
            // 清理重连定时器
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = undefined;
            }

            // 关闭所有 WebSocket 连接
            [ws15mRef, ws1hRef, ws4hRef].forEach(ref => {
                if (ref.current) {
                    if (ref.current.readyState === WebSocket.OPEN || ref.current.readyState === WebSocket.CONNECTING) {
                        ref.current.close();
                    }
                    ref.current = null;
                }
            });

            // 重置重连计数器
            reconnectAttemptsRef.current.clear();
        };

    }, [symbols.join(',')]); // 使用 join 来避免数组引用变化导致的重连

    // Polling fallback: 每 15 秒轮询一次 API，确保 WS 失败时有数据
    useEffect(() => {
        if (symbols.length === 0) return;

        const fetchData = async () => {
            if (document.hidden) return; // 页面隐藏时不轮询

            try {
                const response = await fetch('/api/market/multiframe');
                if (!response.ok) return;

                const data: Record<string, { o15m: number, o1h: number, o4h: number }> = await response.json();

                // 更新数据 (合并更新，保留较新的数据)
                // 注意：这里我们简单地用 API 数据更新 Map，这会覆盖 WS 数据
                // 但如果 WS 正在运行，WS 会再次更新最新的
                // 对于 15m/1h/4h 开盘价，它们在一个周期内是不变的，所以覆盖是安全的

                setKline15m(prev => {
                    const next = new Map(prev);
                    Object.entries(data).forEach(([s, v]) => {
                        const symbol = s.toLowerCase();
                        if (v.o15m) next.set(symbol, { symbol, openPrice: v.o15m, closePrice: v.o15m, openTime: Date.now(), isFinal: false });
                    });
                    return next;
                });

                setKline1h(prev => {
                    const next = new Map(prev);
                    Object.entries(data).forEach(([s, v]) => {
                        const symbol = s.toLowerCase();
                        if (v.o1h) next.set(symbol, { symbol, openPrice: v.o1h, closePrice: v.o1h, openTime: Date.now(), isFinal: false });
                    });
                    return next;
                });

                setKline4h(prev => {
                    const next = new Map(prev);
                    Object.entries(data).forEach(([s, v]) => {
                        const symbol = s.toLowerCase();
                        if (v.o4h) next.set(symbol, { symbol, openPrice: v.o4h, closePrice: v.o4h, openTime: Date.now(), isFinal: false });
                    });
                    return next;
                });

            } catch (e) {
                console.error('Polling error:', e);
            }
        };

        // 首次运行由上面的 useEffect 处理，这里只处理轮询
        const intervalId = setInterval(fetchData, 15000);

        return () => clearInterval(intervalId);
    }, [symbols.length]); // 依赖 symbols 长度，避免频繁重置

    // 计算多时间框架数据
    const multiTimeframeData = useMemo(() => {
        const result: Record<string, MultiTimeframeData> = {};

        symbols.forEach(symbol => {
            const lowerSymbol = symbol.toLowerCase();
            const k15 = kline15m.get(lowerSymbol);
            const k1 = kline1h.get(lowerSymbol);
            const k4 = kline4h.get(lowerSymbol);

            // 🔧 修复：只要有任意一个周期的数据就返回（部分数据支持）
            // 之前的逻辑 if (k15 && k1 && k4) 导致缺少任何一个周期就全部不显示
            if (k15 || k1 || k4) {
                result[symbol] = {
                    o15m: k15?.openPrice || 0,
                    o1h: k1?.openPrice || 0,
                    o4h: k4?.openPrice || 0,
                };
            }
        });

        return result;
    }, [kline15m, kline1h, kline4h, symbols]);

    return { data: multiTimeframeData, isConnected };
}
