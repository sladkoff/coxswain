import { reviewFilterScroll } from "./review-filter-scroll";
import { Component, type ReactNode, type RefObject } from "react";
import { cancelScrollRestore, restoreScroll, type Scroll } from "./restore-scroll";

type Props = {
  canvasRef: RefObject<HTMLDivElement | null>;
  identity: string;
  showReviewed: boolean;
  children: ReactNode;
};

// React's snapshot lifecycle reads the old layout before filtering removes any cards.
export class PreserveReviewScroll extends Component<Props, Record<string, never>, Scroll | null> {
  private stop?: () => void;
  getSnapshotBeforeUpdate(previous: Props): Scroll | null {
    if (previous.identity !== this.props.identity) {
      this.stop?.();
      return null;
    }
    if (previous.showReviewed === this.props.showReviewed) return null;
    this.stop?.();
    const canvas = this.props.canvasRef.current;
    if (!canvas) return null;
    cancelScrollRestore(canvas);
    return reviewFilterScroll(canvas, this.props.showReviewed);
  }
  componentDidUpdate(_previous: Props, _state: Record<string, never>, snapshot: Scroll | null) {
    if (snapshot && this.props.canvasRef.current)
      this.stop = restoreScroll(this.props.canvasRef.current, snapshot);
  }
  componentWillUnmount() {
    this.stop?.();
  }
  render() {
    return this.props.children;
  }
}
