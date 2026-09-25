import { AlertTriangleIcon, RotateCcwIcon } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { Button } from './ui/button.js';

interface Props {
  children: ReactNode;
  /** Changing this resets the boundary (e.g. the active tab id). */
  resetKey?: string;
  label?: string;
  /**
   * Offered beside "Try again" when set: the boundary at the root of
   * the app, where a retry re-renders everything and may well fail the
   * same way, while a reload starts the renderer over against a host
   * that is still fine.
   */
  reload?: () => void;
}
interface State {
  error: Error | null;
}

/**
 * Keeps one crashing tab/pane from blanking the whole window — and, at
 * the root, the whole window from going blank: React unmounts the tree
 * on an uncaught render error, leaving an empty page with no message.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangleIcon className="size-8 text-warning" />
        <div>
          <p className="font-medium">
            {this.props.label ?? 'Something went wrong rendering this view.'}
          </p>
          <p className="mx-auto mt-1 max-w-md font-mono text-sm text-muted-foreground">
            {this.state.error.message}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ error: null })}
          >
            <RotateCcwIcon /> Try again
          </Button>
          {this.props.reload && (
            <Button variant="outline" size="sm" onClick={this.props.reload}>
              Reload window
            </Button>
          )}
        </div>
      </div>
    );
  }
}
