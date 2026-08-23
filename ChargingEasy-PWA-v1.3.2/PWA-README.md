# 充電易 PWA 1.3.2

「充電易」是面向 iPhone 的移动端单页 Web 应用。核心界面位于 `public/pwa/`，使用原生 HTML、CSS 和 JavaScript 实现，支持添加到主屏幕、离线使用和 Supabase 云端同步。

## 主要功能

- 充电、高速和停车费用记录
- 充电量、电价、里程、能耗和具体位置
- 记录搜索、筛选、详情、编辑与删除
- 月度与年度费用、平均电价和每公里费用统计
- IndexedDB 本地优先存储与离线操作
- Supabase 邮箱验证码登录和多设备云端同步
- 自动同步、手动同步与冲突合并
- JSON 备份导入/导出和 CSV 导出
- 浅色、深色和跟随 iOS 系统模式
- iPhone 安全区、独立窗口和主屏幕图标适配

## 核心文件

- `public/pwa/index.html`：PWA 单页入口与 iOS 元数据
- `public/pwa/styles.css`：iOS 风格界面、主题和淡入淡出动画
- `public/pwa/app.js`：记录、导航、统计、同步和备份逻辑
- `public/pwa/cloud.js`：Supabase 登录与同步客户端
- `public/pwa/manifest.webmanifest`：安装信息和 `standalone` 模式
- `public/pwa/sw.js`：离线缓存与版本更新
- `public/pwa/icons/`：PWA 和 Apple Touch 图标
- `supabase-setup.sql`：云端数据表和 RLS 权限策略

## 本地运行

Service Worker 不能通过 `file://` 使用，请从项目目录启动本地 HTTP 服务：

```bash
cd public
python3 -m http.server 8080
```

然后访问 `http://localhost:8080/pwa/index.html`。

完整项目也可以使用 Node.js 22 及以上版本运行：

```bash
npm install
npm run dev
```

## Supabase 初始化

1. 在 Supabase 的 SQL Editor 中运行 `supabase-setup.sql`。
2. 在 Authentication 的 Email Provider 中将 Email OTP Length 设置为 6。
3. 配置 Custom SMTP。
4. 在 Magic link or OTP 邮件模板中使用 `{{ .Token }}` 显示验证码。
5. 如需更换 Supabase 项目，修改 `public/pwa/cloud.js` 顶部的项目 URL 和 Publishable Key。

Publishable Key 可以安全地用于浏览器前端，但不要把 Secret Key 或 `service_role` Key 写入任何前端文件。

## 添加到 iPhone 主屏幕

1. 使用 Safari 打开已部署的 HTTPS 地址。
2. 点击“分享”。
3. 选择“添加到主屏幕”。
4. 从桌面图标启动。

主屏幕模式会隐藏 Safari 地址栏，并根据 `safe-area-inset-bottom` 自动避开 iPhone 底部小横条。

## 数据说明

IndexedDB 始终作为本机数据源，离线时的新增和修改会在恢复网络后同步到 Supabase。删除主屏幕快捷方式通常不会立即删除网站数据，但清除 Safari 网站数据、系统回收存储或更换设备仍可能造成仅存于本机的数据丢失。建议保持自动同步，并定期导出 JSON 备份。
