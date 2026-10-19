# Benchmarks on Tenki

Standard coding benchmarks, run on disposable [Tenki](https://tenki.cloud) sandboxes and graded with each benchmark's **official** harness — so the scores are comparable to everyone else's, not a lookalike.

These are heavier than the [`examples/`](../examples/): a benchmark pulls real evaluation images and runs real test suites. But they obey the same **one rule** — each ships a `verify.mjs` that proves the Tenki-facing pipeline against the live API in CI, using a mode that needs **no model key** (apply the gold/reference solution and confirm the grader agrees).

| Benchmark | What it measures | Verify (CI, no model) |
|---|---|---|
| [swe-bench](swe-bench/) | Fix a real GitHub issue so the repo's hidden tests pass (SWE-bench Lite / Verified / full) | Oracle one instance — gold patch must resolve |

*(More landing here — the SWE-bench family via `--dataset` (Multilingual, SWE-Gym, R2E-Gym, SWE-rebench), then different shapes like Commit0's build-from-spec.)*

## Why the "oracle" verify

A benchmark's CI proof can't require a model key (per [CONTRIBUTING](../CONTRIBUTING.md)). Every one of these benchmarks has a **reference-solution mode**: apply the known-good patch instead of running a model, then grade. If the grader resolves the reference solution, the environment + grading pipeline is correct on Tenki — which is the part CI needs to guarantee. Swapping the reference solution for an agent turns it into a real scored run (bring your own model), which lives outside CI.
