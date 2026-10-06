import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

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

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React UI error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 dir-rtl" dir="rtl">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-lg border border-rose-100 text-center space-y-4">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-800">حدث خطأ غير متوقع في الواجهة</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              عذراً، حدث خطأ أثناء عرض هذه الصفحة. يمكنك إعادة تحميل الصفحة للمتابعة.
            </p>
            {this.state.error?.message && (
              <div className="bg-rose-50/50 p-3 rounded-lg border border-rose-100 text-xs text-rose-700 font-mono text-left dir-ltr overflow-auto max-h-24">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleReload}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors font-medium text-sm"
            >
              <RefreshCw size={16} />
              <span>إعادة تحميل الصفحة</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
