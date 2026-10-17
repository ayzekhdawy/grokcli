import { describe, expect, it } from "vitest";
import { languageFromFileName } from "./codeLang";

describe("languageFromFileName", () => {
  it("maps common extensions", () => {
    expect(languageFromFileName("app.tsx")).toBe("typescript");
    expect(languageFromFileName("index.js")).toBe("javascript");
    expect(languageFromFileName("main.rs")).toBe("rust");
    expect(languageFromFileName("data.json")).toBe("json");
    expect(languageFromFileName("style.css")).toBe("css");
    expect(languageFromFileName("script.py")).toBe("python");
  });

  it("maps special filenames", () => {
    expect(languageFromFileName("Dockerfile")).toBe("dockerfile");
    expect(languageFromFileName("Makefile")).toBe("makefile");
    expect(languageFromFileName("package.json")).toBe("json");
    expect(languageFromFileName("CMakeLists.txt")).toBe("cmake");
    expect(languageFromFileName(".env.local")).toBe("bash");
  });

  it("maps expanded common languages", () => {
    expect(languageFromFileName("App.swift")).toBe("swift");
    expect(languageFromFileName("Main.m")).toBe("objectivec");
    expect(languageFromFileName("script.ps1")).toBe("powershell");
    expect(languageFromFileName("run.bat")).toBe("dos");
    expect(languageFromFileName("query.sql")).toBe("sql");
    expect(languageFromFileName("schema.proto")).toBe("protobuf");
    expect(languageFromFileName("api.graphql")).toBe("graphql");
    expect(languageFromFileName("Main.scala")).toBe("scala");
    expect(languageFromFileName("main.dart")).toBe("dart");
    expect(languageFromFileName("lib.ex")).toBe("elixir");
    expect(languageFromFileName("mod.erl")).toBe("erlang");
    expect(languageFromFileName("Main.hs")).toBe("haskell");
    expect(languageFromFileName("core.clj")).toBe("clojure");
    expect(languageFromFileName("Main.kt")).toBe("kotlin");
    expect(languageFromFileName("app.go")).toBe("go");
    expect(languageFromFileName("page.vue")).toBe("xml");
    expect(languageFromFileName("Widget.svelte")).toBe("xml");
    expect(languageFromFileName("styles.less")).toBe("less");
    expect(languageFromFileName("styles.scss")).toBe("scss");
    expect(languageFromFileName("nginx.conf")).toBe("nginx");
    expect(languageFromFileName("shell.nix")).toBe("nix");
    expect(languageFromFileName("shader.glsl")).toBe("glsl");
    expect(languageFromFileName("main.jl")).toBe("julia");
    expect(languageFromFileName("analysis.r")).toBe("r");
    expect(languageFromFileName("script.pl")).toBe("perl");
    expect(languageFromFileName("Main.groovy")).toBe("groovy");
    expect(languageFromFileName("Program.fs")).toBe("fsharp");
    expect(languageFromFileName("main.ml")).toBe("ocaml");
    expect(languageFromFileName("note.tex")).toBe("latex");
    expect(languageFromFileName("util.lua")).toBe("lua");
    expect(languageFromFileName("config.toml")).toBe("ini");
    expect(languageFromFileName("docker-compose.yml")).toBe("yaml");
    expect(languageFromFileName("build.cmake")).toBe("cmake");
  });

  it("falls back to plaintext", () => {
    expect(languageFromFileName("notes.xyz")).toBe("plaintext");
    expect(languageFromFileName("README")).toBe("plaintext");
  });
});
