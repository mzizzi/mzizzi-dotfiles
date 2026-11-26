from pathlib import Path
import stat
import sys


RENDERER = Path(__file__).resolve().parent.parent
REPO = RENDERER.parent
sys.path.insert(0, str(RENDERER))


def snapshot_files(root, *, relative_to=None):
    base = root if relative_to is None else relative_to
    return {
        path.relative_to(base): (path.read_bytes(), stat.S_IMODE(path.stat().st_mode))
        for path in root.rglob("*") if path.is_file()
    }
