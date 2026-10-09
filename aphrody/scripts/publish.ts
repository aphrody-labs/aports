// Builds the aphrody/* packages for one arch inside an alpine:3.24 container
// and publishes them to the GitHub release `aphrody-3.24-<arch>`, which apk
// consumes as an NDX repository:
//   https://github.com/aphrody-labs/aports/releases/download/aphrody-3.24-${APK_ARCH}/APKINDEX.tar.gz
// Packages whose .apk is already an asset of the release are skipped, so a
// timed-out run resumes where it stopped.
import { $ } from "bun";

const ORDER = [
  "rust-stable",
  "rust-nightly",
  "llvm23",
  "clang23",
  "lld23",
  "llvm-runtimes",
  "aphrody-libc",
  "bun",
  "n2b",
  "aphrody",
  "aphrody-bun-build-deps",
];

const arch = process.env.APK_ARCH ?? (process.arch === "arm64" ? "aarch64" : "x86_64");
const repo = process.env.GITHUB_REPOSITORY ?? "aphrody-labs/aports";
const tag = `aphrody-3.24-${arch}`;
const keyName = "aphrody-labs.rsa";
const root = `${import.meta.dir}/../..`;
const only = process.argv.slice(2);
const container = `aphrody-aports-${arch}`;
const repoLine = `https://github.com/${repo}/releases/download/${tag}/APKINDEX.tar.gz`;

const privKey = process.env.APHRODY_ABUILD_KEY;
if (!privKey) throw new Error("APHRODY_ABUILD_KEY is not set");
await Bun.write(`${root}/aphrody/.work/keys/${keyName}`, privKey.endsWith("\n") ? privKey : privKey + "\n");
await $`cp ${root}/aphrody/keys/${keyName}.pub ${root}/aphrody/.work/keys/${keyName}.pub`;

if ((await $`gh release view ${tag} -R ${repo}`.nothrow().quiet()).exitCode !== 0) {
  await $`gh release create ${tag} -R ${repo} --title ${tag} --notes ${`Aphrody Alpine 3.24 apk repository (${arch}).`} --latest=false`;
}
const assets = async () =>
  new Set<string>(
    JSON.parse(await $`gh release view ${tag} -R ${repo} --json assets`.text()).assets.map((a: { name: string }) => a.name),
  );

await $`docker rm -f ${container}`.nothrow().quiet();
await $`docker run -d --name ${container} -v ${root}:/work -w /work alpine:3.24 sleep infinity`;
const sh = (cmd: string) => $`docker exec -e PACKAGER_PRIVKEY=/work/aphrody/.work/keys/${keyName} -e REPODEST=/work/aphrody/.work/repo -e SRCDEST=/work/aphrody/.work/src ${container} sh -euc ${cmd}`;

try {
  await sh(`apk add -q alpine-sdk
cp /work/aphrody/.work/keys/${keyName}.pub /etc/apk/keys/
mkdir -p /work/aphrody/.work/repo/aphrody/${arch} /work/aphrody/.work/src
echo /work/aphrody/.work/repo/aphrody >> /etc/apk/repositories
echo '${repoLine}' >> /etc/apk/repositories
apk update -q || true`);

  // aphrody-labs/aphrody is private: abuild cannot fetch its tarball anonymously.
  const ver = (await sh(`set +u; . aphrody/aphrody/APKBUILD; echo $pkgver $_commit`).text()).trim().split(" ");
  if (process.env.APHRODY_SOURCE_TOKEN && !(only.length && !only.includes("aphrody"))) {
    await $`gh api repos/aphrody-labs/aphrody/tarball/${ver[1]} > ${root}/aphrody/.work/src/aphrody-${ver[0]}.tar.gz`.env({
      ...process.env,
      GH_TOKEN: process.env.APHRODY_SOURCE_TOKEN,
    });
  }

  for (const pkg of ORDER) {
    if (only.length && !only.includes(pkg)) continue;
    const dir = `aphrody/${pkg}`;
    const files = (await sh(`cd ${dir} && CARCH=${arch} abuild -F listpkg`).text()).trim().split("\n").filter(Boolean);
    const have = await assets();
    if (files.every(f => have.has(f))) {
      console.log(`skip ${pkg}: ${files.join(" ")} already published`);
      continue;
    }
    const apkbuild = await Bun.file(`${root}/${dir}/APKBUILD`).text();
    if (/^sha512sums=""/m.test(apkbuild)) {
      console.warn(`warning: ${pkg} has no pinned sha512sums; computing them for this run only`);
      await sh(`cd ${dir} && abuild -F checksum`);
    }
    await sh(`cd ${dir} && abuild -F -r`);
    const built = `${root}/aphrody/.work/repo/aphrody/${arch}`;
    const upload = files.filter(f => !have.has(f)).map(f => `${built}/${f}`);
    await $`gh release upload ${tag} -R ${repo} --clobber ${upload} ${built}/APKINDEX.tar.gz`;
  }

  // The local index only lists what this run built; rebuild it over every
  // published package so the release index stays complete.
  const all = [...(await assets())].filter(n => n.endsWith(".apk"));
  const missing = all.filter(n => !Bun.file(`${root}/aphrody/.work/repo/aphrody/${arch}/${n}`).size);
  for (const n of missing) {
    await $`gh release download ${tag} -R ${repo} -p ${n} -D ${root}/aphrody/.work/repo/aphrody/${arch} --clobber`;
  }
  await sh(`cd /work/aphrody/.work/repo/aphrody/${arch} && rm -f APKINDEX.tar.gz && apk index -q --allow-untrusted --rewrite-arch ${arch} -o APKINDEX.unsigned.tar.gz *.apk && abuild-sign -k /work/aphrody/.work/keys/${keyName} -p ${keyName}.pub -q APKINDEX.unsigned.tar.gz && mv APKINDEX.unsigned.tar.gz APKINDEX.tar.gz`);
  await $`gh release upload ${tag} -R ${repo} --clobber ${root}/aphrody/.work/repo/aphrody/${arch}/APKINDEX.tar.gz`;
} finally {
  await $`docker rm -f ${container}`.nothrow().quiet();
  await $`rm -rf ${root}/aphrody/.work/keys`.nothrow();
}
