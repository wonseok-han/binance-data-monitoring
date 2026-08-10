import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Dashboard render failed', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="fatal-error" role="alert">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <p className="eyebrow">DASHBOARD ERROR</p>
          <h1>화면을 표시하지 못했습니다</h1>
          <p>새로고침 후에도 문제가 계속되면 서버와 브라우저 로그를 확인해 주세요.</p>
          <button type="button" onClick={() => window.location.reload()}>
            화면 새로고침
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
