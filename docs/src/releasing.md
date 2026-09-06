# Publishing a Release

This page is the checklist for cutting a new version of the DCS Web Dashboard and publishing it
on GitHub. It assumes no prior experience with GitHub releases: every command is written out, and
every button is named.

You do all of this from a normal PowerShell window on your development machine, in the folder
where you cloned the repository. Nothing here touches your DCS server.

## 0. Vocabulary

| Term | Meaning |
| --- | --- |
| Branch | A named line of development. Work happens on a feature branch such as `left_panel`; the finished, official code lives on `main`. |
| Pull request (PR) | A request to merge one branch into another, with a page on GitHub showing every change. Even when you are the only developer, it gives you a reviewable summary and a record of what went into each version. |
| Merge | Actually applying the PR's changes to `main`. |
| Tag | A permanent, human-readable label on one exact commit, such as `v0.1.0`. Unlike a branch, a tag never moves. |
| Release | A GitHub page attached to a tag, holding release notes and downloadable files. |
| Asset | A file attached to a release. Ours is the release ZIP. |
| Semantic version | The `MAJOR.MINOR.PATCH` numbering scheme, e.g. `0.1.0`. |

## 1. Choose the version number

The version lives in one place, `rust-web-dashboard/Cargo.toml`, and everything else derives from
it: the ZIP file name, the folder inside it, and the version the dashboard reports in its API.

We use [semantic versioning](https://semver.org/):

| Change | Bump | Example |
| --- | --- | --- |
| Bug fixes only, nothing new | PATCH | `0.1.0` → `0.1.1` |
| New features, nothing broken for existing users | MINOR | `0.1.0` → `0.2.0` |
| Something existing users must react to (a renamed variable, a removed page) | MAJOR | `0.9.0` → `1.0.0` |

While the project is below `1.0.0`, a MINOR bump is the normal choice for a release with new
features, and breaking changes are still allowed in a MINOR bump.

For the very first release, keep the version already in the file (`0.1.0`). For later releases,
edit it:

```powershell
notepad rust-web-dashboard\Cargo.toml
```

Change the `version = "0.1.0"` line near the top, save, then refresh the lockfile so it records
the new version too:

```powershell
cd rust-web-dashboard
cargo check --locked
cd ..
```

If `cargo check --locked` complains that the lockfile needs updating, run `cargo check` once
without `--locked`, then commit the changed `Cargo.lock` along with `Cargo.toml`.

## 2. Pre-flight checks

Run these from the repository root. All three must pass before you go further.

```powershell
# 1. The backend compiles exactly as the release will build it
cd rust-web-dashboard
cargo +1.98.0 check --locked

# 2. The test suite passes
cargo +1.98.0 test --locked

# 3. The API documentation matches the code
$env:EXPORT_OPENAPI = "1"
cargo +1.98.0 run --locked --quiet > ..\docs\src\openapi.json
Remove-Item Env:\EXPORT_OPENAPI
cd ..
git status --short docs/src/openapi.json
```

If that last `git status` prints a line, the API changed: commit the regenerated
`docs/src/openapi.json` with your other changes so the published Swagger UI stays accurate. If it
prints nothing, the spec was already current.

Rust `1.98.0` is the toolchain the release script pins. Install it once with
`rustup toolchain install 1.98.0`.

## 3. Open the pull request

Make sure everything is committed and pushed on your feature branch:

```powershell
git status
git add -A
git commit -m "Describe what this change does"
git push -u origin left_panel
```

Replace `left_panel` with whatever branch you are on. Then create the PR. With the
[GitHub CLI](https://cli.github.com/):

```powershell
gh pr create --base main --head left_panel --title "Release 0.1.0" --body "First public release."
```

Or in a browser: open the repository, click the **Pull requests** tab, then **New pull request**,
set **base** to `main` and **compare** to your branch, and click **Create pull request**.

Look through the **Files changed** tab once. You are checking for things that should not ship:
secrets, absolute paths from your own machine, or leftover debug code.

## 4. Merge the pull request

Once you are happy with it:

```powershell
gh pr merge --merge
```

Or click the green **Merge pull request** button on the PR page, then **Confirm merge**.

Bring your local `main` up to date afterwards:

```powershell
git checkout main
git pull
```

Every command from here on runs on `main`.

## 5. Build the release ZIP

One script does the whole build: frontend, backend, packaging and verification.

```powershell
.\build_release.ps1
```

It takes several minutes. It will:

1. install the exact frontend dependencies from `package-lock.json`;
2. build the static Next.js frontend;
3. copy that build into `rust-web-dashboard/static/` so it gets embedded in the binary;
4. compile the Rust executable in release mode with Rust 1.98.0;
5. assemble `Releases\DCS-Web-Dashboard-<version>\` with the executable, the `icon` and `images`
   asset folders, an empty `logs` folder and the `services` scripts;
6. zip it to `Releases\DCS-Web-Dashboard-<version>.zip` and verify every expected file is inside.

The script stops with an error rather than producing a half-built ZIP, so if it finishes, the
archive is complete. It prints the folder and ZIP paths at the end.

### Test the ZIP before publishing it

Do not skip this. Extract the ZIP somewhere fresh, on the server or on your own machine, set at
minimum `JWT_SECRET` and `ADMIN_PASSWORD`, run `rust-web-dashboard.exe` from a PowerShell window,
and open `http://localhost:3001`. Log in, click through the pages, and confirm the version shown
by the API matches what you are about to publish:

```powershell
$env:JWT_SECRET = "a-temporary-test-secret-value"
$env:ADMIN_PASSWORD = "test"
.\rust-web-dashboard.exe
```

Press `Ctrl+C` to stop it when you are done.

## 6. Tag the release

A tag marks the exact commit this version was built from, so you can always come back to it.

```powershell
git tag -a v0.1.0 -m "Release 0.1.0"
git push origin v0.1.0
```

The tag name is the version with a leading `v`, matching the convention used by the DCS-gRPC
fork. It must point at the commit you actually built, so tag **after** merging and pulling, and
do not commit anything else in between.

If you tagged the wrong commit and have not published the release yet:

```powershell
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0
```

Then tag again. Never move a tag that people may already have downloaded; cut a new version
instead.

## 7. Write the release notes

Release notes are what your users read first. Write them for someone who runs a DCS server, not
for someone who reads Rust. A workable shape:

```markdown
## What's new

- **Left panel customisation** — reorder, hide and unhide the pages in the sidebar by right-click
  or drag.
- **Mission and Tacview downloads** — pull `.miz` and `.acmi` files straight from the browser.
- **DCS and SRS process control** — Start, Stop and Restart buttons that open a real, visible DCS
  window, plus an optional crash-recovery watchdog.
- **Multi-carrier Airboss planner** — every carrier in the mission gets its own panel.
- **DCS-gRPC API key authentication** — the dashboard can authenticate to a gRPC server that has
  `auth.enabled = true`.

## Installing

New install: download the ZIP below and follow the
[setup guide](https://sevenfifty777.github.io/DCS-Web-Dashboard/setup.html).

Upgrading: stop the service, replace `rust-web-dashboard.exe`, restart it. Your NSSM environment
variables are unaffected.

## Requirements

- Windows Server or Windows 10 or newer
- DCS-gRPC v0.9.2 or later ([custom fork](https://github.com/sevenfifty777/rust-server))

## Breaking changes

None.
```

For later releases, list anything that forces users to act (a renamed environment variable, a
changed default) under **Breaking changes**, at the top. If nothing does, say "None" explicitly:
that sentence saves people a careful read.

## 8. Publish the release

With the GitHub CLI, from the repository root:

```powershell
gh release create v0.1.0 `
    "Releases\DCS-Web-Dashboard-0.1.0.zip" `
    --title "v0.1.0 - First release" `
    --notes-file release-notes.md
```

Write your notes into `release-notes.md` first (and do not commit that file; it is scratch). To
type the notes in the browser instead, drop `--notes-file` and add `--draft`, then finish the page
on GitHub.

Without the CLI: open the repository, click **Releases** in the right sidebar, then
**Draft a new release**. Choose the existing tag `v0.1.0`, give it a title, paste the notes, drag
the ZIP into the **Attach binaries** box, and click **Publish release**.

Mark it as a **pre-release** if you want testers to try it before you recommend it generally. The
checkbox is on the same page, or `--prerelease` on the CLI.

## 9. After publishing

1. **Check the download.** Open the release page in a private browser window, download the ZIP,
   and confirm it extracts with the executable inside. This catches a failed upload.
2. **Check the documentation site.** Merging to `main` triggers the *Deploy mdBook to GitHub
   Pages* workflow, which republishes
   <https://sevenfifty777.github.io/DCS-Web-Dashboard/>. Watch it with `gh run watch`, or the
   **Actions** tab. If it fails, the site keeps serving the previous version, so fix it and push
   again.
3. **Announce it** wherever your users are, linking the release page.

## Quick reference

The whole sequence, once you know it:

```powershell
# On the feature branch
cd rust-web-dashboard; cargo +1.98.0 test --locked; cd ..
git push -u origin left_panel
gh pr create --base main --head left_panel --title "Release 0.1.0" --body "..."
gh pr merge --merge

# On main
git checkout main; git pull
.\build_release.ps1
git tag -a v0.1.0 -m "Release 0.1.0"
git push origin v0.1.0
gh release create v0.1.0 "Releases\DCS-Web-Dashboard-0.1.0.zip" --title "v0.1.0" --notes-file release-notes.md
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `build_release.ps1` fails on `npm ci` | `package-lock.json` and `package.json` disagree. | Run `npm install` in `web-dashboard`, commit the updated lockfile, and rerun. |
| Build fails fetching `protoc-bundled` | No network, or Git cannot reach GitHub. | The build needs internet access on the first build; check your connection and any proxy. |
| `cargo` cannot find toolchain `1.98.0` | The pinned toolchain is not installed. | `rustup toolchain install 1.98.0`. |
| The script says a packaged tree "does not match its expected contents" | A stale file is sitting in the release folder. | Delete `Releases\DCS-Web-Dashboard-<version>\` and rerun. |
| `gh` says "release not found" or "tag not found" | The tag was never pushed. | `git push origin v0.1.0`. |
| The release ZIP has the wrong version in its name | `Cargo.toml` was not bumped, or not saved. | Fix the version, rerun `build_release.ps1`. |
| The docs site still shows the old content | The Pages workflow failed or is still running. | Check the **Actions** tab; rerun the failed job. |
