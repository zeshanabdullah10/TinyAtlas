"""A few shared slots for heavy local jobs (diorama builds, headless renders), so parallel workers on one machine
take turns instead of running out of memory: `with slot("render", 2): ...` waits until one of 2 slots is free."""
import fcntl
import os
import time
from contextlib import contextmanager
from pathlib import Path

LOCKS = Path(__file__).resolve().parents[2] / "data" / "cache" / "locks"


@contextmanager
def slot(kind, n):
    if os.environ.get("TINYATLAS_NO_SLOTS"):
        yield; return
    LOCKS.mkdir(parents=True, exist_ok=True)
    while True:
        for i in range(n):
            f = open(LOCKS / f"{kind}.{i}", "w")
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                f.close(); continue
            try:
                yield
            finally:
                fcntl.flock(f, fcntl.LOCK_UN); f.close()
            return
        time.sleep(2)
