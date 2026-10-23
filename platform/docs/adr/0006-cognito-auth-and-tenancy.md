# ADR 0006: Identity and tenants

Cognito supplies human identity; server-controlled membership records authorize tenant and group
access. Derive tenant scope from verified identity and membership, never a client-provided ID alone.
Device identity maps to an enrolled tenant before queueing. Device IMEI is an identifier, not proof
of possession. Phones require per-device credentials for production ingestion; unauthenticated
legacy compatibility is limited to an isolated development environment.

Check tenant scope for reads, writes, report objects, subscriptions, and commands. Revalidate
membership after role changes. Test cross-tenant identifiers and signed-download boundaries.
For physical-control commands require explicit authorization, expiry, audit, and device-specific
safe execution conditions. Expired commands must never execute automatically on reconnect.
