/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  createSessionConnectHost,
  useSessionConnect,
} from "./useSessionConnect";

describe("useSessionConnect", () => {
  it("rejects a second connect claim for the same session", () => {
    const hostRef = { current: createSessionConnectHost() };
    const { result } = renderHook(() =>
      useSessionConnect({
        hostRef,
        liveMapEnabled: false,
        viewedSessionId: null,
      }),
    );
    expect(result.current.claimSessionConnection("s1")).toBe(true);
    expect(result.current.claimSessionConnection("s1")).toBe(false);
    result.current.releaseSessionConnection(["s1"]);
    expect(result.current.claimSessionConnection("s1")).toBe(true);
  });
});
