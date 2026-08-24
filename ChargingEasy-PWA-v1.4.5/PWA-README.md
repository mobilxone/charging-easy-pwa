# 充電易 1.4.5 PWA

这是「充電易」的移动端单页 Web 应用版本。核心应用源码位于 `public/pwa/`，由原生 HTML、CSS 和 JavaScript 构成，不依赖前端组件库或图表库。

## 已实现

- 首页月度充电费用、电量、里程和能耗概览
- 添加充电记录并自动计算电价、行驶里程、能耗和百公里费用
- 记录搜索、类型筛选、详情、编辑与删除
- 月度与年度统计、费用分类和行驶里程趋势
- 最近 6 个月趋势支持连续拖动，并按单个月份轻柔吸附
- 年度趋势以单个年份连续拖动，无更早数据时不会出现空白区间
- IndexedDB 本地优先存储，登录后使用 Supabase 自动或手动同步
- JSON 备份导入/导出与 CSV 导出
- PWA Manifest、Service Worker、离线缓存和主屏幕图标
- iPhone 安全区适配与独立窗口模式
- 邮箱验证码登录、账户信息、同步状态与二次确认退出
- 无广告、无追踪、无第三方运行时前端组件依赖

## PWA 文件

- `public/pwa/index.html`：单页应用入口与 iOS PWA 元数据
- `public/pwa/styles.css`：完整移动端浅色界面样式
- `public/pwa/app.js`：数据、交互、导航、统计和导入导出逻辑
- `public/pwa/manifest.webmanifest`：安装信息与 `standalone` 显示模式
- `public/pwa/sw.js`：离线应用外壳缓存
- `public/pwa/icons/`：普通、Maskable 和 Apple Touch 图标
- `supabase/functions/reverse-geocode/`：将当前位置转换为“城市＋行政区＋道路”的地址识别函数

## 地址识别函数

在 Supabase Dashboard 打开 `Edge Functions`，新建名为 `reverse-geocode` 的函数，使用
`supabase/functions/reverse-geocode/index.ts` 的内容部署。中国大陆地址通过高德地图 Web 服务识别，
其他国家和地区使用 OpenStreetMap Nominatim；两条路径均设有超时保护，不会让按钮一直停留在识别状态。

大陆地址识别还需要在高德开放平台创建“Web服务”类型的 Key，然后在 Supabase Dashboard 的
`Edge Functions → Secrets` 中新增：

```text
AMAP_WEB_SERVICE_KEY=你的高德Web服务Key
```

Key 只保存在 Supabase Edge Function 环境中，不要写入 `public/`、上传 GitHub 或发送给他人。
完成后重新部署 `reverse-geocode` 函数。若该密钥缺失，App 会明确提示尚未配置，不会退回大陆网络
经常无法访问的海外地址服务。

地址结果只保留城市、行政区和道路，不保存经纬度、门牌号、邮编或建筑物名称。

## iPhone 启动画面

`public/pwa/startup/` 包含常见 iPhone 尺寸的原生启动图，并在 `index.html` 中通过
`apple-touch-startup-image` 声明。更新启动图后，需要从 iPhone 主屏幕删除旧快捷方式，再用
Safari 重新“添加到主屏幕”，iOS 才会刷新已缓存的原生启动图。

## 本地运行

Service Worker 不能通过 `file://` 直接使用，请使用本地 HTTP 服务：

```bash
cd public
python3 -m http.server 8080
```

然后访问 `http://localhost:8080/pwa/index.html`。

## GitHub 与 Cloudflare Pages 部署

将解压后的 `ChargingEasy-PWA-v1.4.5` 文件夹内容上传到 GitHub 仓库，然后在 Cloudflare Pages 使用：

```text
Framework preset: None
Build command: exit 0
Build output directory: public
```

如果 GitHub 仓库多嵌套了一层 `ChargingEasy-PWA-v1.4.5`，请把 Cloudflare 的 Root directory 设置为该文件夹名。
压缩包已在 `public/_redirects` 中加入根路径跳转，访问 Pages 域名会自动进入 `/pwa/`。

## 添加到 iPhone 主屏幕

1. 使用 Safari 打开部署地址。
2. 点击 Safari 的“分享”按钮。
3. 选择“添加到主屏幕”。
4. 从桌面图标启动。

从主屏幕启动后，Manifest 的 `display: standalone` 和 Apple PWA 元数据会让应用以独立窗口运行，不显示 Safari 地址栏。在普通浏览器标签页中，地址栏仍由浏览器控制。

## 数据说明

充电记录始终先写入当前设备的 IndexedDB，离线时仍可使用。登录 Supabase 账户后，可按设置自动同步或点击按钮手动同步到云端；仍建议定期在设置中导出 JSON 备份。

前端只包含可公开使用的 Supabase 项目地址和 Publishable Key。SMTP Key、`service_role` Key、数据库密码以及高德 Web 服务 Key 不应写入 `public/` 或上传 GitHub。
