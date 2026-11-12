"""Prepare the host's IntelliJ IDEA for remote development in the sandbox."""

from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import time
from typing import Callable, TypeVar
from urllib.parse import urlencode
from urllib.request import urlopen
import uuid
import xml.etree.ElementTree as ET

RELEASES_API = "https://data.services.jetbrains.com/products/releases"
# Seconds a JetBrains request may stall before failing, so postCreate cannot hang on it.
URL_TIMEOUT = 60
# IntelliJ's default remote-dev backend location; backends installed here sit next to the ones it deploys.
BACKEND_ROOT = "/home/agent/.cache/JetBrains/RemoteDev/dist"
# In preference order: Ultimate, then Community.
IDEA_PRODUCT_CODES = ("IU", "IC")
# `uname -m` of the guest -> key in a JetBrains release's downloads.
LINUX_DOWNLOADS = {"x86_64": "linux", "aarch64": "linuxARM64", "arm64": "linuxARM64"}

T = TypeVar("T")


@dataclass(frozen=True)
class InstalledIde:
    build: str  # e.g. 262.9437.185, from product-info.json buildNumber
    product_code: str  # one of IDEA_PRODUCT_CODES
    data_directory_name: str  # config directory name under the JetBrains config root
    launcher: str  # launcher executable file name, used to detect a running instance

    @property
    def build_key(self) -> tuple[int, ...]:
        return tuple(int(part) for part in self.build.split(".") if part.isdigit())

    @property
    def backend_name(self) -> str:
        return f"idea-{self.product_code}-{self.build}"


def main() -> None:
    if sys.platform not in ("win32", "darwin"):
        raise SystemExit(f"Unsupported host platform: {sys.platform}")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sandbox", default=os.environ.get("SBX_SANDBOX_NAME", "agent-lab"))
    parser.add_argument("--known-hosts", type=Path, default=Path.home() / ".ssh" / "known_hosts")
    parser.add_argument(
        "--state-dir",
        type=Path,
        help="host directory the sandbox mounts at the same path (default: ~/.sandbox-state/<sandbox>)",
    )
    args = parser.parse_args()
    if args.state_dir is None:
        args.state_dir = Path.home() / ".sandbox-state" / args.sandbox

    host = f"{args.sandbox}.sbx"
    refresh_known_hosts(host, args.known_hosts)

    ide = latest_idea(product_info_files())
    if ide is None:
        print("No IntelliJ IDEA installation found; skipping the IntelliJ backend setup.")
        return
    archive = cached_backend(ide, args.state_dir / "intellij", args.sandbox)
    backend_dir = f"{BACKEND_ROOT}/{ide.backend_name}"
    install_backend(args.sandbox, guest_path(archive), backend_dir)

    if ide_running(ide.launcher):
        # IntelliJ writes its in-memory copy of these files on exit, which would drop the entry.
        print(
            f"WARNING: {ide.launcher} is running, so the IntelliJ SSH configuration and recent project for {host} "
            f"were not written. Quit IntelliJ and rerun: python \"{Path(__file__).resolve()}\" "
            f"--sandbox \"{args.sandbox}\" --known-hosts \"{args.known_hosts}\" --state-dir \"{args.state_dir}\""
        )
        return
    workspace = sbx_exec(args.sandbox, "printenv", "WORKSPACE_DIR").stdout.strip()
    options_dir = config_root() / ide.data_directory_name / "options"
    register_recent_project(options_dir, host, workspace, backend_dir, ide)


def refresh_known_hosts(host: str, path: Path) -> None:
    """Replace IntelliJ SSHJ's host key aliases for `host` with the sandbox's current key."""
    result = subprocess.run(["sbx", "ssh", "known-hosts", host], check=True, capture_output=True, text=True)
    fields = result.stdout.split()
    if len(fields) != 3 or fields[:2] != [host, "ssh-ed25519"]:
        raise ValueError(f"Unexpected SSH host key for {host}")
    base64.b64decode(fields[2], validate=True)

    aliases = (host, f"[{host}]:0")
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


def product_info_files() -> list[Path]:
    home = Path.home()
    if sys.platform == "win32":
        local = Path(os.environ["LOCALAPPDATA"])
        locations = [
            (Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "JetBrains", "*/product-info.json"),
            (local / "Programs", "*/product-info.json"),
            (local / "JetBrains" / "Toolbox" / "apps", "*/ch-*/*/product-info.json"),
        ]
    else:
        bundle = "*.app/Contents/Resources/product-info.json"
        locations = [
            (Path("/Applications"), bundle),
            (home / "Applications", bundle),
            (home / "Library" / "Application Support" / "JetBrains" / "Toolbox" / "apps", f"*/ch-*/*/{bundle}"),
        ]
    return [path for root, pattern in locations for path in root.glob(pattern)]


def config_root() -> Path:
    if sys.platform == "win32":
        return Path(os.environ["APPDATA"]) / "JetBrains"
    return Path.home() / "Library" / "Application Support" / "JetBrains"


def latest_idea(product_infos: list[Path]) -> InstalledIde | None:
    ides = []
    for path in product_infos:
        info = json.loads(path.read_text(encoding="utf-8"))
        if info.get("productCode") not in IDEA_PRODUCT_CODES:
            continue
        ides.append(
            InstalledIde(
                build=info["buildNumber"],
                product_code=info["productCode"],
                data_directory_name=info["dataDirectoryName"],
                launcher=PurePosixPath(info["launch"][0]["launcherPath"]).name,
            )
        )
    if not ides:
        return None
    return max(ides, key=lambda ide: (-IDEA_PRODUCT_CODES.index(ide.product_code), ide.build_key))


def cached_backend(ide: InstalledIde, cache_dir: Path, sandbox: str) -> Path:
    archive = cache_dir / f"{ide.backend_name}.tar.gz"
    if not archive.exists():
        arch = sbx_exec(sandbox, "uname", "-m").stdout.strip()
        url, checksum_url = backend_urls(ide, arch)
        cache_dir.mkdir(parents=True, exist_ok=True)
        download_verified(url, checksum_url, archive)
    for stale in cache_dir.glob("idea-*.tar.gz*"):
        if stale != archive:
            stale.unlink()
            print(f"Removed cached IntelliJ backend {stale.name}.")
    return archive


def backend_urls(ide: InstalledIde, arch: str) -> tuple[str, str]:
    platform = LINUX_DOWNLOADS.get(arch)
    if platform is None:
        raise SystemExit(f"Unsupported sandbox architecture: {arch}")
    code = f"I{ide.product_code}"
    query = urlencode({"code": code, "build": ide.build, "type": "eap,rc,release"})
    with urlopen(f"{RELEASES_API}?{query}", timeout=URL_TIMEOUT) as response:
        releases = json.load(response).get(code, [])
    if not releases:
        raise SystemExit(f"JetBrains lists no {code} release for build {ide.build}.")
    download = releases[0]["downloads"][platform]
    return download["link"], download["checksumLink"]


def download_verified(url: str, checksum_url: str, dest: Path) -> None:
    with urlopen(checksum_url, timeout=URL_TIMEOUT) as response:
        expected = response.read().decode("ascii").split()[0].lower()
    partial = dest.with_name(dest.name + ".part")
    digest = hashlib.sha256()
    print(f"Downloading {url}.")
    with urlopen(url, timeout=URL_TIMEOUT) as response, partial.open("wb") as out:
        while chunk := response.read(1 << 20):
            digest.update(chunk)
            out.write(chunk)
    if digest.hexdigest() != expected:
        partial.unlink()
        raise SystemExit(f"SHA-256 mismatch for {url}.")
    partial.replace(dest)


def guest_path(host_path: Path) -> str:
    """Return the guest path sbx mounts `host_path` at: C:\\x becomes /c/x."""
    if sys.platform != "win32":
        return host_path.as_posix()
    return "/" + "/".join([host_path.drive.rstrip(":").lower(), *host_path.parts[1:]])


def install_backend(sandbox: str, guest_archive: str, backend_dir: str) -> None:
    if sbx_exec(sandbox, "test", "-f", f"{backend_dir}/product-info.json", check=False).returncode == 0:
        return
    # Unpack beside the target and rename, so an interrupted run never leaves a partial backend.
    script = (
        'set -eu; rm -rf "$2.partial" "$2"; mkdir -p "$2.partial"; '
        'tar -xzf "$1" -C "$2.partial" --strip-components=1; mv "$2.partial" "$2"'
    )
    print(f"Installing the IntelliJ backend in {sandbox} at {backend_dir}.")
    sbx_exec(sandbox, "sh", "-c", script, "sh", guest_archive, backend_dir)


def sbx_exec(sandbox: str, *command: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["sbx", "exec", sandbox, *command], check=check, capture_output=True, text=True)


def ide_running(launcher: str) -> bool:
    if sys.platform == "win32":
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {launcher}", "/FO", "CSV", "/NH"], capture_output=True, text=True
        )
        return f'"{launcher.lower()}"' in result.stdout.lower()
    return subprocess.run(["pgrep", "-x", launcher], capture_output=True).returncode == 0


def register_recent_project(options_dir: Path, host: str, project_path: str, backend_dir: str, ide: InstalledIde) -> None:
    config_id = edit_options(options_dir / "sshConfigs.xml", "SshConfigs", lambda c: ensure_ssh_config(c, host))
    edit_options(
        options_dir / "sshRecentConnections.v2.xml",
        "SshLocalRecentConnectionsManager",
        lambda c: ensure_recent_project(c, config_id, project_path, backend_dir, ide),
    )
    edit_options(options_dir / "sshRecentConnectionsHost.xml", "SshHostStorage", lambda c: ensure_host(c, config_id))


def edit_options(path: Path, component_name: str, edit: Callable[[ET.Element], T]) -> T:
    previous = path.read_bytes() if path.exists() else None
    root = ET.Element("application") if previous is None else ET.fromstring(previous)
    component = root.find(f"component[@name='{component_name}']")
    if component is None:
        component = ET.SubElement(root, "component", name=component_name)
    before = None if previous is None else serialize(root)
    result = edit(component)
    after = serialize(root)
    if after != before:
        if previous is not None:
            path.with_name(path.name + ".bak").write_bytes(previous)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(after.encode("utf-8"))
        print(f"Updated {path}.")
    return result


def serialize(root: ET.Element) -> str:
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode")


def ensure_ssh_config(component: ET.Element, host: str) -> str:
    configs = child(component, "configs")
    config = configs.find(f"sshConfig[@host='{host}']")
    if config is None:
        config = ET.SubElement(
            configs,
            "sshConfig",
            authType="OPEN_SSH",
            host=host,
            id=str(uuid.uuid4()),
            port="22",
            nameFormat="DESCRIPTIVE",
            username="agent",
            useOpenSSHConfig="true",
        )
    return config.attrib["id"]


def ensure_recent_project(
    component: ET.Element, config_id: str, project_path: str, backend_dir: str, ide: InstalledIde
) -> None:
    connections = child(child(component, "option", name="connections"), "list")
    connection = find_by_option(connections, "LocalRecentConnectionState", "configId", config_id)
    if connection is None:
        connection = ET.SubElement(connections, "LocalRecentConnectionState")
        set_option(connection, "configId", config_id)
    projects = child(child(connection, "option", name="projects"), "list")
    project = find_by_option(projects, "RecentProjectState", "projectPath", project_path)
    if project is None:
        project = ET.Element("RecentProjectState")
        projects.insert(0, project)
    before = ET.tostring(project)
    installed_ide = child(child(project, "option", name="latestUsedIde"), "RecentProjectInstalledIde")
    set_option(installed_ide, "buildNumber", ide.build)
    set_option(installed_ide, "pathToIde", backend_dir)
    set_option(installed_ide, "productCode", ide.product_code)
    set_option(project, "productCode", ide.product_code)
    set_option(project, "projectPath", project_path)
    if ET.tostring(project) != before:
        set_option(project, "date", str(int(time.time() * 1000)))


def ensure_host(component: ET.Element, config_id: str) -> None:
    config_ids = child(child(component, "option", name="configIds"), "list")
    if config_ids.find(f"option[@value='{config_id}']") is None:
        ET.SubElement(config_ids, "option", value=config_id)


def child(parent: ET.Element, tag: str, **attrs: str) -> ET.Element:
    """Return the first child with `tag` and `attrs`, creating it if missing."""
    match = parent.find(tag + "".join(f"[@{key}='{value}']" for key, value in attrs.items()))
    return match if match is not None else ET.SubElement(parent, tag, attrs)


def option_value(parent: ET.Element, name: str) -> str | None:
    option = parent.find(f"option[@name='{name}']")
    return None if option is None else option.get("value")


def find_by_option(parent: ET.Element, tag: str, name: str, value: str) -> ET.Element | None:
    return next((e for e in parent.findall(tag) if option_value(e, name) == value), None)


def set_option(parent: ET.Element, name: str, value: str) -> None:
    child(parent, "option", name=name).set("value", value)


if __name__ == "__main__":
    main()
