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
});
