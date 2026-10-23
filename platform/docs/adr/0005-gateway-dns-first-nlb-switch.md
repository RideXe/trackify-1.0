# ADR 0005: Gateway endpoint

DNS-only direct access is permitted for a small pilot only after real tracker DNS re-resolution
and reconnect tests. DNS caching can leave clients on dead task addresses. Updating records
neither balances existing connections nor migrates sockets; task replacement can interrupt service.

Use NLB plus multiple gateway tasks for the production availability target. New tasks accept new
connections; existing sockets stay with their current task. Scale using connections, memory, CPU,
and queue latency; draining and reconnect headroom are mandatory. Avoid Spot as the only capacity.
Determine idle timeouts from actual heartbeat behavior.

Gateway session ownership needs a unique connection generation, not just a task ID. Conditional
lease updates prevent an old disconnect deleting a newer session. Socket state remains local.
Commands must route to the owning task and be fenced against stale ownership. Scale-to-zero is
only allowed when raw-protocol service is deliberately disabled.
