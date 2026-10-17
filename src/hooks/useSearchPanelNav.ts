/**
 * Keyboard highlight for the command-palette search panel.
 * Policy lives in `searchPanelNav` (testable). This hook owns index + listeners.
 */
import { useEffect, useRef, useState } from "react";
import {
  clampSearchPanelIndex,
  resolveSearchPanelKey,
  type SearchPanelItem,
} from "@/lib/searchPanelNav";

export function useSearchPanelNav(opts: {
  open: boolean;
  items: readonly SearchPanelItem[];
  sessionCount: number;
  /** Change this to snap the highlight back to the first row (query / filters). */
  resetKey: string;
  getRoot: () => ParentNode | null | undefined;
  onActivate: (item: SearchPanelItem) => void;
  onActivateSessionIndex: (sessionIndex: number) => void;
}): {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
} {
  const [rawIndex, setRawIndex] = useState(0);
  const activeIndex = clampSearchPanelIndex(rawIndex, opts.items.length);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const indexRef = useRef(activeIndex);
  indexRef.current = activeIndex;

  useEffect(() => {
    if (!opts.open) return;
    setRawIndex(0);
  }, [opts.open, opts.resetKey]);

  useEffect(() => {
    if (!opts.open) return;
    const el = optsRef.current
      .getRoot()
      ?.querySelector<HTMLElement>(`[data-search-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [opts.open, activeIndex, opts.items.length]);

  useEffect(() => {
    if (!opts.open) return;
    const onKey = (e: KeyboardEvent) => {
      const o = optsRef.current;
      const result = resolveSearchPanelKey({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        isComposing: e.isComposing,
        activeIndex: indexRef.current,
        itemCount: o.items.length,
        sessionCount: o.sessionCount,
      });
      if (result.type === "none") return;
      e.preventDefault();
      e.stopPropagation();
      if (result.type === "nav") {
        setRawIndex(result.index);
        return;
      }
      if (result.type === "activate") {
        const item = o.items[result.index];
        if (item) o.onActivate(item);
        return;
      }
      o.onActivateSessionIndex(result.sessionIndex);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [opts.open]);

  return { activeIndex, setActiveIndex: setRawIndex };
}
