'use client';

import React, { useState } from 'react';

const DataManager = () => {
    const [symbol, setSymbol] = useState('BTCUSDT');
    const [startDate, setStartDate] = useState('2024-01-01');
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [status, setStatus] = useState<string>('');
    const [loading, setLoading] = useState(false);

    const handleDownload = async (type: 'metrics' | 'fundingRate') => {
        setLoading(true);
        setStatus(`正在请求下载 ${type}...`);

        try {
            const res = await fetch('/api/data/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, type, startDate, endDate }),
            });
            const payload = await res.json().catch(() => null);

            if (res.ok) {
                setStatus(`已开始下载 ${type}，请查看服务器后台日志获取进度。文件将保存至 data/historical`);
            } else if (typeof payload?.error === 'string') {
                setStatus(payload.error);
            } else {
                setStatus(`请求失败 (${res.status})`);
            }
        } catch {
            setStatus('发生错误');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-4 bg-gray-900 rounded-lg border border-gray-800 text-white mt-4">
            <h3 className="text-lg font-bold mb-4">📚 历史数据收集器 (Data Collector)</h3>
            <p className="text-sm text-gray-400 mb-4">
                从币安公开数据仓库下载历史 Metrics (持仓量, 多空比) 和 Ref. Funding Rate 数据。
                这可以突破 API 的 30 天限制，实现全历史回测。
            </p>

            <div className="flex gap-4 items-end flex-wrap">
                <div>
                    <label className="block text-xs mb-1">交易对</label>
                    <input
                        type="text"
                        value={symbol}
                        onChange={e => setSymbol(e.target.value.toUpperCase())}
                        className="bg-gray-800 p-2 rounded border border-gray-700 w-32"
                    />
                </div>

                <div>
                    <label className="block text-xs mb-1">开始日期</label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="bg-gray-800 p-2 rounded border border-gray-700"
                    />
                </div>

                <div>
                    <label className="block text-xs mb-1">结束日期</label>
                    <input
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="bg-gray-800 p-2 rounded border border-gray-700"
                    />
                </div>
            </div>

            <div className="flex gap-4 mt-4">
                <button
                    onClick={() => handleDownload('metrics')}
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
                >
                    ⬇️ 下载 Metrics (持仓量)
                </button>
                <button
                    onClick={() => handleDownload('fundingRate')}
                    disabled={loading}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded disabled:opacity-50"
                >
                    ⬇️ 下载 Funding Rate
                </button>
            </div>

            {status && (
                <div className="mt-4 p-2 bg-gray-800 rounded text-sm text-yellow-500">
                    {status}
                </div>
            )}
        </div>
    );
};

export default DataManager;
