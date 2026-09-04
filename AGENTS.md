# VideoAutoplay repository instructions

These rules apply to every future change in this source repository.

1. Preserve unrelated user changes and inspect the working tree before editing.
2. Never expose credentials, tokens, cookies, authorization headers, passwords, or private URLs.
3. After every requested code change, run `dotnet clean`, `dotnet restore`, a Release build, the complete test suite, JavaScript syntax and behavior tests, and a NuGet vulnerability scan.
4. If any required verification fails, do not commit or push.
5. When all checks pass, inspect the exact diff, create one logical commit, safely pull/rebase if required, and push normally to `origin/main`.
6. Never force-push or rewrite published history.
7. Never commit or push generated `bin`, `obj`, `dist`, ZIP, DLL, PDB, backup, log, local configuration, or secret files.
8. Never publish a GitHub Release unless the user explicitly requests publication of that version.
9. Release-candidate versions must be GitHub pre-releases and must not replace a stable release.
10. Stable releases require explicit user approval and successful live Jellyfin testing.
11. Never alter or delete older tags, releases, assets, checksums, URLs, or distribution-manifest entries.
12. Distribution manifest URLs and checksums must match the uploaded public GitHub asset exactly, and every uploaded asset must be downloaded publicly and hash-verified after publication.
13. After every successful source push, report the commit hash and GitHub URL.
