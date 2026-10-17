import { describe, expect, it } from "vitest";
import {
  clearTypedSecretsAfterSave,
  initialSecretReveal,
  isSecretControl,
  secretFormValue,
  secretInputType,
  secretPlaceholderWhenStored,
  secretSummaryForLog,
  shouldShowSecretToggle,
  toggleSecretReveal,
} from "./secretField";

describe("secretField helpers", () => {
  it("detects secret controls", () => {
    expect(isSecretControl({ secret: true })).toBe(true);
    expect(isSecretControl({ control: "password" })).toBe(true);
    expect(isSecretControl({ control: "text" })).toBe(false);
  });

  it("defaults input type to password (masked)", () => {
    expect(secretInputType("app_secret", {})).toBe("password");
    expect(secretInputType("app_secret", { app_secret: false })).toBe(
      "password",
    );
    expect(secretInputType("app_secret", { app_secret: true })).toBe("text");
  });

  it("toggle flips reveal state", () => {
    const a = toggleSecretReveal({}, "token");
    expect(a.token).toBe(true);
    const b = toggleSecretReveal(a, "token");
    expect(b.token).toBe(false);
  });

  it("form value never invents stored secrets", () => {
    expect(secretFormValue("app_secret", {})).toBe("");
    expect(secretFormValue("app_secret", { app_secret: "typed" })).toBe(
      "typed",
    );
  });

  it("placeholder only when stored and empty form", () => {
    expect(
      secretPlaceholderWhenStored(true, "", "•••• saved"),
    ).toBe("•••• saved");
    expect(
      secretPlaceholderWhenStored(true, "x", "•••• saved"),
    ).toBeUndefined();
    expect(
      secretPlaceholderWhenStored(false, "", "•••• saved"),
    ).toBeUndefined();
  });

  it("summary masks for logs", () => {
    const s = secretSummaryForLog("super-secret-value");
    expect(s).not.toContain("super-secret");
    expect(s.startsWith("••••") || s.includes("••••")).toBe(true);
  });

  it("always show toggle for secret fields", () => {
    expect(shouldShowSecretToggle(true)).toBe(true);
    expect(shouldShowSecretToggle(false)).toBe(false);
  });

  it("initial reveal is all masked", () => {
    expect(initialSecretReveal(["a", "b"])).toEqual({ a: false, b: false });
  });

  it("clearTypedSecretsAfterSave empties or removes keys", () => {
    expect(
      clearTypedSecretsAfterSave({ app_secret: "x", other: "y" }),
    ).toEqual({});
    expect(
      clearTypedSecretsAfterSave(
        { app_secret: "x", token: "t", keep: "k" },
        ["app_secret", "token"],
      ),
    ).toEqual({ keep: "k" });
  });
});
