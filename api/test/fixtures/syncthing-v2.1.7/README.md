# Genuine Syncthing v2.1.7 response

`db-status.json` is the complete, unmodified HTTP 200 JSON body captured on
2026-11-04 from `GET /rest/db/status?folder=fixture-notes` on a disposable local
Syncthing instance. No production service or production response was used.
No sanitization was necessary: the empty folder response contains no paths,
API keys, folder IDs or device IDs (`remoteSequence` is empty). The timestamp
is the disposable instance's original value. All additional pending/error
payloads in `syncthing.test.js` are explicitly derived synthetic cases.

**Do not repeat this capture.** It was a manually launched service, which the
"no ad hoc network services" rule in `AGENTS.md` and `PLAN.md` (Decisions) now
prohibits (#102). The record below documents provenance only and is not a
procedure. A new real response must be recorded read-only from an
already-running service. Otherwise, write the fixture by hand and label it
synthetic.

Binary source:
https://github.com/syncthing/syncthing/releases/download/v2.1.7/syncthing-linux-amd64-v2.1.7.tar.gz

Downloaded archive SHA-256:
`2edc416e7ed136b7c858ed5f3f02a3b8316589605e54c380228ceea7acbf0142`

`./syncthing --version` reported:

```text
syncthing v2.1.7 "Hafnium Hornet" (go1.27.3 linux-amd64) builder@github.syncthing.net 2026-10-20 19:54:38 UTC
```

Historical record of how the capture was made (#99):

- A new key, certificate and config were generated into a throwaway `--home`
  directory. No real Syncthing config was used or written.
- **First launch (unsafe):** a config-edit step failed. The chained `serve` then
  ran on the generated defaults. That run enabled global/local discovery and
  the relay listener, and tried wildcard sync listeners (`0.0.0.0:22000`
  TCP/QUIC). It exited about a second later because 22000 and 8384 were already
  in use, and no API listener started.
- **Second launch:** the config was first set to GUI `127.0.0.1:18384`, listen
  `tcp://127.0.0.1:22099`, with discovery, relays, NAT, usage reporting and
  auto-upgrade disabled. One `GET` of the endpoint above was written to
  `db-status.json`, and the process was then stopped. There were no peers and
  no Docker port publishing.

Upstream wire contract:
https://github.com/syncthing/syncthing/blob/v2.1.7/lib/model/folder_summary.go
and https://docs.syncthing.net/rest/db-status-get.html . `needTotalItems` is the
total pending count (including directories, symlinks and deletions), not just
`needFiles`. The dashboard continues exposing the normalized name `needItems`.
