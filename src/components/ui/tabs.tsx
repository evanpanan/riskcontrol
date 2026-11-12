"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:shadow",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-6 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };

/** Opt-in moving glass selection; measurement also supports wrapped tab rows. */
function GlassTabsList({ activeValue, children, className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { activeValue: string }) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const [selection, setSelection] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null);
  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!active) { setSelection(null); return; }
      const next = { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
      setSelection(prev => prev && Object.keys(next).every(key => prev[key as keyof typeof next] === next[key as keyof typeof next]) ? prev : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const resize = new ResizeObserver(schedule);
    resize.observe(list);
    list.querySelectorAll('[role="tab"]').forEach(tab => resize.observe(tab));
    const mutation = new MutationObserver(schedule);
    mutation.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] });
    window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', schedule); };
  }, [activeValue]);
  return <TabsPrimitive.List ref={listRef} className={cn("relative isolate rounded-xl border border-border/60 bg-secondary/40 text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]", className)} {...props}>
    {selection && <span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-0 rounded-lg border border-white/20 bg-background/65 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_2px_8px_rgba(0,0,0,0.14)] transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none" style={{ transform: `translate3d(${selection.x}px, ${selection.y}px, 0)`, width: selection.width, height: selection.height }} />}
    {children}
  </TabsPrimitive.List>;
}
export { GlassTabsList };
