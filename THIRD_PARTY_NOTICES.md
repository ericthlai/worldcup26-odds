# Third-party notices

This repository vendors two browser bundles. The notes below record only the provenance that can be reproduced from the checked-in bytes.

## Preact

- File: `preact.min.umd.js`
- SHA-256: `195e86e41d0880383a98df4cef5c82c1320de98694ee800cb0f39b537f9cd8c8`
- Verification: byte-for-byte match for `package/dist/preact.min.umd.js` in the official `preact@10.26.4` npm package
- Upstream: https://github.com/preactjs/preact
- License: [MIT — full upstream text](LICENSES/preact-MIT.txt)

## HTM

- File: `htm.umd.js`
- SHA-256: `7a31776e04bd4afde0d4308177d26f377716fcf7e4bd70be590746d6aa594f08`
- Verification: byte-for-byte match for `package/dist/htm.umd.js` in the official npm packages from `htm@3.0.1` through `htm@3.1.1`
- Upstream: https://github.com/developit/htm
- License: [Apache-2.0 — full upstream text](LICENSES/htm-Apache-2.0.txt)

The same HTM artifact was published in multiple releases, so the exact vendored HTM version cannot be recovered from this file alone. This repository therefore does not claim a more precise version.

The exact upstream license texts distributed with the verified npm packages are retained in [`LICENSES/`](LICENSES/). These projects retain their own copyright and license terms. The names and links above are for attribution and provenance; they do not imply endorsement.
