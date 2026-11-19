// The integration tests parse CSV dates in *local* time, and their expected outputs
// (src/test/integration/output/*.json) were recorded on a machine in Australia/Brisbane
// (UTC+10, no daylight saving). Pinning the timezone makes the tests pass on any machine.
// Node applies a runtime change to process.env.TZ on every platform, including Windows.
process.env.TZ = 'Australia/Brisbane';
