/**
 * 列出本机所有工作目录，并给出**用真插件本体**算出来的标题前缀。
 *
 * 用法: node scripts/workspaces.mjs
 *
 * 数据来源: ~/.dsh/sessions/<转义目录名>/<会话 id>/session.v4.jsonl.zstd
 * 每个会话日志的第一行是 {"type":"session", ..., "cwd":"..."}，取它当工作目录。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

import { apply } from '../index.js';

const SESSIONS = path.join(os.homedir(), '.dsh', 'sessions');

/** zstd 解压：优先用 Node 内置，老版本 Node 回退到 zstd 命令。 */
function decompress(file) {
  const raw = fs.readFileSync(file);
  if (typeof zlib.zstdDecompressSync === 'function') return zlib.zstdDecompressSync(raw).toString('utf8');
  return execFileSync('zstd', ['-dc', file], { encoding: 'utf8' });
}

function firstLineCwd(file) {
  try {
    const line = decompress(file).split('\n', 1)[0];
    return JSON.parse(line)?.cwd ?? '';
  } catch {
    return '';
  }
}

/** 假 ctx：只为把插件跑起来，拿到它写出的标题。 */
async function prefixFor(cwd) {
  const handlers = [];
  const ctx = {
    logger: { warn: () => {} },
    sessionTitle: { config: { maxTitleBytes: 80 } },
    on: (event, handler) => handlers.push([event, handler]),
  };
  apply(ctx, undefined);
  const emit = handlers.find(([event]) => event === 'session/event')[1];
  const appended = [];
  const target = { header: { cwd }, append: async (_type, data) => appended.push(data) };
  emit(target, { type: 'session/title', data: { title: '会话标题是怎么生成的', messageSeqs: [1], source: { kind: 'fallback' } } });
  await new Promise((resolve) => setImmediate(resolve));
  return appended[0]?.title ?? '(不加前缀)';
}

const workspaces = new Map();
for (const workspace of fs.readdirSync(SESSIONS)) {
  const dir = path.join(SESSIONS, workspace);
  if (!fs.statSync(dir).isDirectory()) continue;
  const sessions = fs.readdirSync(dir).filter((name) => name.startsWith('session-'));
  let found = '';
  let count = 0;
  for (const id of sessions) {
    const log = path.join(dir, id, 'session.v4.jsonl.zstd');
    if (!fs.existsSync(log)) continue; // 旧格式（v2/v3）日志没有 cwd 字段
    count += 1;
    if (!found) found = firstLineCwd(log);
  }
  if (!found) continue;
  const entry = workspaces.get(found) ?? { count: 0 };
  entry.count += count;
  workspaces.set(found, entry);
}

const rows = await Promise.all(
  [...workspaces].sort(([a], [b]) => a.localeCompare(b)).map(async ([cwd, entry]) => ({
    cwd,
    count: entry.count,
    title: await prefixFor(cwd),
  })),
);

const width = Math.max(...rows.map((row) => row.cwd.length));
console.log(`${rows.length} 个工作目录\n`);
for (const row of rows) {
  console.log(`  ${row.title.padEnd(40)} <- ${row.cwd.padEnd(width)}  (${row.count} 个会话)`);
}
console.log('\n注: 只统计 v4 格式日志；旧格式会话日志没有 cwd 字段，不在此表内。');
