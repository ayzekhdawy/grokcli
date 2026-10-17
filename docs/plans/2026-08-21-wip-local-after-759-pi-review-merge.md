# 审核结论：**通过，无 blocker**

pi `-p`（tools: read, bash）核对 `origin/main..HEAD`（当时 `baa17f8a` + `fcef01cb`，完整 diff `/tmp/wip-local-after-759-land.diff`）。无 blocker，可落地。

## 核对表

| # | 核对项 | 结果 | 依据 |
|---|--------|------|------|
| 1 | 合入范围无夹带 | ✅ | 文件清单仅 pet 源码 + CHANGELOG 2 行 + docs。无 plugin-ui-host / ChatCut / session stall 源码重写。session-stall 源码已在 origin/main（#759） |
| 2 | CHANGELOG Unreleased 未被覆盖 | ✅ | 仅在 EN/中文 Fixed 顶部各追加 1 条宠物位置记忆；`#760/#755/#754` 等既有条目原样保留 |
| 3 | 宠物位置记忆在当前 main 自洽 | ✅ | Rust `restore_overlay_origin` 与 JS `petOverlayOriginForSize` 数学一致；Look/Bubbles 写回先 persist 现场；旧 prefs 无 overlay_w/h 时回退原原点 |
| 4 | 无 secrets / window.confirm / 硬编码文案 / API 破坏 | ✅ | `PetPrefs` 新增字段双端 optional；无新增 UI 字符串 |
| 5 | 文档提交只补 plan/review/listing | ✅ | `fcef01cb` 仅 `docs/plans/` + `docs/submit/`，零产品代码 |

## 测试（合入时）

- vitest `petBubbleLayout` + `petOverlay.guard` 19/19
- `cargo test pet_window` 24/24
- `pnpm typecheck` 绿

## 非 blocker

1. `petOverlay.guard.test.ts` 源码快照较脆（既有模式）。
2. `RunEvent::Exit` 在窗口已隐藏时因 `is_visible()` 守卫 no-op；`hide_pet` 已先持久化。
