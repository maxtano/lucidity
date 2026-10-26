# Pinned official Bluejay release

J_H_40_24_v0.21.0.hex is the unmodified official release asset:
https://github.com/bird-sanctuary/bluejay/releases/download/v0.21.0/J_H_40_24_v0.21.0.hex

SHA-256: fb8a2cae07f283882a65bc90ac228456a74c5c3eaaef59e85f0df5957f98c1ae

Corresponding source and build instructions (GPL-3.0-or-later):
https://github.com/bird-sanctuary/bluejay/tree/v0.21.0
https://github.com/bird-sanctuary/bluejay/archive/refs/tags/v0.21.0.tar.gz

Copyright 2011–2017 Steffen Skaug, 2020–2022 Mathias Rasmussen,
2022–2023 Daniel Mosquera and the Bluejay contributors.

Lucidity verifies the exact asset hash, record checksums, target, MCU, layout,
version and PWM frequency before preparing an installation. It preserves the
on-device bootloader; bytes at 0x1c00 and above are never written. The shipped
image is for J-H-40 / EFM8BB2 only. No automatic target fallback is allowed.
