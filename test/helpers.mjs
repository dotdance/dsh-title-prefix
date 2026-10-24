/**
 * 测试脚手架：把插件的 apply() 直接跑起来。
 *
 * 插件只通过三样东西和宿主交互：ctx.on('session/event') 订阅、ctx.logger.warn 报错、
 * ctx.sessionTitle.config.maxTitleBytes 读上限。这里给出这三样的最小替身。
 */

import { apply } from '../index.js';

export const tick = () => new Promise((resolve) => setImmediate(resolve));

/** 挂载插件，返回事件发射器与告警收集器。 */
export function mount(config, { maxTitleBytes = 80 } = {}) {
  const handlers = [];
  const warnings = [];
  const ctx = {
    logger: { warn: (message) => warnings.push(String(message)) },
    sessionTitle: { config: { maxTitleBytes } },
    on: (event, handler) => handlers.push([event, handler]),
  };
  apply(ctx, config);
  const emit = handlers.find(([event]) => event === 'session/event')?.[1];
  if (typeof emit !== 'function') throw new Error('插件没有订阅 session/event');
  return { emit, warnings };
}

/** 假会话：header 决定取名，append 记录插件写出的标题事件。 */
export function session(cwd, { origin } = {}) {
  const appended = [];
  return {
    header: cwd === undefined ? {} : { cwd, ...(origin === undefined ? {} : { origin }) },
    appended,
    append: async (type, data) => {
      appended.push({ type, data });
    },
  };
}

export const titleEvent = (text, source = { kind: 'fallback' }) => ({
  title: text,
  messageSeqs: [7],
  source,
});

/**
 * 发一条标题事件，等插件的延迟追加落地。
 * `echo: true`（默认）会模拟插件追加的事件再回到事件总线一次，用来验证不会自我循环。
 */
export async function feed(emit, target, data, { echo = true } = {}) {
  emit(target, { type: 'session/title', data });
  await tick();
  if (echo && target.appended.length > 0) {
    emit(target, { type: 'session/title', data: target.appended[target.appended.length - 1].data });
    await tick();
  }
  return target.appended;
}

export const titles = (target) => target.appended.map((event) => event.data.title);
