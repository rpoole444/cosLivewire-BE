const assert = require('assert');
const { ensureAuth, requireAdmin } = require('../middleware/auth');

const createResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

{
  const response = createResponse();
  let nextCalled = false;
  ensureAuth(
    { isAuthenticated: () => true, user: { id: 7 } },
    response,
    () => { nextCalled = true; }
  );
  assert.strictEqual(nextCalled, true, 'Authenticated users should pass ensureAuth');
}

{
  const response = createResponse();
  ensureAuth({ isAuthenticated: () => false, session: {} }, response, () => {});
  assert.strictEqual(response.statusCode, 401, 'Anonymous users should be rejected');
}

{
  const response = createResponse();
  let nextCalled = false;
  requireAdmin(
    { isAuthenticated: () => true, user: { id: 7, is_admin: true } },
    response,
    () => { nextCalled = true; }
  );
  assert.strictEqual(nextCalled, true, 'Admins should pass requireAdmin');
}

{
  const response = createResponse();
  requireAdmin(
    { isAuthenticated: () => true, user: { id: 7, is_admin: false } },
    response,
    () => {}
  );
  assert.strictEqual(response.statusCode, 403, 'Non-admin users should be forbidden');
}

console.log('auth middleware tests passed.');
