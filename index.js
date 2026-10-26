/**
 * dsh-title-prefix — 给每条会话标题加上所属项目名前缀，例如 `my-app · 修复登录超时`。
 *
 * 项目名怎么来：从会话 cwd 逐级向上找，第一个含 rootMarkers 条目（默认 `.git`）的
 * 目录取其目录名；一路找不到就退化为 cwd 自身的名字。纯规则计算，不经过 AI，
 * 所以项目名不会被拼错、不会被翻译。
 *
 * 为什么不调 `ctx.sessionTitle.rename()`
 * -------------------------------------
 * `rename()` 写的是 `user` 来源的标题：它会把会话 pin 住（之后的用户消息不再触发
 * 自动生成），还会 `supersede()` 掉正在进行的自动生成。改为直接追加一条
 * `session/title` 事件：标题即「日志里最后一条 session/title 事件」（latest wins），
 * 服务的排期不受影响，模型标题照样产出，届时本插件再给新标题补一次前缀。
 *
 * 为什么追加要推到微任务
 * ---------------------
 * `session/event` 是在 `Session.append()` 的发布临界区内同步回调的，此时再 append 会
 * 抛 `session append cannot reenter while another append is being published`。
 * 推后执行另有两道闸：标题已带前缀就直接跳过（同时防住自我循环）；追加落地前若已有
 * 更新的标题，就丢弃这次过期追加，免得旧标题盖掉新标题。
 */

import fs from 'node:fs';
import path from 'node:path';

export const name = 'dsh-title-prefix';

/** 标题服务必须先加载，才能收到它的事件。 */
export const inject = ['sessionTitle'];

const DEFAULTS = {
  /** 项目名与标题之间的分隔符。 */
  separator: ' · ',
  /** 固定项目名；非空时压过其它所有取名规则。 */
  projectName: '',
  /** 按目录精确覆盖的项目名，例如 { "/path/to/my-app": "我的应用" }。 */
  projectNames: {},
  /** 标记项目根的目录条目；向上查找时遇到第一个命中的目录即停止。 */
  rootMarkers: ['.git'],
  /** 向上查找项目根时最多检查几层祖先目录。 */
  maxDepth: 8,
  /** 是否也给子会话（subagent）加前缀。 */
  includeSubagents: true,
};

/** 按 UTF-8 字节上限整字截断，不切出半个字符；上限无效时原样返回。 */
function truncateUtf8(text, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) return text;
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = '';
  let used = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out;
}

/** 最近的、含任一 rootMarkers 条目的祖先目录名；找不到就用 cwd 自身的名字。 */
function projectRootName(cwd, markers, maxDepth) {
  let dir = cwd;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    // existsSync 自己吞掉所有错误（EACCES/ENOTDIR 等），返回 false，无需再包 try/catch。
    if (markers.some((marker) => fs.existsSync(path.join(dir, marker)))) return path.basename(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break; // 已到文件系统根
    dir = parent;
  }
  return path.basename(cwd);
}

export function apply(ctx, userConfig) {
  const config = { ...DEFAULTS, ...(userConfig ?? {}) };

  const separator = typeof config.separator === 'string' ? config.separator : DEFAULTS.separator;
  const fixedName = typeof config.projectName === 'string' ? config.projectName.trim() : '';
  const overrides = new Map(
    config.projectNames && typeof config.projectNames === 'object' ? Object.entries(config.projectNames) : [],
  );
  const markers = (Array.isArray(config.rootMarkers) ? config.rootMarkers : []).filter(
    (marker) => typeof marker === 'string' && marker.length > 0,
  );
  const maxDepth = Number.isInteger(config.maxDepth) && config.maxDepth >= 0 ? config.maxDepth : DEFAULTS.maxDepth;
  const includeSubagents = config.includeSubagents !== false;
  // 服务已由 inject 保证加载，其配置不会在运行期变化，取一次即可。
  const maxTitleBytes = ctx.sessionTitle?.config?.maxTitleBytes;

  /** cwd -> 项目名。同一工作目录下的所有会话（含子会话）共用一次目录查找。 */
  const projectByCwd = new Map();
  /** session -> 最近一次看到的标题文本，用来丢弃被更新的标题顶掉的过期追加。 */
  const latestTitle = new WeakMap();

  function report(error) {
    ctx.logger?.warn(`dsh-title-prefix: ${error?.stack ?? error}`);
  }

  function projectOf(cwd) {
    if (fixedName.length > 0) return fixedName;
    if (typeof cwd !== 'string' || cwd.length === 0) return '';
    const cached = projectByCwd.get(cwd);
    if (cached !== undefined) return cached;
    const override = overrides.get(cwd);
    const name = (override === undefined ? projectRootName(cwd, markers, maxDepth) : String(override)).trim();
    projectByCwd.set(cwd, name);
    return name;
  }

  /** 追加带前缀的标题；落地前若已有更新的标题，就放弃这次追加。 */
  async function appendPrefixed(session, seenTitle, data, title) {
    if (latestTitle.get(session) !== seenTitle) return;
    try {
      // data 来自日志、已深度冻结，append 会再快照一次，因此不需要手工复制。
      await session.append('session/title', {
        title,
        messageSeqs: data.messageSeqs ?? [],
        source: data.source,
      });
    } catch (error) {
      report(error); // 装饰失败不能扰动产生该事件的会话
    }
  }

  function onTitleEvent(session, data) {
    const kind = data?.source?.kind;
    if (kind !== 'fallback' && kind !== 'provider') return; // user 改名等来源一概不碰
    const title = typeof data.title === 'string' ? data.title : '';
    if (title.length === 0) return;
    if (!includeSubagents && session?.header?.origin === 'subagent') return;
    latestTitle.set(session, title);
    const project = projectOf(session?.header?.cwd);
    if (project.length === 0) return;
    const head = project + separator;
    if (title.startsWith(head)) return; // 已带前缀；这也是防自我循环的那道闸
    const next = truncateUtf8(head + title, maxTitleBytes).trim();
    if (next.length === 0) return;
    queueMicrotask(() => appendPrefixed(session, title, data, next));
  }

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'session/title') return;
    try {
      onTitleEvent(session, event.data);
    } catch (error) {
      report(error);
    }
  });
}