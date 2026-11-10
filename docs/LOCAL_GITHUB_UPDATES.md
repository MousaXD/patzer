# Local Patzer GitHub updates

The self-hosted Patzer desktop service can optionally use a local systemd
updater to deploy **CI-green commits on `MousaXD/patzer` `main`**.

## Automatic

The user's installed `patzer-github-update.timer` checks **twice daily**:
00:00 and 12:00 in the local system timezone (UAE), with a short randomized
delay. Its service first verifies the exact GitHub CI result, then builds and
tests the release in isolation, backs up SQLite online, and atomically stages
both compiled code and runtime dependencies. A failed deployment attempts
rollback of both. It never auto-merges agent branches or performs a full-history
Chess.com import.

## Manual in Patzer

An authenticated administrator on a **localhost-only** Patzer instance opens
**Admin → System → Application updates** and clicks **Check for updates**.
The button calls `GET /api/admin/local-updates/check`, which runs only
`~/.local/bin/patzer-github-updater --status-json` (no installation). The result
shows installed and latest revision and whether exact-head CI has passed.

Only when CI confirms a ready update does an **Install verified update** button
appear. That button calls `POST /api/admin/local-updates/install`, which starts
the fixed systemd unit `patzer-github-update.service` with `--no-block`.
The site may briefly restart. No arbitrary shell arguments, branch names,
filesystem paths or remote commands come from browser input.

The local management API requires an administrator session and rejects calls
unless the app itself is configured for a loopback binding and the request is
to `localhost` or `127.0.0.1`. The usual Patzer CSRF header also applies to POST.
On installations without the optional user-service updater, checking returns
an explicit unavailable error rather than silently claiming success.

## Operator controls

```bash
systemctl --user list-timers patzer-github-update.timer
~/.local/bin/patzer-github-updater --status-json
systemctl --user start patzer-github-update.service
journalctl --user -u patzer-github-update.service -n 60 --no-pager
systemctl --user disable --now patzer-github-update.timer
```

This is separate from the older optional *upstream Patzer release notices*
toggle on the System screen. That toggle does not control this fork's
local GitHub deployment schedule.
