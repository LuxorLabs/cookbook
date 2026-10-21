## Running checks

Checks run on a Tenki sandbox through Crabbox, not locally.

- Warm box: `crabbox warmup --slug ci`. Skip it if `crabbox status --id ci` prints `state=ready`.
- Run a command there: `crabbox run --id ci -- <command>`. The full suite is `crabbox job run --id ci test`.
- Only tracked and non-ignored files sync. Ignored inputs the checks need go up once with `crabbox cp --id ci <local-path> SANDBOX:<remote-path>`.
- Leave the box running. Do not `crabbox stop ci`.
