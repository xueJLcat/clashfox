# ClashFox

ClashFox 是一个免构建的 Firefox WebExtension，用来读取 mihomo 外部控制器的 `/connections`，并在工具栏弹窗中显示当前标签页域名对应的连接、规则、链路和流量。

## 使用

1. 在 mihomo 配置里启用外部控制器：

   ```yaml
   external-controller: 127.0.0.1:9090
   secret: ""
   ```

   远程控制器示例：

   ```yaml
   external-controller: 192.168.20.2:9090
   secret: "12210127"
   ```

2. 打开 Firefox 的 `about:debugging#/runtime/this-firefox`。
3. 点击「临时载入附加组件」，选择本仓库里的 `manifest.json`。
4. 打开扩展设置，填写 API 控制器地址和 `secret`。例如 yacd 链接里出现 `hostname=192.168.20.2&port=9090&secret=12210127` 时，这里填写：

   - 控制器地址：`http://192.168.20.2:9090`
   - Secret：``

## 当前能力

- 默认连接 `http://127.0.0.1:9090/connections`，也支持设置为局域网或远程控制器地址。
- 工具栏 badge 显示当前标签页匹配到的连接数量。
- 弹窗支持快速切换多个 mihomo 后端，切换后会立即刷新当前标签页连接。
- 弹窗支持快速切换过滤模式：当前主域名、当前完整地址、全部连接。
- 支持浅色/深色主题切换，弹窗可快速切换，设置页可保存偏好。
- 弹窗显示匹配连接的目标地址、连接类型、规则、代理链路、上下行流量。
- 设置页支持配置多个后端、控制器地址、`secret`、刷新间隔和同域名后缀匹配。
- 请求 mihomo API 时会携带 `Authorization: Bearer <secret>`。

## 多后端

在扩展设置页可以新增、删除、测试多个后端。每个后端包含：

- 后端名称
- API 控制器地址，例如 `http://192.168.20.2:9090`
- Secret

保存后，弹窗里的「后端」下拉菜单会显示这些后端。选择不同后端时，ClashFox 会保存当前选择并立刻重新请求 `/connections`。

## 过滤模式

弹窗中可以快速切换三种过滤模式：

- 主域名：按当前页面主域名展示连接，例如 `www.example.com` 会匹配 `example.com` 及其子域名。
- 完整地址：按当前页面完整主机地址精确展示连接，例如只匹配 `www.example.com`。
- 全部：不按当前页面过滤，展示当前后端 `/connections` 返回的所有连接。

mihomo 连接数据通常不包含 URL path 或 query，所以「完整地址」按主机名和显式端口匹配，不按 `/path?query` 匹配。

## 匹配说明

mihomo 的连接数据不包含 Firefox 标签页 ID，所以 ClashFox 以当前标签页的 hostname 匹配连接里的 `metadata.host`、`metadata.remoteDestination`、`metadata.destinationIP` 等字段。对于只暴露 IP、未保留域名，或页面里的第三方子资源连接，可能无法完全归属到当前标签页。

## 权限说明

为了让控制器地址可以配置为 `127.0.0.1`、局域网 IP、域名或 HTTPS 地址，扩展在 `manifest.json` 中申请了 `http://*/*` 与 `https://*/*` 请求权限。
