import { describe, expect, it } from "vitest";
import { matchSshHost, mergeWatchingSet, partitionSshHosts } from "./sshHostMatch";

describe("sshHostMatch", () => {
  const hosts = [
    { alias: "devbox", hostname: "10.0.0.8", user: "deploy" },
    { alias: "gpu", hostname: "lab.example.com", user: "me" },
    { alias: "bastion", hostname: "jump", user: "ops" },
  ];

  it("empty query matches all", () => {
    expect(hosts.every((h) => matchSshHost("  ", h))).toBe(true);
  });

  it("filters alias substring immediately", () => {
    expect(hosts.filter((h) => matchSshHost("dev", h)).map((h) => h.alias)).toEqual(
      ["devbox"],
    );
  });

  it("filters hostname and user", () => {
    expect(hosts.filter((h) => matchSshHost("example", h)).map((h) => h.alias)).toEqual(
      ["gpu"],
    );
    expect(hosts.filter((h) => matchSshHost("ops", h)).map((h) => h.alias)).toEqual(
      ["bastion"],
    );
  });

  it("partitions watching vs available after filter", () => {
    const watching = new Set(["gpu"]);
    const p = partitionSshHosts(hosts, watching, "g");
    expect(p.watching.map((h) => h.alias)).toEqual(["gpu"]);
    expect(p.available.map((h) => h.alias)).toEqual([]);
    const all = partitionSshHosts(hosts, watching, "");
    expect(all.watching.map((h) => h.alias)).toEqual(["gpu"]);
    expect(all.available.map((h) => h.alias)).toEqual(["devbox", "bastion"]);
  });

  it("merges optimistic pending onto persisted watch aliases", () => {
    const on = mergeWatchingSet(["gpu"], { devbox: true });
    expect([...on].sort()).toEqual(["devbox", "gpu"]);
    const off = mergeWatchingSet(["gpu", "devbox"], { gpu: false });
    expect([...off]).toEqual(["devbox"]);
  });
});
