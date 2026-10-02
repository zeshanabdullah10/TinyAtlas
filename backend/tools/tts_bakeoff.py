"""One-off TTS bake-off: Kokoro voices vs Chatterbox(-Turbo) on three stories; speed, VRAM and ASR word error rate.

    .venv-tts/Scripts/python backend/tools/tts_bakeoff.py tts      # writes data/audio/_bakeoff/*.wav + metrics.json
    .venv-tts/Scripts/python backend/tools/tts_bakeoff.py asr      # transcribes with faster-whisper small.en, adds WER
"""
import json
import os
import re
import sys
import time
from pathlib import Path

os.environ.update(TF_ENABLE_ONEDNN_OPTS="0", USE_TF="0")
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "audio" / "_bakeoff"
STORIES = {"mahodand-lake": "swat", "butkara-i-stupa": "swat-lower", "kalam": "swat"}


def text_of(slug):
    return (ROOT / "data" / "audio" / STORIES[slug] / f"{slug}.en.txt").read_text(encoding="utf-8").strip()


def sentences(t):
    return [s for s in re.split(r"(?<=[.!?])\s+", t) if s]


def tts():
    import numpy as np
    import soundfile as sf
    import torch
    metrics = json.loads((OUT / "metrics.json").read_text()) if (OUT / "metrics.json").exists() else {}

    def run(name, load, gen_fn, modes, sr):
        torch.cuda.empty_cache(); torch.cuda.reset_peak_memory_stats()
        t0 = time.time(); model = load(); load_s = time.time() - t0
        for mode in modes:
            for slug in STORIES:
                key = f"{name}_{mode}_{slug}" if mode else f"{name}_{slug}"
                torch.cuda.synchronize(); t0 = time.time()
                wav = gen_fn(model, text_of(slug), mode)
                torch.cuda.synchronize(); gen = time.time() - t0
                sf.write(OUT / f"{key}.wav", wav, sr)
                dur = len(wav) / sr
                metrics[key] = {"model": name, "slug": slug, "seconds": round(dur, 1), "gen_s": round(gen, 1), "rtf": round(gen / dur, 3),
                                "peak_vram_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2), "load_s": round(load_s, 1)}
                print(key, metrics[key], flush=True)
        del model; torch.cuda.empty_cache()
        (OUT / "metrics.json").write_text(json.dumps(metrics, indent=1))

    import espeakng_loader
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    EspeakWrapper.set_library(espeakng_loader.get_library_path())
    EspeakWrapper.data_path = espeakng_loader.get_data_path()
    from kokoro import KPipeline
    for voice, code in (("af_heart", "a"), ("bf_emma", "b"), ("am_michael", "a")):
        def gen(p, text, mode, voice=voice):
            parts = [np.asarray(a, dtype=np.float32) for _, _, a in p(text, voice=voice, speed=1.0)]
            gap = np.zeros(int(24000 * 0.25), dtype=np.float32)
            return np.concatenate([np.concatenate([a, gap]) for a in parts])
        run(f"kokoro_{voice}", lambda c=code: KPipeline(lang_code=c, device="cuda"), gen, [""], 24000)

    from chatterbox.tts import ChatterboxTTS
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    def cb(m, text, mode):
        chunks = [text] if mode == "full" else sentences(text)
        gap = np.zeros(int(m.sr * 0.25), dtype=np.float32)
        return np.concatenate([np.concatenate([m.generate(c).squeeze().cpu().numpy().astype(np.float32), gap]) for c in chunks])
    run("chatterbox-turbo_default", lambda: ChatterboxTurboTTS.from_pretrained("cuda"), cb, ["full", "sent"], 24000)
    run("chatterbox_default", lambda: ChatterboxTTS.from_pretrained("cuda"), cb, ["full", "sent"], 24000)


def norm(t):
    from num2words import num2words
    t = t.lower().replace("-", " ")
    t = re.sub(r"\d[\d,]*", lambda m: num2words(int(m.group(0).replace(",", ""))), t)
    t = re.sub(r"[^a-z' ]", " ", t.replace("’", "'"))
    return " ".join(t.split())


def load16k(p):
    import librosa
    import soundfile as sf
    x, sr = sf.read(p, dtype="float32")
    return librosa.resample(x, orig_sr=sr, target_sr=16000)


def asr():
    import torch
    os.add_dll_directory(str(Path(torch.__file__).parent / "lib"))
    os.environ["PATH"] = str(Path(torch.__file__).parent / "lib") + os.pathsep + os.environ["PATH"]
    import jiwer
    from faster_whisper import WhisperModel
    m = WhisperModel("small.en", device="cuda", compute_type="float16")
    metrics = json.loads((OUT / "metrics.json").read_text())
    for key, v in metrics.items():
        segs, _ = m.transcribe(load16k(OUT / f"{key}.wav"), language="en", beam_size=5)
        hyp = " ".join(s.text for s in segs)
        ref = norm(text_of(v["slug"]))
        o = jiwer.process_words(ref, norm(hyp))
        v.update(wer=round(o.wer, 3), subs=o.substitutions, dels=o.deletions, ins=o.insertions, heard=hyp.strip())
        print(key, v["wer"], o.deletions, o.insertions, flush=True)
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=1))


{"tts": tts, "asr": asr}[sys.argv[1]]()
