/**
 * Catch render errors in a pane so a markdown/tool glitch does not white-screen
 * the whole workbench. Recovery is local (reset boundary state).
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

export type UiErrorBoundaryLabels = {
  title: string;
  body: string;
  retry: string;
};

type Props = {
  children: ReactNode;
  labels: UiErrorBoundaryLabels;
  /** Optional class for the fallback panel. */
  className?: string;
  /** Bump to clear a caught error after parent navigates (e.g. session id). */
  resetKey?: string | null;
};

type State = {
  error: Error | null;
};

export class UiErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Browser console is enough for dev; host file logs cover Rust.
    console.error("[UiErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      const { labels, className } = this.props;
      const detail = this.state.error.message || String(this.state.error);
      return (
        <div
          className={className ?? "ui-error-boundary"}
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "24px 20px",
            margin: "12px",
            borderRadius: 12,
            border: "1px solid var(--border, #333)",
            background: "var(--surface-2, rgba(0,0,0,0.25))",
            maxWidth: 520,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>{labels.title}</div>
          <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.45 }}>
            {labels.body}
          </div>
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              opacity: 0.65,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 120,
              overflow: "auto",
            }}
          >
            {detail}
          </pre>
          <div>
            <button
              type="button"
              className="btn btn--primary"
              style={{ height: 28, fontSize: 12 }}
              onClick={this.retry}
            >
              {labels.retry}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
