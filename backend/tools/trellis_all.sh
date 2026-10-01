#!/bin/sh
# One fresh worker process per (variant, seed): the baker leaks GPU memory across runs and the GPU is shared.
#   setsid nohup sh /workspace/trellis_all.sh "1 2 3" > /workspace/b3d_run.log 2>&1 < /dev/null &
cd /workspace
for s in $1; do for v in thal/A thal/B palace/A palace/B museum/A museum/B; do
  [ -f /workspace/b3d_job/${v%/*}/${v#*/}_s$s.glb ] || SEEDS=$s ONLY=$v /workspace/trellis/bin/python /workspace/trellis_worker.py /workspace/b3d_job 2>&1 | grep -a 'modelled\|OOM\|Error'
done; done
echo ALLDONE
