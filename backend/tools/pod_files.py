"""Copy files to and from a RunPod pod through its Jupyter contents API (POD_ID / POD_JUPYTER_TOKEN from the
environment or .env, as pod_run.py).

    python backend/tools/pod_files.py put local/file.txt /workspace/job/file.txt
    python backend/tools/pod_files.py get /workspace/job/out.wav local/out.wav
"""
import base64
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from tinyatlas.llm import _env  # noqa: E402


def _base() -> tuple[str, dict]:
    return f"https://{_env('POD_ID')}-8888.proxy.runpod.net/api/contents", {"Authorization": f"token {_env('POD_JUPYTER_TOKEN')}"}


def _rel(remote: str) -> str:
    """Jupyter's root is /workspace on RunPod images."""
    return remote.removeprefix("/workspace/").lstrip("/")


def put(local: Path, remote: str, client: httpx.Client | None = None) -> None:
    base, auth = _base()
    c = client or httpx
    r = c.put(f"{base}/{_rel(remote)}", headers=auth, timeout=120, json={
        "type": "file", "format": "base64", "content": base64.b64encode(Path(local).read_bytes()).decode()})
    r.raise_for_status()


def mkdir(remote: str, client: httpx.Client | None = None) -> None:
    base, auth = _base()
    (client or httpx).put(f"{base}/{_rel(remote)}", headers=auth, timeout=60, json={"type": "directory"})


def get(remote: str, local: Path, client: httpx.Client | None = None) -> None:
    base, auth = _base()
    r = (client or httpx).get(f"{base}/{_rel(remote)}", headers=auth, params={"format": "base64", "content": 1}, timeout=300)
    r.raise_for_status()
    Path(local).parent.mkdir(parents=True, exist_ok=True)
    Path(local).write_bytes(base64.b64decode(r.json()["content"]))


if __name__ == "__main__":
    op, a, b = sys.argv[1:4]
    put(Path(a), b) if op == "put" else get(a, Path(b))
