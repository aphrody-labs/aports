# Linux 7.2.9 packaging qualification

The recipe pins `aphrody-labs/linux` commit
`dc79e99b05799bcf8216edf7ae28d714ada9f90c`. Its authenticated GitHub API
archive was downloaded and SHA-512 verified on 2026-10-10. Fork and Alpine
fragments have pinned checksums. The publisher prefetches the private source
through existing GitHub authentication; credentials stay outside the recipe.

On the Ubuntu 26.04 VPS, the recipe's `_prepareconfig` retained every requested
value with Clang 21.1.8 and Rust 1.98.1. The Bun checker independently checked
the resulting configs:

| Architecture | Profile | Options | Mismatches |
| --- | --- | ---: | ---: |
| x86_64 | generic | 155 | 0 |
| x86_64 | nvidia | 165 | 0 |
| aarch64 | generic | 153 | 0 |
| aarch64 | nvidia | 164 | 0 |

Alpine's base needs built-in PHYLIB for Rust PHY abstractions. Its ARM64 DRM
drivers select the hidden KMS helper as a module. The two Alpine fragments
express these dependencies while preserving the fork fragments byte for byte.

The fork's x86 kernel and Rust accelerator built and booted in diskless QEMU;
all seven accelerator selftests passed. NVIDIA open modules 615.78.08 built
against that kernel and reported matching 7.2.9 vermagic. These are source and
config checks, not qualification of Alpine-built APKs or GPU hardware on Linux.
Full Alpine builds, packaged headers, signing, NVIDIA userspace/GSP matching,
hardware CUDA and host activation remain required. The publisher accepts only
the generic profile to prevent different kernels sharing one release filename;
the NVIDIA profile is available for separately qualified local abuild runs.

WSL uses a separate dxgkrnl port and the Windows driver. This native PCI profile
must not be applied to WSL. Follow [NVIDIA's pinned build contract](https://github.com/NVIDIA/open-gpu-kernel-modules/blob/615.78.08/README.md)
and [the Linux kernel Rust guide](https://docs.kernel.org/rust/quick-start.html).
