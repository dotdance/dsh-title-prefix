# dsh-title-prefix

DSH 插件：**给每条会话标题加上所属项目名前缀**。

```
原标题：  修复登录超时
改后：    my-app · 修复登录超时
```

前缀由**规则**算出，不经过 AI，所以项目名不会被拼错、不会被翻译：从会话自己的工作目录向上找，遇到第一个含 `.git` 的目录就取该目录名；找不到就退化为工作目录自身的名字。

## 安装

本项目是正式的 DSH 插件包（`package.json` 声明了 `dsh.bundle.patch`，包内带 `cordis.patch.yml`）。装进某个 profile：

```sh
dsh plugin --profile web add link:/Users/go/proj/dsh-title-prefix
```

装完后它会出现在市场（dshmarket）的插件列表里，可以在界面上启用、停用；停用时市场会把它从 profile 的 `dsh.profile.bundles` 里摘掉。用 `link:` 安装表示直接链接本目录，改源码即时生效。

卸载：

```sh
dsh plugin --profile web remove dsh-title-prefix
```

命令行卸载不会改动 `dsh.profile.bundles`，请再从 profile `package.json` 的 `dsh.profile.bundles` 中删掉 `dsh-title-prefix` 一项；用市场插件列表卸载则会自动处理。

> 旧方式（在 profile 的 `cordis.patch.yml` 末尾手写 `insert` 行、`name` 写 `file://…/index.js`）**已废弃**：那行和本包的 bundle 层会插入同一个 `id`，两个同 id 条目会让 DSH 起不来。
