# beam

Pair two machines once, then run a terminal, a command, or a message stream on either of them from the other.

beam replaces the `ssh host cmd` habit for machines you own. Pairing is a one-time exchange that leaves both sides holding the other's Ed25519 public key, and every connection after that is mutually authenticated against those keys — no passwords, no authorized_keys file, no accounts. What it carries is deliberately small: a real pty, an argv with separate stdout and stderr, and opaque messages that queue on disk when the other machine is offline and are delivered when it comes back.

It knows nothing about what you run over it. Repositories, agents and build systems live above beam.

> Beta. Expect rough edges, and pin a version if you depend on it.

## Install

```sh
npm install -g @notaharness/beam@beta
```

On both machines. This package is the only way to get the `beam` binary — there is no `n10 beam` subcommand, and installing [`@notaharness/n10`](https://www.npmjs.com/package/@notaharness/n10) or the desktop app does not put `beam` on your `PATH`.

## Pair two machines

On the machine you want to reach:

```sh
beam serve
```

It prints a pairing URL containing a single-use token, good for ten minutes. Anything that captures that output captures the token, so treat it like a password while it is live.

On the other machine:

```sh
beam pair 'http://<endpoint>/pair#token=…'
beam peers
```

Pairing is symmetric — one act, and both machines can authenticate each other from then on. Only one side needs to be reachable: a laptop with no open port can still drive a worker box, and the worker can still answer it.

## Use it

```sh
beam exec worker --cwd '~/src/app' -- git pull   # run argv there; its exit code becomes yours
beam connect worker pty                          # a login shell on that machine
beam connect worker pty -- tmux -u attach -t dev # or any argv, no shell in between
beam msg send worker --topic build --message 'done'
beam msg listen --topic build                    # one JSON envelope per line
beam msg queue                                   # what is still waiting, per peer
beam status                                      # this machine's identity and peers
```

`exec` keeps stdout and stderr separate and hands back the remote exit code. Nothing on the far side goes through a shell: `argv[0]` is executed directly, and a `~/` path is expanded by the accepting machine only when you pass it as `--cwd`, never inside an argument. `connect` gives you a real terminal with Ctrl-C passed through to the remote process rather than interrupting your local one. A message to a machine that is offline is written to a local queue and drains on the next connection, so a script can report to a machine that is not listening yet.

A peer is named by its label or its peer id. `beam peer rename`, `beam peer forget` and `beam revoke` manage the table. Exit codes are 0 for success, 1 for a runtime failure, 2 for a usage mistake.

## Requirements

- **Node.js 20+.**
- **A build toolchain on Linux.** `node-pty` ships prebuilt binaries for macOS and Windows, but not Linux, so npm compiles it during install. On Debian/Ubuntu: `sudo apt install build-essential python3`. macOS needs the Xcode command line tools (`xcode-select --install`).
- **Network reachability** between the machines, for whichever side accepts connections. beam does not punch through NAT for you; run it over Tailscale or a LAN.

## Security

Read this before pairing with anything.

- **Pairing grants a shell as the user running the node.** Treat it exactly like granting SSH access. `beam revoke <peer>` takes it back immediately: the connection is destroyed rather than asked to close, so a revoked peer gets no window to open one more stream.
- **The transport is plaintext.** Streams run over a plain WebSocket, so everything you type into a remote shell and everything it prints back crosses the network in the clear. Mutual authentication is mandatory and covers the connection upgrade itself, so an attacker on the path cannot impersonate either side or reuse what they capture to connect — but they can read the traffic. Confidentiality has to come from underneath: run beam over Tailscale, or another network layer you trust, unless the path between the machines is already one you trust. (`--transport webrtc` is reserved for an encrypted data channel and is not available yet; `ws` is the only transport today.)
- **The default bind is loopback.** Accepting connections from elsewhere takes an explicit `--hostname`, and the node prints what it bound.
- **Keys and state stay local.** The private key never leaves the machine. Identity, the peer table and the mailbox live in `$BEAM_CONFIG_DIR`, else `$XDG_CONFIG_HOME/beam`, else `~/.config/beam`, written `0600`. Queued message payloads are stored unencrypted at rest and are never executed by beam.
- **Re-pairing never silently replaces a key.** A pairing that would change the key stored for a known peer is refused unless you pass `--force`, and you are told which peer it would replace.

## Links

- [Source](https://github.com/notaharness/n10)
- [Protocol and design notes](https://github.com/notaharness/n10/blob/master/docs/beam.md)
- [Issues](https://github.com/notaharness/n10/issues)

MIT
