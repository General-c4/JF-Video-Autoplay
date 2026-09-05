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
9. After each locally verified code update, push source, require successful source CI, then publish a fresh unique RC automatically and add it to the public Jellyfin manifest. Do not wait for a live test server: the user tests through Jellyfin updates.
10. v1.0.0 remains Stable/Latest. Every later version is experimental, Pre-release and not Latest until the user explicitly says: "Promote this tested version to Stable." Never promote automatically. Do not change v1.0.0 assets, tag, or content.
11. Never alter or delete older tags, releases, assets, checksums, URLs, or distribution-manifest entries.
12. Distribution manifest URLs and checksums must match the uploaded public GitHub asset exactly, and every uploaded asset must be downloaded publicly and hash-verified after publication.
13. After every successful source push, report the commit hash and GitHub URL.
14. Use the next unused immutable vMAJOR.MINOR.PATCH-rcN tag in both repositories. Every code update after a published RC increments N. Never overwrite tags, releases, assets, manifest entries or reuse download URLs.
15. Use MAJOR.MINOR.PATCH.N for assembly/file and Jellyfin manifest versions, and MAJOR.MINOR.PATCH-rcN for informational/product and all plugin-owned script cache versions. Test numeric ordering against previous catalog versions using Jellyfin's version parser.
16. Complete clean/restore/Release build, all .NET and JavaScript tests, syntax, resource, authorization, forbidden-file, secret and direct/transitive NuGet vulnerability checks before commit/push. Require zero warnings/errors and passing source CI before RC publication.
17. Publish one root DLL in Jellyfin.Plugin.VideoAutoplay.zip under the unique RC tag, retain a uniquely named local ZIP and external checksum report, update manifest with its actual MD5, and publicly download/hash-verify the asset. Report install version, URL, hashes, Pre-release/Latest status. Failure stops publication; never claim partial publication succeeded.
