import React from "react";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown | null }
> {
  state = { error: null as unknown | null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("App crashed:", error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const message =
        this.state.error instanceof Error
          ? this.state.error.message
          : String(this.state.error);

      return (
        <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
          <div className="max-w-2xl w-full bg-white border border-red-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-red-50 border-b border-red-100">
              <h1 className="text-lg font-semibold text-red-900">
                Something went wrong
              </h1>
              <p className="text-sm text-red-800 mt-1">
                The app hit a runtime error (often caused by parsing or unexpected
                file structure). Use the reset button and try again.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-sm font-mono whitespace-pre-wrap bg-slate-900 text-slate-50 rounded-lg p-4">
                {message}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={this.reset}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
                >
                  Reset app
                </button>
                <a
                  className="px-4 py-2 rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200"
                  href="/"
                >
                  Reload page
                </a>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
