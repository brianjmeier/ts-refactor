import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const CLI = join(import.meta.dir, "../src/cli.ts");
const FIXTURES = join(import.meta.dir, "fixtures");
const WORK = join(import.meta.dir, ".workdir");

function run(args: string) {
  return $`bun ${CLI} ${args.split(" ")} --tsconfig ${WORK}/tsconfig.json`
    .cwd(WORK)
    .text();
}

function runRaw(args: string[]) {
  return $`bun ${CLI} ${args} --tsconfig ${WORK}/tsconfig.json`
    .cwd(WORK)
    .text();
}

function readWork(file: string) {
  return readFileSync(join(WORK, file), "utf-8");
}

describe("ts-refactor", () => {
  beforeEach(() => {
    // Fresh copy of fixtures for each test
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(WORK, { recursive: true });
    copyFileSync(join(FIXTURES, "tsconfig.json"), join(WORK, "tsconfig.json"));
    copyFileSync(join(FIXTURES, "sample.ts"), join(WORK, "sample.ts"));
    copyFileSync(join(FIXTURES, "consumer.ts"), join(WORK, "consumer.ts"));
  });

  afterEach(() => {
    rmSync(WORK, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Help
  // -------------------------------------------------------------------------

  test("prints help with no args", async () => {
    const out = await $`bun ${CLI}`.text();
    expect(out).toContain("ts-refactor");
    expect(out).toContain("rename");
    expect(out).toContain("references");
    expect(out).toContain("move");
    expect(out).toContain("diagnostics");
  });

  // -------------------------------------------------------------------------
  // Rename
  // -------------------------------------------------------------------------

  describe("rename", () => {
    test("dry-run shows affected files and references", async () => {
      const out = await run(
        "rename --file sample.ts --symbol UserProfile --to AccountProfile --dry-run",
      );
      expect(out).toContain('Dry run: rename "UserProfile" → "AccountProfile"');
      expect(out).toContain("sample.ts");
      expect(out).toContain("consumer.ts");
    });

    test("renames exported interface across files", async () => {
      await run(
        "rename --file sample.ts --symbol UserProfile --to AccountProfile",
      );
      const sample = readWork("sample.ts");
      const consumer = readWork("consumer.ts");

      expect(sample).toContain("export interface AccountProfile");
      expect(sample).not.toContain("UserProfile");
      expect(consumer).toContain("type AccountProfile");
      expect(consumer).not.toContain("UserProfile");
    });

    test("renames exported function across files", async () => {
      await run("rename --file sample.ts --symbol createUser --to makeUser");
      const sample = readWork("sample.ts");
      const consumer = readWork("consumer.ts");

      expect(sample).toContain("export function makeUser");
      expect(consumer).toContain("makeUser");
      expect(consumer).not.toContain("createUser");
    });

    test("renames by line position", async () => {
      // Line 16: const multiplier = 2;
      await run("rename --file sample.ts --line 16 --to factor");
      const sample = readWork("sample.ts");

      expect(sample).toContain("const factor = 2");
      expect(sample).toContain("count * factor");
    });

    test("renames by line and col position", async () => {
      // Line 15: function localHelper(count: number)
      // "count" starts at col 22
      await run("rename --file sample.ts --line 15 --col 22 --to amount");
      const sample = readWork("sample.ts");

      expect(sample).toContain("function localHelper(amount: number)");
      expect(sample).toContain("return amount * multiplier");
    });

    test("renames exported const (VariableDeclaration) by name", async () => {
      // VariableDeclaration nodes have getName() but don't satisfy Node.isNamed/isNameable —
      // this exercises the fallback branch in findByName that was previously missing.
      await run("rename --file sample.ts --symbol DEFAULT_COUNT --to DEFAULT_AMOUNT");
      const sample = readWork("sample.ts");
      expect(sample).toContain("DEFAULT_AMOUNT");
      expect(sample).not.toContain("DEFAULT_COUNT");
    });

    test("errors on missing --to flag", async () => {
      const proc = $`bun ${CLI} rename --file sample.ts --symbol UserProfile --tsconfig ${WORK}/tsconfig.json`
        .cwd(WORK)
        .nothrow();
      const result = await proc;
      expect(result.exitCode).not.toBe(0);
    });

    test("errors on nonexistent symbol", async () => {
      const proc = $`bun ${CLI} rename --file sample.ts --symbol DoesNotExist --to Foo --tsconfig ${WORK}/tsconfig.json`
        .cwd(WORK)
        .nothrow();
      const result = await proc;
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("not found");
    });
  });

  // -------------------------------------------------------------------------
  // References
  // -------------------------------------------------------------------------

  describe("references", () => {
    test("finds references by name", async () => {
      const out = await run("references --file sample.ts --symbol UserProfile");
      expect(out).toContain("References for");
      expect(out).toContain("sample.ts");
      expect(out).toContain("consumer.ts");
    });

    test("finds references by line", async () => {
      // Line 7: export function createUser
      const out = await run("refs --file sample.ts --line 7");
      expect(out).toContain("References for");
      expect(out).toContain("consumer.ts");
    });

    test("errors on nonexistent symbol", async () => {
      const proc = $`bun ${CLI} references --file sample.ts --symbol Nope --tsconfig ${WORK}/tsconfig.json`
        .cwd(WORK)
        .nothrow();
      const result = await proc;
      expect(result.exitCode).not.toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Move
  // -------------------------------------------------------------------------

  describe("move", () => {
    test("dry-run shows files with imports to update", async () => {
      const out = await run("move --file sample.ts --to lib/sample.ts --dry-run");
      expect(out).toContain("Dry run: move");
      expect(out).toContain("consumer.ts");
    });

    test("moves file and updates imports", async () => {
      mkdirSync(join(WORK, "lib"), { recursive: true });
      await run("move --file sample.ts --to lib/sample.ts");
      const consumer = readWork("consumer.ts");

      expect(consumer).toContain("./lib/sample");
      expect(consumer).not.toContain('"./sample"');
    });
  });

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  describe("diagnostics", () => {
    test("reports no diagnostics on valid files", async () => {
      const out = await run("diagnostics");
      expect(out).toContain("No diagnostics found");
    });

    test("reports errors on broken file", async () => {
      writeFileSync(
        join(WORK, "broken.ts"),
        'const x: string = 123;\nconst y: number = "hello";\n',
      );
      const out = await run("diagnostics --file broken.ts");
      expect(out).toContain("[error]");
      expect(out).toContain("diagnostic");
    });

    test("scopes to single file", async () => {
      writeFileSync(join(WORK, "broken.ts"), "const x: string = 123;\n");
      const allOut = await run("diagnostics");
      const fileOut = await run("diagnostics --file sample.ts");
      expect(allOut).toContain("[error]");
      expect(fileOut).toContain("No diagnostics found");
    });
  });

  // -------------------------------------------------------------------------
  // Multi-tsconfig (monorepo support)
  // -------------------------------------------------------------------------

  describe("multi-tsconfig", () => {
    // Set up a minimal two-package workspace in WORK:
    //   packages/core/src/types.ts   — exports CoreModel
    //   packages/app/src/index.ts    — imports CoreModel from @repo/core
    //   packages/core/tsconfig.json
    //   packages/app/tsconfig.json
    //   package.json                 — declares workspaces: ["packages/*"]
    beforeEach(() => {
      mkdirSync(join(WORK, "packages/core/src"), { recursive: true });
      mkdirSync(join(WORK, "packages/app/src"), { recursive: true });

      writeFileSync(
        join(WORK, "packages/core/src/types.ts"),
        "export interface CoreModel { id: string; }\n",
      );
      writeFileSync(
        join(WORK, "packages/app/src/index.ts"),
        'import type { CoreModel } from "@repo/core";\nexport function use(m: CoreModel) { return m.id; }\n',
      );

      const sharedTsconfig = JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true },
      });
      writeFileSync(join(WORK, "packages/core/tsconfig.json"), sharedTsconfig);
      writeFileSync(join(WORK, "packages/app/tsconfig.json"), sharedTsconfig);

      writeFileSync(
        join(WORK, "package.json"),
        JSON.stringify({
          name: "repo",
          workspaces: ["packages/*"],
          private: true,
        }),
      );
      writeFileSync(
        join(WORK, "packages/core/package.json"),
        JSON.stringify({ name: "@repo/core", main: "src/types.ts" }),
      );
      writeFileSync(
        join(WORK, "packages/app/package.json"),
        JSON.stringify({ name: "@repo/app", main: "src/index.ts" }),
      );
    });

    test("comma-separated tsconfigs: renames symbol across both packages", async () => {
      const tsconfigs = `${WORK}/packages/core/tsconfig.json,${WORK}/packages/app/tsconfig.json`;
      await $`bun ${CLI} rename --file packages/core/src/types.ts --symbol CoreModel --to DomainModel --tsconfig ${tsconfigs}`
        .cwd(WORK)
        .text();

      const core = readFileSync(join(WORK, "packages/core/src/types.ts"), "utf-8");
      expect(core).toContain("DomainModel");
      expect(core).not.toContain("CoreModel");
    });

    test("glob tsconfig pattern: discovers tsconfigs automatically", async () => {
      const globPattern = `${WORK}/packages/*/tsconfig.json`;
      await $`bun ${CLI} rename --file packages/core/src/types.ts --symbol CoreModel --to DomainModel --tsconfig ${globPattern}`
        .cwd(WORK)
        .text();

      const core = readFileSync(join(WORK, "packages/core/src/types.ts"), "utf-8");
      expect(core).toContain("DomainModel");
    });

    test("nonexistent tsconfig exits with error", async () => {
      const proc = await $`bun ${CLI} rename --file packages/core/src/types.ts --symbol CoreModel --to X --tsconfig ${WORK}/does-not-exist/tsconfig.json`
        .cwd(WORK)
        .nothrow();
      expect(proc.exitCode).not.toBe(0);
    });
  });
});
