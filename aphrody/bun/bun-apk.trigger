#!/usr/bin/bun
// apk trigger of bun-apk, run by bun (apk execve()s it; argv: the changed /usr/lib/bun/node_modules/* dirs).
// Links the `bin` entries of every npm package shipped as an apk into /usr/lib/bun/bin and drops links
// whose package is gone, so an apk carrying an npm package is usable like a `bun add -g` one.
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const modules = "/usr/lib/bun/node_modules";
const bin = "/usr/lib/bun/bin";
mkdirSync(bin, { recursive: true });

const wanted = new Map();
const packages = [];
for (const entry of existsSync(modules) ? readdirSync(modules) : []) {
  if (entry.startsWith("@")) {
    for (const sub of readdirSync(join(modules, entry))) packages.push(join(modules, entry, sub));
  } else if (!entry.startsWith(".")) {
    packages.push(join(modules, entry));
  }
}
for (const dir of packages) {
  const file = Bun.file(join(dir, "package.json"));
  if (!(await file.exists())) continue;
  const pkg = await file.json().catch(() => null);
  if (!pkg?.bin) continue;
  const bins = typeof pkg.bin === "string" ? { [String(pkg.name).split("/").pop()]: pkg.bin } : pkg.bin;
  for (const [name, target] of Object.entries(bins)) {
    if (!/^[\w.@+-]+$/.test(name)) continue;
    wanted.set(name, relative(bin, resolve(dir, String(target))));
  }
}

for (const name of readdirSync(bin)) {
  const path = join(bin, name);
  if (!lstatSync(path).isSymbolicLink()) continue;
  if (wanted.get(name) !== readlinkSync(path)) unlinkSync(path);
}
for (const [name, target] of wanted) {
  if (!existsSync(join(bin, name))) symlinkSync(target, join(bin, name));
}
