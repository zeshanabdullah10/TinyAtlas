"""Make the offline English audio guide for Atlas regions, entirely on this machine.

    .venv-tts/Scripts/python backend/tools/audio_local.py swat swat-lower
    .venv-tts/Scripts/python backend/tools/audio_local.py swat --scripts-only

1. Scripts: narration.ensure() writes data/audio/<region>/<slug>.en.txt from the place's sourced facts (OpenRouter).
2. Voice: Chatterbox (Resemble AI, MIT), default voice, one sentence at a time, 250 ms between sentences (500 ms
   between paragraphs), loudness-normalised to -16 LUFS, AAC mono 48 kb/s at data/audio/<region>/<slug>.en.m4a.
3. Quality gate: every sentence is transcribed with faster-whisper small.en. A sentence that misses more than 30% of
   its words, or has a silence over 1.5 s, is regenerated with a new seed (3 tries); the whole clip must reach a WER
   of 0.15 or less (names the recogniser cannot spell count as errors, so the bar is loose). Results go to
   data/audio/<region>/quality.json; clips that still fail are listed.
4. Index: data/audio/<region>/audio.json = {slug: {"en": {file, seconds, text}}}, read by /api/audio and listen.js.

Existing clips are kept. Needs ffmpeg/ffprobe on PATH; the TTS libraries live in .venv-tts (see README).
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("HF_HOME", "D:/TinyAtlas/.hf_cache")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tinyatlas import api, atlaspack, narration  # noqa: E402

WER_MAX, MISS_MAX, SILENCE_MAX, TRIES, LUFS = 0.15, 0.30, 1.5, 3, -16.0
SR = 24000


def sentences(text: str) -> list[list[str]]:
    """Paragraphs of sentences; no split after a single capital and a dot (W.K.A. Berry)."""
    return [[x for x in re.split(r"(?<![A-Z]\.)(?<=[.!?])\s+", para.strip()) if x]
            for para in re.split(r"\n\s*\n", text.strip()) if para.strip()]


NUM = re.compile(r"\d[\d,]*")
UNIT_AFTER = re.compile(r"\s*(?:m|km|metres|meters|kilometres|kilometers|feet|ft|people|years)\b", re.I)


def _year(n: int) -> str:
    """1957 -> nineteen fifty-seven, 1900 -> nineteen hundred, 1905 -> nineteen oh five, 2007 -> two thousand and seven."""
    from num2words import num2words as w
    if 2000 <= n <= 2009:
        return "two thousand" + (f" and {w(n - 2000)}" if n > 2000 else "")
    hi, lo = divmod(n, 100)
    return f"{w(hi)} hundred" if lo == 0 else f"{w(hi)} oh {w(lo)}" if lo < 10 else f"{w(hi)} {w(lo)}"


def _say_number(m: re.Match, text: str) -> str:
    """A number as it should be spoken: 1957 -> nineteen fifty-seven (a year), 5,918 -> five thousand nine hundred and
    eighteen. A plain four-digit 1000-2099 is a year unless a unit follows it."""
    from num2words import num2words
    raw = m.group(0).rstrip(","); n = int(raw.replace(",", ""))
    year = "," not in raw and len(raw) == 4 and 1000 <= n <= 2099 and not UNIT_AFTER.match(text, m.end())
    return (_year(n) if year else num2words(n)).replace(",", "") + ("," if m.group(0).endswith(",") else "")


ROMAN = {"I": "One", "II": "Two", "III": "Three", "IV": "Four"}


def speakable(t: str) -> str:
    """Text for the voice: numbers spelled out so the model cannot misread digits (2nd -> second, 5,918 -> five
    thousand ...), and site numerals read as words (Butkara I -> Butkara One). The display text stays as written."""
    from num2words import num2words
    t = re.sub(r"\b(Butkara|Shahi|Swat|Sharif) (IV|III|II|I)\b", lambda m: f"{m.group(1)} {ROMAN[m.group(2)]}", t)
    t = re.sub(r"\b(\d+)(st|nd|rd|th)\b", lambda m: num2words(int(m.group(1)), to="ordinal"), t)
    return NUM.sub(lambda m: _say_number(m, t), t)


def numbers(t: str) -> list[int]:
    return [int(x.replace(",", "")) for x in NUM.findall(t) if x.strip(",")]


def numbers_heard(sentence: str, heard: str) -> bool:
    """Every number in the sentence must come back: as digits in the transcript, or spelled out in it."""
    want = numbers(sentence)
    if not want:
        return True
    got = set(numbers(heard)); words = " ".join(norm(heard))
    return all(n in got or " ".join(norm(_say_number(re.match(r".*", str(n)), str(n)))) in words
               or " ".join(norm(str(n))) in words for n in want)


def norm(t: str) -> list[str]:
    t = t.lower().replace("-", " ").replace("metres", "meters").replace("kilometres", "kilometers")
    t = speakable(t)
    return re.sub(r"[^a-z' ]", " ", t.replace("-", " ")).split()


def missing(ref: list[str], hyp: list[str]) -> float:
    """Share of reference words with no similar word (ratio >= 0.6) anywhere in the transcript."""
    if not ref:
        return 0.0
    return sum(not any(difflib.SequenceMatcher(None, w, h).ratio() >= 0.6 for h in hyp) for w in ref) / len(ref)


def longest_silence(x, thr=0.004) -> float:
    import numpy as np
    quiet = np.abs(x) < thr
    best = run = 0
    for q in quiet[::240]:                      # 10 ms steps
        run = run + 1 if q else 0
        best = max(best, run)
    return best * 0.01


class Voice:
    def __init__(self):
        import torch
        self.torch = torch
        lib = str(Path(torch.__file__).parent / "lib")     # faster-whisper's CTranslate2 wants torch's CUDA 12 DLLs
        os.add_dll_directory(lib)
        os.environ["PATH"] = lib + os.pathsep + os.environ["PATH"]
        from chatterbox.tts import ChatterboxTTS
        from faster_whisper import WhisperModel
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.tts = ChatterboxTTS.from_pretrained(self.device)
        self.asr = WhisperModel("small.en", device=self.device, compute_type="int8_float16" if self.device == "cuda" else "int8")
        print(f"Chatterbox + whisper small.en on {self.device}", flush=True)

    def say(self, sentence: str, seed: int):
        import numpy as np
        self.torch.manual_seed(seed)
        return self.tts.generate(speakable(sentence)).squeeze().cpu().numpy().astype(np.float32)

    def hear(self, wav) -> str:
        import librosa
        segs, _ = self.asr.transcribe(librosa.resample(wav, orig_sr=SR, target_sr=16000), language="en", beam_size=5)
        return " ".join(s.text for s in segs)


def voice_clip(v: Voice, text: str) -> tuple:
    """-> (wav, log). Per-sentence generate, check and retry; then pauses and loudness."""
    import jiwer
    import numpy as np
    import pyloudnorm as pyln
    flat = [(pi, s) for pi, para in enumerate(sentences(text)) for s in para]
    ref_all = " ".join(norm(" ".join(s for _, s in flat)))
    best = []                                   # per sentence: [miss, wav, heard, tries]

    def attempt(i, seed):
        wav = v.say(flat[i][1], seed)
        heard = v.hear(wav)
        bad = missing(norm(flat[i][1]), norm(heard))
        if not numbers_heard(flat[i][1], heard):
            bad = max(bad, 1.0)                 # a wrong number is never acceptable in a guide
        if longest_silence(wav) > SILENCE_MAX:
            bad = max(bad, 1.0)
        return [bad, wav, heard]

    for i in range(len(flat)):
        pick, tries = None, 0
        for t in range(TRIES):
            tries += 1
            cand = attempt(i, 1000 * t + i)
            if pick is None or cand[0] < pick[0]:
                pick = cand
            if cand[0] <= MISS_MAX:
                break
        best.append([*pick, tries])

    def wer():
        return jiwer.wer(ref_all, " ".join(norm(" ".join(b[2] for b in best))))

    extra = 0
    while wer() > WER_MAX and extra < TRIES * 2:         # the clip as a whole: redo its worst sentence
        i = max(range(len(best)), key=lambda k: best[k][0])
        if best[i][0] == 0:
            break
        cand = attempt(i, 7000 + 100 * extra + i)
        best[i][3] += 1
        extra += 1
        if cand[0] < best[i][0]:
            best[i][:3] = cand

    gap, para_gap = np.zeros(int(SR * 0.25), np.float32), np.zeros(int(SR * 0.5), np.float32)
    parts = []
    for k, (pi, _) in enumerate(flat):
        parts += [best[k][1], para_gap if k + 1 < len(flat) and flat[k + 1][0] != pi else gap]
    wav = np.concatenate(parts[:-1])
    meter = pyln.Meter(SR)
    wav = pyln.normalize.loudness(wav, meter.integrated_loudness(wav), LUFS)
    peak = float(np.abs(wav).max())
    if peak > 0.97:                                       # never clip: back off the level instead
        wav = wav * (0.97 / peak)
    log = {"wer": round(wer(), 3), "worst_sentence_miss": round(max(b[0] for b in best), 2), "sentences": len(best),
           "retries": sum(b[3] - 1 for b in best), "max_silence_s": round(longest_silence(wav), 2),
           "peak": round(float(np.abs(wav).max()), 3), "lufs": round(meter.integrated_loudness(wav), 1)}
    log["ok"] = log["wer"] <= WER_MAX and log["worst_sentence_miss"] <= MISS_MAX and log["max_silence_s"] <= SILENCE_MAX
    return wav, log


def seconds(p: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                         capture_output=True, text=True).stdout.strip()
    return round(float(out or 0), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("regions", nargs="+")
    ap.add_argument("--scripts-only", action="store_true")
    a = ap.parse_args()
    voice = None
    t_start = time.time()
    for region in a.regions:
        cfg = api._region(region)
        keep = {lm["slug"] for lm in cfg["landmarks"]}
        places = [p for p in atlaspack.places(cfg["atlas"]) if p["slug"] in keep]
        scripts = narration.ensure(region, places)
        print(f"{region}: scripts for {len(scripts)} places", flush=True)
        if a.scripts_only:
            continue
        folder = narration.ROOT / region
        qpath = folder / "quality.json"
        quality = json.loads(qpath.read_text()) if qpath.exists() else {}
        for slug in scripts:
            out = folder / f"{slug}.en.m4a"
            if out.exists():
                continue
            voice = voice or Voice()
            import soundfile as sf
            wav, log = voice_clip(voice, scripts[slug])
            quality[slug] = log
            with tempfile.TemporaryDirectory() as tmp:
                f = Path(tmp) / "clip.wav"
                sf.write(f, wav, SR)
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(f), "-ac", "1", "-c:a", "aac", "-b:a", "48k", str(out)], check=True)
            print("  ", out.name, log, flush=True)
            qpath.write_text(json.dumps(quality, indent=1), encoding="utf-8")
        index = {}
        for m in sorted(folder.glob("*.m4a")):
            slug, lang = m.stem.rsplit(".", 1)
            txt = narration.path(region, slug, lang)
            if slug in scripts and txt.exists():
                index.setdefault(slug, {})[lang] = {"file": m.name, "seconds": seconds(m), "text": txt.read_text(encoding="utf-8")}
        (folder / "audio.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{region}: audio.json with {len(index)} places; failing the gate: {[k for k, v in quality.items() if not v['ok']]}", flush=True)
    print(f"total {time.time() - t_start:.0f} s", flush=True)


main()
