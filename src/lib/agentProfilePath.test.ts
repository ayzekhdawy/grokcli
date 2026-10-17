import { describe, expect, it } from "vitest";
import {
  agentProfileSpawnCliArgs,
  normalizeAgentProfilePath,
} from "./agentProfilePath";

describe("normalizeAgentProfilePath", () => {
  it("treats empty as unset", () => {
    expect(normalizeAgentProfilePath(null)).toBeNull();
    expect(normalizeAgentProfilePath(undefined)).toBeNull();
    expect(normalizeAgentProfilePath("")).toBeNull();
    expect(normalizeAgentProfilePath("   ")).toBeNull();
  });

  it("trims real paths", () => {
    expect(normalizeAgentProfilePath("  /tmp/my-agent.md  ")).toBe(
      "/tmp/my-agent.md",
    );
    expect(normalizeAgentProfilePath("./agents/custom.md")).toBe(
      "./agents/custom.md",
    );
    expect(normalizeAgentProfilePath("C:\\agents\\x.md")).toBe(
      "C:\\agents\\x.md",
    );
  });

  it("rejects control characters", () => {
    expect(normalizeAgentProfilePath("/tmp/a\nb.md")).toBeNull();
    expect(normalizeAgentProfilePath("/tmp/a\0b.md")).toBeNull();
    expect(normalizeAgentProfilePath("x\r\ny")).toBeNull();
  });
});

describe("agentProfileSpawnCliArgs", () => {
  it("omits flag when unset", () => {
    expect(agentProfileSpawnCliArgs("")).toBeNull();
    expect(agentProfileSpawnCliArgs(null)).toBeNull();
    expect(agentProfileSpawnCliArgs("   ")).toBeNull();
  });

  it("builds agent-option --agent-profile PATH", () => {
    expect(agentProfileSpawnCliArgs("  /tmp/a.md  ")).toEqual([
      "--agent-profile",
      "/tmp/a.md",
    ]);
    expect(agentProfileSpawnCliArgs("./my-agent.md")).toEqual([
      "--agent-profile",
      "./my-agent.md",
    ]);
  });
});
