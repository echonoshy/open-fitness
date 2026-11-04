import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

type Point = { x: number; y: number };
type Drag = {
  id: number;
  from: Point;
  grip: Point;
  moved: boolean;
};

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(n, max));

export function useReferenceDrag() {
  const slot = useRef<HTMLDivElement>(null);
  const position = useRef<Point | null>(null);
  const drag = useRef<Drag | null>(null);
  const [detached, setDetached] = useState(false);

  const reset = useCallback(() => {
    position.current = null;
    const node = slot.current;
    if (node) {
      node.style.removeProperty("--reference-x");
      node.style.removeProperty("--reference-y");
    }
    setDetached(false);
  }, []);

  // Translate from the responsive slot so the surrounding controls keep their layout.
  const place = useCallback((point: Point) => {
    const node = slot.current;
    const stage = node?.closest<HTMLElement>(".training-stage");
    if (!node || !stage) return;
    const home = node.getBoundingClientRect();
    const area = stage.getBoundingClientRect();
    const header = stage.parentElement
      ?.querySelector(".app-header")
      ?.getBoundingClientRect();
    const left = area.left + 8;
    const top = Math.max(area.top, header?.bottom ?? area.top) + 8;
    const right = Math.max(
      left,
      area.left + stage.clientWidth - home.width - 8,
    );
    const bottom = Math.max(top, area.bottom - home.height - 8);
    const x = clamp(point.x, left, right);
    const y = clamp(point.y, top, bottom);
    position.current = { x, y };
    node.style.setProperty("--reference-x", `${x - home.left}px`);
    node.style.setProperty("--reference-y", `${y - home.top}px`);
    setDetached(true);
  }, []);

  const finishDrag = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    const node = slot.current;
    if (node) {
      delete node.dataset.dragging;
      if (node.hasPointerCapture(current.id))
        node.releasePointerCapture(current.id);
    }
  }, []);

  useLayoutEffect(() => {
    const node = slot.current!;
    const stage = node.closest<HTMLElement>(".training-stage")!;
    const fit = () => {
      if (position.current) place(position.current);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    observer.observe(node.parentElement!);
    observer.observe(stage);
    stage.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("blur", finishDrag);
    return () => {
      observer.disconnect();
      stage.removeEventListener("scroll", fit);
      window.removeEventListener("blur", finishDrag);
    };
  }, [finishDrag, place]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    const target = event.target as Element;
    if (
      !target.closest(".reference-heading, .reference-media") ||
      target.closest("button")
    )
      return;
    const card = target
      .closest(".exercise-reference-card")!
      .getBoundingClientRect();
    const point = { x: event.clientX, y: event.clientY };
    drag.current = {
      id: event.pointerId,
      from: point,
      moved: false,
      grip: { x: point.x - card.left, y: point.y - card.top },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.moved) {
      if (
        Math.hypot(
          event.clientX - current.from.x,
          event.clientY - current.from.y,
        ) < 3
      )
        return;
      current.moved = true;
      event.currentTarget.dataset.dragging = "true";
    }
    place({
      x: event.clientX - current.grip.x,
      y: event.clientY - current.grip.y,
    });
  };
  // A cancelled gesture can report stale coordinates. Commit each move and
  // leave the last displayed position alone on every path that ends the drag.
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === event.pointerId) finishDrag();
  };
  const onLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onPointerEnd(event);
  };

  return {
    slot,
    detached,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture,
    },
  };
}
