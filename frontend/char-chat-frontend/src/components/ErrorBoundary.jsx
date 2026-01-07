import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '', stack: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || '알 수 없는 오류가 발생했습니다.' };
  }

  componentDidCatch(error, info) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('ErrorBoundary:', error, info);
    }
    try {
      // ✅ 디버깅용: 모바일/데모 환경에서 콘솔 접근이 어려워 화면에서 바로 복사할 수 있게 한다.
      const stack = String(info?.componentStack || '').trim();
      if (stack) this.setState({ stack });
    } catch (_) {}
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 border rounded-md bg-red-50 text-red-800 text-sm">
          <div className="font-semibold mb-1">컴포넌트 렌더링 중 문제가 발생했습니다.</div>
          <div className="opacity-80">{this.state.message}</div>
          {this.state.stack && process.env.NODE_ENV !== 'production' && (
            <pre className="mt-3 p-2 rounded bg-white/70 text-[11px] overflow-auto max-h-48 whitespace-pre-wrap">
              {this.state.stack}
            </pre>
          )}
          {this.props.fallback}
        </div>
      );
    }
    return this.props.children;
  }
}




