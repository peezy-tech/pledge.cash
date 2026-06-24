## Smart Contract Development Standard

Every meaningful contract change should answer these questions:

1. What state machine is this changing?
2. Which assets can move, and under which authority?
3. Which invariants must hold before and after every public function?
4. Which external calls happen, and what can a malicious or non-standard token do?
5. What are the bounds on loops, arrays, retries, timestamps, and user-controlled input?
6. What is the deterministic command that proves the change locally?

Prefer explicit custom errors, explicit events for state transitions, small public APIs, and simple control flow. Keep external calls near the edge of the function, with state changes ordered deliberately and tested.

## Useful Commands

```sh
bun run test
bun --cwd packages/contracts test
bun --cwd packages/contracts build
cd packages/contracts && forge fmt --check
```

If a command fails because the repo is mid-prototype, report the exact failing command and first actionable error.
