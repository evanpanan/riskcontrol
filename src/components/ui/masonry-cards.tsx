"use client";
import { Children, useLayoutEffect, useRef, type ReactNode } from 'react';
/** Size rows from natural content height, rather than stretching short cards to match long ones. */
export function MasonryCards({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      for (const item of Array.from(root.children) as HTMLElement[]) {
        const content = item.firstElementChild as HTMLElement | null;
        if (!content) continue;
        const span = Math.max(1, Math.ceil((content.getBoundingClientRect().height + 12) / 13));
        const value = `span ${span}`;
        if (item.style.gridRowEnd !== value) item.style.gridRowEnd = value;
      }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    for (const item of Array.from(root.children)) if (item.firstElementChild) resize.observe(item.firstElementChild);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [children]);
  return <div ref={rootRef} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start" style={{ gridAutoRows: '1px' }}>
    {Children.toArray(children).map((child, index) => <div key={index} className="min-w-0"><div className="min-w-0 flow-root">{child}</div></div>)}
  </div>;
}
