import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

function readCss(name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Top-level `selector { … }` bodies. Skips at-rules, comments, and nested blocks. */
function ruleBodies(css: string, selector: string): string[] {
  const bodies: string[] = [];
  const re = /(?:^|\n)([^{}@\n][^{}]*)\{([^}]*)\}/g;
  for (const match of stripComments(css).matchAll(re)) {
    const selectors = match[1]!.split(",").map((part) => part.trim());
    if (selectors.includes(selector)) bodies.push(match[2]!);
  }
  return bodies;
}

describe("composer IME containment", () => {
  const part1 = readCss("chat.part1.css");
  const part2 = readCss("chat.part2.css");
  const part3 = readCss("chat.part3.css");
  const css = `${part1}\n${part2}\n${part3}`;

  it("does not put a size container on the field or its stack", () => {
    for (const selector of [".composer", ".composer-stack"]) {
      const bodies = ruleBodies(css, selector);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body).not.toMatch(/container-type\s*:/);
        expect(body).not.toMatch(/container-name\s*:/);
      }
    }
  });

  it("keeps the chip query on the chrome and the button row only", () => {
    const named = [".composer__chrome", ".composer__row"];
    for (const selector of named) {
      const bodies = ruleBodies(css, selector);
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies.some((body) => /container-type\s*:\s*inline-size/.test(body))).toBe(
        true,
      );
      expect(bodies.some((body) => /container-name\s*:\s*composer/.test(body))).toBe(
        true,
      );
    }

    const re = /(?:^|\n)([^{}@\n][^{}]*)\{([^}]*)\}/g;
    const owners: string[] = [];
    for (const match of stripComments(css).matchAll(re)) {
      if (!/container-name\s*:\s*composer/.test(match[2]!)) continue;
      owners.push(
        ...match[1]!.split(",").map((part) => part.trim()),
      );
    }
    expect(owners.sort()).toEqual([...named].sort());
  });
});
