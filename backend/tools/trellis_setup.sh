#!/bin/sh
# Runs ON THE POD once: Microsoft TRELLIS (v1, image-large, MIT) mesh+texture path only, own venv.
#   setsid nohup sh /workspace/trellis_setup.sh > /workspace/trellis_install.log 2>&1 < /dev/null &
# Reuses the image's torch 2.10+cu130 (matches nvcc 13.0, so nvdiffrast compiles). Skips kaolin.
# diff-gaussian-rasterization is still needed: TRELLIS bakes the GLB texture by rendering the gaussians (to_glb).
set -e
cd /workspace
[ -d TRELLIS ] || git clone -q https://github.com/microsoft/TRELLIS.git
(cd TRELLIS && git submodule update -q --init trellis/representations/mesh/flexicubes)
python3 -m venv --system-site-packages /workspace/trellis
P=/workspace/trellis/bin/pip
$P install -q --upgrade pip
$P install -q pillow imageio imageio-ffmpeg tqdm easydict opencv-python-headless scipy ninja rembg onnxruntime trimesh xatlas pyvista pymeshfix igraph transformers==4.46.3 huggingface_hub fast-simplification
$P install -q git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8
$P install -q spconv-cu126
$P install -q xformers --no-deps || true
export TORCH_CUDA_ARCH_LIST=8.6
# the image ships nvcc without the cusparse/cublas/cusolver headers; torch pulled them in as pip packages
export CPATH=/usr/local/lib/python3.12/dist-packages/nvidia/cu13/include
$P install -q --no-build-isolation git+https://github.com/NVlabs/nvdiffrast.git
[ -d mip-splatting ] || git clone -q --recursive https://github.com/autonomousvision/mip-splatting.git
$P install -q --no-build-isolation mip-splatting/submodules/diff-gaussian-rasterization || echo GAUSSRAST_FAILED
/workspace/trellis/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('JeffreyXiang/TRELLIS-image-large')"
echo DONE > /workspace/trellis.done
