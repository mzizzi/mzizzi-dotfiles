import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest import mock

BIN = Path(__file__).resolve().parents[1] / "bin"
sys.path.insert(0, str(BIN))
SCRIPT = BIN / "open-intellij.py"
spec = importlib.util.spec_from_file_location("open_intellij", SCRIPT)
assert spec is not None and spec.loader is not None
launcher = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = launcher
spec.loader.exec_module(launcher)

# The line remote-dev-server.sh prints when run with --listenOn 0.0.0.0, with the token shortened.
JOIN_LINE = "Join link: tcp://0.0.0.0:5990#jt=6a1b&p=IU&fp=D8D3&cb=262.9437.185&newUi=true&jb=25.0.3b508.16\n"


class FakeProcess:
    def __init__(self, output: str):
        self.stdout = io.StringIO(output)


class WaitForJoinLinkTest(unittest.TestCase):
    def test_returns_link_with_loopback_host_and_port(self):
        backend = FakeProcess("Hostname is not provided\n" + JOIN_LINE + "Http link: https://example\n")
        link, port = launcher.wait_for_join_link(backend)
        self.assertEqual(link, "tcp://127.0.0.1:5990#jt=6a1b&p=IU&fp=D8D3&cb=262.9437.185&newUi=true&jb=25.0.3b508.16")
        self.assertEqual(port, 5990)

    def test_exits_with_output_tail_when_backend_ends_without_link(self):
        backend = FakeProcess("".join(f"line {i}\n" for i in range(launcher.FAILURE_TAIL_LINES + 5)))
        with mock.patch.object(sys, "stderr", io.StringIO()) as stderr, self.assertRaises(SystemExit):
            launcher.wait_for_join_link(backend)
        self.assertNotIn("line 4\n", stderr.getvalue())
        self.assertTrue(stderr.getvalue().endswith(f"line {launcher.FAILURE_TAIL_LINES + 4}\n"))


class ReadPidTest(unittest.TestCase):
    def test_skips_sbx_status_lines(self):
        self.assertEqual(launcher.read_pid(FakeProcess("  ✓ sandbox agent-lab — started\npid 327\n")), "327")

    def test_exits_when_no_pid_is_printed(self):
        with self.assertRaises(SystemExit):
            launcher.read_pid(FakeProcess("error\n"))


if __name__ == "__main__":
    unittest.main()
