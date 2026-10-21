# Benchmarks

Standard coding benchmarks run on Tenki sandboxes and graded with each benchmark's official harness, so scores compare with published ones. They are heavier than the [examples](../examples/): they pull real evaluation images and run real test suites.

Each benchmark ships a `verify.mjs` that CI runs with no model key. It applies the benchmark's reference solution instead of running a model and checks that the grader marks it resolved, which shows the environment and grading work on Tenki. Swap the reference solution for an agent and it becomes a scored run.

| Benchmark | What it measures | CI check |
| --- | --- | --- |
| [SWE-bench](swe-bench/) | Fix a real GitHub issue so the repo's hidden tests pass (Lite, Verified, or full) | The gold patch for one instance must resolve |
