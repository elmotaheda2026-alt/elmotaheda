import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import CompanyLogo from './CompanyLogo';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidMount() {
    window.addEventListener('server-reconnected', this.handleServerReconnected);
  }

  public componentWillUnmount() {
    window.removeEventListener('server-reconnected', this.handleServerReconnected);
  }

  private handleServerReconnected = () => {
    if (this.state.hasError) {
      const msg = this.state.error?.message || '';
      if (/dynamically imported module|Loading chunk|Importing a module script failed/i.test(msg)) {
        window.location.reload();
        return;
      }
      this.setState({ hasError: false, error: undefined });
    }
  };

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React UI error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center p-6 dir-rtl"
          style={{ background: 'linear-gradient(135deg, #0b1224 0%, #0f1f4a 55%, #172959 100%)' }}
          dir="rtl"
        >
          <div className="bg-slate-900/90 backdrop-blur-xl rounded-3xl p-8 max-w-md w-full shadow-2xl border border-white/15 text-center text-white space-y-5">
            <div className="flex flex-col items-center gap-3">
              <CompanyLogo size={68} theme="dark" />
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-400/30 text-rose-300 text-xs font-bold">
                <AlertTriangle size={14} />
                <span>حدث خطأ غير متوقع في الواجهة</span>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              عذراً، تعذر عرض هذه الشاشة حالياً. يمكنك إعادة المحاولة أو تحميل الصفحة للمتابعة.
            </p>
            {this.state.error?.message && (
              <div className="bg-slate-950/70 p-3 rounded-xl border border-white/10 text-[11px] text-rose-300 font-mono text-left dir-ltr overflow-auto max-h-24">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleReload}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl transition-colors font-bold text-xs cursor-pointer shadow-lg"
            >
              <RefreshCw size={15} />
              <span>إعادة تحميل الصفحة</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
