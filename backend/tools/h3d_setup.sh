#!/bin/sh
# Runs ON THE POD once: Hunyuan3D-2 (shape generation only) in its own environment, for landmark models.
#   setsid nohup sh /workspace/h3d_setup.sh > /workspace/h3d_install.log 2>&1 < /dev/null &
set -e
cd /workspace
[ -d Hunyuan3D-2 ] || git clone -q https://github.com/Tencent/Hunyuan3D-2.git
python3 -m venv /workspace/h3d
/workspace/h3d/bin/pip install -q --upgrade pip
/workspace/h3d/bin/pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cu128
cd Hunyuan3D-2
/workspace/h3d/bin/pip install -q -r requirements.txt
/workspace/h3d/bin/pip install -q -e .
/workspace/h3d/bin/pip install -q rembg onnxruntime trimesh fast-simplification
# transformers 5 renamed DINOv2's weights, which Hunyuan3D-2's checkpoint was saved with
/workspace/h3d/bin/pip install -q 'transformers==4.49.0'
/workspace/h3d/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('tencent/Hunyuan3D-2', allow_patterns=['hunyuan3d-dit-v2-0/*'])"
echo DONE > /workspace/h3d.done
