"""Make the offline audio guide for regions: scripts (OpenRouter), voices (RunPod), AAC files for phones.

    python backend/tools/audio.py hunza skardu            # scripts + voices + data/audio/<region>/audio.json
    python backend/tools/audio.py hunza --scripts-only

Needs POD_ID / POD_JUPYTER_TOKEN (env or .env) for a pod with /workspace/tts set up (see tts_worker.py), and
ffmpeg on PATH. Existing scripts and audio are kept.
"""
import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402

import pod_files  # noqa: E402
from tinyatlas import api, narration  # noqa: E402

JOB = "/workspace/audio_job"
HERE = Path(__file__).resolve().parent

ap = argparse.ArgumentParser()
ap.add_argument("regions", nargs="+")
ap.add_argument("--scripts-only", action="store_true")
a = ap.parse_args()


def pod(cmd: str) -> str:
    return subprocess.run([sys.executable, str(HERE / "pod_run.py"), cmd], capture_output=True, text=True).stdout


def seconds(p: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                         capture_output=True, text=True).stdout.strip()
    return round(float(out or 0), 1)


todo = []
for region in a.regions:
    scripts = narration.ensure(region, api.region_landmarks(region), api._chunks(region))
    print(f"{region}: scripts for {len(scripts)} landmarks", flush=True)
    for slug, texts in scripts.items():
        for lang in texts:
            if not (narration.ROOT / region / f"{slug}.{lang}.m4a").exists():
                todo.append((region, slug, lang))
if a.scripts_only or not todo:
    sys.exit(0)

print(f"voicing {len(todo)} clips on the pod", flush=True)
with httpx.Client() as client:
    pod_files.mkdir(JOB, client)
    pod_files.put(HERE / "tts_worker.py", f"{JOB}/tts_worker.py", client)
    for region, slug, lang in todo:
        pod_files.put(narration.path(region, slug, lang), f"{JOB}/{region}__{slug}.{lang}.txt", client)
pod(f"cd {JOB} && rm -f worker.log && setsid nohup /workspace/tts/bin/python tts_worker.py {JOB} > worker.log 2>&1 < /dev/null & disown")
while "DONE" not in (log := pod(f"tail -3 {JOB}/worker.log")):
    if "Error" in log or "Traceback" in log:
        print(pod(f"tail -40 {JOB}/worker.log")); sys.exit(1)
    time.sleep(20)

tmp = narration.ROOT / "_wav"
tmp.mkdir(parents=True, exist_ok=True)
with httpx.Client() as client:
    for region, slug, lang in todo:
        wav = tmp / f"{region}__{slug}.{lang}.wav"
        pod_files.get(f"{JOB}/{region}__{slug}.{lang}.wav", wav, client)
        out = narration.ROOT / region / f"{slug}.{lang}.m4a"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-c:a", "aac", "-b:a", "48k", str(out)], check=True)
        print("  ", out.name, flush=True)
shutil.rmtree(tmp)

for region in a.regions:
    index = {}
    for m in sorted((narration.ROOT / region).glob("*.m4a")):
        slug, lang = m.stem.rsplit(".", 1)
        index.setdefault(slug, {})[lang] = {"file": m.name, "seconds": seconds(m),
                                            "text": narration.path(region, slug, lang).read_text(encoding="utf-8")}
    (narration.ROOT / region / "audio.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{region}: audio.json with {len(index)} landmarks", flush=True)
