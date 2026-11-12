import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import xml.etree.ElementTree as ET

SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "setup-intellij.py"
spec = importlib.util.spec_from_file_location("setup_intellij", SCRIPT)
assert spec is not None and spec.loader is not None
setup = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = setup
spec.loader.exec_module(setup)

IDE = setup.InstalledIde(build="262.9437.185", product_code="IU", data_directory_name="IntelliJIdea2026.2", launcher="idea64.exe")
HOST = "agent-lab.sbx"
CONFIG_ID = "11111111-1111-4111-8111-111111111111"
OTHER_ID = "22222222-2222-4222-8222-222222222222"
PROJECT = "/c/Users/example/code/mzizzi-dotfiles"
BACKEND = f"{setup.BACKEND_ROOT}/{IDE.backend_name}"

# Modeled on the files IntelliJ IDEA 2026.2 writes.
SSH_CONFIGS = f"""<application>
  <component name="SshConfigs">
    <configs>
      <sshConfig authType="OPEN_SSH" host="{HOST}" id="{CONFIG_ID}" port="22" nameFormat="DESCRIPTIVE" username="agent" useOpenSSHConfig="true" />
      <sshConfig authType="OPEN_SSH" host="other.sbx" id="{OTHER_ID}" port="22" nameFormat="DESCRIPTIVE" username="agent" useOpenSSHConfig="true" />
    </configs>
  </component>
</application>"""
RECENT = f"""<application>
  <component name="SshLocalRecentConnectionsManager">
    <option name="connections">
      <list>
        <LocalRecentConnectionState>
          <option name="configId" value="{OTHER_ID}" />
          <option name="projects">
            <list>
              <RecentProjectState>
                <option name="date" value="1700000000000" />
                <option name="latestUsedIde">
                  <RecentProjectInstalledIde>
                    <option name="buildNumber" value="262.1.1" />
                    <option name="pathToIde" value="/opt/idea" />
                    <option name="productCode" value="IU" />
                  </RecentProjectInstalledIde>
                </option>
                <option name="productCode" value="IU" />
                <option name="projectPath" value="/c/Users/example/code/other" />
              </RecentProjectState>
            </list>
          </option>
        </LocalRecentConnectionState>
        <LocalRecentConnectionState>
          <option name="configId" value="{CONFIG_ID}" />
          <option name="projects">
            <list />
          </option>
        </LocalRecentConnectionState>
      </list>
    </option>
  </component>
</application>"""
HOSTS = f"""<application>
  <component name="SshHostStorage">
    <option name="configIds">
      <list>
        <option value="{OTHER_ID}" />
        <option value="{CONFIG_ID}" />
      </list>
    </option>
  </component>
</application>"""


def write_product_info(root: Path, name: str, product_code: str, build: str) -> Path:
    path = root / name / "product-info.json"
    path.parent.mkdir(parents=True)
    info = {
        "buildNumber": build,
        "productCode": product_code,
        "dataDirectoryName": f"{name}-data",
        "launch": [{"os": "Windows", "launcherPath": "bin/idea64.exe"}],
    }
    path.write_text(json.dumps(info), encoding="utf-8")
    return path


class LatestIdeaTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))

    def test_prefers_newest_ultimate_over_community_and_other_products(self):
        paths = [
            write_product_info(self.root, "old", "IU", "262.9437.185"),
            write_product_info(self.root, "new", "IU", "263.7307.112"),
            write_product_info(self.root, "community", "IC", "264.1.1"),
            write_product_info(self.root, "pycharm", "PY", "265.1.1"),
        ]
        ide = setup.latest_idea(paths)
        self.assertEqual(ide, setup.InstalledIde("263.7307.112", "IU", "new-data", "idea64.exe"))

    def test_compares_build_components_numerically(self):
        paths = [
            write_product_info(self.root, "a", "IU", "262.9437.185"),
            write_product_info(self.root, "b", "IU", "262.10968.63"),
        ]
        self.assertEqual(setup.latest_idea(paths).build, "262.10968.63")

    def test_falls_back_to_community(self):
        paths = [write_product_info(self.root, "community", "IC", "262.10968.63")]
        self.assertEqual(setup.latest_idea(paths).product_code, "IC")

    def test_none_without_intellij(self):
        self.assertIsNone(setup.latest_idea([write_product_info(self.root, "pycharm", "PY", "262.10968.63")]))


class RegisterRecentProjectTest(unittest.TestCase):
    def setUp(self):
        self.options = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(mock.patch("sys.stdout", io.StringIO()))

    def register(self, ide=IDE, backend=BACKEND):
        setup.register_recent_project(self.options, HOST, PROJECT, backend, ide)

    def write_fixtures(self):
        for name, text in [
            ("sshConfigs.xml", SSH_CONFIGS),
            ("sshRecentConnections.v2.xml", RECENT),
            ("sshRecentConnectionsHost.xml", HOSTS),
        ]:
            (self.options / name).write_text(text, encoding="utf-8")

    def recent_projects(self, config_id):
        root = ET.parse(self.options / "sshRecentConnections.v2.xml").getroot()
        connections = root.find("component/option[@name='connections']/list")
        assert connections is not None
        connection = setup.find_by_option(connections, "LocalRecentConnectionState", "configId", config_id)
        return None if connection is None else connection.findall("option[@name='projects']/list/RecentProjectState")

    def assert_project(self, project, ide, backend):
        installed = project.find("option[@name='latestUsedIde']/RecentProjectInstalledIde")
        self.assertEqual(setup.option_value(installed, "pathToIde"), backend)
        self.assertEqual(setup.option_value(installed, "buildNumber"), ide.build)
        self.assertEqual(setup.option_value(installed, "productCode"), ide.product_code)
        self.assertEqual(setup.option_value(project, "productCode"), ide.product_code)
        self.assertEqual(setup.option_value(project, "projectPath"), PROJECT)
        self.assertIsNotNone(setup.option_value(project, "date"))

    def test_adds_project_to_existing_config_and_preserves_other_entries(self):
        self.write_fixtures()
        self.register()

        (project,) = self.recent_projects(CONFIG_ID)
        self.assert_project(project, IDE, BACKEND)
        self.assertEqual(len(self.recent_projects(OTHER_ID)), 1)
        configs = ET.parse(self.options / "sshConfigs.xml").getroot().findall(".//sshConfig")
        self.assertEqual([c.get("id") for c in configs], [CONFIG_ID, OTHER_ID])
        self.assertEqual((self.options / "sshRecentConnections.v2.xml.bak").read_text(encoding="utf-8"), RECENT)
        self.assertEqual((self.options / "sshConfigs.xml").read_text(encoding="utf-8"), SSH_CONFIGS)
        self.assertEqual((self.options / "sshRecentConnectionsHost.xml").read_text(encoding="utf-8"), HOSTS)

    def test_second_run_writes_nothing(self):
        self.write_fixtures()
        self.register()
        before = {p.name: p.read_bytes() for p in self.options.iterdir()}
        with mock.patch.object(setup.time, "time", return_value=0):
            self.register()
        self.assertEqual({p.name: p.read_bytes() for p in self.options.iterdir()}, before)

    def test_new_build_replaces_backend_in_place(self):
        self.write_fixtures()
        self.register()
        newer = setup.InstalledIde("263.7307.112", "IU", "IntelliJIdea2026.3", "idea64.exe")
        self.register(newer, BACKEND.replace(IDE.build, newer.build))
        (project,) = self.recent_projects(CONFIG_ID)
        self.assert_project(project, newer, BACKEND.replace(IDE.build, newer.build))

    def test_creates_all_files_when_missing(self):
        self.register()
        root = ET.parse(self.options / "sshConfigs.xml").getroot()
        config = root.find("component[@name='SshConfigs']/configs/sshConfig")
        assert config is not None
        self.assertEqual((config.get("host"), config.get("useOpenSSHConfig")), (HOST, "true"))
        config_id = config.get("id")
        (project,) = self.recent_projects(config_id)
        self.assert_project(project, IDE, BACKEND)
        hosts = ET.parse(self.options / "sshRecentConnectionsHost.xml").getroot()
        self.assertEqual([o.get("value") for o in hosts.iter("option") if o.get("value")], [config_id])
        self.assertEqual(list(self.options.glob("*.bak")), [])


class CachedBackendTest(unittest.TestCase):
    PAYLOAD = b"backend archive"

    def setUp(self):
        self.cache = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(mock.patch("sys.stdout", io.StringIO()))
        self.subprocess_run = self.enterContext(mock.patch.object(setup.subprocess, "run"))
        self.subprocess_run.return_value = subprocess.CompletedProcess([], 0, stdout="x86_64\n")

    def urlopen(self, checksum):
        releases = {"IIU": [{"downloads": {"linux": {"link": "https://x/idea.tar.gz", "checksumLink": "https://x/idea.tar.gz.sha256"}}}]}
        responses = {
            "https://x/idea.tar.gz.sha256": f"{checksum} *idea.tar.gz".encode(),
            "https://x/idea.tar.gz": self.PAYLOAD,
        }

        def fake(url, **_):
            if url.startswith(setup.RELEASES_API):
                self.assertIn("build=262.9437.185", url)
                return io.BytesIO(json.dumps(releases).encode())
            return io.BytesIO(responses[url])

        return mock.patch.object(setup, "urlopen", side_effect=fake)

    def test_downloads_verifies_and_prunes_other_builds(self):
        (self.cache / "idea-IU-261.1.1.tar.gz").write_bytes(b"old")
        (self.cache / "idea-IU-262.9437.185.tar.gz.part").write_bytes(b"interrupted")
        with self.urlopen(hashlib.sha256(self.PAYLOAD).hexdigest()):
            archive = setup.cached_backend(IDE, self.cache, "agent-lab")
        self.assertEqual(archive.read_bytes(), self.PAYLOAD)
        self.assertEqual(list(self.cache.iterdir()), [archive])

    def test_checksum_mismatch_leaves_no_archive(self):
        with self.urlopen("0" * 64), self.assertRaises(SystemExit):
            setup.cached_backend(IDE, self.cache, "agent-lab")
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_unknown_sandbox_architecture_fails_before_network(self):
        self.subprocess_run.return_value = subprocess.CompletedProcess([], 0, stdout="riscv64\n")
        with mock.patch.object(setup, "urlopen") as urlopen, self.assertRaises(SystemExit):
            setup.cached_backend(IDE, self.cache, "agent-lab")
        urlopen.assert_not_called()

    def test_cached_archive_skips_network_and_sandbox(self):
        archive = self.cache / "idea-IU-262.9437.185.tar.gz"
        archive.write_bytes(self.PAYLOAD)
        with mock.patch.object(setup, "urlopen") as urlopen:
            self.assertEqual(setup.cached_backend(IDE, self.cache, "agent-lab"), archive)
        urlopen.assert_not_called()
        self.subprocess_run.assert_not_called()


class InstallBackendTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(mock.patch("sys.stdout", io.StringIO()))
        self.subprocess_run = self.enterContext(mock.patch.object(setup.subprocess, "run"))

    def test_skips_installed_backend(self):
        self.subprocess_run.return_value = subprocess.CompletedProcess([], 0)
        setup.install_backend("agent-lab", "/c/cache/idea.tar.gz", BACKEND)
        self.assertEqual(self.subprocess_run.call_count, 1)
        self.assertEqual(self.subprocess_run.call_args.args[0], ["sbx", "exec", "agent-lab", "test", "-f", f"{BACKEND}/product-info.json"])

    def test_unpacks_missing_backend(self):
        self.subprocess_run.side_effect = [subprocess.CompletedProcess([], 1), subprocess.CompletedProcess([], 0)]
        setup.install_backend("agent-lab", "/c/cache/idea.tar.gz", BACKEND)
        command = self.subprocess_run.call_args.args[0]
        self.assertEqual(command[:5], ["sbx", "exec", "agent-lab", "sh", "-c"])
        self.assertEqual(command[-2:], ["/c/cache/idea.tar.gz", BACKEND])


class GuestPathTest(unittest.TestCase):
    @unittest.skipUnless(setup.sys.platform == "win32", "Windows drive mapping")
    def test_maps_windows_drive(self):
        path = Path(r"C:\Users\example\.sandbox-state\agent-lab\intellij\idea.tar.gz")
        self.assertEqual(setup.guest_path(path), "/c/Users/example/.sandbox-state/agent-lab/intellij/idea.tar.gz")


if __name__ == "__main__":
    unittest.main()
