# dsh-title-prefix

DSH 插件：**给每条会话标题加上所属项目名前缀**。

```
原标题：  修复登录超时
改后：    my-app · 修复登录超时
```

前缀由**规则**算出，不经过 AI，所以项目名不会被拼错、不会被翻译：从会话自己的工作目录向上找，遇到第一个含 `.git` 的目录就取该目录名；找不到就退化为工作目录自身的名字。

兜底标题和模型生成的标题都会加前缀；你手动改过的标题不加。

## 安装

本包是正式的 DSH 插件包（`package.json` 声明了 `dsh.bundle.patch`，包内带 `cordis.patch.yml`）。装进某个 profile：

```sh
dsh plugin --profile <profile> add link:/path/to/dsh-title-prefix
```

装完后它出现在 Web 侧栏的**插件**页，可以在那里启用、停用；停用时会把本包从 profile 的 `dsh.profile.bundles` 里摘掉。用 `link:` 表示直接链接本目录，改源码后需重启 DSH 生效。

卸载：

```sh
dsh plugin --profile <profile> remove dsh-title-prefix
```

命令行卸载不会改动 `dsh.profile.bundles`，请再从 profile `package.json` 的 `dsh.profile.bundles` 中删掉 `dsh-title-prefix` 一项；用插件页卸载则会自动处理。

> 旧方式（在 profile 的 `cordis.patch.yml` 末尾手写 `insert` 行、`name` 写 `file://…/index.js`）**已废弃**：那行和本包的 bundle 层会插入同一个 `id`，两个同 id 条目会让 DSH 起不来。

## 配置

在 profile 的 `cordis.patch.yml` 里给本插件条目加 `config`：

```yaml
- id: dsh-title-prefix
  config:
    projectName: '' # 留空表示按目录自动取名
    separator: ' · '
    includeSubagents: false
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `separator` | `' · '` | 项目名与标题之间的分隔符。 |
| `projectName` | `''` | 固定项目名；非空时压过其它所有取名规则。 |
| `projectNames` | `{}` | 按目录精确覆盖的项目名，例如 `{ "/path/to/my-app": "我的应用" }`。 |
| `rootMarkers` | `['.git']` | 标记项目根的目录条目；向上查找时遇到第一个命中的目录即停止。 |
| `maxDepth` | `8` | 向上查找项目根时最多检查几层祖先目录。`0` 表示只看会话自己的工作目录。 |
| `includeSubagents` | `true` | 是否也给子会话（subagent）加前缀。 |

当标题加前缀后超过 DSH 的标题字节上限（`sessionTitle` 服务的 `maxTitleBytes`）时，按整字截断，不会切出半个汉字。

## 许可证

MIT