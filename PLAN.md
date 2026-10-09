# aphrody-labs/aports

Fork of [alpinelinux/aports](https://github.com/alpinelinux/aports) `3.24-stable` for Aphrody
Alpine (chantier U1, see `PLAN-ALPINE-BUN.md` section U in aphrody-labs/bun). Upstream is merged
every 6 h (`.github/workflows/aphrody-upstream-sync.yml`). Fork content lives only in `aphrody/`.

## Repository

Signed apk repository published by `.github/workflows/aphrody-packages.yml`
(`aphrody/scripts/publish.ts`) as the release assets of `aphrody-3.24-<arch>`:

```
https://github.com/aphrody-labs/aports/releases/download/aphrody-3.24-${APK_ARCH}/APKINDEX.tar.gz
```

Public key: `aphrody/keys/aphrody-labs.rsa.pub` (copy to `/etc/apk/keys/`). Private key: secret
`APHRODY_ABUILD_KEY`. `APHRODY_SYNC_TOKEN` fetches the private aphrody source and pushes syncs.

Jobs (each under the 6 h cap): `build <arch>` (userland, `ORDER` in `publish.ts`), one `kernel` job per
flavor and arch (`APHRODY_KERNEL_FLAVOR=aphrody|aphrody-v3`, `linux-aphrody` builds only that one), then
`index <arch>` signs `APKINDEX.tar.gz` over every published `.apk` (the only writer of the index).

## Packages (`aphrody/`)

| Package | Version | Notes |
| --- | --- | --- |
| `bun` | 1.4.3_p2 | Fork release zip. Subpackages `bun-shell` (`/bin/bunsh`, `/etc/shells`), `bun-apk` (shared cache, global dir, bin trigger) |
| `n2b` | 0.7.1 | Release `n2b-v0.7.1` of aphrody-labs/bun, built with `rust-stable` |
| `aphrody` | 1.0.0_git20261009 | Private repo tarball, built with `rust-stable` |
| `aphrody-libc` | 0.1.0 | U2 Rust libc overlay (`-dev`: `libaphrody_libc.a`, `-preload`: `LD_PRELOAD` profile) |
| `llvm23`, `clang23`, `lld23`, `llvm-runtimes` | 23.1.3 | Backport of aports master 6f2f659847f |
| `rust-nightly` | 2026-09-15 | Official musl dist, `/usr/lib/rust-nightly` (Bun's `rust-toolchain.toml`) |
| `rust-stable` | 1.98.1 | Official musl dist, `/usr/lib/rust-stable` (3.24 ships 1.96) |
| `aphrody-bun-build-deps` | 1 | Meta: everything needed to build Bun |
| `sudo-rs` | 0.2.15 | U3. From 3.24 community 8b25d8295f3f; `provides=sudo`, replaces sudo/doas; subpackage `aphrody-sudoers` (group `aphrody`, `/etc/sudoers.d/aphrody` NOPASSWD) |
| `aphrody-sysctl` | 1.1 | U3. `/etc/sysctl.d/90-aphrody-bun.conf`, `/etc/security/limits.d/90-aphrody-bun.conf`, `/etc/modules-load.d/aphrody.conf` |
| `linux-aphrody`, `linux-aphrody-v3` | 6.18.55 | U3. linux-lts + `config-aphrody.fragment` + `bun.config` (+ `lto.config`), LLVM=1, CONFIG_RUST=y; `-v3` = x86-64-v3 / armv8.2-a. Source switch to aphrody-labs/linux `aphrody-bun` (V). Check: `bun aphrody/kernel/check-config.ts` |

## To do

- `abuild checksum` for `aphrody`, `rust-nightly`, `rust-stable` (sha512sums empty; the publish
  script computes them per run and warns).
- Bump `bun` to the first fork release that contains `bunsh`.
