$agent-swarm Run the adversarial review against `demo/docs/feature-spec.md` to help answer the question "Should we implement this feature now, defer it, or reduce scope?"

Use this decision matrix:
- Build now: clear demo value, bounded implementation, acceptable failure risk.
- Reduce scope: strong idea, but the safe path is a smaller slice.
- Defer: useful, but not needed for this demo or not ready to implement.
- Reject: weak value, wrong timing, or too much complexity.

After the run, review the synthesis and give me:
- whether the swarm says build now, reduce scope, defer, or reject
- the strongest advocate point
- the strongest skeptic point
- the smallest safe implementation slice
