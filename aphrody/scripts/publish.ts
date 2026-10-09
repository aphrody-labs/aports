// Builds aphrody/* packages for one arch inside an alpine:3.24 container and
// publishes them to the GitHub release `aphrody-3.24-<arch>`, which apk
// consumes as an NDX repository:
//   https://github.com/aphrody-labs/aports/releases/download/aphrody-3.24-${APK_ARCH}/APKINDEX.tar.gz
//
//   bun aphrody/scripts/publish.ts build [pkg...]   default: ORDER; @desktop = DESKTOP, @rust-base = RUST_BASE; .apk assets only
//   bun aphrody/scripts/publish.ts index            rebuild and sign APKINDEX over every published .apk
//
// Packages whose .apk files are already assets are skipped, so a run cut by
// the 6 h cap resumes where it stopped. Several build jobs (one per kernel
// flavor) run in parallel, so only the final `index` job writes the index.
// linux-aphrody builds the flavor named by APHRODY_KERNEL_FLAVOR (aphrody or
// aphrody-v3); it is not in ORDER and gets one job per flavor.
import { $ } from "bun";

const ORDER = [
  "rust-stable",
  "rust-nightly",
  "llvm23",
  "clang23",
  "lld23",
  "llvm-runtimes",
  "aphrody-libc",
  "sudo-rs",
  "aphrody-sysctl",
  "bun",
  "n2b",
  "aphrody",
  "aphrody-bun-build-deps",
  // Linux counterparts of MSYS2 packages with no 3.24 aport (msys2-mirror, aphrody-labs/bun)
  "directx-headers",
  "directxmath",
  "jbigkit",
  "tre",
];

// COSMIC desktop (chantier C1), its own job: `publish.ts build @desktop`. The rest of COSMIC
// (1.0.15) comes from 3.24 community.
const DESKTOP = [
  "cosmic-sound-theme",
  "cosmic-wallpapers",
  "cosmic-monitor",
  "cosmic-osk",
  "cosmic-viewer",
  "system76-scheduler",
  "bun-cosmic",
  "aphrody-desktop-cosmic",
];

// Rust userland (chantier C2), its own job: `publish.ts build @rust-base`. The container gets
// mold + sccache and aphrody/scripts/abuild-rust.conf; the rest comes from 3.24 main/community.
const RUST_BASE = ["uutils-findutils", "uutils-diffutils", "ntpd-rs", "zlib-rs", "aphrody-rust-base"];

const [mode = "build", ...args] = process.argv.slice(2);
const groups: Record<string, string[]> = { "@desktop": DESKTOP, "@rust-base": RUST_BASE };
const only = args.flatMap(a => groups[a] ?? [a]);
if (mode !== "build" && mode !== "index") throw new Error(`unknown mode ${mode}: build | index`);
const rustTuned = only.some(p => RUST_BASE.includes(p));
if (process.env.APHRODY_RUST_CPU)
  throw new Error("APHRODY_RUST_CPU is for local abuild runs: published packages must run on every CPU of the arch");
const arch = process.env.APK_ARCH ?? (process.arch === "arm64" ? "aarch64" : "x86_64");
const flavor = process.env.APHRODY_KERNEL_FLAVOR ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "aphrody-labs/aports";
const tag = `aphrody-3.24-${arch}`;
const keyName = "aphrody-labs.rsa";
const root = `${import.meta.dir}/../..`;
const work = `${root}/aphrody/.work`;
const built = `${work}/repo/aphrody/${arch}`;
const container = `aphrody-aports-${arch}${flavor ? `-${flavor}` : ""}`;
const repoLine = `https://github.com/${repo}/releases/download/${tag}/APKINDEX.tar.gz`;

const privKey = process.env.APHRODY_ABUILD_KEY;
if (!privKey) throw new Error("APHRODY_ABUILD_KEY is not set");
await Bun.write(`${work}/keys/${keyName}`, privKey.endsWith("\n") ? privKey : privKey + "\n");
await $`cp ${root}/aphrody/keys/${keyName}.pub ${work}/keys/${keyName}.pub`;

if ((await $`gh release view ${tag} -R ${repo}`.nothrow().quiet()).exitCode !== 0) {
  await $`gh release create ${tag} -R ${repo} --title ${tag} --notes ${`Aphrody Alpine 3.24 apk repository (${arch}).`} --latest=false`.nothrow();
}
const assets = async () =>
  new Set<string>(
    JSON.parse(await $`gh release view ${tag} -R ${repo} --json assets`.text()).assets.map(
      (a: { name: string }) => a.name,
    ),
  );

// Created on the host first: the container runs as root, and the host writes here too.
await $`mkdir -p ${work}/src ${built}`;
await $`docker rm -f ${container}`.nothrow().quiet();
await $`docker run -d --name ${container} -v ${root}:/work -w /work alpine:3.24 sleep infinity`;
// SCCACHE_DIR (a /work/... path) is forwarded only when the caller sets it.
const sccache = rustTuned && process.env.SCCACHE_DIR ? ["-e", `SCCACHE_DIR=${process.env.SCCACHE_DIR}`] : [];
const sh = (cmd: string) =>
  $`docker exec -e PACKAGER_PRIVKEY=/work/aphrody/.work/keys/${keyName} -e REPODEST=/work/aphrody/.work/repo -e SRCDEST=/work/aphrody/.work/src -e APHRODY_KERNEL_FLAVOR=${flavor} ${sccache} ${container} sh -euc ${cmd}`;

try {
  await sh(`apk add -q alpine-sdk
cp /work/aphrody/.work/keys/${keyName}.pub /etc/apk/keys/
mkdir -p /work/aphrody/.work/repo/aphrody/${arch} /work/aphrody/.work/src
echo /work/aphrody/.work/repo/aphrody >> /etc/apk/repositories
echo '${repoLine}' >> /etc/apk/repositories
apk update -q || true`);
  if (rustTuned)
    await sh(`apk add -q mold sccache
cat /work/aphrody/scripts/abuild-rust.conf >> /etc/abuild.conf`);

  if (mode === "build") await build(only.length ? only : ORDER);
  else await index();
} finally {
  await $`docker rm -f ${container}`.nothrow().quiet();
  await $`rm -rf ${work}/keys`.nothrow();
}

async function build(packages: string[]) {
  // aphrody-labs/aphrody is private: abuild cannot fetch its tarball anonymously.
  if (packages.includes("aphrody") && process.env.APHRODY_SOURCE_TOKEN) {
    const [ver, commit] = (await sh(`set +u; . aphrody/aphrody/APKBUILD; echo $pkgver $_commit`).text())
      .trim()
      .split(" ");
    await $`gh api repos/aphrody-labs/aphrody/tarball/${commit} > ${work}/src/aphrody-${ver}.tar.gz`.env({
      ...process.env,
      GH_TOKEN: process.env.APHRODY_SOURCE_TOKEN,
    });
  }
  for (const pkg of packages) {
    if (pkg === "linux-aphrody" && !flavor)
      throw new Error("linux-aphrody needs APHRODY_KERNEL_FLAVOR=aphrody|aphrody-v3");
    const dir = `aphrody/${pkg}`;
    const files = (await sh(`cd ${dir} && CARCH=${arch} abuild -F listpkg`).text()).trim().split("\n").filter(Boolean);
    const have = await assets();
    if (files.every(f => have.has(f))) {
      console.log(`skip ${pkg}: ${files.join(" ")} already published`);
      continue;
    }
    if (/^sha512sums=""/m.test(await Bun.file(`${root}/${dir}/APKBUILD`).text())) {
      console.warn(`warning: ${pkg} has no pinned sha512sums; computing them for this run only`);
      await sh(`cd ${dir} && abuild -F checksum`);
    }
    await sh(`cd ${dir} && abuild -F -r`);
    const upload = files.filter(f => !have.has(f)).map(f => `${built}/${f}`);
    await $`gh release upload ${tag} -R ${repo} --clobber ${upload}`;
  }
}

async function index() {
  const have = await assets();
  for (const name of [...have].filter(n => n.endsWith(".apk"))) {
    if (!(await Bun.file(`${built}/${name}`).exists())) {
      await $`gh release download ${tag} -R ${repo} -p ${name} -D ${built} --clobber`;
    }
  }
  await sh(`cd /work/aphrody/.work/repo/aphrody/${arch}
rm -f APKINDEX.tar.gz APKINDEX.unsigned.tar.gz
apk index -q --allow-untrusted --rewrite-arch ${arch} -o APKINDEX.unsigned.tar.gz *.apk
abuild-sign -k /work/aphrody/.work/keys/${keyName} -p ${keyName}.pub -q APKINDEX.unsigned.tar.gz
mv APKINDEX.unsigned.tar.gz APKINDEX.tar.gz`);
  await $`gh release upload ${tag} -R ${repo} --clobber ${built}/APKINDEX.tar.gz`;
}
