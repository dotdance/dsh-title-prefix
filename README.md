# dsh-title-prefix

DSH 插件：**给每条会话标题加上所属项目名前缀**。

```
原标题：  修复登录超时
改后：    my-app · 修复登录超时
```

兜底标题和模型生成的标题都会加前缀；你手动改过的标题不加。

适合**会话列表单列平铺展示**时使用：不必点开每条会话，就能看出它属于哪个 workspace / 项目。

## 安装

```sh
dsh plugin --profile web add dsh-title-prefix
```

## 许可证

MIT
