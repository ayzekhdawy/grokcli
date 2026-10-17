# 背景图：从 X 搜索 + Imagine 生成

**日期**：2026-07-28  
**状态**：已批准 · 首版实现中  
**参考会话**：`d578e8f0-db3e-4fa7-b95d-9de9d3c84011`（X 热门带图推文 → 本地下载整理）

## 目标

在 **设置 → 外观 → 背景图** 增加两条来源：

1. **从 X 搜索**：关键字 → Grok X 工具搜带图帖 → 瀑布流画廊 → 选中下载 → 设为背景  
2. **Imagine 生成**：提示词 → Grok Imagine 出图（首版静图）→ 落盘库目录 → 设为背景  

充分发挥 Grok Build 生态：Host 负责 UI / 下载 / 落盘 / 应用；搜索与生成通过 **headless `grok -p`**（`--always-approve` + JSON schema）调用与 TUI 相同的工具面。

## 架构（C：Host 编排 + Grok 工具）

```
Settings 入口
  → WallpaperSourceModal（Tab: X | Imagine）
  → Host commands
       wallpaper_x_search      → grok headless + X tools → gallery items
       wallpaper_fetch_media   → reqwest allowlist 下载 → ~/.grok-app/wallpapers/
       wallpaper_imagine       → grok headless + image_gen → 落盘
       wallpaper_library_list  → 扫库目录
  → FE: path → media:// → File → prepareWallpaperFromFile → IDB 当前壁纸
```

## 落盘

```
{app_data}/wallpapers/
  x/<yyyy-mm-dd>/...
  imagine/<yyyy-mm-dd>/...
  library/   # 预留
```

当前生效壁纸仍走 **IDB + localStorage meta**（与现有兼容）。

## 分期

| 期 | 范围 | 首版 |
|----|------|------|
| P0 | 入口、Modal、X 瀑布流、下载、应用 | ✅ |
| P1 | Imagine 静图 | ✅ |
| P2 | Imagine 视频、我的库管理、分页 | 后续 |

## 非目标

- 云同步 / 每日自动轮换  
- 把聊天会话当选图 UI  
- 重编码视频  

## Host 命令

| Command | 说明 |
|---------|------|
| `wallpaper_x_search` | `{ query, sort? }` → `{ items, errorCode? }` |
| `wallpaper_fetch_media` | `{ url, source? }` → `{ path, mime, bytes }` |
| `wallpaper_imagine` | `{ prompt, aspectRatio? }` → gallery item + localPath |
| `wallpaper_library_list` | 最近库文件 |

## 错误码

`auth_required` · `cli_missing` · `search_failed` · `empty` · `download_failed` · `url_blocked` · `imagine_failed` · `timeout`
