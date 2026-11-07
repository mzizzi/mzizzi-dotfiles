"""Keep IntelliJ SSHJ's sandbox host-key aliases current after a rebuild."""

import argparse
import base64
import os
from pathlib import Path
import subprocess


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sandbox", default=os.environ.get("SBX_SANDBOX_NAME", "agent-lab"))
    parser.add_argument("--known-hosts", type=Path, default=Path.home() / ".ssh" / "known_hosts")
    args = parser.parse_args()

    host = f"{args.sandbox}.sbx"
    result = subprocess.run(["sbx", "ssh", "known-hosts", host], check=True, capture_output=True, text=True)
    fields = result.stdout.split()
    if len(fields) != 3 or fields[:2] != [host, "ssh-ed25519"]:
        raise ValueError(f"Unexpected SSH host key for {host}")
    base64.b64decode(fields[2], validate=True)

    aliases = (host, f"[{host}]:0")
    path = args.known_hosts
    current = path.read_bytes().decode("utf-8") if path.exists() else ""
    lines = []
    for line in current.splitlines(keepends=True):
        parts = line.split(maxsplit=1)
        if not parts or parts[0] not in aliases:
            lines.append(line)
    updated = "".join(lines)
    newline = "\r\n" if "\r\n" in current else "\n"
    if updated and not updated.endswith(("\n", "\r")):
        updated += newline
    updated += "".join(f"{alias} ssh-ed25519 {fields[2]}{newline}" for alias in aliases)

    if updated != current:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(updated.encode("utf-8"))
        print(f"Updated SSH host key for {host}.")


if __name__ == "__main__":
    main()
