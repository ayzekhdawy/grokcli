#!/usr/bin/env node
/**
 * Dependency hygiene gates for the monorepo root (pnpm-only app).
 *
 * Enforces:
 *  - root package manager is pnpm (when invoked as preinstall / install hook)
 *  - root package-lock.json must not exist (stale npm lock regresses CVE pins)
 *  - pnpm-lock.yaml must exist
 *
 * remote-bridge/ may keep its own package-lock.json (independent npm package).
 *
 * Usage:
 *   node scripts/check-deps-hygiene.mjs           # lockfile checks only
 *   node scripts/check-deps-hygiene.mjs --preinstall  # also reject npm/yarn installs
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const preinstall = process.argv.includes("--preinstall");
let failed = false;

function fail(msg) {
  console.error(`deps-hygiene: ${msg}`);
  failed = true;
}

if (preinstall) {
  const ua = process.env.npm_config_user_agent || "";
  // Allow pnpm; reject npm / yarn / bun install of the root tree.
  if (!/\bpnpm\//.test(ua)) {
    fail(
      "Root package manager is pnpm only. Use `pnpm install` (do not use npm/yarn at repo root).",
    );
    fail(`Detected user-agent: ${ua || "(empty)"}`);
  }
}

const rootNpmLock = join(root, "package-lock.json");
const pnpmLock = join(root, "pnpm-lock.yaml");

if (existsSync(rootNpmLock)) {
  fail(
    "Root package-lock.json must not exist. Delete it and rely on pnpm-lock.yaml. (remote-bridge/ may keep its own lockfile.)",
  );
}

if (!existsSync(pnpmLock)) {
  fail("pnpm-lock.yaml is required at the repository root.");
}

if (failed) {
  process.exit(1);
}

if (!preinstall) {
  console.log("deps-hygiene: ok (pnpm-only root, no stale package-lock.json)");
}
