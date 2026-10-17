import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import { RemoteImLayout } from "@/components/RemoteImLayout";
import { RemoteImOverview } from "@/components/RemoteImOverview";
import { RemoteImChannelPanel } from "@/components/RemoteImChannelPanel";
import { createDefaultInstance } from "@/lib/remoteIm";

describe("ssr smoke remote im", () => {
  it("renders layout", () => {
    const html = renderToString(
      React.createElement(RemoteImLayout, {
        locale: "zh",
        trustedProjects: [],
      }),
    );
    expect(html).toContain("rim-layout");
  });

  it("renders overview", () => {
    const html = renderToString(
      React.createElement(RemoteImOverview, {
        locale: "en",
        bridge: null,
        busy: null,
        instances: [],
        onStart: () => {},
        onStop: () => {},
        onRestart: () => {},
        onToggleEnabled: () => {},
        onLifecycle: () => {},
        onAllowYolo: () => {},
        onOpenChannel: () => {},
      }),
    );
    expect(html.length).toBeGreaterThan(100);
  });

  it("renders feishu panel", () => {
    const inst = createDefaultInstance("feishu");
    const html = renderToString(
      React.createElement(RemoteImChannelPanel, {
        locale: "zh",
        channelId: "feishu",
        instance: inst,
        instances: [inst],
        trustedProjects: [],
        busy: null,
        onSave: async () => {},
        onTest: async () => ({ ok: true, message: "x" }),
        onRequestDelete: () => {},
        onSelectInstance: () => {},
        onAddInstance: () => {},
      }),
    );
    expect(html).toContain("data-channel");
  });
});
