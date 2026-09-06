import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImageType } from '../src/lib/upload.js';

test('detectImageType checks file signatures instead of the filename', () => {
  assert.equal(
    detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
    'image/png'
  );
  assert.equal(detectImageType(Buffer.from('GIF89a000000', 'ascii')), 'image/gif');
  assert.equal(detectImageType(Buffer.from('RIFF0000WEBP', 'ascii')), 'image/webp');
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(detectImageType(Buffer.from('<script>x</script>', 'utf8')), null);
});
