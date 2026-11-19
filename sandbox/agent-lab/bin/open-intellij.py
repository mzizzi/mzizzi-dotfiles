"""Open the sandbox workspace in a JetBrains Client connected to a fresh IntelliJ backend."""

from __future__ import annotations

import argparse
from collections import deque
import contextlib
import queue
import re
import subprocess
import sys
import threading
from typing import IO

import setup_intellij as setup

# Seconds to wait for the backend to print its join link; a cold start indexes the project first.
JOIN_LINK_TIMEOUT = 300
# Lines of backend output shown when no join link appears.
FAILURE_TAIL_LINES = 40
# Seconds to wait for killed backends to exit before removing their lock files.
STOP_TIMEOUT = 30
# The backend prints the address it listens on, 0.0.0.0, as the link's host.
JOIN_LINK = re.compile(r"Join link: tcp://[^:/]+:(\d+)(#\S+)")


def main() -> None:
    if sys.platform != "win32":
        raise SystemExit(f"Unsupported host platform: {sys.platform}")
    parser = argparse.ArgumentParser(description=__doc__)
    setup.add_sandbox_args(parser)
    args = setup.parse_sandbox_args(parser)

    ide = setup.latest_idea(setup.product_info_files())
    if ide is None:
        raise SystemExit("No IntelliJ IDEA installation found.")
    client = ide.product_info.parent / "bin" / "jetbrains_client64.exe"
    if not client.is_file():
        raise SystemExit(f"JetBrains Client not found at {client}.")
    setup.prepare_backend(ide, args.sandbox, args.state_dir)

    stop_all(args.sandbox, ide.data_directory_name)
    workspace = setup.workspace_dir(args.sandbox)
    print(f"Starting the IntelliJ backend for {workspace}.", flush=True)
    with contextlib.ExitStack() as cleanup:
        # The open exec keeps the sandbox from stopping; setsid makes the printed PID this backend's group.
        # --listenOn because a published port cannot reach the guest's loopback.
        backend = sbx_popen(
            args.sandbox,
            "setsid",
            "sh",
            "-c",
            'echo "pid $$"; REMOTE_DEV_NON_INTERACTIVE=1 exec "$@"',
            "sh",
            f"{ide.backend_dir}/bin/remote-dev-server.sh",
            "run",
            workspace,
            "--listenOn",
            "0.0.0.0",
        )
        cleanup.callback(backend.kill)
        pgid = read_pid(backend)
        cleanup.callback(setup.sbx_exec, args.sandbox, "kill", "--", f"-{pgid}", check=False)

        link, port = wait_for_join_link(backend)
        published = f"127.0.0.1:{port}:{port}/tcp4"
        subprocess.run(["sbx", "ports", args.sandbox, "--publish", published], check=True, stdout=subprocess.DEVNULL)
        cleanup.callback(
            subprocess.run, ["sbx", "ports", args.sandbox, "--unpublish", published], capture_output=True
        )
        print("Opening JetBrains Client; close it to stop the backend.", flush=True)
        subprocess.run([str(client), "thinClient", link], check=False)


def stop_all(sandbox: str, data_directory_name: str) -> None:
    """Stop every backend in the sandbox and remove the lock files a killed backend leaves."""
    # The [r] keeps the pattern from matching this sh -c command line.
    script = (
        'pkill -f "[r]emote-dev-server run"; '
        'for _ in $(seq "$2"); do pgrep -f "[r]emote-dev-server run" >/dev/null || break; sleep 1; done; '
        'rm -f "$HOME/.config/JetBrains/$1/.lock" "$HOME/.cache/JetBrains/$1/.port"'
    )
    setup.sbx_exec(sandbox, "sh", "-c", script, "sh", data_directory_name, str(STOP_TIMEOUT))


def sbx_popen(sandbox: str, *command: str) -> subprocess.Popen[str]:
    return subprocess.Popen(
        ["sbx", "exec", sandbox, *command],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def read_pid(backend: subprocess.Popen[str]) -> str:
    """Return the PID the backend's wrapper prints, skipping the status lines sbx prints first."""
    assert backend.stdout is not None
    for line in backend.stdout:
        if match := re.fullmatch(r"pid (\d+)", line.strip()):
            return match.group(1)
    raise SystemExit("The IntelliJ backend exited before it started.")


def wait_for_join_link(backend: subprocess.Popen[str]) -> tuple[str, int]:
    """Return the join link, with a 127.0.0.1 host, and its port; keep draining so the pipe never fills."""
    assert backend.stdout is not None
    links: queue.Queue[tuple[str, int] | None] = queue.Queue()
    tail: deque[str] = deque(maxlen=FAILURE_TAIL_LINES)

    def drain(stream: IO[str]) -> None:
        matched = False
        for line in stream:
            if matched:
                continue
            tail.append(line)
            if match := JOIN_LINK.search(line):
                port = int(match.group(1))
                links.put((f"tcp://127.0.0.1:{port}{match.group(2)}", port))
                matched = True
        if not matched:
            links.put(None)

    threading.Thread(target=drain, args=(backend.stdout,), daemon=True).start()
    try:
        result = links.get(timeout=JOIN_LINK_TIMEOUT)
    except queue.Empty:
        result = None
    if result is None:
        sys.stderr.write("".join(tail))
        raise SystemExit("The IntelliJ backend did not print a join link.")
    return result


if __name__ == "__main__":
    main()
