"""AI stylisation of the painted tiles with ComfyUI (SD1.5 img2img + depth & lineart ControlNets).

The painted tile is the img2img base (low denoise), so colours and layout stay authoritative; the depth
and line passes pin geometry, roads and rivers. Every tile uses the same seed and prompt. Tiles overlap and
are feather-blended when mosaicked, which is what hides the seams.

ComfyUI is reached over HTTP at COMFY_URL (default: local ComfyUI on 127.0.0.1:8188).
"""
import io
import os
import time
import uuid

import httpx
import numpy as np
from PIL import Image

PROMPT = ("hand-painted illustrated miniature map, oblique diorama view, soft watercolor and gouache, warm earthy "
          "palette, snow-capped mountains, green valley, clean ink outlines, storybook cartography, highly detailed")
NEGATIVE = "photo, text, watermark, signature, blurry, lowres, distorted, people, modern buildings, oversaturated"
SEASON_PROMPT = {
    "summer": "summer, green irrigated fields and poplars in the valley",
    "spring": "spring, pink and white apricot and cherry blossom in the valley orchards, fresh green fields, "
              "late snow on the high slopes",
    "autumn": "autumn, golden yellow poplars and orange red orchards in the valley, dry grass, first snow on the peaks",
    "winter": "winter, deep snow covering the valleys and slopes, frozen lakes, bare trees",
}


def prompt(season: str = "summer") -> str:
    return f"{PROMPT}, {SEASON_PROMPT[season]}"
CKPT = "v1-5-pruned-emaonly.safetensors"
CN_DEPTH = "control_v11f1p_sd15_depth.pth"
CN_LINE = "control_v11p_sd15_lineart.pth"


def comfy_url() -> str:
    return os.environ.get("COMFY_URL", "http://127.0.0.1:8188").rstrip("/")


def build_workflow(base: str, depth: str, line: str, seed: int = 7, denoise: float = 0.55, steps: int = 24,
                   cfg: float = 6.5, depth_strength: float = 0.6, line_strength: float = 0.9,
                   prefix: str = "tinyatlas", text: str = PROMPT) -> dict:
    """ComfyUI API-format graph. `base`, `depth`, `line` are filenames already uploaded to ComfyUI's input dir."""
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": text, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": ["1", 1]}},
        "4": {"class_type": "LoadImage", "inputs": {"image": base}},
        "5": {"class_type": "LoadImage", "inputs": {"image": depth}},
        "6": {"class_type": "LoadImage", "inputs": {"image": line}},
        "7": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": CN_DEPTH}},
        "8": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": CN_LINE}},
        "9": {"class_type": "ControlNetApplyAdvanced", "inputs": {
            "positive": ["2", 0], "negative": ["3", 0], "control_net": ["7", 0], "image": ["5", 0],
            "strength": depth_strength, "start_percent": 0.0, "end_percent": 0.8, "vae": ["1", 2]}},
        "10": {"class_type": "ControlNetApplyAdvanced", "inputs": {
            "positive": ["9", 0], "negative": ["9", 1], "control_net": ["8", 0], "image": ["6", 0],
            "strength": line_strength, "start_percent": 0.0, "end_percent": 0.8, "vae": ["1", 2]}},
        "11": {"class_type": "VAEEncode", "inputs": {"pixels": ["4", 0], "vae": ["1", 2]}},
        "12": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["10", 0], "negative": ["10", 1], "latent_image": ["11", 0],
            "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "dpmpp_2m", "scheduler": "karras",
            "denoise": denoise}},
        "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["1", 2]}},
        "14": {"class_type": "SaveImage", "inputs": {"images": ["13", 0], "filename_prefix": prefix}},
    }


XL_CKPT = "RealVisXL_V5.0_fp16.safetensors"
XL_CN_DEPTH = "controlnet-depth-sdxl-1.0.safetensors"


def depth_painting_workflow(depth: str, text: str, negative: str = NEGATIVE, seed: int = 11, width: int = 1216,
                            height: int = 832, strength: float = 0.75, steps: int = 30, cfg: float = 5.5,
                            prefix: str = "tinyatlas_view", ckpt: str = XL_CKPT, cn: str = XL_CN_DEPTH,
                            init: str | None = None, denoise: float = 0.9) -> dict:
    """txt2img pinned by a depth image (a filename already uploaded to ComfyUI): the picture follows the real
    skyline, the prompt decides season, light and style. SDXL by default. With `init` (an uploaded colour picture)
    it starts from that instead of noise, so mapped features like lakes land where they really are."""
    latent = {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}}
    if init:
        latent = {"class_type": "VAEEncode", "inputs": {"pixels": ["15", 0], "vae": ["1", 2]}}
    wf = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": text, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["1", 1]}},
        "5": {"class_type": "LoadImage", "inputs": {"image": depth}},
        "7": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": cn}},
        "9": {"class_type": "ControlNetApplyAdvanced", "inputs": {
            "positive": ["2", 0], "negative": ["3", 0], "control_net": ["7", 0], "image": ["5", 0],
            "strength": strength, "start_percent": 0.0, "end_percent": 0.9, "vae": ["1", 2]}},
        "11": latent,
        "12": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["9", 0], "negative": ["9", 1], "latent_image": ["11", 0],
            "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "dpmpp_2m", "scheduler": "karras",
            "denoise": denoise if init else 1.0}},
        "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["1", 2]}},
        "14": {"class_type": "SaveImage", "inputs": {"images": ["13", 0], "filename_prefix": prefix}},
    }
    if init:
        wf["15"] = {"class_type": "LoadImage", "inputs": {"image": init}}
    return wf


def img2img_workflow(image: str, text: str, negative: str = NEGATIVE, denoise: float = 0.72, seed: int = 5,
                     steps: int = 30, cfg: float = 6.0, prefix: str = "tinyatlas_img", ckpt: str = XL_CKPT) -> dict:
    """SDXL img2img from an uploaded picture (used to redraw a landmark photo as a clean scale model)."""
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": text, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["1", 1]}},
        "4": {"class_type": "LoadImage", "inputs": {"image": image}},
        "5": {"class_type": "ImageScale", "inputs": {"image": ["4", 0], "upscale_method": "lanczos", "width": 1024,
                                                      "height": 1024, "crop": "center"}},
        "11": {"class_type": "VAEEncode", "inputs": {"pixels": ["5", 0], "vae": ["1", 2]}},
        "12": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["11", 0],
            "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": denoise}},
        "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["1", 2]}},
        "14": {"class_type": "SaveImage", "inputs": {"images": ["13", 0], "filename_prefix": prefix}},
    }


def _png(img: Image.Image) -> bytes:
    b = io.BytesIO()
    img.save(b, format="PNG")
    return b.getvalue()


def upload(img: Image.Image, name: str, client: httpx.Client) -> str:
    r = client.post(f"{comfy_url()}/upload/image", files={"image": (name, _png(img), "image/png")},
                    data={"overwrite": "true"}, timeout=120)
    r.raise_for_status()
    return r.json()["name"]


def run(workflow: dict, client: httpx.Client, timeout_s: int = 600) -> Image.Image:
    r = client.post(f"{comfy_url()}/prompt", json={"prompt": workflow, "client_id": uuid.uuid4().hex}, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"ComfyUI rejected the workflow: {r.text[:800]}")
    pid = r.json()["prompt_id"]
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        h = client.get(f"{comfy_url()}/history/{pid}", timeout=60).json().get(pid)
        if h and h.get("status", {}).get("status_str") == "error":
            raise RuntimeError(f"ComfyUI run failed: {h['status']}")
        if h and h.get("outputs"):
            im = next(iter(h["outputs"].values()))["images"][0]
            v = client.get(f"{comfy_url()}/view", params={"filename": im["filename"], "subfolder": im["subfolder"],
                                                         "type": im["type"]}, timeout=120)
            v.raise_for_status()
            return Image.open(io.BytesIO(v.content)).convert("RGB")
        time.sleep(2)
    raise TimeoutError(f"ComfyUI job {pid} did not finish in {timeout_s}s")


def _ramp(n: int, lo: int, hi: int) -> np.ndarray:
    """1-D weights of length n: rise 0->1 over the first `lo` px, fall 1->0 over the last `hi` px.
    A tile's falling ramp and its neighbour's rising ramp over the same pixels sum to exactly 1."""
    w = np.ones(n)
    if lo:
        w[:lo] = (np.arange(lo) + 0.5) / lo
    if hi:
        w[n - hi:] = np.minimum(w[n - hi:], (hi - np.arange(hi) - 0.5) / hi)
    return w


def blend_mosaic(placements, size: tuple[int, int]) -> Image.Image:
    """Feather-blend overlapping tiles into one image.

    placements: iterable of (PIL image, (x0, y0, x1, y1) canvas rect, (left, top, right, bottom) ramp widths in px
    where a tile borders a neighbour; 0 on region edges). Weights of overlapping tiles sum to 1 in the overlap.
    """
    W, H = size
    acc = np.zeros((H, W, 3))
    wsum = np.zeros((H, W, 1))
    for img, (x0, y0, x1, y1), (rl, rt, rr, rb) in placements:
        w, h = x1 - x0, y1 - y0
        a = np.asarray(img.convert("RGB").resize((w, h), Image.LANCZOS), dtype=np.float64)
        wt = (_ramp(h, rt, rb)[:, None] * _ramp(w, rl, rr)[None, :])[..., None]
        cx0, cy0, cx1, cy1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
        sl = (slice(cy0 - y0, cy1 - y0), slice(cx0 - x0, cx1 - x0))
        acc[cy0:cy1, cx0:cx1] += a[sl] * wt[sl]
        wsum[cy0:cy1, cx0:cx1] += wt[sl]
    return Image.fromarray(np.clip(acc / np.maximum(wsum, 1e-9), 0, 255).astype(np.uint8), "RGB")


WATER_RGB = np.array([74, 144, 196], dtype=np.float64)


def restore_water(styled: Image.Image, mask: Image.Image, amount: float = 0.8) -> Image.Image:
    """Paint OSM water back over a styled tile. The diffusion pass washes out thin streams, but where water
    is stays authoritative, so blend the water colour in wherever the (soft) mask says so."""
    a = np.asarray(styled.convert("RGB"), dtype=np.float64)
    m = np.asarray(mask.convert("L").resize(styled.size), dtype=np.float64)[..., None] / 255.0 * amount
    return Image.fromarray(np.clip(a * (1 - m) + WATER_RGB * m, 0, 255).astype(np.uint8), "RGB")
