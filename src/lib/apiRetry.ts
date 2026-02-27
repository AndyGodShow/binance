/**
 * API重试机制工具类
 * 支持指数退避重试策略，提升API调用的稳定性
 */

import { logger } from './logger';

interface RetryOptions {
    maxRetries?: number;          // 最大重试次数，默认3次
    initialDelay?: number;        // 初始延迟（毫秒），默认1000ms
    maxDelay?: number;            // 最大延迟（毫秒），默认10000ms
    backoffMultiplier?: number;   // 退避倍数，默认2
    shouldRetry?: (error: Error) => boolean; // 是否应该重试的判断函数
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    shouldRetry: () => true
};

/**
 * 带重试的API调用函数
 * @param fn 要执行的异步函数
 * @param options 重试配置选项
 * @returns Promise with the result
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const config = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error;
    let delay = config.initialDelay;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            // 如果是最后一次尝试，直接抛出错误
            if (attempt === config.maxRetries) {
                logger.error(`API call failed after ${config.maxRetries} retries`, lastError);
                throw lastError;
            }

            // 检查是否应该重试
            if (!config.shouldRetry(lastError)) {
                logger.warn('Error not retryable, throwing immediately', { error: lastError.message });
                throw lastError;
            }

            // 记录重试日志
            logger.warn(`API call failed, retrying in ${delay}ms (attempt ${attempt + 1}/${config.maxRetries})`, {
                error: lastError.message
            });

            // 等待后重试
            await sleep(delay);

            // 计算下一次延迟（指数退避）
            delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
        }
    }

    // 这行代码理论上不会执行到，但TypeScript需要
    throw lastError!;
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 专门用于fetch请求的重试包装器
 * @param url 请求URL
 * @param init fetch配置
 * @param options 重试配置
 */
export async function fetchWithRetry(
    url: string,
    init?: RequestInit,
    options?: RetryOptions
): Promise<Response> {
    return withRetry(
        async () => {
            const response = await fetch(url, init);

            // 如果响应不成功，抛出错误以触发重试
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response;
        },
        {
            ...options,
            // 对于4xx客户端错误不重试，只对5xx服务器错误和网络错误重试
            shouldRetry: (error: Error) => {
                const statusMatch = error.message.match(/HTTP (\d+):/);
                if (statusMatch) {
                    const status = parseInt(statusMatch[1]);
                    return status >= 500; // 只重试5xx错误
                }
                return true; // 网络错误等都重试
            }
        }
    );
}
