import { describe, expect, it } from "vitest";
import {
  buildPluginMarketErrorView,
  classifyPluginMarketError,
  clearPluginMarketRowError,
  formatPluginMarketRowErrorMessage,
  planPluginMarketEmptyRetry,
  planPluginMarketRetry,
  pluginMarketErrorHintKey,
  pluginMarketErrorTitleKey,
  pluginMarketIsSoftFailKind,
  pluginMarketLoadIsSoftFail,
  resolvePluginCatalogEmptyState,
  setPluginMarketRowError,
} from "./pluginMarketPro";

describe("classifyPluginMarketError", () => {
  it("classifies CLI missing / too old", () => {
    expect(classifyPluginMarketError("CLI not found")).toBe("cli_missing");
    expect(classifyPluginMarketError("Grok Build CLI not found")).toBe(
      "cli_missing",
    );
    expect(
      classifyPluginMarketError({ reason: "cli_missing", message: "x" }),
    ).toBe("cli_missing");
    expect(
      classifyPluginMarketError(
        "This Grok CLI does not support `plugin list --available`",
      ),
    ).toBe("cli_too_old");
    expect(
      classifyPluginMarketError(
        "error: unrecognized subcommand 'marketplace'",
      ),
    ).toBe("cli_too_old");
    expect(
      classifyPluginMarketError("unexpected argument '--trust' found"),
    ).toBe("cli_too_old");
    expect(classifyPluginMarketError({ code: "cli_too_old" })).toBe(
      "cli_too_old",
    );
  });

  it("classifies network / offline / timeout", () => {
    expect(classifyPluginMarketError("connection refused")).toBe("network");
    expect(classifyPluginMarketError(new Error("ENOTFOUND github.com"))).toBe(
      "network",
    );
    expect(classifyPluginMarketError("You appear offline")).toBe("offline");
    expect(classifyPluginMarketError("operation timed out")).toBe("timeout");
  });

  it("classifies install-specific failures", () => {
    expect(classifyPluginMarketError("plugin already installed")).toBe(
      "already_installed",
    );
    expect(classifyPluginMarketError("plugin source required")).toBe(
      "invalid_source",
    );
    expect(classifyPluginMarketError("unknown plugin: nope")).toBe("not_found");
    expect(classifyPluginMarketError("Permission denied writing config")).toBe(
      "permission",
    );
    expect(classifyPluginMarketError("401 Unauthorized")).toBe("auth");
  });

  it("classifies parse / host-only / host error", () => {
    expect(
      classifyPluginMarketError(
        "Failed to parse available plugins JSON: Unexpected token",
      ),
    ).toBe("parse");
    expect(classifyPluginMarketError("Need Tauri for marketplace")).toBe(
      "host_only",
    );
    expect(classifyPluginMarketError("ipc invoke failed")).toBe("host_error");
  });

  it("falls back to other", () => {
    expect(classifyPluginMarketError("weird host boom")).toBe("other");
    expect(classifyPluginMarketError(null)).toBe("other");
    expect(classifyPluginMarketError("")).toBe("other");
  });
});

describe("buildPluginMarketErrorView / soft-fail", () => {
  it("marks cli gaps as soft-fail", () => {
    const v = buildPluginMarketErrorView("CLI not found", "list");
    expect(v.kind).toBe("cli_missing");
    expect(v.softFail).toBe(true);
    expect(v.title).toMatch(/cli/i);
    expect(v.hint.length).toBeGreaterThan(0);
    expect(pluginMarketIsSoftFailKind("cli_too_old")).toBe(true);
    expect(pluginMarketIsSoftFailKind("network")).toBe(false);
    expect(pluginMarketLoadIsSoftFail("CLI not found")).toBe(true);
    expect(pluginMarketLoadIsSoftFail("connection refused")).toBe(false);
  });

  it("maps i18n keys for each kind", () => {
    expect(pluginMarketErrorTitleKey("cli_missing")).toBe(
      "ext.market.err.cliMissing",
    );
    expect(pluginMarketErrorHintKey("network")).toBe(
      "ext.market.err.hint.network",
    );
    expect(pluginMarketErrorTitleKey("other")).toBe("ext.market.err.other");
  });
});

describe("resolvePluginCatalogEmptyState", () => {
  const base = {
    loading: false,
    cliFound: true,
    error: null as unknown,
    sourceCount: 2,
    availableCount: 10,
    visibleCount: 0,
    marketFilter: "xAI Official",
    query: "",
  };

  it("returns null when rows are visible", () => {
    expect(
      resolvePluginCatalogEmptyState({ ...base, visibleCount: 3 }),
    ).toBeNull();
  });

  it("loading state", () => {
    const e = resolvePluginCatalogEmptyState({
      ...base,
      loading: true,
      sourceCount: 0,
      availableCount: 0,
      visibleCount: 0,
    });
    expect(e?.kind).toBe("loading");
    expect(e?.softFail).toBe(true);
  });

  it("cli missing soft-fail", () => {
    const e = resolvePluginCatalogEmptyState({
      ...base,
      cliFound: false,
      availableCount: 0,
      sourceCount: 0,
    });
    expect(e?.kind).toBe("cli_missing");
    expect(e?.softFail).toBe(true);
    expect(e?.retryAction).toBe("open_runtime");
  });

  it("cli too old from list error", () => {
    const e = resolvePluginCatalogEmptyState({
      ...base,
      availableCount: 0,
      error: "unrecognized subcommand 'marketplace'",
    });
    expect(e?.kind).toBe("cli_too_old");
    expect(e?.softFail).toBe(true);
    expect(e?.retryAction).toBe("update_cli");
  });

  it("offline / network load error", () => {
    const e = resolvePluginCatalogEmptyState({
      ...base,
      availableCount: 0,
      error: "network is unreachable",
    });
    expect(e?.kind).toBe("offline");
    expect(e?.retryAction).toBe("retry_load");
  });

  it("no sources honesty", () => {
    const e = resolvePluginCatalogEmptyState({
      ...base,
      sourceCount: 0,
      availableCount: 0,
      marketFilter: "__all__",
    });
    expect(e?.kind).toBe("no_sources");
    expect(e?.titleKey).toBe("ext.market.empty");
  });

  it("empty catalog with sources", () => {
    const e = resolvePluginCatalogEmptyState({
      ...base,
      sourceCount: 1,
      availableCount: 0,
      marketFilter: "__all__",
    });
    expect(e?.kind).toBe("empty_catalog");
    expect(e?.retryAction).toBe("refresh_catalog");
  });

  it("empty filter vs empty query honesty", () => {
    const filterEmpty = resolvePluginCatalogEmptyState({
      ...base,
      marketFilter: "xAI Official",
      query: "",
    });
    expect(filterEmpty?.kind).toBe("empty_filter");
    expect(filterEmpty?.showClearFilters).toBe(true);
    expect(filterEmpty?.hintKey).toBe("ext.market.emptyFilterHint");

    const queryEmpty = resolvePluginCatalogEmptyState({
      ...base,
      marketFilter: "__all__",
      query: "zzzz-nope",
    });
    expect(queryEmpty?.kind).toBe("empty_query");
    expect(queryEmpty?.showClearFilters).toBe(true);
    expect(queryEmpty?.hintKey).toBe("ext.market.emptyQueryHint");
  });

  it("hard load error with empty catalog", () => {
    const e = resolvePluginCatalogEmptyState({
      ...base,
      availableCount: 0,
      error: "Failed to parse available plugins JSON: boom",
    });
    expect(e?.kind).toBe("error");
    expect(e?.retryAction).toBe("retry_load");
  });
});

describe("planPluginMarketRetry", () => {
  it("maps capability gaps to runtime / CLI update", () => {
    expect(planPluginMarketRetry("cli_missing").action).toBe("open_runtime");
    expect(planPluginMarketRetry("cli_missing").canRetry).toBe(false);
    expect(planPluginMarketRetry("cli_too_old").action).toBe("update_cli");
    expect(planPluginMarketRetry("host_only").action).toBe("none");
  });

  it("retries install for transient / generic install failures", () => {
    expect(planPluginMarketRetry("network", "install")).toEqual(
      expect.objectContaining({
        action: "retry_install",
        canRetry: true,
      }),
    );
    expect(planPluginMarketRetry("other", "install").action).toBe(
      "retry_install",
    );
    expect(planPluginMarketRetry("already_installed").label).toMatch(
      /reinstall/i,
    );
  });

  it("retries load for list failures", () => {
    expect(planPluginMarketRetry("timeout", "list").action).toBe("retry_load");
    expect(planPluginMarketRetry("parse", "list").action).toBe(
      "refresh_catalog",
    );
  });

  it("plans from empty presentation", () => {
    expect(
      planPluginMarketEmptyRetry({
        kind: "empty_filter",
        retryAction: "clear_filter",
        softFail: true,
      }).action,
    ).toBe("clear_filter");
    expect(
      planPluginMarketEmptyRetry({
        kind: "offline",
        retryAction: "retry_load",
        softFail: false,
      }).canRetry,
    ).toBe(true);
  });
});

describe("setPluginMarketRowError / clear", () => {
  it("sets classified row errors immutably", () => {
    const empty: Record<string, never> = {};
    const withErr = setPluginMarketRowError(
      empty,
      "xAI Official:vercel",
      "connection refused",
      "install",
    );
    expect(withErr["xAI Official:vercel"]).toMatchObject({
      kind: "network",
      softFail: false,
    });
    expect(withErr["xAI Official:vercel"].message).toMatch(/connection/i);
    expect(empty).toEqual({});

    // Same error → same object
    expect(
      setPluginMarketRowError(
        withErr,
        "xAI Official:vercel",
        "connection refused",
      ),
    ).toBe(withErr);

    const cleared = clearPluginMarketRowError(withErr, "xAI Official:vercel");
    expect(cleared).toEqual({});
    expect(clearPluginMarketRowError(cleared, "missing")).toBe(cleared);
    expect(setPluginMarketRowError(empty, "", "x")).toBe(empty);
  });

  it("formats row message with optional detail", () => {
    const row = {
      kind: "network" as const,
      message: "connection refused",
      softFail: false,
    };
    expect(formatPluginMarketRowErrorMessage(row)).toMatch(/network/i);
    expect(
      formatPluginMarketRowErrorMessage(row, {
        title: "Network error",
        includeDetail: true,
      }),
    ).toContain("connection refused");
  });
});
