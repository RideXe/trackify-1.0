# ADR 0001: TypeScript

Accepted for the new platform. Use shared TypeScript contracts and Node.js 24 for Lambda and
the candidate gateway. Retain legacy Java decoders and samples as references, respecting their
licenses. Protocol support must be implemented and tested model by model; there is no automatic
parity with all existing decoders. Benchmark memory and fragmented TCP frame handling before
choosing gateway task size. CPU-heavy work may later need a different runtime.
