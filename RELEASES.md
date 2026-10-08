# Releasing Bifrost Terminal

Bifrost Terminal is released by hand from a local Windows machine. There is no CI release pipeline, no update feed and no in-app updater: a new version is a new installer that the user runs over the existing install.

## Steps

1. Bump the version (see [Version bump rule](#version-bump-rule)) and commit `package.json` and `package-lock.json` together.
2. Build the installer from the repo root:

   ```powershell
   .\scripts\package-local.ps1            # build only
   .\scripts\package-local.ps1 -Install   # build, close Bifrost Terminal, install silently over the existing install
   ```

   The installer is written to `make\Bifrost*-win32-x64-<version>.exe`.

3. Install it and check that the app starts, opens a terminal and that `wsh` works.
4. Optionally publish the installer as a GitHub release on `heinsutton/bifrost-terminal` with `gh release create v<version> <installer> --notes "<changelog>"`.

## Version bump rule

Semver `MAJOR.MINOR.PATCH`; the version lives in `package.json` and the root entries of `package-lock.json`.

- Every release bumps PATCH (0.15.3 to 0.15.4).
- A release with a major new feature bumps MINOR and resets PATCH (0.15.x to 0.16.0).
- MAJOR changes only when the maintainer says so.
- Bump with `npm version <patch|minor|major> --no-git-tag-version`, which updates both files, then commit them before building. The version is stamped into `wavesrv` through ldflags, so the backend must be rebuilt after a bump (the Taskfile backend tasks do this automatically).

The full rule is in [`.kilocode/rules/rules.md`](.kilocode/rules/rules.md) under "Versioning".

## What `package-local.ps1` does

- Picks a supported Node (24, 22 or 20) for the process; Node 26 breaks `npm install`.
- Deletes `make\`, then runs `task build:backend build:tsunamiscaffold --force` (`wavesrv`, `wsh`, tsunami scaffold).
- Runs `npm run build:prod` (Vite) and `electron-builder` with [`electron-builder.config.cjs`](./electron-builder.config.cjs), NSIS target only.
- Checks that `wavesrv.x64.exe` is inside the packaged app.

Use it instead of `task package`: that task runs `clean` in parallel with the backend build and can produce an installer without `wavesrv`.

## Not done

- No code signing or notarization; the installer is unsigned.
- No automatic updates, package-manager publishing (Homebrew, WinGet, Chocolatey, Snap) or S3 artifact buckets. The upstream Wave Terminal release process that used these has been removed from this fork.
