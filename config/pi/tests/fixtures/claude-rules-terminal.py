import os
import subprocess
import sys
import time

from terminal_pty import read_terminal, terminal_process


def wait_for_markers(master, output, deadline, markers, failure):
    while not all(marker in output for marker in markers):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(failure)
        chunk = read_terminal(master, remaining)
        if not chunk:
            raise RuntimeError(failure)
        output.extend(chunk)


with terminal_process(sys.argv[1:], env={**os.environ, "TERM": "xterm-256color"}) as (process, master):
    output = bytearray()
    deadline = time.monotonic() + 25
    try:
        wait_for_markers(
            master, output, deadline,
            (b"Trust this project?", b"Claude Code configuration", b"Yes", b"No"),
            "Pi did not show the Claude project trust prompt",
        )
        os.write(master, b"\r")
        wait_for_markers(
            master, output, deadline, (b"Rules fixture complete",),
            "Pi did not finish the scripted requests after approval",
        )
        os.write(master, b"\x04")
        status = process.wait(timeout=3)
        if status:
            raise RuntimeError(f"Pi exited with status {status}")
    except subprocess.TimeoutExpired as error:
        sys.stderr.buffer.write(output[-12_000:])
        raise RuntimeError("Pi did not exit after the final scripted response") from error
    except RuntimeError:
        sys.stderr.buffer.write(output[-12_000:])
        raise
