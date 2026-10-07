# Local rpiv-advisor fork — how this works and how to update it

This checkout is a **personal fork of the upstream `rpiv-mono` monorepo**,
published at `https://github.com/ikbuibui/rpiv-mono` on `local/advisor`, used so
that two local changes to `packages/rpiv-advisor` survive upstream releases:

1. **Scoped `/advisor` picker** — `packages/rpiv-advisor/advisor/scope.ts`
   (commit `d083807`).
2. **Persistent advisor footer indicator** —
   `packages/rpiv-advisor/advisor/status.ts` (commit `d9b619f`).

A third commit, `docs: describe the local rpiv-advisor fork and its rebase
workflow`, adds this document. It is the only commit that is not part of a
feature; the two feature commits are self-contained.

Pi loads it because pi-setup's `config/settings.json` lists
`${REPO_ROOT}/rpiv-mono/packages/rpiv-advisor` instead of
`npm:@juicesharp/rpiv-advisor`. Bootstrap renders `${REPO_ROOT}` to the absolute
pi-setup checkout path in the agent's `settings.json`. The checkout can live
anywhere; the extension is loaded exactly once.

## Layout

| Path | Meaning |
| --- | --- |
| `origin` | `https://github.com/ikbuibui/rpiv-mono.git` — your published fork; push advisor updates here (SSH authentication may be used for pushes). |
| `upstream` | `https://github.com/juicesharp/rpiv-mono.git` — upstream; use for fetching, not pushing. Add it on fresh checkouts. |
| `upstream/main` | the latest fetched upstream `main`; the rebase target |
| `local/advisor` | the branch carrying the advisor patches and fork documentation |

A recursive pi-setup clone checks out a detached HEAD at the pinned commit.
Switch to `local/advisor` before editing or rebasing. A local `main` branch is
not the rebase target; fetching updates remote-tracking branches, not local ones.

Your commits sit directly on top of the upstream commit they were based on, and
nothing else in the tree is modified — so an upstream update is a plain
`rebase`.

## Updating to a newer upstream release

From your pi-setup checkout, enter `rpiv-mono` (no fixed absolute path is
required). Save all local work before starting:

```bash
cd rpiv-mono

# 1. Add upstream once on a fresh checkout; skip if it already exists.
git remote add upstream https://github.com/juicesharp/rpiv-mono.git

# 2. Switch to the advisor branch; Git tracks origin/local/advisor on a fresh clone.
git switch local/advisor
git status --porcelain          # expect empty (package-lock.json may appear — see below)

# 3. Fetch upstream and rebase the local commits onto its newest main.
git fetch upstream
git rebase upstream/main

# 4. Refresh dependency links (workspaces + the @juicesharp/rpiv-config and
#    @juicesharp/rpiv-test-utils links the package resolves at load/test time).
npm install --ignore-scripts --no-audit --no-fund

# 5. Prove both the tests and the types still hold against the new upstream.
npx vitest run packages/rpiv-advisor
npx tsc --noEmit -p tsconfig.base.json

# 6. Publish the rebased branch (history changed, so use a lease).
git push --force-with-lease origin local/advisor

# 7. Pick up the new code in a running Pi session.
#    In Pi:  /reload
```

After publishing, return to pi-setup and set the `rpiv-mono` `commit` in
`forks/manifest.json` to `git -C rpiv-mono rev-parse HEAD`. Commit the manifest
and `rpiv-mono` submodule pointer together. For ordinary edits (including this
document), commit inside `rpiv-mono` first and use a normal push before updating
the parent pin. Uncommitted submodule files are not captured by a pi-setup commit.
Verify a fresh restore before relying on the new pin.

### Why `npm install` matters

The package imports `@juicesharp/rpiv-config` at runtime and
`@juicesharp/rpiv-test-utils` in tests. Pi does **not** install dependencies for
a **local** package (`pi` docs, "Pi Packages": *"Local packages are not
installed or modified"*), so those resolve through this checkout's
`node_modules` workspace links. If `node_modules/@juicesharp/rpiv-config` is
missing, the extension fails to load. Step 4 recreates it.

### If the rebase conflicts

Conflicts can only appear in the files the two commits touch:

- `packages/rpiv-advisor/advisor/command.ts`
- `packages/rpiv-advisor/advisor/handlers.ts`
- `packages/rpiv-advisor/advisor/restore.ts`
- `packages/rpiv-advisor/advisor/messages.ts`
- `packages/rpiv-advisor/advisor/index.ts`
- `packages/rpiv-advisor/CHANGELOG.md`, `README.md`, `docs/configuration.md`
- `packages/test-utils/pi.ts`

Resolve, then `git rebase --continue`. If a change landed upstream that already
does what one of these commits does, `git rebase --skip` that commit and delete
the corresponding section from this file.

### `package-lock.json` noise

`npm install` here rewrites `package-lock.json` (the upstream lock was produced
on a different node/npm). It is **not** part of either feature commit. Discard
it before committing or rebasing:

```bash
git checkout -- package-lock.json
```

## Verifying the fork is live in Pi

```bash
pi list        # the advisor entry should point at <pi-setup>/rpiv-mono/packages/rpiv-advisor
```

Two behaviours to eyeball in an interactive session:

- **Footer indicator** — start a session with an advisor configured; the footer
  shows a line like `Advisor: openai-codex/gpt-6-astra • high`, and
  `Advisor: … (inactive)` when the current executor is blocklisted.
- **Scoped picker** — run `pi --models openai-codex/\*`, then `/advisor`; the
  picker lists only those scoped models (your current advisor stays at the top
  with a checkmark), not every authenticated model.

## Reverting to the npm package

In pi-setup's `config/settings.json`, replace the local package path with a
pinned `npm:@juicesharp/rpiv-advisor@<version>` entry. Run
`./scripts/bootstrap --apply` from pi-setup, then `pi update --extensions` and
restart Pi or `/reload`. Editing only the generated settings would be undone by
the next bootstrap apply. Bootstrap backups live under `<agent-dir>/backups/`.
