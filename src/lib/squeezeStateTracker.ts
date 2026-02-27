/**
 * Squeeze 状态追踪器
 * 用于追踪前一个 Squeeze 状态以检测释放时刻
 */

interface SqueezeState {
    status: 'on' | 'off';
    timestamp: number;
}

class SqueezeStateTracker {
    private states: Map<string, SqueezeState> = new Map();

    /**
     * 更新并获取 Squeeze 状态
     */
    updateAndGetState(
        symbol: string,
        currentStatus: 'on' | 'off'
    ): { current: 'on' | 'off'; previous: 'on' | 'off' } {
        const prevState = this.states.get(symbol);

        const previous: 'on' | 'off' = prevState?.status || 'off';
        const current = currentStatus;

        // 保存当前状态
        this.states.set(symbol, {
            status: current,
            timestamp: Date.now()
        });

        return { current, previous };
    }

    /**
     * 清理旧状态（超过 30 分钟）
     */
    cleanup(maxAge: number = 30 * 60 * 1000) {
        const now = Date.now();
        for (const [symbol, state] of this.states.entries()) {
            if (now - state.timestamp > maxAge) {
                this.states.delete(symbol);
            }
        }
    }
}

export const squeezeStateTracker = new SqueezeStateTracker();
