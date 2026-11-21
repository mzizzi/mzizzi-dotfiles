from contextlib import contextmanager, suppress
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import subprocess
import termios


@contextmanager
def terminal_process(command, *, env, cwd=None, grace_period=0):
    master, slave = pty.openpty()
    try:
        try:
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
            process = subprocess.Popen(
                command, cwd=cwd, env=env, stdin=slave, stdout=slave, stderr=slave,
                start_new_session=True,
            )
        finally:
            os.close(slave)
        with process:
            try:
                yield process, master
            finally:
                if process.poll() is None and grace_period:
                    with suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGTERM)
                    with suppress(subprocess.TimeoutExpired):
                        process.wait(grace_period)
                if process.poll() is None:
                    with suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGKILL)
    finally:
        os.close(master)


def read_terminal(master, timeout):
    if not select.select([master], [], [], timeout)[0]:
        return None
    try:
        return os.read(master, 65536)
    except OSError as error:
        if error.errno != errno.EIO:
            raise
        return b""
