import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Orion React ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen bg-background flex flex-col items-center justify-center p-8 text-on-background select-none">
          <div className="max-w-xl w-full bg-surface-container/90 border border-red-500/30 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl flex flex-col items-center text-center gap-6">
            <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/30">
              <AlertTriangle size={32} />
            </div>

            <div>
              <h1 className="text-2xl font-extrabold text-on-surface mb-2">Orion Smart Mirror Recovered</h1>
              <p className="text-sm text-on-surface-variant">
                An unexpected component rendering error occurred. The application interface has been safely caught.
              </p>
            </div>

            {this.state.error && (
              <div className="w-full bg-black/60 border border-white/10 rounded-2xl p-4 text-left font-mono text-xs text-red-300 max-h-40 overflow-y-auto break-all">
                <p className="font-bold text-red-400 mb-1">{this.state.error.toString()}</p>
                {this.state.errorInfo?.componentStack && (
                  <pre className="text-[10px] text-on-surface-variant whitespace-pre-wrap">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}

            <div className="flex gap-4 w-full">
              <button
                onClick={this.handleReset}
                className="flex-1 py-3 px-6 rounded-2xl bg-primary text-on-primary font-bold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw size={16} />
                <span>Reload Application</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
