# PDF sandbox

Production PDF and cover parsing happens in this offline service. The trusted
Django/Celery process copies only one input to a random job directory, then
atomically announces the job via `request.json`. The sandbox sees the job spool
only; it must not mount private library storage, database credentials, broker
credentials, environment secrets, or a Docker socket.

For each job `runner.py` starts `parse_pdf.py` inside a new bubblewrap user,
mount, process and network namespace. The child gets read-only Python runtime,
one read-only input, its output directory, private `/tmp`, `/proc` and `/dev`.
CPU, address-space, output-size, file descriptor and wall-time limits apply.
The container must additionally use `network_mode: none`, a memory/PID limit,
read-only root filesystem, dropped capabilities and `no-new-privileges`.

The shared spool must be writable by UID/GID **10001** in both trusted worker
and sandbox. `PDF_JOB_ROOT=/jobs` on both sides. Use the project root as the
Docker build context. The backend parser path is only needed for the local
subprocess mode; production uses the spool.

Linux must permit unprivileged user namespaces inside this container. Default
Docker seccomp and some host AppArmor policies can block bubblewrap. Verify
on the target host using the actual deployment policy before exposing uploads.
Provide an audited container-specific policy permitting the namespace calls
needed by bubblewrap; do not grant privileged mode or mount the Docker socket.
If a namespace cannot be created, the job fails with `sandbox_failed`.
There is deliberately **no automatic fallback to unsandboxed production parsing**.

The Windows development runner uses a subprocess, stripped environment and
timeout, but cannot supply equivalent Linux namespace/resource isolation.
Use it only with trusted local test documents, not for public hosting.

Encrypted PDFs are retained as encrypted originals and reported as `locked`.
Passwords are entered only in PDF.js on the user's device; they never enter
this spool. No OCR is performed.
