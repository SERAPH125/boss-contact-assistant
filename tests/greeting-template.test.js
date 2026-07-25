const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GreetingTemplate = require('../src/greeting-template.js');
const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');

test('renders greeting template with job placeholders and defaults', () => {
  assert.equal(
    GreetingTemplate.renderGreetingTemplate('您好，我对{company}的{jobName}很感兴趣', {
      name: '前端工程师',
      company: '甲公司'
    }),
    '您好，我对甲公司的前端工程师很感兴趣'
  );
  assert.equal(
    GreetingTemplate.renderGreetingTemplate('', { name: 'x' }),
    GreetingTemplate.DEFAULT_GREETING
  );
});

test('contact greeting path never calls LLM and imports the template helper', () => {
  assert.match(background, /['"]\/src\/greeting-template\.js['"]/);
  assert.match(background, /GreetingTemplate\.renderGreetingTemplate/);
  assert.match(background, /function genGreetingFromJD\(/);
  const start = background.indexOf('function genGreetingFromJD(');
  const end = background.indexOf('\n}', start);
  const body = background.slice(start, end);
  assert.doesNotMatch(body, /callLLM/);
  assert.doesNotMatch(body, /熟悉XXX|80-120/);
  assert.match(background, /使用招呼语模板/);
});
