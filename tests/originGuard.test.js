const assert = require('assert');
const { createOriginGuard } = require('../middleware/originGuard');

const run = ({ method, origin, enabled = true }) => {
  let status;
  let payload;
  let nextCalled = false;
  const middleware = createOriginGuard({
    allowedOrigins: ['https://app.alpinegrooveguide.com'],
    enabled,
  });

  middleware(
    { method, get: (name) => (name === 'origin' ? origin : undefined) },
    {
      status(code) {
        status = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
    },
    () => { nextCalled = true; }
  );

  return { status, payload, nextCalled };
};

assert.equal(run({ method: 'GET' }).nextCalled, true);
assert.equal(run({ method: 'POST', origin: 'https://app.alpinegrooveguide.com' }).nextCalled, true);
assert.equal(run({ method: 'POST', origin: 'https://evil.example' }).status, 403);
assert.equal(run({ method: 'DELETE' }).nextCalled, true);
assert.equal(run({ method: 'POST', enabled: false }).nextCalled, true);

console.log('origin guard tests passed');
