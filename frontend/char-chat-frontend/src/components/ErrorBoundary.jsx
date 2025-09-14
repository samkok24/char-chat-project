import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || '알 수 없는 오류가 발생했습니다.' };
  }

  componentDidCatch(error, info) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('ErrorBoundary:', error, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 border rounded-md bg-red-50 text-red-800 text-sm">
          <div className="font-semibold mb-1">컴포넌트 렌더링 중 문제가 발생했습니다.</div>
          <div className="opacity-80">{this.state.message}</div>
          {this.props.fallback}
        </div>
      );
    }
    return this.props.children;
  }
}




