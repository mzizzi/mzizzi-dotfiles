import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time

config_path = Path(sys.argv[1])
config = json.loads(config_path.read_text())
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
env = dict(os.environ, TERM="xterm-256color", PI_CODING_AGENT_DIR=config["agentDir"],
           PI_WORKTREE_TERMINAL_CONFIG=str(config_path), PI_OFFLINE="1", PI_TELEMETRY="0",
           PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT=config["hostRoot"])
process = subprocess.Popen(config["command"], cwd=config["source"], env=env,
                           stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
seen = 0
answers = []
injected = False
output = bytearray()
deadline = time.monotonic() + 20
race_deadline = None
try:
    while process.poll() is None and time.monotonic() < deadline:
        if select.select([master], [], [], 0.02)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
        events_path = Path(config["events"])
        events = [json.loads(line) for line in events_path.read_text().splitlines()] if events_path.exists() else []
        for event in events[seen:]:
            if event["type"] == "dialog":
                if event.get("title") != "Switch parent worktree?":
                    raise RuntimeError("Unexpected fixture dialog: " + str(event))
                time.sleep(0.05)
                os.write(master, b"\r")
                answers.append(event["title"])
            if event["type"] == "late-guard" and not injected:
                os.write(master, b"CANCEL_TERMINAL_INPUT\r")
                injected = True
                race_deadline = time.monotonic() + 2
        seen = len(events)
        if race_deadline and time.monotonic() >= race_deadline:
            break
finally:
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
    # Detached children do not receive the parent's process-group signal.
    events_path = Path(config["events"])
    events = [json.loads(line) for line in events_path.read_text().splitlines()] if events_path.exists() else []
    for event in events:
        if event.get("type") != "start" or not event.get("child") or not event.get("pid"):
            continue
        pid = event["pid"]
        try:
            child_env = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
            marker = f"PI_WORKTREE_TERMINAL_CONFIG={config_path}".encode()
            if marker in child_env:
                os.kill(pid, signal.SIGTERM)
        except (FileNotFoundError, ProcessLookupError):
            pass
    os.close(master)
    Path(config["terminalOutput"]).write_bytes(output)
print(json.dumps({"exitCode": process.returncode, "answers": answers, "injected": injected,
                  "deadlineExceeded": time.monotonic() >= deadline}))
