"""Run a shell command on a RunPod pod through its Jupyter terminal API and print the output.

    POD_ID=... POD_JUPYTER_TOKEN=... python backend/tools/pod_run.py "nvidia-smi"

Reads the token from the environment so it never appears in argv or shell history.
Exit status is the remote command's.
"""
import json
import os
import re
import sys
import uuid

import httpx
from websocket import create_connection

pod, token = os.environ["POD_ID"], os.environ["POD_JUPYTER_TOKEN"]
host = f"{pod}-8888.proxy.runpod.net"
auth = {"Authorization": f"token {token}"}
cmd = sys.argv[1]
ANSI = re.compile("\x1b\\[[?0-9;]*[a-zA-Z]")

term = httpx.post(f"https://{host}/api/terminals", headers=auth, timeout=30).json()["name"]
ws = create_connection(f"wss://{host}/terminals/websocket/{term}?token={token}", timeout=180)
mark = f"__DONE_{uuid.uuid4().hex[:8]}__"
# The typed line is echoed back with a literal "$?"; only the real output has the marker followed by digits.
ws.send(json.dumps(["stdin", f"{cmd}\necho {mark}$?\n"]))
buf, done = "", None
while not done:
    kind, *data = json.loads(ws.recv())
    if kind == "stdout":
        buf += data[0]
        done = re.search(rf"{mark}(\d+)", buf)
ws.close()
httpx.delete(f"https://{host}/api/terminals/{term}", headers=auth, timeout=30)

# buf = prompt+echoed cmd, cmd output, prompt+echoed marker command, marker+status
pre = buf.split(f"echo {mark}$?")[0]
pre = ANSI.sub("", pre).replace("\r", "")
lines = pre.split("\n")
print("\n".join(lines[1:-1]).strip())      # drop the echoed command line and the trailing prompt
sys.exit(int(done.group(1)))
