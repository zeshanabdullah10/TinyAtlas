---
name: delegate-and-judge
description: How to run Tiny Atlas work as architect + reviewer — write precise subagent prompts, steer them in rounds, and judge outputs against data and images instead of trusting self-reports. Use whenever a task will be delegated to subagents (Agent tool), whenever reviewing a subagent's result, or when starting a session on this repo.
---

# Delegate and judge

Learned over the Swat Atlas build (Oct 2026: about 40 subagent runs across data, Blender, three.js, 3D, TTS and release
work). The owner's standing preference: **the lead agent designs, specs and judges; Sonnet subagents implement.**
Read `docs/HANDOFF.md` first. It holds the facts, and this skill holds the method.

## 1. Before delegating
- **Write the contract first** when two or more agents will touch the same interface (example: `docs/atlas-pack-v1.md`
  existed before the pack builder and the renderer started in parallel). Settle conventions that cause silent errors
  up front: pixel-centred vs corner grids, sign of angles, units, scene axes.
- **Read just enough code to be exact.** Grep for constants, function names and line numbers; a prompt that says
  "build_scene.py ~352–382, the Wave texture drives colour and bump" fixes in one round what "rock looks stripy" takes
  three to fix.
- **Assign file ownership.** List the files each agent may edit and the files another agent owns right now. Collisions
  happened every time this was skipped.
- **Decide what you will check** before the agent starts. If you can't name the measurement, the spec isn't ready.

## 2. The prompt template (worked every time)
```
Be efficient and concise. <OS/shell/Python/Blender path/GPU>. Repo <path>, branch <b>. Do NOT commit.
Don't touch <files owned by others>.
CONTEXT: what exists, where; READ FIRST: <contract/doc/modules>; reference images: <paths>.
GOAL (one sentence) + the principle that constrains it ("never move geometry", "only CC BY/CC0").
INPUTS: exact paths + schemas.
STEPS: numbered, with numbers — thresholds, colours, angles, budgets ("sun 9–11°, azimuth 210–220°", not "warmer").
VERIFY: measurable checks to run AND report (sampled RGB, counts, hashes, WER, pytest), plus
        "VIEW the image yourself (Read shows images) next to <reference>".
BUDGET: max N previews/iterations; time-box risky installs (e.g. 25–45 min), with a named fallback.
REPLY: ≤N words — paths, numbers, and candid gaps.
```
Rules: run independent agents in parallel, in the background; sequence dependent ones. Ask agents to **stop and
report** before an expensive or taste-dependent step (the TTS bake-off stopped for the owner to pick a voice by ear).

## 3. Steering in rounds
- Send follow-ups to the **same agent** (SendMessage keeps its context): "Round N", fixes in priority order, each with
  *symptom → likely cause → measurable target*.
- If your own earlier spec caused the problem, say so in the message (the wave-strata bands were requested by the lead).
- **Rate-limited or interrupted agent:** "check the current state of <files> so you don't double-apply; continue
  from where you stopped".
- **Two agents edited one file:** tell the owner of that file to re-read it, and say which spec wins.
- **An agent hand-edited generated data** (e.g. area cameras in `meta.json`): port it back into the generator at once,
  rebuild, and prove the output is identical.
- **Stop polishing** after 2–3 rounds that don't converge on a detail invisible at product scale; log the exact fix
  and move on (Shingardar's grass cap; the SDXL paint-over).
- An agent refusing an unsafe shortcut (spoofing a browser User-Agent to beat a 403) is right: hand it the compliant
  fix (contact URL in the UA).

## 4. Judging — never forward a self-report
1. **Look.** Open every output image yourself (downscale to ~1536 px first). If the agent says "didn't view it", that
   is the image to open first; twice it hid a broken result (White Palace gorge shot, home view).
2. **Compare** side by side with the approved bar (HANDOFF §5.2) and the previous round.
3. **Measure, don't eyeball:** sample RGB, recompute areas, sample the DEM for disputed heights, count instances, check
   hashes, re-run the ASR yourself. Agents' numbers were wrong or "estimated from the preview" several times.
4. **Verify against the world,** not the summary: wrong Wikidata coordinates, a misplaced town node (Kalam 606 m off
   its built-up centre), a lake far smaller than a guess, a planner time at 27 km/h on a jeep track. Check claims
   against a second source.
5. **Regressions:** tests, the other pack, the phone layout, a rebuild-identity check after pipeline changes.
6. **Before committing:** read the diff of server/planner/service-worker code; grep for secrets; stage only the files
   the finished work owns; test the staged snapshot in isolation (`git checkout-index` to a temp dir + junction to
   `data/`, then pytest + smoke) when other agents have uncommitted work in the tree.

### Red flags → send it back
"Looks good" without viewing · a global colour regrade to fix a local problem · an invented coordinate, height,
fact or route segment · a hidden place shown as visible, or a tier-1 place silently dropped · generated files edited
by hand · times or distances that contradict a cited source · anything that spends money or publishes without the
owner's go-ahead.

### Quality-gate lessons (apply to any automated check)
- A loose gate passes real errors: fuzzy word matching let "5,918" read as "908" through. Add **strict checks for the
  facts that matter** (numbers must be heard exactly) and keep fuzzy matching for names.
- A strict gate flags noise: most TTS "failures" were Whisper misspelling local names. **Diff the flagged items
  yourself** before regenerating or accepting.
- Fix errors at the source (spell numbers out before voicing) rather than retrying until a seed happens to pass.

## 5. Owner-facing conduct
- Before anything billable or public (RunPod, push, release, deploy), state the price or effect and get a yes once per
  context. Terminate pods the moment a batch ends; only touch resources you created.
- Report in plain words: what was verified, what wasn't, what's next. Don't claim what you didn't check.
- Pull before push: another session may have committed (here it switched the checkout to `main`, pushed v2.2, and
  the remote renamed itself). `git fetch`, check `git branch --show-current` and `HEAD..origin/main` first.

## 6. Token economy (the owner hit usage limits)
- **One task per session.** Start fresh with "Read docs/HANDOFF.md, then …"; `/compact` early; `/clear` between
  unrelated tasks. A 3-day session reached ~580k tokens re-read per turn (1.3 B cache reads).
- **Keep images and heavy outputs inside subagents**, whose contexts are discarded; ask them for text and numbers. Open
  images in the main session only for final judgement, downscaled.
- Read files with offset/limit; prefer grep for constants; don't re-read files you just edited.
- Don't switch model or effort mid-session (it breaks the cache). Disable unused MCP servers in `/mcp`.
