# Local execution and publication boundaries

Lucidity is an experimental, single-user local application. The workbench can execute operator-approved shell commands and interact with physical devices. It is not an authenticated multi-user service. Keep it bound to loopback; do not publish a running development server, proxy it to the Internet, or remove its host/origin guards.

## Files to keep private

The repository ignores environment files, private keys, local assistant configuration, dependencies, build output, workbench files, generated artifacts, device receipts, flight logs, screenshots, local lab state and private research. The imported SMA mount and derivatives are also excluded pending documented redistribution terms. Public synthetic fixtures are separate from physical captures.

Ignore rules do not remove files already committed, and `git add -f` bypasses them. Before each push, inspect `git diff --cached --stat` and `git diff --cached`, scan the staged content and any existing history for secrets, and verify that no private files were force-added. Share Git-tracked files rather than the whole working directory. If a credential is ever published, revoke it at its provider before addressing history.

The Vite build exports only an explicit list of public documents (`PRODUCT.md` and `TECHNICAL.md`). Adding a document to that list requires reviewing its content and links; `.gitignore` is not a build-output filter.

## Dependency and secret checks

Run `npm audit` separately in `drone-studio` and `direction-lab`. Run Gitleaks on the intended publication tree and, once Git history exists, on that history. Scanner findings must be reviewed: browser storage keys and UI property names are not authentication credentials. A clean scan is not a guarantee that all sensitive information or application vulnerabilities have been found.

The automated suites use mock devices. Physical flight, firmware changes and simulator harnesses require their own explicit setup and validation; a passing software suite does not establish aircraft readiness.

## Third-party materials

Bundled Bluejay firmware retains its [upstream license and source references](drone-studio/firmware/bluejay/README.md). Bundled fonts retain their OFL notices in `drone-studio/public/fonts/`. The downloaded SMA mount and its derivatives are excluded until their source and redistribution terms are documented. Original Lucidity code and documentation are licensed under [Apache 2.0](LICENSE). Third-party licenses continue to apply to their respective materials; see [NOTICE](NOTICE).

## Public demo

`npm run build:demo` in `drone-studio` builds a separate static entry into `dist-demo/`. Its Vite configuration includes no aircraft, terminal or document-export plugins. Host only this static output for a public demo. The full local Studio server is a different deployment model.
