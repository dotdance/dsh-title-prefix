/**
 * dsh-title-prefix
 *
 * Give every session title a project-name prefix, e.g.
 *
 *   my-app · 修复登录超时
 *
 * HOW IT WORKS
 * ------------
 * The log-only `session/title` event is the single source of truth, and the
 * LATEST such event in the log wins (see `foldSessionTitle` and the `title`
 * session projection in @deepseek-ai/dsh-session-title).
 *
 * The built-in service first appends a deterministic fallback title
 * (`source.kind === "fallback"`) and later lets the registered provider replace
 * it (`source.kind === "provider"`). This plugin listens to those events and,
 * when the text does not already carry the project prefix, appends one more
 * `session/title` event carrying the prefixed text.
 *
 * WHY APPEND AND NOT `ctx.sessionTitle.rename()`
 * ---------------------------------------------
 * `rename()` appends a *user*-sourced title, which (a) pins the session so no
 * later user message starts another automatic revision and (b) calls
 * `supersede()`, which bumps the session-local revision and therefore aborts any
 * in-flight automatic generation. Appending a plain event keeps the service's
 * own scheduled work intact, so the model-generated title still arrives and this
 * plugin then re-prefixes that title as well.
 *
 * The appended event is deferred to a microtask: `Session.append` refuses to
 * re-enter while another append is being published ("session append cannot
 * reenter while another append is being published"), and the fallback title is
 * appended synchronously by the service. The append is also guarded on two
 * fronts, so the plugin can neither loop on its own event nor overwrite a newer
 * title: a text that already starts with the exact prefix is left alone, and a
 * deferred append is dropped when a newer title has been observed meanwhile.
 */

import fs from 'node:fs';
import path from 'node:path';

export const name = 'dsh-title-prefix';

/** The title service must be loaded before its events can be decorated. */
export const inject = ['sessionTitle'];

const DEFAULTS = {
  /** Text placed between the project name and the title. */
  separator: ' · ',
  /** Fixed project name. When non-empty it wins over every other rule. */
  projectName: '',
  /** Exact per-directory overrides, e.g. { "/path/to/my-app": "我的应用" }. */
  projectNames: {},
  /** Directory entries that mark a project root; the walk stops at the first hit. */
  rootMarkers: ['.git'],
  /** Maximum ancestor levels inspected while looking for a root marker. */
  maxDepth: 8,
  /** Decorate child (subagent) sessions too. */
  includeSubagents: true,
};

/** Longest leading run of whole code points within a UTF-8 byte budget. */
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

/** Copy a logged title source so the appended event never aliases log-owned data. */
function copySource(source) {
  if (source?.kind === 'provider') {
    return {
      kind: 'provider',
      provider: String(source.provider ?? 'unknown'),
      ...(source.model === undefined ? {} : { model: { ...source.model } }),
    };
  }
  return { kind: 'fallback' };
}

export function apply(ctx, userConfig) {
  const config = { ...DEFAULTS, ...(userConfig ?? {}) };
  const separator = typeof config.separator === 'string' ? config.separator : DEFAULTS.separator;
  const fixedName = typeof config.projectName === 'string' ? config.projectName : '';
  const overrides = config.projectNames && typeof config.projectNames === 'object' ? config.projectNames : {};
  const markers = (Array.isArray(config.rootMarkers) ? config.rootMarkers : [])
    .filter((marker) => typeof marker === 'string' && marker.length > 0);
  const maxDepth = Number.isInteger(config.maxDepth) && config.maxDepth >= 0 ? config.maxDepth : DEFAULTS.maxDepth;

  /** session -> derived project name (one derivation per session). */
  const derived = new WeakMap();
  /** session -> newest title text observed, used to drop superseded appends. */
  const observed = new WeakMap();

  function report(error) {
    ctx.logger?.warn(`dsh-title-prefix: ${error?.stack ?? error}`);
  }

  /** Nearest ancestor whose entries include one of the configured root markers. */
  function projectRootName(cwd) {
    let dir = cwd;
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      for (const marker of markers) {
        try {
          if (fs.existsSync(path.join(dir, marker))) return path.basename(dir);
        } catch {
          /* an unreadable ancestor is simply not a root */
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir || parent === path.sep) break;
      dir = parent;
    }
    return path.basename(cwd);
  }

  function projectOf(session) {
    const cached = derived.get(session);
    if (cached !== undefined) return cached;
    let project = '';
    if (fixedName.length > 0) {
      project = fixedName;
    } else {
      const cwd = session?.header?.cwd;
      if (typeof cwd === 'string' && cwd.length > 0) {
        project = Object.prototype.hasOwnProperty.call(overrides, cwd) ? String(overrides[cwd]) : projectRootName(cwd);
      }
    }
    project = project.trim();
    derived.set(session, project);
    return project;
  }

  /** Append the prefixed title, one microtask later, unless it is already stale. */
  function appendPrefixed(session, seenTitle, next, data) {
    if (observed.get(session) !== seenTitle) return;
    try {
      void Promise.resolve(
        session.append('session/title', {
          title: next,
          messageSeqs: Array.isArray(data.messageSeqs) ? [...data.messageSeqs] : [],
          source: copySource(data.source),
        }),
      ).catch(report);
    } catch (error) {
      report(error);
    }
  }

  function onTitleEvent(session, data) {
    const kind = data?.source?.kind;
    if (kind !== 'fallback' && kind !== 'provider') return;
    const title = typeof data.title === 'string' ? data.title : '';
    if (title.length === 0) return;
    observed.set(session, title);
    if (config.includeSubagents === false && session?.header?.origin === 'subagent') return;
    const project = projectOf(session);
    if (project.length === 0) return;
    const head = project + separator;
    if (title.startsWith(head)) return;
    const next = truncateUtf8(head + title, ctx.sessionTitle?.config?.maxTitleBytes).trim();
    if (next.length === 0 || next === title) return;
    queueMicrotask(() => appendPrefixed(session, title, next, data));
  }

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'session/title') return;
    try {
      onTitleEvent(session, event.data);
    } catch (error) {
      // A failed decoration must never disturb the session that produced it.
      report(error);
    }
  });
}
