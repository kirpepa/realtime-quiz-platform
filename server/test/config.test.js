import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const configUrl = new URL('../src/config.js', import.meta.url).href;

function importConfig(environment) {
  const env = { ...process.env, ...environment };
  delete env.JWT_ACCESS_SECRET;
  delete env.JWT_REFRESH_SECRET;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `import '${configUrl}'`], {
    cwd: tmpdir(),
    env,
    encoding: 'utf8',
  });
}

test('JWT secrets have no fallback outside test mode', () => {
  const result = importConfig({ NODE_ENV: 'production' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_ACCESS_SECRET/);
});

test('isolated unit tests may use test-only secrets', () => {
  const result = importConfig({ NODE_ENV: 'test' });
  assert.equal(result.status, 0, result.stderr);
});
