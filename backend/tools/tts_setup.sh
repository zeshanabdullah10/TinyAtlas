#!/bin/sh
# Runs ON THE POD once: a separate Python environment for the audio guide voices (kept apart from ComfyUI's).
#   nohup sh /workspace/tts_setup.sh > /workspace/tts_install.log 2>&1 &
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq espeak-ng > /dev/null
python3 -m venv /workspace/tts
/workspace/tts/bin/pip install -q --upgrade pip
/workspace/tts/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cu128
/workspace/tts/bin/pip install -q kokoro soundfile "misaki[zh]" transformers accelerate sentencepiece
echo DONE > /workspace/tts.done
