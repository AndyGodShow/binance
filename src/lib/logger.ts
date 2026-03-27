/**
 * 统一日志系统
 * 在开发环境使用console，生产环境可以接入监控服务
 */

interface LogContext {
    [key: string]: any;
}

class Logger {
    private isDevelopment: boolean;

    constructor() {
        this.isDevelopment = process.env.NODE_ENV === 'development';
    }

    /**
     * 信息日志
     */
    info(message: string, context?: LogContext): void {
        if (this.isDevelopment) {
            console.log(`[INFO] ${message}`, context || '');
        }
        // 生产环境可以发送到监控服务
        // this.sendToMonitoring('info', message, context);
    }

    /**
     * 警告日志（始终输出——生产环境也需要警告可见）
     */
    warn(message: string, context?: LogContext): void {
        console.warn(`[WARN] ${message}`, context || '');
        // TODO: 接入监控服务（如DataDog, New Relic等）
    }

    /**
     * 错误日志（始终输出——生产问题必须可见）
     */
    error(message: string, error?: Error, context?: LogContext): void {
        console.error(`[ERROR] ${message}`, error || '', context || '');
        // TODO: 接入错误追踪服务（如Sentry）
        // this.sendToErrorTracking(message, error, context);
    }

    /**
     * 调试日志（仅开发环境）
     */
    debug(message: string, context?: LogContext): void {
        if (this.isDevelopment) {
            console.debug(`[DEBUG] ${message}`, context || '');
        }
    }

    /**
     * 性能测量
     */
    time(label: string): void {
        if (this.isDevelopment) {
            console.time(label);
        }
    }

    timeEnd(label: string): void {
        if (this.isDevelopment) {
            console.timeEnd(label);
        }
    }
}

// 单例导出
export const logger = new Logger();
