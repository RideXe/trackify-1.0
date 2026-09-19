# ADR 0004: AppSync Events

Use managed event channels for live dashboard changes. Cognito verifies identity; channel
handlers must additionally enforce tenant and group permissions. A valid token must never allow
subscription to an arbitrary fleet channel. Only backend IAM roles publish tracking data.

Clients bootstrap authorized current state from the API and resync after reconnect or a version
gap. Live broadcasts are transient, not the historical source of truth. Bound payloads and batch
changes; measure subscriber multiplication. Membership revocation must terminate or expire old
authorization promptly. Implement this explicitly during the identity phase.

[Authentication and authorization](https://docs.aws.amazon.com/appsync/latest/eventapi/configure-event-api-auth.html)
