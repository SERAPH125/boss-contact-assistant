const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensure,
  permissionPatternForBaseUrl
} = require('../src/api-permissions.js');

test('builds an exact HTTPS host permission without path or port', () => {
  assert.equal(
    permissionPatternForBaseUrl('https://llm.example.com:8443/v1'),
    'https://llm.example.com/*'
  );
});

test('allows HTTP only for local development hosts', () => {
  assert.equal(
    permissionPatternForBaseUrl('http://127.0.0.1:11434/v1'),
    'http://127.0.0.1/*'
  );
  assert.equal(
    permissionPatternForBaseUrl('http://localhost:8080/v1'),
    'http://localhost/*'
  );
  assert.throws(
    () => permissionPatternForBaseUrl('http://llm.example.com/v1'),
    /HTTPS/
  );
});

test('requests a missing optional permission and reports denial', async () => {
  const calls = [];
  const chromeApi = {
    permissions: {
      async request(value) {
        calls.push(['request', value]);
        return false;
      }
    }
  };

  const result = await ensure(chromeApi, 'https://llm.example.com/v1');

  assert.equal(result.ok, false);
  assert.match(result.error, /授权/);
  assert.equal(calls.length, 1);
});
