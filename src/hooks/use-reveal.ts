import { useEffect, useRef } from "react";

/** Adds `.revealed` when elements with `.reveal-up` / `.reveal-scale` enter the viewport */
export function useReveal(deps: unknown[] = []) {
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = rootRef.current ?? document;
    const nodes = Array.from(
      (root instanceof Element ? root : document).querySelectorAll(
        ".reveal-up, .reveal-scale, .reveal-left, .reveal-right",
      ),
    ) as HTMLElement[];

    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    for (const el of nodes) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return rootRef;
}
