import { describe, expect, it } from "vitest";
import { defaultSkillMdContent } from "./skillScaffold";
import {
  MAX_SKILL_EDIT_BYTES,
  buildSkillHostErrorPresentation,
  buildSkillSaveOkPresentation,
  buildSkillSavePreflightError,
  buildSkillValidatePresentation,
  classifySkillHostError,
  parseSkillMdFrontmatter,
  skillEditBadgeTone,
  skillEditHint,
  skillEditKindBlocksSave,
  skillEditKindLabel,
  skillEditSeverity,
  skillMdByteLength,
  validateSkillMdContent,
} from "./skillEditFeedback";

describe("skillMdByteLength", () => {
  it("counts ASCII and multi-byte", () => {
    expect(skillMdByteLength("abc")).toBe(3);
    expect(skillMdByteLength("你")).toBe(3);
    expect(skillMdByteLength("")).toBe(0);
  });
});

describe("parseSkillMdFrontmatter", () => {
  it("parses scaffold template", () => {
    const md = defaultSkillMdContent("deploy-k8s", "Deploy to k8s.");
    const p = parseSkillMdFrontmatter(md);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.frontmatter.name).toBe("deploy-k8s");
    expect(p.frontmatter.description).toContain("Deploy");
    expect(p.frontmatter.body).toContain("# Deploy K8s");
  });

  it("rejects empty / missing / unclosed frontmatter", () => {
    const empty = parseSkillMdFrontmatter("");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.kind).toBe("empty");

    const missing = parseSkillMdFrontmatter("# just body\n");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.kind).toBe("missing_frontmatter");

    const unclosed = parseSkillMdFrontmatter("---\nname: x\n");
    expect(unclosed.ok).toBe(false);
    if (!unclosed.ok) expect(unclosed.kind).toBe("unclosed_frontmatter");
  });

  it("rejects invalid frontmatter lines", () => {
    const bad = parseSkillMdFrontmatter("---\nnot a kv line\n---\n");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.kind).toBe("invalid_frontmatter");
  });

  it("strips quotes and allows description", () => {
    const md = `---
name: "hello-world"
description: 'Say "hi"'
---

Body here.
`;
    const p = parseSkillMdFrontmatter(md);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.frontmatter.name).toBe("hello-world");
    expect(p.frontmatter.description).toContain("hi");
    expect(p.frontmatter.body.trim()).toBe("Body here.");
  });
});

describe("validateSkillMdContent", () => {
  it("accepts valid scaffold", () => {
    const md = defaultSkillMdContent("code-review", "Review PRs.");
    const v = validateSkillMdContent(md, { expectedName: "code-review" });
    expect(v.ok).toBe(true);
    expect(v.blocking).toBe(false);
    expect(v.kind).toBe("ok");
    expect(v.name).toBe("code-review");
  });

  it("blocks empty and missing name", () => {
    expect(validateSkillMdContent("").blocking).toBe(true);
    expect(validateSkillMdContent("").kind).toBe("empty");

    const noName = `---
description: something useful
---

# Title
`;
    const v = validateSkillMdContent(noName);
    expect(v.blocking).toBe(true);
    expect(v.kind).toBe("missing_name");
  });

  it("blocks invalid name", () => {
    const md = `---
name: BAD_NAME!!
description: x
---

body
`;
    const v = validateSkillMdContent(md);
    expect(v.blocking).toBe(true);
    expect(v.kind).toBe("invalid_name");
  });

  it("warns on name mismatch without blocking", () => {
    const md = defaultSkillMdContent("alpha", "Alpha skill.");
    const v = validateSkillMdContent(md, { expectedName: "beta" });
    expect(v.ok).toBe(true);
    expect(v.blocking).toBe(false);
    expect(v.issues.some((i) => i.kind === "name_mismatch")).toBe(true);
    expect(v.kind).toBe("name_mismatch");
  });

  it("warns on missing description / empty body", () => {
    const md = `---
name: bare-skill
---
`;
    const v = validateSkillMdContent(md);
    expect(v.ok).toBe(true);
    expect(v.blocking).toBe(false);
    expect(v.issues.some((i) => i.kind === "missing_description")).toBe(true);
    expect(v.issues.some((i) => i.kind === "empty_body")).toBe(true);
  });

  it("blocks oversized content", () => {
    const big = "x".repeat(MAX_SKILL_EDIT_BYTES + 1);
    const v = validateSkillMdContent(big, { maxBytes: MAX_SKILL_EDIT_BYTES });
    expect(v.blocking).toBe(true);
    expect(v.kind).toBe("too_large");
  });
});

describe("classifySkillHostError", () => {
  it("maps known host messages", () => {
    expect(classifySkillHostError("CONFLICT: file changed on disk")).toBe(
      "conflict",
    );
    expect(
      classifySkillHostError("path not allowed: outside known skills roots"),
    ).toBe("path_outside");
    expect(classifySkillHostError("path not allowed: traversal")).toBe(
      "path_denied",
    );
    expect(classifySkillHostError("path not allowed: bundled skills")).toBe(
      "bundled_readonly",
    );
    expect(
      classifySkillHostError("file too large to edit in-app (max 2097152 bytes)"),
    ).toBe("too_large");
    expect(classifySkillHostError("not a file: /tmp/x")).toBe("not_a_file");
    expect(classifySkillHostError("path not found: No such file")).toBe(
      "not_found",
    );
    expect(
      classifySkillHostError("skill already exists", "create"),
    ).toBe("already_exists");
    expect(classifySkillHostError("Try-run requires the desktop host")).toBe(
      "host_only",
    );
    expect(classifySkillHostError("skill name is reserved")).toBe(
      "invalid_name",
    );
    expect(classifySkillHostError("boom")).toBe("host_error");
  });
});

describe("skillEditSeverity / blocks / badge", () => {
  it("maps severity and block rules", () => {
    expect(skillEditSeverity("ok")).toBe("ok");
    expect(skillEditSeverity("name_mismatch")).toBe("warn");
    expect(skillEditSeverity("empty_body")).toBe("info");
    expect(skillEditSeverity("invalid_name")).toBe("err");
    expect(skillEditKindBlocksSave("ok")).toBe(false);
    expect(skillEditKindBlocksSave("name_mismatch")).toBe(false);
    expect(skillEditKindBlocksSave("missing_name")).toBe(true);
    expect(skillEditBadgeTone("ok")).toBe("ok");
    expect(skillEditBadgeTone("err")).toBe("fail");
    expect(skillEditBadgeTone("warn")).toBe("muted");
  });

  it("has fallback labels and hints", () => {
    expect(skillEditKindLabel("conflict")).toMatch(/conflict/i);
    expect(skillEditHint("missing_frontmatter").length).toBeGreaterThan(10);
  });
});

describe("buildSkillValidatePresentation / host / preflight", () => {
  it("builds ok presentation", () => {
    const md = defaultSkillMdContent("ok-skill", "Does things.");
    const p = buildSkillValidatePresentation(md, {
      expectedName: "ok-skill",
      path: "/tmp/skills/ok-skill/SKILL.md",
    });
    expect(p.ok).toBe(true);
    expect(p.blocking).toBe(false);
    expect(p.phase).toBe("validate");
    expect(p.path).toContain("SKILL.md");
    expect(p.name).toBe("ok-skill");
  });

  it("builds blocking presentation for bad content", () => {
    const p = buildSkillValidatePresentation("# no fm\n");
    expect(p.ok).toBe(false);
    expect(p.blocking).toBe(true);
    expect(p.kind).toBe("missing_frontmatter");
  });

  it("builds host error presentation", () => {
    const p = buildSkillHostErrorPresentation(
      new Error("CONFLICT: mtime"),
      "save",
      { path: "/x/SKILL.md" },
    );
    expect(p.kind).toBe("conflict");
    expect(p.phase).toBe("save");
    expect(p.blocking).toBe(true);
    expect(p.path).toBe("/x/SKILL.md");
  });

  it("preflight blocks host-only and invalid content", () => {
    expect(
      buildSkillSavePreflightError("x", { isTauri: false })?.kind,
    ).toBe("host_only");
    const bad = buildSkillSavePreflightError("# no", { isTauri: true });
    expect(bad?.blocking).toBe(true);
    expect(bad?.phase).toBe("save");

    const good = buildSkillSavePreflightError(
      defaultSkillMdContent("fine", "desc"),
      { isTauri: true, expectedName: "fine" },
    );
    expect(good).toBeNull();
  });

  it("builds save ok presentation", () => {
    const p = buildSkillSaveOkPresentation({
      path: "/a/SKILL.md",
      name: "a",
      sizeBytes: 12,
      title: "Saved",
    });
    expect(p.ok).toBe(true);
    expect(p.phase).toBe("save");
    expect(p.title).toBe("Saved");
  });
});
