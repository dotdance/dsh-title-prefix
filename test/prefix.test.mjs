import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { feed, mount, session, tick, titleEvent, titles } from './helpers.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = path.join(PROJECT, 'tmp', 'test-sandbox');
const ROOT = path.join(SANDBOX, 'root'); // 假装它是个 git 仓库根
const DEEP = path.join(ROOT, 'packages', 'deep', 'inner'); // 仓库里的深层子目录
const PLAIN = path.join(SANDBOX, 'plain'); // 不在任何仓库里

before(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, '.git'), { recursive: true });
  fs.mkdirSync(DEEP, { recursive: true });
  fs.mkdirSync(PLAIN, { recursive: true });
});

after(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('向上找到最近的 .git，用它的目录名当项目名', async () => {
  const { emit } = mount();
  const target = session(DEEP);
  await feed(emit, target, titleEvent('会话标题是怎么生成的'));
  assert.deepEqual(titles(target), ['root · 会话标题是怎么生成的']);
});

test('找不到任何 .git 时退化为工作目录名', async () => {
  const { emit } = mount({ maxDepth: 0 }); // 只看给定目录本身
  const target = session(PLAIN);
  await feed(emit, target, titleEvent('会话标题是怎么生成的'));
  assert.deepEqual(titles(target), ['plain · 会话标题是怎么生成的']);
});

test('没有工作目录的会话不加前缀，也不报错', async () => {
  const { emit, warnings } = mount();
  const target = session(undefined);
  await feed(emit, target, titleEvent('会话标题是怎么生成的'));
  assert.deepEqual(titles(target), []);
  assert.deepEqual(warnings, []);
});

test('标题已带前缀时不重复追加', async () => {
  const { emit } = mount();
  const target = session(ROOT);
  await feed(emit, target, titleEvent('root · 会话标题是怎么生成的'), { echo: false });
  assert.deepEqual(titles(target), []);
});

test('模型标题（provider）加前缀后原样保留来源信息', async () => {
  const { emit } = mount();
  const target = session(ROOT);
  const source = { kind: 'provider', provider: 'session-title-first-prompt-llm', model: { provider: 'sky', model: 'deepseek-v4.1-flash' } };
  await feed(emit, target, titleEvent('项目路径', source));
  assert.deepEqual(titles(target), ['root · 项目路径']);
  assert.deepEqual(target.appended[0].data.source, source);
  assert.deepEqual(target.appended[0].data.messageSeqs, [7]);
  assert.equal(target.appended[0].type, 'session/title');
});

test('超长标题按 maxTitleBytes 上限整字截断', async () => {
  const { emit } = mount({}, { maxTitleBytes: 80 });
  const target = session(ROOT);
  await feed(emit, target, titleEvent('很长的标题'.repeat(60)));
  const [result] = titles(target);
  assert.ok(Buffer.byteLength(result, 'utf8') <= 80, `实际 ${Buffer.byteLength(result, 'utf8')} 字节`);
  assert.ok(result.startsWith('root · '));
  assert.ok(!result.includes('\uFFFD'), '不能切出半个字');
});

test('目录映射优先于自动取名', async () => {
  const { emit } = mount({ projectNames: { [DEEP]: '内网聊天' } });
  const target = session(DEEP);
  await feed(emit, target, titleEvent('标题'));
  assert.deepEqual(titles(target), ['内网聊天 · 标题']);
});

test('固定项目名无视其它取名规则', async () => {
  const { emit } = mount({ projectName: 'ACME', projectNames: { [DEEP]: '内网聊天' } });
  const target = session(DEEP);
  await feed(emit, target, titleEvent('标题'));
  assert.deepEqual(titles(target), ['ACME · 标题']);
});

test('分隔符可配置', async () => {
  const { emit } = mount({ separator: '-' });
  const target = session(ROOT);
  await feed(emit, target, titleEvent('标题'));
  assert.deepEqual(titles(target), ['root-标题']);
});

test('includeSubagents=false 时跳过子会话', async () => {
  const { emit } = mount({ includeSubagents: false });
  const target = session(ROOT, { origin: 'subagent' });
  await feed(emit, target, titleEvent('标题'));
  assert.deepEqual(titles(target), []);
});

test('默认也给子会话加前缀', async () => {
  const { emit } = mount();
  const target = session(ROOT, { origin: 'subagent' });
  await feed(emit, target, titleEvent('标题'));
  assert.deepEqual(titles(target), ['root · 标题']);
});

test('新标题抢先落地时放弃对旧标题的追加', async () => {
  const { emit } = mount();
  const target = session(ROOT);
  // 两条事件在同一次同步流程里到达：兜底标题的追加还没落地，模型标题就来了
  emit(target, { type: 'session/title', data: titleEvent('兜底标题') });
  emit(target, { type: 'session/title', data: titleEvent('模型标题', { kind: 'provider', provider: 'p' }) });
  await tick();
  assert.deepEqual(titles(target), ['root · 模型标题']);
});

test('非标题事件与用户来源的标题一概不动', async () => {
  const { emit, warnings } = mount();
  const target = session(ROOT);
  emit(target, { type: 'agent/message', data: { title: 'x' } });
  emit(target, { type: 'session/title', data: titleEvent('手动改的名字', { kind: 'user' }) });
  await tick();
  assert.deepEqual(titles(target), []);
  assert.deepEqual(warnings, []);
});

test('插件抛错时只告警，不抛出到宿主', async () => {
  const { emit, warnings } = mount();
  const target = {
    header: { cwd: ROOT },
    append: async () => {
      throw new Error('append 失败');
    },
  };
  emit(target, { type: 'session/title', data: titleEvent('标题') });
  await tick();
  await tick();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /append 失败/);
});
