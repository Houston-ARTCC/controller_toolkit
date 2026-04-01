"use client";

import { Component } from "react";

export default class MapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="text-muted mt-3 text-sm">
          Map failed to load. Projection data is still available above.
        </div>
      );
    }
    return this.props.children;
  }
}
