import { describe, expect, it } from "vitest";
import { createT } from "@/i18n";
import { SETTINGS_LABEL_KEYS, buildSettingsLabels } from "./settingsLabels";

describe("settingsLabels", () => {
  it("fills every registered key with a non-empty en string", () => {
    const labels = buildSettingsLabels(createT("en"));
    expect(Object.keys(labels)).toHaveLength(SETTINGS_LABEL_KEYS.length);
    for (const key of SETTINGS_LABEL_KEYS) {
      expect(labels[key]?.length).toBeGreaterThan(0);
    }
  });
});
