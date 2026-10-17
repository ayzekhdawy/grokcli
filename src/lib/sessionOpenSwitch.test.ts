import { describe, expect, it } from "vitest";
import {
  DEFERRED_RECONCILE_MS,
  WARM_CONNECT_DEBOUNCE_MS,
  isOpenGenerationCurrent,
  sessionJournalLooksUnchanged,
  shouldApplyOpenSessionResult,
} from "./sessionOpenSwitch";

describe("sessionOpenSwitch", () => {
  it("exposes positive debounce intervals", () => {
    expect(WARM_CONNECT_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(DEFERRED_RECONCILE_MS).toBeGreaterThan(0);
  });

  it("isOpenGenerationCurrent requires exact match", () => {
    expect(isOpenGenerationCurrent(3, 3)).toBe(true);
    expect(isOpenGenerationCurrent(4, 3)).toBe(false);
  });

  it("shouldApplyOpenSessionResult needs gen + viewing id", () => {
    expect(
      shouldApplyOpenSessionResult({
        currentGen: 2,
        startedGen: 2,
        viewingSessionId: "a",
        targetSessionId: "a",
      }),
    ).toBe(true);
    expect(
      shouldApplyOpenSessionResult({
        currentGen: 3,
        startedGen: 2,
        viewingSessionId: "a",
        targetSessionId: "a",
      }),
    ).toBe(false);
    expect(
      shouldApplyOpenSessionResult({
        currentGen: 2,
        startedGen: 2,
        viewingSessionId: "b",
        targetSessionId: "a",
      }),
    ).toBe(false);
  });

  it("sessionJournalLooksUnchanged compares ends", () => {
    expect(sessionJournalLooksUnchanged([], [])).toBe(true);
    expect(
      sessionJournalLooksUnchanged(
        [{ id: "1" }, { id: "2" }],
        [{ id: "1" }, { id: "2" }],
      ),
    ).toBe(true);
    expect(
      sessionJournalLooksUnchanged(
        [{ id: "1" }, { id: "2" }],
        [{ id: "1" }, { id: "3" }],
      ),
    ).toBe(false);
    expect(
      sessionJournalLooksUnchanged([{ id: "1" }], [{ id: "1" }, { id: "2" }]),
    ).toBe(false);
  });
});
