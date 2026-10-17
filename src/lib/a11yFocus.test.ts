import { afterEach, describe, expect, it, vi } from "vitest";
import {
  focusFirst,
  focusRelative,
  installDialogFocus,
  isTypingTarget,
  listFocusable,
  nextIndex,
  preferPermissionFocus,
  trapTabKey,
} from "./a11yFocus";

type FakeEl = HTMLElement & {
  id: string;
  disabled?: boolean;
  className?: string;
  _focus: ReturnType<typeof vi.fn>;
};

function fakeEl(
  id: string,
  opts?: { disabled?: boolean; className?: string },
): FakeEl {
  const focus = vi.fn();
  const el = {
    id,
    className: opts?.className ?? "",
    hasAttribute: (n: string) => n === "disabled" && !!opts?.disabled,
    getAttribute: (_n: string) => null as string | null,
    focus,
    _focus: focus,
  };
  return el as unknown as FakeEl;
}

function fakeRoot(els: FakeEl[]): ParentNode {
  return {
    querySelectorAll: () => els,
    querySelector: (sel: string) => {
      if (sel.includes("perm-bar__btn--allow")) {
        return els.find((e) => e.className.includes("perm-bar__btn--allow")) ?? null;
      }
      return els[0] ?? null;
    },
    contains: (n: Node) => els.includes(n as FakeEl),
  } as unknown as ParentNode;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listFocusable / focusFirst", () => {
  it("lists enabled controls and skips disabled", () => {
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    });
    const a = fakeEl("a");
    const b = fakeEl("b");
    const disabled = fakeEl("x", { disabled: true });
    // disabled has hasAttribute true — listFocusable filters it
    const root = fakeRoot([disabled, a, b]);
    // querySelectorAll returns all; listFocusable filters disabled
    const list = listFocusable(root);
    expect(list.map((e) => (e as FakeEl).id)).toEqual(["a", "b"]);
    const focused = focusFirst(root);
    expect((focused as FakeEl | null)?.id).toBe("a");
    expect(a._focus).toHaveBeenCalled();
  });
});

describe("trapTabKey", () => {
  it("wraps from last to first on Tab", () => {
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    });
    const a = fakeEl("a");
    const b = fakeEl("b");
    const root = fakeRoot([a, b]);
    vi.stubGlobal("document", { activeElement: b });
    const e = {
      key: "Tab",
      shiftKey: false,
      preventDefault: vi.fn(),
    };
    trapTabKey(e, root);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(a._focus).toHaveBeenCalled();
  });

  it("wraps from first to last on Shift+Tab", () => {
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    });
    const a = fakeEl("a");
    const b = fakeEl("b");
    const root = fakeRoot([a, b]);
    vi.stubGlobal("document", { activeElement: a });
    const e = {
      key: "Tab",
      shiftKey: true,
      preventDefault: vi.fn(),
    };
    trapTabKey(e, root);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(b._focus).toHaveBeenCalled();
  });
});

describe("preferPermissionFocus", () => {
  it("focuses allow button when present", () => {
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    });
    const deny = fakeEl("deny", { className: "perm-bar__btn--deny" });
    const ok = fakeEl("ok", { className: "perm-bar__btn--allow" });
    const root = fakeRoot([deny, ok]);
    const el = preferPermissionFocus(root);
    expect((el as FakeEl | null)?.id).toBe("ok");
    expect(ok._focus).toHaveBeenCalled();
  });
});

describe("isTypingTarget", () => {
  it("detects input / textarea / contenteditable", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(
      isTypingTarget({
        tagName: "INPUT",
        isContentEditable: false,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isTypingTarget({
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isTypingTarget({
        tagName: "DIV",
        isContentEditable: true,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isTypingTarget({
        tagName: "BUTTON",
        isContentEditable: false,
        closest: () => null,
      } as unknown as EventTarget),
    ).toBe(false);
  });
});

describe("nextIndex / focusRelative", () => {
  it("clamps next/prev indices", () => {
    expect(nextIndex(0, 0, "next")).toBe(-1);
    expect(nextIndex(3, -1, "next")).toBe(0);
    expect(nextIndex(3, -1, "prev")).toBe(2);
    expect(nextIndex(3, 0, "prev")).toBe(0);
    expect(nextIndex(3, 2, "next")).toBe(2);
    expect(nextIndex(3, 1, "next")).toBe(2);
    expect(nextIndex(3, 1, "prev")).toBe(0);
  });

  it("focusRelative moves among list", () => {
    const a = fakeEl("a");
    const b = fakeEl("b");
    const c = fakeEl("c");
    const list = [a, b, c];
    expect((focusRelative(list, a, "next") as FakeEl).id).toBe("b");
    expect(b._focus).toHaveBeenCalled();
    expect((focusRelative(list, c, "next") as FakeEl).id).toBe("c");
    expect((focusRelative(list, a, "prev") as FakeEl).id).toBe("a");
    expect((focusRelative(list, null, "next") as FakeEl).id).toBe("a");
  });
});

describe("installDialogFocus", () => {
  it("traps Tab and calls onEscape", () => {
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
      setTimeout: (fn: () => void) => {
        fn();
        return 1;
      },
      clearTimeout: vi.fn(),
    });
    const a = fakeEl("a");
    const b = fakeEl("b");
    const root = fakeRoot([a, b]);
    const listeners: Array<{
      type: string;
      fn: (e: KeyboardEvent) => void;
      capture?: boolean;
    }> = [];
    const prev = fakeEl("prev");
    vi.stubGlobal("document", {
      activeElement: prev,
      addEventListener: (
        type: string,
        fn: (e: KeyboardEvent) => void,
        capture?: boolean,
      ) => {
        listeners.push({ type, fn, capture });
      },
      removeEventListener: vi.fn(),
    });
    const onEscape = vi.fn();
    const cleanup = installDialogFocus(() => root, {
      onEscape,
      initialFocus: "first",
    });
    expect(a._focus).toHaveBeenCalled();
    expect(listeners.length).toBe(1);

    const tab = {
      key: "Tab",
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    // active = last → wrap to first
    (document as unknown as { activeElement: FakeEl }).activeElement = b;
    listeners[0]!.fn(tab);
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(a._focus).toHaveBeenCalled();

    const esc = {
      key: "Escape",
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    listeners[0]!.fn(esc);
    expect(onEscape).toHaveBeenCalled();
    expect(esc.preventDefault).toHaveBeenCalled();

    cleanup();
    expect(prev._focus).toHaveBeenCalled();
  });

  it("skips initial focus when initialFocus is none", () => {
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    });
    const a = fakeEl("a");
    const root = fakeRoot([a]);
    vi.stubGlobal("document", {
      activeElement: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const cleanup = installDialogFocus(() => root, {
      initialFocus: "none",
      restoreFocus: false,
    });
    expect(window.setTimeout).not.toHaveBeenCalled();
    expect(a._focus).not.toHaveBeenCalled();
    cleanup();
  });
});
