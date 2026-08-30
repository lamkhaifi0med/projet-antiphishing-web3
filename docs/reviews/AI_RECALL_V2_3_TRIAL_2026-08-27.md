# AI recall v2.3 prompt trial — 2026-08-27

## Purpose

This document records a rejected prompt-only trial. It was run against the
existing frozen cache to test whether more prescriptive URL-only guidance could
improve the strict `malicious` recall of the configured NVIDIA fallback without
changing labels, score thresholds, or WF3 publication rules.

## Command and isolation

```text
NVIDIA_MODEL_FALLBACK=openai/gpt-oss-20b node ai/eval/evaluate.js --limit=36 --provider=nvidia --scope=end-to-end --delay-ms=500 --prompt-version=v2.3
```

- The evaluation verified the local frozen capture cache before running.
- Page captures and RDAP data were read locally; no page or RDAP refetch was
  performed.
- The NVIDIA provider was forced, so Gemini fallback was disabled.
- The trial prompt was reverted after the run. Production remains on the
  validated v2.2 prompt and `openai/gpt-oss-20b` fallback.

## Result

| Model                       | Processed | Provider errors |  TP |  FP |  FN |  TN | Precision | Recall |    F1 |
| --------------------------- | --------: | --------------: | --: | --: | --: | --: | --------: | -----: | ----: |
| NVIDIA `openai/gpt-oss-20b` |   71 / 72 |               1 |  13 |   0 |  23 |  35 |    100.0% |  36.1% | 53.1% |

Analysis modes among processed entries: 34 `combined`, 29 `url_only`, and 8
`url_structural`.

## Decision

The trial is **not adopted**. It reduced strict recall from the v2.2 NVIDIA
baseline (20/36, 55.6%) to 13/36 (36.1%) while also leaving one provider error.
It therefore cannot support the acceptance target and must not change runtime
classification or blockchain publication behavior.

The detailed artifacts are retained as
`ai/eval/report-v2.3-nvidia-endtoend.md` and
`ai/eval/results-v2.3-nvidia-endtoend.json`. They are evidence for this
specific rejected trial, not a production result.
