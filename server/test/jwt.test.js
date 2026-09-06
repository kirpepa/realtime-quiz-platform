import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = await import('../src/auth/jwt.js');

test('access and refresh tokens are type-separated', () => {
  const payload = { id: 'user-1', role: 'participant', nickname: 'Test' };
  const access = signAccessToken(payload);
  const refresh = signRefreshToken(payload);

  assert.equal(verifyAccessToken(access).tokenType, 'access');
  assert.equal(verifyRefreshToken(refresh).tokenType, 'refresh');
  assert.throws(() => verifyAccessToken(refresh));
  assert.throws(() => verifyRefreshToken(access));
});
