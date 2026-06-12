import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: (error: Error, reset: () => void) => ReactNode;
  /**
   * When this value changes, an active error state is cleared. Used with the
   * route pathname so navigating away from a crashed page recovers — without
   * remounting the whole subtree on every navigation (which `key` would do,
   * destroying table scroll/selection state).
   */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    return this.state.error
      ? this.props.fallback(this.state.error, () => this.setState({ error: null }))
      : this.props.children;
  }
}
