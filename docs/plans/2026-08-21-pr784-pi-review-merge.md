# PR #784 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash）核对 `/tmp/pr784.diff`。无 blocker。合入 `c2f7f782`。Fixes #783。

Draft 先 `gh pr ready` 再 squash。CI 四门绿。`windowChrome` + `window-config` 13 测通过。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | 根因：maximize 时指针仍按下 → Aero drag-to-restore | ✅ 32ms defer past mouse-up |
| 2 | 根因：body transform 破坏 `-webkit-app-region: drag` | ✅ 去掉 viewport pin |
| 3 | 8px 顶边 no-drag 保留原生 HTTOP | ✅ z-index 低于 caption |
| 4 | Linux work-area fill 仍在 | ✅ |
| 5 | 不重演 #735；无 App.tsx useState / confirm | ✅ |
| 6 | CHANGELOG Unreleased 追加 #783，改写 #773 去掉 pin 表述 | ✅ 未覆盖 0.2.24 |

## 非 blocker

去掉 pin 后顶边原生 resize 若仍有轻微 visualViewport 平移，可后续再补，不阻塞。`scheduleCaptionButtonToggle` 不取消上一次 timeout。
