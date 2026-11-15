import { Component, type ReactNode } from "react";

/** Keep accessible model controls usable if the browser cannot initialize WebGL. */
export class SceneBoundary extends Component<
  { children: ReactNode; release?: boolean },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback" role="alert">
        <h2>The 3D view could not start.</h2>
        <p>
          {this.props.release ? "Your structure is retained. Select a card to place it with the target controls." :
            "Your structure is retained. Precise placement is available under Build options."}
        </p>
        <button onClick={() => this.setState({ failed: false })}>
          Retry 3D view
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
