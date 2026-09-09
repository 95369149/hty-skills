import fs from "node:fs/promises";
import crypto from "node:crypto";

const artifactModule = process.env.ARTIFACT_TOOL_MODULE || "@oai/artifact-tool";
const { FileBlob, SpreadsheetFile } = await import(artifactModule);

const [workbookPath, expectedArg = ""] = process.argv.slice(2);
if (!workbookPath) {
  console.error("Usage: node verify_workbook.mjs <workbook.xlsx> [order1,order2,...]");
  process.exit(2);
}

const requiredSheets = [
  "首页数据看板", "订单总台账", "排产执行表", "使用说明", "基础配置", "工序负荷看板",
  "异常跟踪表", "今日调度清单", "生产日报", "每日排产表", "待确认任务池", "人员配置"
];
const expectedOrders = expectedArg.split(",").map(v => v.trim()).filter(Boolean);
const data = await fs.readFile(workbookPath);
const hash = crypto.createHash("sha256").update(data).digest("hex");
const stat = await fs.stat(workbookPath);
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const sheetInspection = await wb.inspect({kind: "sheet", include: "id,name", maxChars: 10000});
const sheetNames = [...sheetInspection.ndjson.matchAll(/"name":"([^"]+)"/g)].map(m => m[1]);
const missingSheets = requiredSheets.filter(name => !sheetNames.includes(name));

const ledger = wb.worksheets.getItem("订单总台账");
const values = ledger.getUsedRange().values;
const orderRows = new Map();
for (let i = 1; i < values.length; i++) {
  const no = String(values[i]?.[0] ?? "").trim();
  if (!no) continue;
  const rows = orderRows.get(no) ?? [];
  rows.push(i + 1);
  orderRows.set(no, rows);
}
const expected = Object.fromEntries(expectedOrders.map(no => [no, orderRows.get(no) ?? []]));
const duplicates = Object.fromEntries(expectedOrders.flatMap(no => {
  const rows = orderRows.get(no) ?? [];
  return rows.length > 1 ? [[no, rows]] : [];
}));
const formulaColumns = [5, 7, 22, 23, 24, 25]; // F/H/W/X/Y/Z; explicit user overrides remain possible.
const formulaIssues = [];
for (const no of expectedOrders) {
  const rows = orderRows.get(no) ?? [];
  if (rows.length !== 1) continue;
  const row = rows[0];
  const formulas = ledger.getRange(`A${row}:Z${row}`).formulas[0];
  for (const col of formulaColumns) {
    if (!formulas[col]) formulaIssues.push({order: no, row, columnIndex: col + 1});
  }
}

const expectedRows = expectedOrders.flatMap(no => expected[no] ?? []).sort((a, b) => a - b);
const contiguousIssues = expectedRows.length > 1 && expectedRows.some((row, i) => i > 0 && row !== expectedRows[i - 1] + 1)
  ? [{rows: expectedRows}]
  : [];

const result = {
  ok: missingSheets.length === 0 && expectedOrders.every(no => expected[no].length === 1) && Object.keys(duplicates).length === 0 && formulaIssues.length === 0 && contiguousIssues.length === 0,
  workbookPath,
  size: stat.size,
  modifiedAt: stat.mtime.toISOString(),
  sha256: hash,
  sheetCount: sheetNames.length,
  missingSheets,
  expectedOrders: expected,
  duplicates,
  formulaIssues,
  contiguousIssues
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
