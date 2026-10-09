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
flavor and arch (`APHRODY_KERNEL_FLAVOR=aphrody|aphrody-v3`, `linux-aphrody` builds only that one), `desktop <arch>`
(`publish.ts build @desktop`, the C1 packages below), `rust-base <arch>` (`publish.ts build @rust-base`, the C2
packages below; mold, sccache cached in `aphrody/.work/sccache`, `aphrody/scripts/abuild-rust.conf`), then
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
| `cosmic-monitor`, `cosmic-osk`, `cosmic-sound-theme`, `cosmic-viewer`, `cosmic-wallpapers` | 1.10.0 | C1. Backport of aports master `cbc8344575b9` (absent from 3.24, whose community has the rest of COSMIC at 1.0.15); upstream sha512 re-checked on the downloaded tarballs |
| `system76-scheduler` | 2.0.2 | C1. Not in Alpine. OpenRC service, execsnoop from `bcc-tools` (`EXECSNOOP_PATH`) |
| `aphrody-desktop-cosmic` | 1.0.15 | C1. Meta: the only list of desktop packages (session, apps, portals, PipeWire autostart, Mesa, fonts, Xwayland); `-host`: seatd, cosmic-greeter, system76-scheduler, services enabled. Used by aphrody-labs/aphrody `tools/config/container/aphrody-os` target `desktop` |
| `uutils-findutils` | 0.10.0 | C2. New (not in Alpine). `find`, `xargs`; `replaces=findutils` + `replaces_priority=100` (wins over GNU and the busybox applets), no `provides=findutils` (no locate/updatedb) |
| `uutils-diffutils` | 0.5.0 | C2. New. `diff`, `cmp` (multi-call, argv[0]); `replaces=diffutils`, priority 100; GNU `diff3`/`sdiff` can stay installed |
| `ntpd-rs` | 1.9.0 | C2. From edge testing 104f7fb8a887 (3.24 has no testing repository): NTS, OpenRC `ntpd-rs`, `ntpd-rs-metrics-exporter` |
| `zlib-rs` | 0.6.8 | C2. New. Opt-in `/usr/lib/zlib-rs/libz.so.1` (`LD_LIBRARY_PATH=/usr/lib/zlib-rs`), `somask`: never provides `so:libz.so.1`; opt-level 3 |
| `aphrody-rust-base` | 1.0.0 | C2. Meta: the only list of the Rust userland (uutils coreutils/findutils/diffutils, sudo-rs + su, ntpd-rs, sq/sqv, Nushell, fish, Ion, eza, ripgrep, fd, bottom, helix, yazi, zellij, starship); `aphrody-rust-tools`: cargo-auditable/deny/nextest, sccache, mold, wild, uv. Used by aphrody-os target `cli` and the `USERLAND=rust` variant of ghcr.io/aphrody-labs/alpine |

## To do

- `abuild checksum` for `aphrody`, `rust-nightly`, `rust-stable` (sha512sums empty; the publish
  script computes them per run and warns).
- Bump `bun` to the first fork release that contains `bunsh`.
