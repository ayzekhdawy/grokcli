import { describe, expect, it } from "vitest";
import { resolveThinkingChromeLabel } from "./thinkingChromeLabel";

const formatDuration = (s: number) => `${s}s`;
const thinkingFor = (d: string) => `Thinking for ${d}`;
const thoughtFor = (d: string) => `Thought for ${d}`;
const doneLabel = "Thought";

describe("resolveThinkingChromeLabel", () => {
  it("live always uses 思考中/Thinking for + timer (never bare Thinking)", () => {
    expect(
      resolveThinkingChromeLabel({
        live: true,
        durationMs: 0,
        thinkingFor,
        thoughtFor,
        doneLabel,
        formatDuration,
      }),
    ).toBe("Thinking for 0s");
    expect(
      resolveThinkingChromeLabel({
        live: true,
        durationMs: 12_400,
        thinkingFor,
        thoughtFor,
        doneLabel,
        formatDuration,
      }),
    ).toBe("Thinking for 12s");
    // Missing duration still shows timer at 0
    expect(
      resolveThinkingChromeLabel({
        live: true,
        durationMs: null,
        thinkingFor,
        thoughtFor,
        doneLabel,
        formatDuration,
      }),
    ).toBe("Thinking for 0s");
  });

  it("done uses Thought for + duration, not bare Thought when duration known", () => {
    expect(
      resolveThinkingChromeLabel({
        live: false,
        durationMs: 5_200,
        thinkingFor,
        thoughtFor,
        doneLabel,
        formatDuration,
      }),
    ).toBe("Thought for 5s");
  });

  it("done without duration falls back to doneLabel (思考了 / Thought)", () => {
    expect(
      resolveThinkingChromeLabel({
        live: false,
        durationMs: undefined,
        thinkingFor,
        thoughtFor,
        doneLabel: "思考了",
        formatDuration,
      }),
    ).toBe("思考了");
  });

  it("does not invent gist — only duration labels", () => {
    // Contract: caller must not pass body gist into this helper.
    const label = resolveThinkingChromeLabel({
      live: true,
      durationMs: 3_000,
      thinkingFor,
      thoughtFor,
      doneLabel,
      formatDuration,
    });
    expect(label).not.toMatch(/定位|Quick note|gist/i);
    expect(label).toBe("Thinking for 3s");
  });
});
