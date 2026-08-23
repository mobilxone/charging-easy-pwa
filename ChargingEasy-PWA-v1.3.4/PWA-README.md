# 充電易 PWA

这是「充電易」的移动端单页 Web 应用版本。核心应用源码位于 `public/pwa/`，由原生 HTML、CSS 和 JavaScript 构成，不依赖前端组件库或图表库。

## 已实现

- 首页月度充电费用、电量、里程和能耗概览
- 添加充电记录并自动计算电价、行驶里程、能耗和百公里费用
- 记录搜索、类型筛选、详情、编辑与删除
- 月度与年度统计、费用柱状图和近 6 个月趋势
- IndexedDB 设备本地存储
- 邮箱验证码登录与 Supabase 云端同步
- 自动同步、手动同步和退出登录二次确认
- JSON 备份导入/导出与 CSV 导出
- PWA Manifest、Service Worker、离线缓存和主屏幕图标
- iPhone 安全区适配与独立窗口模式
- 无广告、无追踪

## PWA 文件

- `public/pwa/index.html`：单页应用入口与 iOS PWA 元数据
- `public/pwa/styles.css`：完整移动端浅色界面样式
- `public/pwa/app.js`：数据、交互、导航、统计和导入导出逻辑
- `public/pwa/manifest.webmanifest`：安装信息与 `standalone` 显示模式
- `public/pwa/sw.js`：离线应用外壳缓存
- `public/pwa/icons/`：普通、Maskable 和 Apple Touch 图标

## 本地运行

Service Worker 不能通过 `file://` 直接使用，请使用本地 HTTP 服务：

```bash
cd public
python3 -m http.server 8080
```

然后访问 `http://localhost:8080/pwa/index.html`。

## 添加到 iPhone 主屏幕

1. 使用 Safari 打开部署地址。
2. 点击 Safari 的“分享”按钮。
3. 选择“添加到主屏幕”。
4. 从桌面图标启动。

从主屏幕启动后，Manifest 的 `display: standalone` 和 Apple PWA 元数据会让应用以独立窗口运行，不显示 Safari 地址栏。在普通浏览器标签页中，地址栏仍由浏览器控制。

## 数据说明

应用采用 IndexedDB 本地优先：未登录时，记录只保存在当前设备；登录后，本地记录会与已配置的 Supabase 项目双向合并并同步。断网时仍可正常记录，恢复网络后补传。即使启用了云同步，也建议定期在设置中导出 JSON 备份。

## Cloudflare Pages 部署

将项目上传到 GitHub 后，在 Cloudflare Pages 中使用以下设置：

- Framework preset：`None`
- Build command：`exit 0`
- Build output directory：`public`
- Root directory：仓库根目录（如果项目文件多套了一层文件夹，则填写该文件夹名称）

`public/_redirects` 已包含根地址跳转规则，访问 Pages 域名会自动进入 `/pwa/`。
