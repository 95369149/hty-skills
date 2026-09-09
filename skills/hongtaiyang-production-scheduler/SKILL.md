---
name: hongtaiyang-production-scheduler
description: Guides and maintains the Hongtaiyang production scheduling workbook, including order intake, daily scheduling, feedback closure, exception tracking, and dashboard consistency.
---

# 红太阳生产排产指导

## Workbook

Default workbook:

`/Users/buguojun/Desktop/步国军/红太阳生产/红太阳生产计划排产看板（codex）.xlsx`

Maintain this workbook directly unless the user explicitly names another file. New orders append after the last real order row in `订单总台账`; never insert in the middle.

This is the only production workbook. The visible production directory must contain exactly one workbook: the canonical file above. Do not synchronize or edit similarly named copies outside this directory. Store safety copies only under the hidden folder `.codex-backups/` beside the workbook, and store transaction files only under the hidden folder `.codex-work/`. Never leave `.bak`, `.damaged`, timestamped, or temporary `.xlsx` files in the visible production directory, and never open a temporary workbook in WPS.

## Workbook schema and field mapping

`订单总台账` has 27 columns `A:AA`. Every appended row must contain exactly 27 values; personnel columns `R:V` and derived columns `W:Z` must not be shifted by an extra blank value. New rows copy the last real row's formatting, then write values and formulas explicitly.

- Formula columns for new orders: `F` planned shipment, `H` partition, `W` remaining days, `X` risk flag, `Y` risk sequence, `Z` order type.
- Normalize model names to the workbook convention (`6代1625自动送料`, not `六代机1625自动送料`) so the partition formula parses correctly. Preserve distinctive machine families such as `吊臂机` or laser models when the workbook has no equivalent normalization.
- If the user explicitly supplies a delivery deadline such as “9月底” or “国庆节前”, preserve it in `F` with a formula/value override and also record the original work-duration requirement in `E`/`AA`; do not silently replace an explicit deadline with a computed date.
- If the user explicitly calls an order a `样机`, set `Z` to a formula/value that returns `样机`; do not let the generic customer-address heuristic classify it as a customer order.

## Transactional Write Protocol

Treat every workbook edit as a transaction. Do not report success until all steps pass.

1. **Preflight**
   - Before any write, close WPS/Excel/Numbers/LibreOffice processes and verify none remain. If an office process is active and cannot be safely closed, stop before preparing a temporary workbook.
   - Read the canonical workbook fresh from disk immediately before every edit. The current on-disk canonical file is the only edit source.
   - Never use a backup, an earlier export, a prepared temporary workbook, or remembered row data as the edit source. Backups are rollback-only.
   - If the user opens or saves the workbook after preparation begins, discard the prepared temporary workbook, reread the newly saved canonical file, and restart the transaction.
   - Confirm WPS, Excel, Numbers, and LibreOffice are fully closed. If any office process is running, stop and ask the user to close it; background auto-save can overwrite the result.
   - Record the workbook modification time, size, sheet names, and SHA-256 hash.
   - Save a timestamped backup in `.codex-backups/`.
2. **Locate data dynamically**
   - Find the last real order by the last non-empty value in `订单总台账!A:A`.
   - Never use `UsedRange` length, a fixed row number, sorting position, or blank formula rows to choose the destination.
   - Reject duplicate order numbers. Update an existing order only when the user explicitly sends a correction.
   - If one user request contains multiple machines, split into distinct order numbers (`W029-1`, `W029-2`, etc.) when requested or when separate tracking is operationally necessary; each split row gets quantity `1` and copies the shared configuration.
3. **Write to a temporary workbook**
   - Import the canonical workbook once.
   - Apply all requested edits in memory.
   - Export to a temporary `.xlsx` beside the canonical workbook. Never export directly over the canonical file.
4. **Validate the temporary workbook**
   - Reopen the temporary file from disk.
   - Confirm all 12 required sheets exist: `首页数据看板`, `订单总台账`, `排产执行表`, `使用说明`, `基础配置`, `工序负荷看板`, `异常跟踪表`, `今日调度清单`, `生产日报`, `每日排产表`, `待确认任务池`, `人员配置`.
   - Confirm every expected order number appears exactly once and record its actual row.
   - Confirm new order rows are contiguous after the prior last real row, are not hidden, and are not excluded by an active filter.
   - Confirm formulas or explicit values in `F/H/W/X/Y/Z` match the order data. Explicit user values such as `智能12分区` override formula inference.
   - Confirm an explicit machine count was not left only in free text: either keep a single quantity in `G` or split into individually trackable order numbers with `G=1`.
   - Render the affected rows and visually verify the values.
5. **Commit atomically**
   - Replace the canonical workbook with the validated temporary file using an atomic rename.
   - Reopen the canonical workbook and run `scripts/verify_workbook.mjs` with the expected order numbers.
   - Wait five seconds, then confirm modification time, size, and SHA-256 hash have not changed. A change means an office process overwrote the file; restore the backup and report failure.
6. **Complete**
   - Report the canonical path, actual order rows, and final modification time.
   - Never say “已完成” based only on a write command or an in-memory inspection.

If any validation fails, do not partially commit. Restore the backup and state which check failed.

## Order Intake Defaults

When the user sends a new order, fill missing fields with these defaults:

- `系统`：if not mentioned, write `乾诚`.
- `电机`：if not mentioned, write `东菱`.
- `机型`：`特价机`在生产分类和公式中等同于`5代机`，机型列统一写为`5代+幅面+形式`，例如`特价机2035自动送料`写为`5代2035自动送料`；如需保留特价属性，写入备注。
- `空压机`：if not mentioned, write `无`.
- `送料架`：
  - if the model is `定台`, write `无`;
  - if the model is `送料` and no special feeder is mentioned, write `简易送料架`;
  - if a special feeder is mentioned, preserve it, e.g. `四层送料架`, `一体送料架`, `送料+延长台面`.
- Preserve explicit non-default values from the user, e.g. `以色列电机`, `国产电机`, `中瑞`, language-specific systems, or special feeder structures.
- Put free-form remarks only in `订单总台账!AA`. Do not put remarks into personnel columns.

## Daily Scheduling Rules

- `每日排产表` records the plan and feedback closure; it is not the current machine progress source.
- `订单总台账!O` is the current real progress. Only completion feedback advances it.
- New daily plan rows use `执行状态=已安排`.
- Completion feedback:
  - `✅`: set daily row to `已完成`, write actual completion, and advance ledger progress only to the completed node.
  - `❎`: set daily row to `未完成`, keep ledger progress unchanged, and write tomorrow carryover.
  - Missing feedback on an older planned row is treated as unfinished carryover before generating the next plan.
- Sunday is normally rest day. Monday should carry over from the previous production day.

## Planning Priority

Use this priority order:

1. Today's confirmed manual plan, if present.
2. Previous production day's unfinished or carryover rows.
3. Previous production day's completed rows that naturally move to the next process.
4. Urgent delivery pressure.
5. Recent new orders needing material/frame confirmation.
6. Generic due-date pressure.

Do not let stale overdue rows outrank recent carryover unless the user explicitly schedules them.

## Output Format

Always output daily plans in the user's plain format:

```text
今日（6月22日）生产计划：
1.6代1625送料二序完成（140订单）
2.皮带机1830自动送料开工一序（146订单）❗️❗️
```

No table. Keep urgent marks at the end of the line.

## Validation Baseline

After workbook edits:

- Confirm the workbook opens.
- Confirm `订单总台账` freeze pane is `A2`.
- Confirm formula columns `F/H/W/X/Y/Z` exist on all real order rows.
- Confirm no active `每日排产表` row is isolated from either `订单总台账` or `待确认任务池`.
- Run `scripts/verify_workbook.mjs` after order intake and workbook repair.
- Do not use `openpyxl` for workbook authoring. Use the spreadsheet runtime required by the spreadsheet skill.
