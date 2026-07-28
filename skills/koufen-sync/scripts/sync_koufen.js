const https = require('https');
const fs = require('fs');
const path = require('path');

const APP_ID = process.env.FEISHU_APP_ID || 'cli_aa83b104e2f8dbe7';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const APP_TOKEN = process.env.FEISHU_APP_TOKEN || 'UxiFbg3lPaClaIsO2tTcmX2ynHf';
const SRC_TABLE = 'tbl5sjvBhkzeXuBq';
const TGT_TABLE = 'tblOx1ORipiEVFw1';
const MODE = process.argv.includes('--incremental') ? 'incremental' : 'full';
const STATE_FILE = path.join(__dirname, '..', '..', 'memory', 'koufen_state.json');

let tenantToken = null;

// ===== UTILS =====
function request(method, hostname, path, body, headers) {
  return new Promise(function(resolve, reject) {
    var h = { 'Content-Type': 'application/json' };
    if (headers) Object.assign(h, headers);
    var opts = { method: method, hostname: hostname, path: path, headers: h, timeout: 30000 };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getTenantToken() {
  var res = await request('POST', 'open.feishu.cn', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: APP_ID, app_secret: APP_SECRET });
  if (res.data.code !== 0) throw new Error('Auth failed: ' + JSON.stringify(res.data));
  tenantToken = res.data.tenant_access_token;
}

async function feishuGet(path) {
  var res = await request('GET', 'open.feishu.cn', path, null, { Authorization: 'Bearer ' + tenantToken });
  return res.data;
}

async function feishuPost(path, body) {
  var res = await request('POST', 'open.feishu.cn', path, body, { Authorization: 'Bearer ' + tenantToken });
  if (res.data.code !== 0) throw new Error('POST ' + path + ': ' + JSON.stringify(res.data));
  return res.data;
}

async function listAllRecords(tableId) {
  var all = [], pageToken;
  while (true) {
    var p = '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + tableId + '/records?page_size=500' + (pageToken ? '&page_token=' + pageToken : '');
    var res = await feishuGet(p);
    all = all.concat((res.data && res.data.items) || []);
    if (!res.data || !res.data.has_more) break;
    pageToken = res.data.page_token;
  }
  return all;
}

// ===== STATE FILE =====
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      var raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return { processedIds: raw.processedIds || [], lastSync: raw.lastSync || '' };
    }
  } catch (e) { /* corrupt, start fresh */ }
  return { processedIds: [], lastSync: '' };
}

function saveState(state) {
  var dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.lastSync = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function addProcessedIds(state, newIds) {
  var set = {};
  for (var i = 0; i < state.processedIds.length; i++) set[state.processedIds[i]] = true;
  var added = 0;
  for (var j = 0; j < newIds.length; j++) {
    if (!set[newIds[j]]) {
      state.processedIds.push(newIds[j]);
      set[newIds[j]] = true;
      added++;
    }
  }
  return added;
}

// ===== FIELD MAPPINGS =====
var SECTION_DATES = { '配电板': '配电板检查时间', '钳工': '钳工检查时间', '电工': '电工检查时间' };
var SECTION_RESP = { '配电板': '配电板责任人', '钳工': '钳工责任人', '电工': '电工责任人' };

var DEDUCTION_MAP = {
  '扣分项1: 订单配置问题': { item: '1. 检查是否按生产订单要求生产，配置是否正确。', section: '钳工' },
  '扣分项2: 轮子/底脚缺失': { item: '2. 检查轮子及底脚是否安装齐全', section: '钳工' },
  '扣分项3: 台面导轨清洁问题': { item: '3. 检查台面及导轨是否干净整洁，导轨无锈迹，无铁屑且保养。', section: '钳工' },
  '扣分项4: 台面管子安装问题': { item: '4. 检查台面分区管子安装是否正确，气管走分区上面，无磨毛毡隐患，25以上设备安装毛毡滚轮', section: '钳工' },
  '扣分项5: 台面螺丝未紧固': { item: '5. 检查台面螺丝是否紧到位。', section: '钳工' },
  '扣分项6: 导轨齿条螺丝问题': { item: '6. 检查纵向导轨齿条螺丝是否紧到位，导轨帽是否安装到位', section: '钳工' },
  '扣分项7: 机身齿条间隙问题': { item: '7. 纵向推动横梁，检查机身齿条是否有间隙或异响，定位销是否安装', section: '钳工' },
  '扣分项8: 机身减速机安装问题': { item: '8. 检查机身减速机是否安装紧固，联轴器有无锁紧，齿轮是否安装到位顶丝打胶固定', section: '钳工' },
  '扣分项9: 机身限位块问题': { item: '9. 检查机身限位块位置和安装方向是否正确。', section: '钳工' },
  '扣分项10: 纵向限位感应问题': { item: '10. 检查纵向限位感应螺丝是否安装，且安装高度合适。', section: '钳工' },
  '扣分项11: 横梁选择安装问题': { item: '11. 检查横梁是否选择正确，安装是否居中，满足行程的情况下留出防尘罩位置。', section: '钳工' },
  '扣分项12: 机身齿条横向问题': { item: '12. 横向推动横梁，检查机身齿条是否有间隙或异响，定位销是否安装', section: '钳工' },
  '扣分项13: 横梁减速机安装问题': { item: '13. 检查横梁减速机是否安装紧固，联轴器有无锁紧，齿轮是否安装到位且用顶丝固定并打胶。', section: '钳工' },
  '扣分项14: 电机线头捆扎问题': { item: '14. 检查各电机线头是否正确捆扎。', section: '钳工' },
  '扣分项15: 压料板气缸问题': { item: '15. 检查压料板行程是否足够，压料气缸备帽打胶，夹料气缸是否齐全，安装是否正确。', section: '钳工' },
  '扣分项16: 滚筒支撑安装问题': { item: '16. 检查滚筒支撑是否安装且正确。', section: '钳工' },
  '扣分项17: 钣金安装问题': { item: '17. 检查钣金是否安装齐全无磕碰。', section: '钳工' },
  '扣分项18: 前后堵头高度问题': { item: '18. 检查前后堵头安装高度是否与台面齐平。', section: '钳工' },
  '扣分项19: 台面挡板安装问题': { item: '19. 检查台面两侧挡板是否安装平整且高度降到最低。', section: '钳工' },
  '扣分项20: 侧门前后门平齐问题': { item: '20. 检查侧门与前后门钣金是否平齐。', section: '钳工' },
  '扣分项21: 拖链安装问题': { item: '21. 检查横纵向拖链长短合适，链接是否备双螺帽且锁紧。', section: '钳工' },
  '扣分项22: 机头钣金锁紧问题': { item: '22. 检查机头钣金是否锁紧，螺丝选择是否正确（M4*8平头）。', section: '钳工' },
  '扣分项23: 机头钣金摩擦电机线问题': { item: '23. 上下移动刀座检查机头钣金是否会摩擦升降轴电机线。', section: '钳工' },
  '扣分项24: 防尘罩安装问题': { item: '24. 检查防尘罩规格是否选择正确，安装正确，有无磨边，异响等。', section: '钳工' },
  '扣分项25: 侧门前后门拉紧问题': { item: '25. 检查侧门及前后门是否拉紧，摇晃无异响。', section: '钳工' },
  '扣分项26: 流转卡自检签字问题': { item: '26. 检查是否在流转卡上自检签字。', section: '钳工' },
  '扣分项27: 风管连接反吹问题': { item: '27. 检查风管连接是否牢固，反吹安装是否正确', section: '钳工' },
  '配电板内无杂物扣分': { item: '配电板内无杂物', section: '配电板' },
  '配电板线路扣分': { item: '配电箱走线不规则', section: '配电板' },
  '配电板线路不进槽，不规则扣分': { item: '配电板线路不进槽，不规则', section: '配电板' },
  '线槽盖安装不完整扣分': { item: '线槽盖安装不完整', section: '配电板' },
  '线槽内接线扣分': { item: '线槽内接线', section: '配电板' },
  '强弱电不分离扣分': { item: '强弱电不分离', section: '配电板' },
  '端子压接扣分': { item: '所有端子压接是否紧固', section: '配电板' },
  '端子牌螺丝扣分': { item: '端子牌螺丝是否紧固', section: '配电板' },
  '驱动器地线扣分': { item: '驱动器地线安装是否并联', section: '配电板' },
  '线号不全，标号没有朝向外扣分': { item: '线号不全，标号没有朝向外', section: '配电板' },
  '固定螺丝缺失扣分': { item: '固定螺丝缺失', section: '配电板' },
  '电子元器件安装不整齐扣分': { item: '电子元器件安装不整齐', section: '配电板' },
  '纵向驱动电阻扣分': { item: '纵向驱动电阻缺失', section: '配电板' },
  '对射及二次覆膜装置磨线扣分': { item: '对射及二次覆膜装置磨线', section: '电工' },
  '拖链走线扣分': { item: '检查横纵向拖链走线是否规则有序，转弯处线路预留足够长且捆扎牢固', section: '电工' },
  '机身走线扣分': { item: '检查机身走线是否入槽，包括四角急停线路，线槽安装在架子上方以防叉车撞坏', section: '电工' },
  '机头线路检查不合格扣分': { item: '机头线路检查不合格', section: '电工' },
  '生产订单配置不符扣分': { item: '检查是否按生产订单要求生产，刀口配置，风机，系统是否正确。', section: '电工' },
};

function tsToDate(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function parseDeductionValue(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    if (val <= 0) return null;
    return { score: val };
  }
  if (typeof val === 'string') {
    var trimmed = val.trim();
    if (['无', '', '0', '否', '合格'].indexOf(trimmed) >= 0) return null;
    var numMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
    if (numMatch) return { score: parseFloat(numMatch[1]) };
    return { score: 5 };
  }
  return null;
}

// ===== CORE =====
async function incrementalSync() {
  // 1. Load state
  var state = loadState();
  var processedSet = {};
  for (var i = 0; i < state.processedIds.length; i++) {
    processedSet[state.processedIds[i]] = true;
  }
  console.error('State: ' + state.processedIds.length + ' already processed');

  // 2. Read source records
  console.error('Reading source...');
  var srcRecords = await listAllRecords(SRC_TABLE);
  console.error('Source total: ' + srcRecords.length + ' records');

  // 3. Filter: 终检结果有值 AND not already processed
  var newRecords = [];
  var totalWithFinal = 0;
  for (var i = 0; i < srcRecords.length; i++) {
    var rec = srcRecords[i];
    var finalResult = rec.fields['终检结果'];
    if (finalResult && finalResult !== '') {
      totalWithFinal++;
      if (!processedSet[rec.record_id]) {
        newRecords.push(rec);
      }
    }
  }

  console.error('终检完成: ' + totalWithFinal + '  |  新记录: ' + newRecords.length + '  |  已跳过: ' + (totalWithFinal - newRecords.length));

  if (newRecords.length === 0) {
    // Count orphans
    var existingTarget = await listAllRecords(TGT_TABLE);
    var srcIds = {};
    for (var j = 0; j < srcRecords.length; j++) srcIds[srcRecords[j].record_id] = true;
    var orphans = 0;
    for (var k = 0; k < existingTarget.length; k++) {
      if (!srcIds[existingTarget[k].fields['原始记录ID']]) orphans++;
    }

    console.error('\n========== 同步报告 ==========');
    console.error('新增: 0  更新: 0  跳过: ' + totalWithFinal);
    if (orphans > 0) console.error('⚠️ 孤儿: ' + orphans + ' 条');
    console.error('总条数: ' + existingTarget.length);
    var ts = 0;
    for (var m = 0; m < existingTarget.length; m++) ts += Number(existingTarget[m].fields['分值']) || 0;
    console.error('总分值: ' + ts);
    console.log(JSON.stringify({ created: 0, updated: 0, skipped: totalWithFinal, orphans: orphans, errors: 0, total: existingTarget.length, totalScore: ts, mode: 'incremental' }));
    return;
  }

  // 4. Extract deductions from new records only
  console.error('Extracting deductions from ' + newRecords.length + ' new records...');
  var deductions = [];
  var processedIds = [];

  for (var i = 0; i < newRecords.length; i++) {
    var rec = newRecords[i];
    var f = rec.fields;
    var recordId = rec.record_id;
    var qcNo = f['质检编号'] || '';
    var orderNo = f['订单编号'] || '';
    var hasDeduction = false;

    var fieldNames = Object.keys(DEDUCTION_MAP);
    for (var j = 0; j < fieldNames.length; j++) {
      var fieldName = fieldNames[j];
      var config = DEDUCTION_MAP[fieldName];
      var parsed = parseDeductionValue(f[fieldName]);
      if (!parsed) continue;

      hasDeduction = true;
      var section = config.section;
      var date = tsToDate(f[SECTION_DATES[section]]);
      var resp = f[SECTION_RESP[section]];
      var responsible = Array.isArray(resp) ? resp.join(' | ') : (resp || '');

      deductions.push({ recordId: recordId, qcNo: qcNo, orderNo: orderNo, section: section, date: date, responsible: responsible, item: config.item, score: parsed.score });
    }

    // Mark as processed (even if no deduction - record is complete)
    processedIds.push(recordId);
    if (!hasDeduction) {
      // console.error('  No deductions in ' + qcNo + ' (completed, no issues)');
    }
  }

  // 5. Sort & number
  deductions.sort(function(a, b) {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.qcNo.localeCompare(b.qcNo);
  });

  // Read existing target to determine starting seq
  var existingTarget = await listAllRecords(TGT_TABLE);
  var maxSeq = 0;
  for (var i = 0; i < existingTarget.length; i++) {
    var s = Number(existingTarget[i].fields['序号']) || 0;
    if (s > maxSeq) maxSeq = s;
  }

  for (var i = 0; i < deductions.length; i++) {
    deductions[i].seq = maxSeq + i + 1;
  }

  console.error('New deductions: ' + deductions.length);

  // 6. Check for duplicates in existing target (防重复)
  var existingKeys = {};
  for (var i = 0; i < existingTarget.length; i++) {
    var ef = existingTarget[i].fields;
    if (ef['原始记录ID'] && ef['不合格项']) {
      existingKeys[ef['原始记录ID'] + '|||' + ef['不合格项']] = true;
    }
  }

  // 7. Create target records
  var created = 0, skipped = 0, errors = 0;
  for (var i = 0; i < deductions.length; i++) {
    var d = deductions[i];
    var key = d.recordId + '|||' + d.item;

    if (existingKeys[key]) {
      skipped++;
      continue;
    }

    try {
      await feishuPost('/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + TGT_TABLE + '/records', {
        fields: {
          '原始记录ID': d.recordId, '来源表': SRC_TABLE, '质检编号': d.qcNo,
          '订单编号': d.orderNo, '工段': d.section, '检验时间': d.date,
          '责任人': d.responsible, '不合格项': d.item, '分值': d.score, '序号': d.seq,
        }
      });
      created++;
      if (created % 10 === 0) console.error('Created ' + created + '/' + deductions.length + '...');
    } catch (e) {
      errors++;
      console.error('ERROR: ' + e.message);
      if (errors > 10) break;
    }
  }

  // 8. Update state file
  addProcessedIds(state, processedIds);
  saveState(state);
  console.error('State updated: ' + state.processedIds.length + ' processed IDs saved');

  // 9. Verify & report
  var final = await listAllRecords(TGT_TABLE);
  var totalScore = 0;
  for (var i = 0; i < final.length; i++) totalScore += Number(final[i].fields['分值']) || 0;

  // Check orphans
  var srcIds = {};
  for (var i = 0; i < srcRecords.length; i++) srcIds[srcRecords[i].record_id] = true;
  var orphans = 0;
  for (var i = 0; i < final.length; i++) {
    if (!srcIds[final[i].fields['原始记录ID']]) orphans++;
  }

  console.error('\n========== 同步报告 ==========');
  console.error('新增扣分: ' + created + '  防重复跳过: ' + skipped + '  已处理记录: ' + processedIds.length);
  if (orphans > 0) console.error('⚠️ 孤儿: ' + orphans + ' 条（源表已无对应记录）');
  console.error('错误: ' + errors);
  console.error('总条数: ' + final.length + '  总分值: ' + totalScore);
  console.log(JSON.stringify({ created: created, skipped: skipped, processedRecords: processedIds.length, orphans: orphans, errors: errors, total: final.length, totalScore: totalScore, mode: 'incremental' }));
}

async function fullSync() {
  console.error('Full sync: reading source...');
  var srcRecords = await listAllRecords(SRC_TABLE);
  console.error('Source: ' + srcRecords.length + ' records');

  // Extract from ALL records (full rewrite)
  var deductions = [];
  for (var i = 0; i < srcRecords.length; i++) {
    var rec = srcRecords[i];
    var f = rec.fields;
    var recordId = rec.record_id;
    var qcNo = f['质检编号'] || '';
    var orderNo = f['订单编号'] || '';

    var fieldNames = Object.keys(DEDUCTION_MAP);
    for (var j = 0; j < fieldNames.length; j++) {
      var fieldName = fieldNames[j];
      var config = DEDUCTION_MAP[fieldName];
      var parsed = parseDeductionValue(f[fieldName]);
      if (!parsed) continue;

      var section = config.section;
      var date = tsToDate(f[SECTION_DATES[section]]);
      var resp = f[SECTION_RESP[section]];
      var responsible = Array.isArray(resp) ? resp.join(' | ') : (resp || '');

      deductions.push({ recordId: recordId, qcNo: qcNo, orderNo: orderNo, section: section, date: date, responsible: responsible, item: config.item, score: parsed.score });
    }
  }

  deductions.sort(function(a, b) {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.qcNo.localeCompare(b.qcNo);
  });
  for (var i = 0; i < deductions.length; i++) deductions[i].seq = i + 1;

  console.error('Extracted: ' + deductions.length + ' deductions');

  // Clear target
  console.error('Clearing target...');
  var existing = await listAllRecords(TGT_TABLE);
  for (var i = 0; i < existing.length; i++) {
    try {
      await request('DELETE', 'open.feishu.cn', '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + TGT_TABLE + '/records/' + existing[i].record_id, null, { Authorization: 'Bearer ' + tenantToken });
    } catch (e) { /* skip */ }
  }
  console.error('Deleted ' + existing.length + ' old records');

  // Create
  var created = 0, errors = 0;
  for (var i = 0; i < deductions.length; i++) {
    var d = deductions[i];
    try {
      await feishuPost('/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + TGT_TABLE + '/records', {
        fields: {
          '原始记录ID': d.recordId, '来源表': SRC_TABLE, '质检编号': d.qcNo,
          '订单编号': d.orderNo, '工段': d.section, '检验时间': d.date,
          '责任人': d.responsible, '不合格项': d.item, '分值': d.score, '序号': d.seq,
        }
      });
      created++;
      if (created % 10 === 0) console.error('Created ' + created + '/' + deductions.length + '...');
    } catch (e) {
      errors++;
      console.error('ERROR #' + d.seq + ': ' + e.message);
      if (errors > 10) break;
    }
  }

  // Reset state
  var state = { processedIds: [], lastSync: new Date().toISOString() };
  for (var i = 0; i < srcRecords.length; i++) {
    var finalResult = srcRecords[i].fields['终检结果'];
    if (finalResult && finalResult !== '') {
      state.processedIds.push(srcRecords[i].record_id);
    }
  }
  saveState(state);
  console.error('State saved: ' + state.processedIds.length + ' processed IDs');

  var final = await listAllRecords(TGT_TABLE);
  var totalScore = 0;
  for (var i = 0; i < final.length; i++) totalScore += Number(final[i].fields['分值']) || 0;

  console.error('\n========== 同步报告 ==========');
  console.error('新增: ' + created + '  错误: ' + errors);
  console.error('总条数: ' + final.length + '  总分值: ' + totalScore);
  console.log(JSON.stringify({ created: created, errors: errors, total: final.length, totalScore: totalScore, mode: 'full' }));
}

// ===== MAIN =====
async function main() {
  if (!APP_SECRET) {
    console.error('ERROR: FEISHU_APP_SECRET not set.');
    console.error('Usage: FEISHU_APP_SECRET=*** node sync_koufen.js');
    process.exit(1);
  }

  await getTenantToken();

  if (MODE === 'full') {
    await fullSync();
  } else {
    await incrementalSync();
  }
}

main().catch(function(e) { console.error('FATAL:', e.message); process.exit(1); });
