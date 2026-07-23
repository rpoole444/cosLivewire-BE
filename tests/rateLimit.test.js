const assert = require('assert');
const { createRateLimit } = require('../middleware/rateLimit');

const limiter = createRateLimit({ windowMs: 60000, max: 2, keyGenerator: () => 'test' });
const request = {};
const response = {
  statusCode: 200,
  headers: {},
  set(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
};

let nextCalls = 0;
limiter(request, response, () => { nextCalls += 1; });
limiter(request, response, () => { nextCalls += 1; });
limiter(request, response, () => { nextCalls += 1; });

assert.strictEqual(nextCalls, 2);
assert.strictEqual(response.statusCode, 429);
assert.ok(Number(response.headers['Retry-After']) > 0);
assert.match(response.payload.message, /too many/i);

console.log('rateLimit tests passed');
