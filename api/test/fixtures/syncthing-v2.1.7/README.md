# Genuine Syncthing v2.1.7 response

`db-status.json` is the complete, unmodified HTTP 200 JSON body captured on
2026-11-04 from `GET /rest/db/status?folder=fixture-notes` on a disposable local
Syncthing instance. No production service or production response was used.
No sanitization was necessary: the empty folder response contains no paths,
API keys, folder IDs or device IDs (`remoteSequence` is empty). The timestamp
is the disposable instance's original value. All additional pending/error
payloads in `syncthing.test.js` are explicitly derived synthetic cases.

Binary source:
https://github.com/syncthing/syncthing/releases/download/v2.1.7/syncthing-linux-amd64-v2.1.7.tar.gz

Downloaded archive SHA-256:
`2edc416e7ed136b7c858ed5f3f02a3b8316589605e54c380228ceea7acbf0142`

`./syncthing --version` reported:

```text
syncthing v2.1.7 "Hafnium Hornet" (go1.27.3 linux-amd64) builder@github.syncthing.net 2026-10-20 19:54:38 UTC
```

Capture procedure (use a new disposable directory and available loopback ports):

1. Extract the upstream release. Run `syncthing generate --home=<throwaway> --no-port-probing`.
   This only generates disposable configuration/certificates; do not use a real config.
2. Before serving, edit that generated `config.xml`: add a `folder` element with
   `id="fixture-notes"`, `label="Fixture"`, `type="sendreceive"`, and a path under
   the throwaway directory. Set `gui/address` to `127.0.0.1:18384` and
   `options/listenAddress` to `tcp://127.0.0.1:22099`. Set
   `globalAnnounceEnabled`, `localAnnounceEnabled`, `relaysEnabled`, `natEnabled`
   to `false`, `urAccepted` to `-1`, and `autoUpgradeIntervalH` to `0`.
   Verify all settings before launching; never run the generated defaults.
3. Run `syncthing serve --home=<throwaway> --no-browser --no-restart --no-upgrade`.
   Wait for the empty folder's initial scan to complete and state to become idle.
4. Read `gui/apikey` directly from the disposable XML in a capture script and send
   it only as the `X-API-Key` request header to
   `http://127.0.0.1:18384/rest/db/status?folder=fixture-notes`.
   Write the raw response bytes to the fixture file, without printing the key.
5. Stop the disposable process. Do not commit its config, keys, certificates or DB.

The capture used loopback listeners only, no Docker port publishing, no peers,
no discovery/relays, and no production configuration changes. An initial failed
configuration edit was accidentally followed by a default launch; it exited on
occupied 8384 without starting a second API listener. The successful capture was
made only after the settings above were verified.

Upstream wire contract:
https://github.com/syncthing/syncthing/blob/v2.1.7/lib/model/folder_summary.go
and https://docs.syncthing.net/rest/db-status-get.html . `needTotalItems` is the
total pending count (including directories, symlinks and deletions), not just
`needFiles`. The dashboard continues exposing the normalized name `needItems`.
