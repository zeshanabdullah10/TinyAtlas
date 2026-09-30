"""Tiny in-process job runner for region builds: one worker thread per job, progress polled over HTTP.

Only one build runs at a time (the free public services we use - Overpass, Nominatim - ask for that), so extra
jobs wait in a queue. State lives in memory; a restart forgets running jobs, and the built files stay on disk.
"""
import threading
import time
import traceback
import uuid

_LOCK = threading.Lock()          # serialises builds
JOBS: dict[str, "Job"] = {}
KEEP = 50


class Job:
    def __init__(self, steps: list[tuple[str, str]]):
        self.id = uuid.uuid4().hex[:12]
        self.steps = [{"key": k, "label": l, "state": "pending"} for k, l in steps]
        self.status = "queued"         # queued | running | done | error
        self.message = ""
        self.result: str | None = None  # region slug when done
        self.error: str | None = None
        self.created = time.time()

    def begin(self, key: str, message: str = "") -> None:
        for s in self.steps:
            if s["state"] == "active":
                s["state"] = "done"
            if s["key"] == key:
                s["state"] = "active"
        self.message = message

    def finish(self, slug: str) -> None:
        for s in self.steps:
            s["state"] = "done"
        self.status, self.result = "done", slug

    def fail(self, error: str) -> None:
        for s in self.steps:
            if s["state"] == "active":
                s["state"] = "error"
        self.status, self.error = "error", error

    def to_dict(self) -> dict:
        return {"id": self.id, "status": self.status, "steps": self.steps, "message": self.message,
                "result": self.result, "error": self.error}


def start(steps, work) -> Job:
    """Run work(job) on a background thread. `work` reports progress with job.begin(...) and returns the slug."""
    job = Job(steps)
    JOBS[job.id] = job
    for old in sorted(JOBS.values(), key=lambda j: j.created)[:-KEEP]:
        JOBS.pop(old.id, None)

    def run():
        with _LOCK:
            job.status = "running"
            try:
                job.finish(work(job))
            except Exception as exc:                       # surfaced to the UI, never swallowed
                traceback.print_exc()
                job.fail(f"{type(exc).__name__}: {exc}"[:300])

    threading.Thread(target=run, daemon=True, name=f"job-{job.id}").start()
    return job


def get(job_id: str) -> Job | None:
    return JOBS.get(job_id)
