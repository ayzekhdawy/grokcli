# 官网下载对接（grok-app.com）

本文是 **grok-app.com** 与本仓库 GitHub Release 的下载契约。官网另开仓库；安装包永远留在 GitHub，官网只出页面和按钮。

实现官网前只读本文。发版步骤仍以 [release.md](./release.md) 为准。

## 1. 结论（先看这个）

| 问题 | 答案 |
|------|------|
| 文件放哪 | `RongleCat/grok-app` 的 GitHub Release，不放官网仓 |
| 谁出流量 | GitHub CDN。官网只托管 HTML/CSS/图 |
| 按钮怎么写 | `href` 指向 GitHub；或官网短链 **302** 到 GitHub。禁止反代 / 禁止把包打进 Pages |
| 怎么永远最新 | 用稳定文件名 + `/releases/latest/download/…` |
| 版本号从哪来 | 构建时拉 `downloads.json`，不要浏览器里现拉（CORS） |
| 现网 v0.2.19 | **还没有**稳定别名。下一枚正式 `v*` tag 的 Release 才会挂上 |

不要链到：

- `grok-desktop-latest`（应用内静默更新：`.app.tar.gz` / `latest.json`）
- `*.sig`、`SHA256SUMS` 以外的校验旁路文件当「下载 App」
- `latest.json`（给 Tauri updater，不是给人点的）

## 2. 拓扑

```
用户点 grok-app.com 按钮
        │
        │  <a href> 或 302
        ▼
GitHub  /releases/latest/download/Grok_mac_x64.dmg
        │
        │  302
        ▼
GitHub  /releases/download/vX.Y.Z/Grok_mac_x64.dmg
        │
        ▼
GitHub Releases CDN（objects.githubusercontent.com 等）
```

本仓库发版流水线（`.github/workflows/release.yml`）：

```
tag vX.Y.Z
  ├─ macOS ARM / Intel  → Grok_<ver>_aarch64.dmg / Grok_<ver>_x64.dmg
  ├─ Windows            → Grok_<ver>_x64-setup.exe / Grok_<ver>_x64-portable.zip
  ├─ Linux              → AppImage / .deb / .rpm
  ├─ grok-desktop-latest → 仅自动更新（官网不要用）
  └─ checksums job
        scripts/publish-website-downloads.py
          ├─ 复制稳定别名（Grok_mac_x64.dmg …）
          ├─ 写 downloads.json
          └─ 与 SHA256SUMS 一并挂到同一个 vX.Y.Z Release
```

`grok-desktop-latest` 创建时带 `--latest=false`，不会抢走 GitHub 的 “latest” 指向。

## 3. 稳定 URL（官网按钮写这些）

仓库：`RongleCat/grok-app`  
前缀：`https://github.com/RongleCat/grok-app/releases/latest/download/`

| 官网按钮 | `installers` 键 | 稳定文件名 | 完整 URL |
|----------|-----------------|------------|----------|
| macOS Apple Silicon | `mac-aarch64` | `Grok_mac_aarch64.dmg` | `…/latest/download/Grok_mac_aarch64.dmg` |
| macOS Intel | `mac-x64` | `Grok_mac_x64.dmg` | `…/latest/download/Grok_mac_x64.dmg` |
| Windows 安装版 | `windows-x64` | `Grok_windows_x64-setup.exe` | `…/latest/download/Grok_windows_x64-setup.exe` |
| Windows 绿色版 | `windows-x64-portable` | `Grok_windows_x64-portable.zip` | `…/latest/download/Grok_windows_x64-portable.zip` |
| Linux 通用 | `linux-x64-appimage` | `Grok_linux_x64.AppImage` | `…/latest/download/Grok_linux_x64.AppImage` |
| Debian 系 | `linux-x64-deb` | `Grok_linux_x64.deb` | `…/latest/download/Grok_linux_x64.deb` |
| Fedora / RHEL 系 | `linux-x64-rpm` | `Grok_linux_x64.rpm` | `…/latest/download/Grok_linux_x64.rpm` |
| 机器清单 | — | `downloads.json` | `…/latest/download/downloads.json` |

发版硬性要求：`mac-x64` 与 `windows-x64` 缺失则 checksums job 失败。其余键在对应平台构建成功时一并写入。四端 CI 全绿时上表 7 个安装包都会在。

### 3.1 各包给谁用

| 键 | 给谁 | 不要写成 |
|----|------|----------|
| `mac-aarch64` | M1 / M2 / M3 / M4 Mac | 「Mac 通用」 |
| `mac-x64` | Intel Mac | 默认主按钮（现在大多数人是 ARM） |
| `windows-x64` | Windows 10/11 x64 安装 | 「Windows ARM」 |
| `windows-x64-portable` | 免安装 zip | 主下载（主按钮用 setup.exe） |
| `linux-x64-appimage` | 任意桌面发行版；Arch / Manjaro 走这条 | 某个具体发行版专包 |
| `linux-x64-deb` | Ubuntu / Debian / Mint / Pop!_OS | Fedora |
| `linux-x64-rpm` | Fedora / RHEL / openSUSE | Ubuntu |

没有：macOS universal、Windows ARM、Linux aarch64、AUR、Flatpak、Snap。

### 3.2 版本化文件名（只作对照，不要写死在按钮上）

稳定别名与带版本号的文件是同一字节（同一 sha256）：

| 稳定名 | 版本化名（以 0.2.19 为例） |
|--------|---------------------------|
| `Grok_mac_aarch64.dmg` | `Grok_0.2.19_aarch64.dmg` |
| `Grok_mac_x64.dmg` | `Grok_0.2.19_x64.dmg` |
| `Grok_windows_x64-setup.exe` | `Grok_0.2.19_x64-setup.exe` |
| `Grok_windows_x64-portable.zip` | `Grok_0.2.19_x64-portable.zip` |
| `Grok_linux_x64.AppImage` | `Grok_0.2.19_amd64.AppImage` |
| `Grok_linux_x64.deb` | `Grok_0.2.19_amd64.deb` |
| `Grok_linux_x64.rpm` | `Grok-0.2.19-1.x86_64.rpm` |

按钮必须用左列。右列会随版本变，写死会在下一版 404。

## 4. `downloads.json`

下一枚正式 tag 之后：

```text
https://github.com/RongleCat/grok-app/releases/latest/download/downloads.json
```

### 4.1 顶层字段

| 字段 | 类型 | 含义 |
|------|------|------|
| `schemaVersion` | number | 现为 `1`。官网遇到不认识的主版本应拒绝静默猜测 |
| `product` | string | 固定 `Grok App` |
| `officialSite` | string | `https://grok-app.com` |
| `version` | string | 无 `v` 前缀，如 `0.2.20` |
| `tag` | string | 带 `v`，如 `v0.2.20` |
| `releaseUrl` | string | 该版 GitHub Release 页 |
| `downloadsJsonUrl` | string | 本文件的稳定 URL |
| `installers` | object | 以 id 为键，见下表 |

### 4.2 `installers.<id>`

| 字段 | 类型 | 官网怎么用 |
|------|------|------------|
| `id` | string | 与键相同，用来对按钮 |
| `os` | string | `macos` / `windows` / `linux` |
| `arch` | string | `aarch64` / `x64` |
| `kind` | string | `dmg` / `nsis` / `portable-zip` / `appimage` / `deb` / `rpm` |
| `label` | string | 英文短标签，UI 文案自己做 i18n，不要直接当中文 |
| `filename` | string | 稳定文件名 |
| `url` | string | **按钮 href**（`/releases/latest/download/…`） |
| `versionedFilename` | string | 带 semver 的源文件名 |
| `versionedUrl` | string | 钉死某一版时用；默认按钮不要用 |
| `sha256` | string | 小写 hex，可展示「校验」 |
| `size` | number | 字节数，可格式化成 `14.6 MB` |

### 4.3 样例（结构以此为准，数字随发版变）

```json
{
  "schemaVersion": 1,
  "product": "Grok App",
  "officialSite": "https://grok-app.com",
  "version": "0.2.20",
  "tag": "v0.2.20",
  "releaseUrl": "https://github.com/RongleCat/grok-app/releases/tag/v0.2.20",
  "downloadsJsonUrl": "https://github.com/RongleCat/grok-app/releases/latest/download/downloads.json",
  "installers": {
    "mac-aarch64": {
      "id": "mac-aarch64",
      "os": "macos",
      "arch": "aarch64",
      "kind": "dmg",
      "label": "macOS Apple Silicon",
      "filename": "Grok_mac_aarch64.dmg",
      "url": "https://github.com/RongleCat/grok-app/releases/latest/download/Grok_mac_aarch64.dmg",
      "versionedFilename": "Grok_0.2.20_aarch64.dmg",
      "versionedUrl": "https://github.com/RongleCat/grok-app/releases/download/v0.2.20/Grok_0.2.20_aarch64.dmg",
      "sha256": "…64 hex…",
      "size": 14121321
    },
    "mac-x64": {
      "id": "mac-x64",
      "os": "macos",
      "arch": "x64",
      "kind": "dmg",
      "label": "macOS Intel",
      "filename": "Grok_mac_x64.dmg",
      "url": "https://github.com/RongleCat/grok-app/releases/latest/download/Grok_mac_x64.dmg",
      "versionedFilename": "Grok_0.2.20_x64.dmg",
      "versionedUrl": "https://github.com/RongleCat/grok-app/releases/download/v0.2.20/Grok_0.2.20_x64.dmg",
      "sha256": "…",
      "size": 15305825
    },
    "windows-x64": {
      "id": "windows-x64",
      "os": "windows",
      "arch": "x64",
      "kind": "nsis",
      "label": "Windows x64",
      "filename": "Grok_windows_x64-setup.exe",
      "url": "https://github.com/RongleCat/grok-app/releases/latest/download/Grok_windows_x64-setup.exe",
      "versionedFilename": "Grok_0.2.20_x64-setup.exe",
      "versionedUrl": "https://github.com/RongleCat/grok-app/releases/download/v0.2.20/Grok_0.2.20_x64-setup.exe",
      "sha256": "…",
      "size": 11891913
    }
  }
}
```

Linux 三个键与 Windows portable 形状相同，按第 3 节文件名填。

生成脚本：`scripts/publish-website-downloads.py`。本地自测：

```bash
python3 scripts/publish-website-downloads.py --self-test
```

## 5. 官网怎么接（推荐实现）

### 5.1 构建时拉清单（推荐）

GitHub Release 资源 **没有** 给任意浏览器源开 CORS。页面里 `fetch(downloads.json)` 会失败。

官网 CI 在构建时用 Node / curl 拉（服务端无 CORS 问题），把结果写进站点：

```bash
curl -fsSL -L \
  -o downloads.json \
  https://github.com/RongleCat/grok-app/releases/latest/download/downloads.json
```

`-L` 必须开：`/releases/latest/download/…` 会 302 到具体 tag。

然后：

1. 校验 `schemaVersion === 1`
2. 校验至少存在 `installers["mac-x64"]` 与 `installers["windows-x64"]`
3. 页面主按钮 `href = installers[id].url`
4. 旁注版本：`v` + `version`（或直接用 `tag`）
5. 可选：`size`、`sha256`、`releaseUrl`（「发行说明」）

构建缓存：发版后官网应能再跑一次构建。两种触发都可以：

- 定时（每小时 / 每天）
- 本仓库发版成功后 `repository_dispatch` 打官网仓（官网仓建好再加，本仓库暂未接线）

构建失败（404 / JSON 坏了）时：**不要发布空按钮**。保留上一份成功的清单，或回退到第 5.2 节写死的稳定 URL，版本号显示「见 GitHub Releases」。

### 5.2 纯静态、不拉 JSON 也可以

按钮可以直接写死第 3 节的稳定 URL，零 API、零构建依赖。缺点是页面上的版本号不会自动变。可另加一个「所有版本」链到：

```text
https://github.com/RongleCat/grok-app/releases
```

两种可以一起用：href 写死稳定 URL，版本号来自构建时的 JSON。

### 5.3 探测用户系统（建议，非必须）

主 CTA 按 UA / `navigator.userAgentData` 选一个默认包，其余放「其他平台」：

| 探测 | 默认键 |
|------|--------|
| macOS + ARM | `mac-aarch64` |
| macOS + Intel / 无法判断 | `mac-x64`（若同时有 ARM，文案写清「Intel」；主 CTA 在无法判断时宁可指向 ARM 并提供 Intel 次按钮） |
| Windows | `windows-x64` |
| Linux | `linux-x64-appimage`，旁边给 deb / rpm |

无法判断时不要只给一个按钮，列出 Mac ARM / Mac Intel / Windows / Linux。

### 5.4 短链（可选）

若希望地址长成 `https://grok-app.com/download/mac-intel`：

| 短路径 | 302 Location |
|--------|----------------|
| `/download/mac` | `mac-aarch64` 的 `url`（默认 ARM） |
| `/download/mac-intel` | `mac-x64` 的 `url` |
| `/download/mac-arm` | `mac-aarch64` 的 `url` |
| `/download/windows` | `windows-x64` 的 `url` |
| `/download/windows-portable` | `windows-x64-portable` 的 `url` |
| `/download/linux` | `linux-x64-appimage` 的 `url` |
| `/download/linux-deb` | `linux-x64-deb` 的 `url` |
| `/download/linux-rpm` | `linux-x64-rpm` 的 `url` |

必须是 **HTTP 302/307**，响应里不要出现安装包字节。Cloudflare 橙色云不要反代这几个路径去拉 GitHub 大文件。

### 5.5 域名

- 站点：`https://grok-app.com/`（已上线；GitHub About website 与 `package.json` `homepage` 指向此地址）
- 皮肤目录 `OFFICIAL_SKIN_CATALOG_URL` 仍是空串；本文不覆盖皮肤 Apply

## 6. 校验与旁路文件

每个 Release 还有 `SHA256SUMS`（含版本化名和稳定别名，同一文件两个名字哈希相同）。

用户侧：

```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS --ignore-missing

# Windows PowerShell
Get-FileHash .\Grok_windows_x64-setup.exe -Algorithm SHA256
```

官网若展示校验：用 `installers[id].sha256`，并链到该版 `SHA256SUMS`：

```text
https://github.com/RongleCat/grok-app/releases/latest/download/SHA256SUMS
```

（`SHA256SUMS` 从合同落地的下一枚 tag 起才会和别名出现在同一 Release。）

## 7. 应用内「关于」

未签名 / 本机构建走 GitHub 手工下载时，Host `app_update.rs` 会在 Release 资产里挑当前平台的安装包。**稳定别名优先于版本化文件**，与官网主按钮同一条 URL。不要在官网上再发明第三套文件名。

## 8. 禁止事项

1. 把 `.dmg` / `.exe` / `.zip` / AppImage / `.deb` / `.rpm` 提交进官网仓。  
2. 让 Pages / Cloudflare / Vercel **代理下载**安装包（会变成你的流量账单，也容易超时）。  
3. 按钮指向 `…/releases/download/grok-desktop-latest/…`。  
4. 按钮指向 `*.app.tar.gz`、`*.sig`、`latest.json`。  
5. 在浏览器里依赖 GitHub API / `downloads.json` 的 CORS。  
6. 把 `v0.2.19` 写进官网按钮路径。  
7. 把 Linux 三种格式说成「三个发行版官方源」；它们是同一套 x64 构建的三种打包。

## 9. 验收

官网发布前：

- [ ] 七个安装按钮（或短链）都 302/直达 GitHub，响应不是官网域名吐出的文件流  
- [ ] Mac 两个架构都在，默认不明显导向 Intel  
- [ ] Windows 主按钮是 setup.exe，绿色版是次入口  
- [ ] Linux 能看到 AppImage + deb + rpm  
- [ ] 页面版本号与 `downloads.json` 的 `tag` 一致（若构建时有拉清单）  
- [ ] 国内访问失败时仍有「GitHub Releases」兜底链接  
- [ ] 没有链到 `grok-desktop-latest`

本仓库发版后：

- [ ] 该 tag 的 Release 资产同时有版本化名和稳定别名  
- [ ] 有 `downloads.json`，`schemaVersion === 1`  
- [ ] `installers.mac-x64.url` / `installers.windows-x64.url` 可下载  
- [ ] `SHA256SUMS` 里稳定名与版本化名哈希相同
