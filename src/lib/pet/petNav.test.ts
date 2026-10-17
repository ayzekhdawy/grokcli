import { describe, expect, it } from "vitest";
import {
  buildSettingsHash,
  parseSettingsHash,
} from "@/lib/settingsCatalog";
import { PET_SETTINGS_HASH, PET_SETTINGS_SECTION, petSettingsHash } from "./petNav";

describe("pet settings navigation helper", () => {
  it("pet-window settings and the 宠物 nav share one hash/section", () => {
    expect(PET_SETTINGS_SECTION).toBe("pet");
    expect(PET_SETTINGS_HASH).toBe("#/settings/pet/look");
    expect(petSettingsHash()).toBe("#/settings/pet/look");
    expect(buildSettingsHash({ section: "pet" })).toBe(PET_SETTINGS_HASH);
    expect(parseSettingsHash(PET_SETTINGS_HASH)).toEqual({
      section: "pet",
      tab: "look",
    });
    expect(parseSettingsHash("#/settings/pet")).toEqual({
      section: "pet",
      tab: "look",
    });
  });
});
