"use client";

import React from 'react';

interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error?: Error;
    errorInfo?: React.ErrorInfo;
}

/**
 * 错误边界组件
 * 捕获子组件树中的JavaScript错误，记录错误并显示降级UI
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        // 更新 state 使下一次渲染能够显示降级 UI
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        // 记录错误信息到控制台
        console.error('ErrorBoundary 捕获到错误:', error);
        console.error('错误详情:', errorInfo);

        // 可以在这里将错误信息发送到错误追踪服务
        this.setState({ errorInfo });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    };

    render() {
        if (this.state.hasError) {
            // 如果提供了自定义 fallback UI，使用它
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // 默认的错误 UI
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '400px',
                    padding: '20px',
                    textAlign: 'center',
                    backgroundColor: '#1a1a2e',
                    borderRadius: '8px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    margin: '20px'
                }}>
                    <div style={{ fontSize: '48px', marginBottom: '20px' }}>⚠️</div>
                    <h2 style={{ color: '#ff6b6b', marginBottom: '10px' }}>出错了</h2>
                    <p style={{ color: '#a0a0b8', marginBottom: '20px', maxWidth: '500px' }}>
                        应用遇到了一个错误。您可以尝试刷新页面，或者联系技术支持。
                    </p>

                    {this.state.error && (
                        <details style={{
                            marginTop: '20px',
                            padding: '10px',
                            background: 'rgba(255,255,255,0.05)',
                            borderRadius: '4px',
                            textAlign: 'left'
                        }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: '10px' }}>
                                错误详情 (仅开发环境可见)
                            </summary>
                            <pre style={{
                                fontSize: '12px',
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordWrap: 'break-word',
                                display: process.env.NODE_ENV === 'development' ? 'block' : 'none'
                            }}>
                                {this.state.error.toString()}
                                {this.state.errorInfo && '\n\n' + this.state.errorInfo.componentStack}
                            </pre>
                            {process.env.NODE_ENV !== 'development' && (
                                <p style={{ fontSize: '12px', color: '#888' }}>
                                    出于安全原因，生产环境不再展示详细调用栈。请联系开发人员获取日志。
                                </p>
                            )}
                        </details>
                    )}

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                            onClick={this.handleReset}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: '#1976d2',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: '500'
                            }}
                        >
                            重试
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: '#757575',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: '500'
                            }}
                        >
                            刷新页面
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
