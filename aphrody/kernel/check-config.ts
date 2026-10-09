#!/usr/bin/env bun
// Checks the running kernel against the linux-aphrody config fragments.
//
//   bun aphrody/kernel/check-config.ts [--config <file>] [--arch x86_64|aarch64] [--sysctl] [--json]
//
// Reads /proc/config.gz (CONFIG_IKCONFIG_PROC, set in bun.config), else /boot/config-<release>.
// Expected values: config-aphrody.fragment then bun.config (then lto.config when the kernel has
// CONFIG_LTO_CLANG_THIN=y), "# @arch" markers honoured, the last fragment setting a symbol wins.
// "# CONFIG_X is not set" is satisfied by an absent symbol. --sysctl also compares
// /etc/sysctl.d/90-aphrody-bun.conf (aphrody-sysctl) with /proc/sys.
// Exit 0 when everything matches, 1 on a mismatch, 2 when no config can be read.

import { gunzipSync } from "bun";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const here = import.meta.dir;
const fragmentsDir = join(here, "..", "linux-aphrody");
const carch = option("--arch") ?? ({ x64: "x86_64", arm64: "aarch64" } as Record<string, string>)[process.arch];
if (!carch) {
  console.error(`check-config: unsupported architecture ${process.arch}`);
  process.exit(2);
}

async function readKernelConfig(): Promise<{ source: string; text: string } | undefined> {
  const explicit = option("--config");
  if (explicit) {
    const bytes = await Bun.file(explicit).bytes();
    const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
    return { source: explicit, text: new TextDecoder().decode(gz ? gunzipSync(bytes) : bytes) };
  }
  const proc = Bun.file("/proc/config.gz");
  if (await proc.exists()) {
    return { source: "/proc/config.gz", text: new TextDecoder().decode(gunzipSync(await proc.bytes())) };
  }
  const release = (
    await Bun.file("/proc/sys/kernel/osrelease")
      .text()
      .catch(() => "")
  ).trim();
  const boot = Bun.file(`/boot/config-${release}`);
  if (release && (await boot.exists())) return { source: `/boot/config-${release}`, text: await boot.text() };
  return undefined;
}

/** Symbol -> value ("y", "m", "\"str\"", ...), from a .config. */
function parseConfig(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^CONFIG_([A-Za-z0-9_]+)=(.*)$/.exec(line);
    if (m) values.set(m[1], m[2]);
  }
  return values;
}

/** Symbol -> expected value ("n" for "is not set"), in fragment order, last setting wins. */
function parseFragment(text: string, file: string, expected: Map<string, { value: string; file: string }>) {
  let arches: string[] | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("# @arch ")) {
      arches = line.slice("# @arch ".length).split(/\s+/);
      continue;
    }
    const set = /^CONFIG_([A-Za-z0-9_]+)=(.*)$/.exec(line);
    const unset = /^# CONFIG_([A-Za-z0-9_]+) is not set$/.exec(line);
    if (!set && !unset) continue;
    const applies = !arches || arches.includes(carch!);
    arches = undefined;
    if (!applies) continue;
    if (set) expected.set(set[1], { value: set[2], file });
    else expected.set(unset![1], { value: "n", file });
  }
}

const kernel = await readKernelConfig();
if (!kernel) {
  console.error(
    "check-config: no /proc/config.gz (CONFIG_IKCONFIG_PROC) nor /boot/config-<release>; pass --config <file>",
  );
  process.exit(2);
}
const actual = parseConfig(kernel.text);
const files = ["config-aphrody.fragment", "bun.config"];
if (actual.get("LTO_CLANG_THIN") === "y") files.push("lto.config");

const expected = new Map<string, { value: string; file: string }>();
for (const file of files) parseFragment(await Bun.file(join(fragmentsDir, file)).text(), file, expected);

type Mismatch = { kind: "config" | "sysctl"; key: string; expected: string; actual: string; file: string };
const mismatches: Mismatch[] = [];
for (const [sym, { value, file }] of expected) {
  const got = actual.get(sym) ?? "n";
  if (got !== value) mismatches.push({ kind: "config", key: `CONFIG_${sym}`, expected: value, actual: got, file });
}

let sysctlChecked = 0;
if (flag("--sysctl")) {
  const conf = Bun.file("/etc/sysctl.d/90-aphrody-bun.conf");
  const text = (await conf.exists())
    ? await conf.text()
    : await Bun.file(join(here, "..", "aphrody-sysctl", "90-aphrody-bun.conf")).text();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^-/, "");
    const want = line
      .slice(eq + 1)
      .trim()
      .split(/\s+/)
      .join(" ");
    const path = `/proc/sys/${key.replaceAll(".", "/")}`;
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    sysctlChecked++;
    const got = (await file.text()).trim().split(/\s+/).join(" ");
    if (got !== want)
      mismatches.push({ kind: "sysctl", key, expected: want, actual: got, file: "90-aphrody-bun.conf" });
  }
}

if (flag("--json")) {
  console.log(
    JSON.stringify(
      { source: kernel.source, arch: carch, fragments: files, checked: expected.size, sysctlChecked, mismatches },
      null,
      2,
    ),
  );
} else {
  console.log(
    `${kernel.source} (${carch}): ${expected.size} options from ${files.join(", ")}` +
      (flag("--sysctl") ? `, ${sysctlChecked} sysctls` : ""),
  );
  for (const m of mismatches) console.log(`  ${m.kind} ${m.key}: expected ${m.expected}, got ${m.actual} (${m.file})`);
  console.log(mismatches.length ? `${mismatches.length} mismatch(es)` : "all match");
}
process.exit(mismatches.length ? 1 : 0);
