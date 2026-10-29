# dsh-title-prefix

DSH 插件：**给每条会话标题加上所属项目名前缀**。

DSH plugin: **prefixes every session title with the name of its workspace / project.**

[中文](#中文) · [English](#english)

## 中文

```
原标题：  修复登录超时
改后：    my-app · 修复登录超时
```

兜底标题和模型生成的标题都会加前缀；你手动改过的标题不加。

适合**会话列表单列平铺展示**时使用：不必点开每条会话，就能看出它属于哪个 workspace / 项目。

![侧栏会话列表：每条标题都带项目名前缀](https://raw.githubusercontent.com/dotdance/dsh-title-prefix/main/assets/sidebar-session-list.png)

### 安装

```sh
dsh plugin --profile web add dsh-title-prefix
```

### 许可证

MIT

## English

```
Before:  修复登录超时
After:   my-app · 修复登录超时
```

Both fallback titles and model-generated titles get the prefix; titles you renamed yourself are left unchanged.

Useful when the **session list is a single flat column**: you can tell which workspace / project each conversation belongs to without opening it.

![Session list in the sidebar: every title carries its project prefix](https://raw.githubusercontent.com/dotdance/dsh-title-prefix/main/assets/sidebar-session-list.png)

### Install

```sh
dsh plugin --profile web add dsh-title-prefix
```

### License

MIT
