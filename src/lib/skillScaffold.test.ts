import { describe, expect, it } from "vitest";
import {
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  SKILL_NAME_MIN,
  defaultSkillMdContent,
  normalizeSkillDescription,
  sanitizeSkillFolderName,
  skillDescriptionForFrontmatter,
} from "./skillScaffold";

describe("sanitizeSkillFolderName", () => {
  it("accepts simple lowercase names", () => {
    expect(sanitizeSkillFolderName("deploy")).toBe("deploy");
    expect(sanitizeSkillFolderName("deploy-k8s")).toBe("deploy-k8s");
    expect(sanitizeSkillFolderName("a1")).toBe("a1");
  });

  it("normalizes case, spaces, and underscores", () => {
    expect(sanitizeSkillFolderName("  Deploy K8s  ")).toBe("deploy-k8s");
    expect(sanitizeSkillFolderName("my_skill_name")).toBe("my-skill-name");
    expect(sanitizeSkillFolderName("Foo__Bar")).toBe("foo-bar");
  });

  it("strips invalid characters and collapses hyphens", () => {
    expect(sanitizeSkillFolderName("hello@world!")).toBe("helloworld");
    expect(sanitizeSkillFolderName("a--b---c")).toBe("a-b-c");
    expect(sanitizeSkillFolderName("-trim-me-")).toBe("trim-me");
  });

  it("rejects empty, too short, too long, and reserved", () => {
    expect(sanitizeSkillFolderName("")).toBeNull();
    expect(sanitizeSkillFolderName("   ")).toBeNull();
    expect(sanitizeSkillFolderName("x")).toBeNull(); // min 2
    expect(sanitizeSkillFolderName("a".repeat(SKILL_NAME_MAX + 1))).toBeNull();
    expect(sanitizeSkillFolderName("bundled")).toBeNull();
    expect(sanitizeSkillFolderName("Bundled")).toBeNull();
    expect(sanitizeSkillFolderName(null)).toBeNull();
    expect(sanitizeSkillFolderName(undefined)).toBeNull();
  });

  it("accepts boundary lengths", () => {
    expect(sanitizeSkillFolderName("ab")).toBe("ab");
    expect(sanitizeSkillFolderName("a".repeat(SKILL_NAME_MAX))).toBe(
      "a".repeat(SKILL_NAME_MAX),
    );
    expect(SKILL_NAME_MIN).toBe(2);
  });
});

describe("normalizeSkillDescription", () => {
  it("trims and caps length", () => {
    expect(normalizeSkillDescription("  hello  ")).toBe("hello");
    const long = "x".repeat(SKILL_DESCRIPTION_MAX + 50);
    expect(normalizeSkillDescription(long).length).toBe(SKILL_DESCRIPTION_MAX);
  });

  it("collapses excessive blank lines", () => {
    expect(normalizeSkillDescription("a\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("skillDescriptionForFrontmatter", () => {
  it("provides a default when empty", () => {
    expect(skillDescriptionForFrontmatter("")).toMatch(/Describe what this skill/);
  });

  it("flattens newlines and escapes quotes", () => {
    expect(skillDescriptionForFrontmatter("line1\nline2")).toBe("line1 line2");
    expect(skillDescriptionForFrontmatter('say "hi"')).toBe('say \\"hi\\"');
  });
});

describe("defaultSkillMdContent", () => {
  it("emits frontmatter name + description and body steps", () => {
    const md = defaultSkillMdContent("code-review", "Review PRs carefully.");
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("name: code-review");
    expect(md).toContain("description: Review PRs carefully.");
    expect(md).toContain("# Code Review");
    expect(md).toContain("Review PRs carefully.");
    expect(md).toContain("## Steps");
  });

  it("sanitizes name in frontmatter", () => {
    const md = defaultSkillMdContent("My Skill", "does things");
    expect(md).toContain("name: my-skill");
    expect(md).toContain("# My Skill");
  });

  it("uses placeholder body when description omitted", () => {
    const md = defaultSkillMdContent("help-me");
    expect(md).toContain("name: help-me");
    expect(md).toMatch(/Describe the workflow|Describe what this skill/);
  });
});
