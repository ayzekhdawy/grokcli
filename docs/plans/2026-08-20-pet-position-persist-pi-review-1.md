# 审核结论：无 blocker

已对照桌面宠物关闭再开丢位置的修复审 `pet_window.rs` / `lib.rs` Exit flush / `pet.ts` / `petBubbleLayout.ts` / `PetOverlay.tsx` 及相关测试。Rust `pet_window` 24/24、相关 JS 测试全绿。四个声称根因均被覆盖，指定回归点未发现破坏。

---

## 根因验证

1. **拖动坐标没写盘 — 已修复。** `pet_set_dragging` 不再用 `was && !dragging`，改为 DRAGGING=false 时无条件 persist。前端 `finishDrag` 把 `petSetDragging(false)` 移到 `petSyncOverlaySize` resolve 之后。
2. **hide 时 0,0 落盘 — 已修复，双保险。** `hide_pet` 在 `win.hide()` 之前 persist；Moved 要求 `dragging && visible`。
3. **`pet_prefs_set` 用前端过期 x/y 覆盖 — 已修复。** 先 persist 现场，再用 `keep_live_overlay_pos` 保住磁盘 x/y/overlay 尺寸。
4. **存窗口左上角导致宠物跑位 — 已修复。** 同时存逻辑宽高；重开按 mark 底边中心对齐。Rust `restore_overlay_origin` 与 JS `petOverlayOriginForSize` 数学一致。

## 非 blocker

1. `RunEvent::Exit` 在窗口已隐藏时 `persist_pet_window_pos` 会因 `is_visible()` 守卫 no-op。hide_pet + 拖动 persist 已覆盖绝大多数路径。
2. Moved 处理器每个事件多一次 `is_visible()`，拖动期间高频但轻量。
3. `petOverlay.guard.test.ts` 源码快照较脆（既有模式）。
4. `overlay_w/h` 会随 prefs 返回前端，无 UI 影响。

**结论：** 无 blocker，可进入下一项。
