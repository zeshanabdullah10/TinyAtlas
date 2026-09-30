"""Runs ON THE POD (in /workspace/tts): voice every <slug>.<lang>.txt in a folder into <slug>.<lang>.wav.

    /workspace/tts/bin/python tts_worker.py /workspace/audio_job

English and Mandarin use Kokoro-82M; Urdu uses Meta's MMS-TTS Urdu (Arabic script) model.
"""
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

job = Path(sys.argv[1])
todo = sorted(p for p in job.glob("*.txt") if not p.with_suffix(".wav").exists())
by_lang = {}
for p in todo:
    by_lang.setdefault(p.stem.rsplit(".", 1)[1], []).append(p)

if by_lang.get("en") or by_lang.get("zh"):
    from kokoro import KPipeline
    for lang, code, voice in (("en", "b", "bf_emma"), ("zh", "z", "zf_xiaoxiao")):
        if not by_lang.get(lang):
            continue
        pipe = KPipeline(lang_code=code)
        for p in by_lang[lang]:
            text = p.read_text(encoding="utf-8")
            # Kokoro only splits non-English text at newlines and cuts each piece at ~510 phonemes: one sentence a line
            text = re.sub(r"([。！？；])\s*", "\\1\n", text) if lang == "zh" else re.sub(r"(?<=[.!?])\s+", "\n", text)
            parts = [audio for _, _, audio in pipe(text, voice=voice, speed=0.95)]
            gap = np.zeros(int(24000 * 0.25), dtype=np.float32)
            wav = np.concatenate([np.concatenate([np.asarray(a, dtype=np.float32), gap]) for a in parts])
            sf.write(p.with_suffix(".wav"), wav, 24000)
            print("voiced", p.name, flush=True)

if by_lang.get("ur"):
    import torch
    from transformers import AutoTokenizer, VitsModel
    name = "facebook/mms-tts-urd-script_arabic"
    tok, model = AutoTokenizer.from_pretrained(name), VitsModel.from_pretrained(name).to("cuda")
    for p in by_lang["ur"]:
        sentences = [s.strip() for s in re.split(r"(?<=[۔؟!.])\s+", p.read_text(encoding="utf-8")) if s.strip()]
        chunks = []
        for s in sentences:
            with torch.no_grad():
                out = model(**tok(s, return_tensors="pt").to("cuda")).waveform[0].cpu().numpy()
            chunks += [out, np.zeros(int(model.config.sampling_rate * 0.3), dtype=np.float32)]
        sf.write(p.with_suffix(".wav"), np.concatenate(chunks), model.config.sampling_rate)
        print("voiced", p.name, flush=True)
print("DONE", flush=True)
