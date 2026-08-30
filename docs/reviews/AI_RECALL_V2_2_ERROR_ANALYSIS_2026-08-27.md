# AI recall v2.2 error analysis — 2026-08-27

## Purpose and isolation

This note records a read-only aggregate analysis of the existing forced NVIDIA
v2.2 end-to-end result. It is intended to select the next engineering question,
not to change runtime classification.

The source was `ai/eval/results-v2.2-nvidia-endtoend.json`. The analysis grouped
already-recorded metadata only; it did not display URLs or capture bodies, open
any page, refetch page/RDAP data, call a provider, submit a blockchain
transaction, or send a Discord message.

## Confirmed baseline

The forced NVIDIA `openai/gpt-oss-20b` v2.2 run processed 72/72 entries:

|  TP |  FP |  FN |  TN | Precision | Recall |    F1 |
| --: | --: | --: | --: | --------: | -----: | ----: |
|  20 |   1 |  16 |  35 |     95.2% |  55.6% | 70.2% |

All 16 strict false negatives were returned as `suspicious`; none was returned
as `legitimate`.

| False-negative evidence class             | Count |
| ----------------------------------------- | ----: |
| `dead` + `url_only` + `suspicious`        |     5 |
| `empty` + `url_only` + `suspicious`       |     2 |
| `empty` + `url_structural` + `suspicious` |     2 |
| `ok` + `combined` + `suspicious`          |     4 |
| `refused` + `url_only` + `suspicious`     |     3 |

The one strict false positive was an `empty` + `url_only` case returned as
`malicious`. One additional legitimate entry was returned as `suspicious`.

## Interpretation

1. The largest deficit is uncertainty in low-evidence paths: 10 of 16 false
   negatives are `url_only` and 12 of 16 have no usable page text.
2. The issue is not confined to missing captures: four false negatives remain
   in `combined` mode, so URL-only threshold changes cannot be treated as a
   complete solution.
3. Reclassifying every `suspicious` verdict as `malicious` would violate the
   production safety model and improperly use an evaluation finding as a
   runtime rule. It must not be done.
4. The more prescriptive v2.3 prompt-only trial reduced recall to 36.1%; broad
   prompt strengthening is therefore rejected as the next intervention.

## Next evidence gate

The next candidate change should be an explicit, typed calibration policy for
non-text evidence. It must be independent of labels and URLs in the frozen
final dataset, retain the `verdict === "malicious"` publication condition, and
be tested first with synthetic cases. A candidate may only be measured by a new
forced full frozen-cache run after its policy and acceptance criteria are
written down.

Existing v2.2 result artifacts do not include a per-record URL-feature summary,
so this analysis cannot responsibly infer feature-level cutoffs from them.
Future evaluator output now preserves a domain-free feature summary and
provenance metadata while omitting raw URLs, page content, and free-text model
output. That enables the next aggregate analysis without exposing sensitive
inputs.
