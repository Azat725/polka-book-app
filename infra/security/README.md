# PDF container policies

`pdf-seccomp.json` is based on the Docker/Moby default allowlist:
https://github.com/moby/profiles/blob/main/seccomp/default.json
(Apache-2.0; license included as UPSTREAM_LICENSE, retrieved 2026-11-08).
It remains default-deny. A final rule permits clone/unshare/mount/umount/umount2/
pivot_root/setns/sethostname/chroot for the **offline PDF sandbox only**, so
bubblewrap can construct fresh per-job namespaces. API, database, worker and other
containers keep the normal Docker default policy.

There is no privileged mode, Docker socket, host filesystem mount, outbound
network, app secret, or global `seccomp=unconfined` exception. The parser process
sees only its own input/output, runtime libraries, a private proc/dev and tmpfs.
The outer namespace runner has the job spool; the parser does not.

On AppArmor hosts, Docker's usual profile blocks the required mounts. Load the
included **container-specific** AppArmor 4 profile instead of relaxing host-wide
protections. It is designed for Ubuntu 24.04+; older AppArmor syntax must be
adapted and independently checked on that host.

```bash
sudo apparmor_parser -r infra/security/polka-pdf.apparmor
```

Add this non-secret line to `.env` so all ordinary Compose commands retain the
override on Linux:

```text
COMPOSE_FILE=compose.yaml:infra/compose.apparmor.yaml
```

Validate the merged configuration before starting. If the kernel/provider
blocks unprivileged user namespaces, choose a host that supports them rather
than disabling host-wide safeguards or using a local production parser.

The startup self-test and subsequent real-PDF test must both pass on the target
host. These policies have not been executed on this Windows machine because its
WSL/Docker Linux engine does not start. Do not treat a JSON syntax check as a
successful Linux isolation test.
