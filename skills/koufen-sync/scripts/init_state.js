const https = require('https');
const fs = require('fs');
const path = require('path');

const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const APP_TOKEN = 'UxiFbg3lPaClaIsO2tTcmX2ynHf';
const SRC_TABLE = 'tbl5sjvBhkzeXuBq';
const STATE_FILE = path.join(__dirname, '..', 'memory', 'koufen_state.json');

let tenantToken;

function request(method, hostname, path, body, headers) {
  return new Promise(function(resolve, reject) {
    var h = { 'Content-Type': 'application/json' };
    if (headers) Object.assign(h, headers);
    var req = https.request({ method: method, hostname: hostname, path: path, headers: h, timeout: 30000 }, function(res) {
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

async function main() {
  var res = await request('POST', 'open.feishu.cn', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: 'cli_aa83b104e2f8dbe7', app_secret: APP_SECRET });
  if (res.data.code !== 0) throw new Error('Auth: ' + JSON.stringify(res.data));
  tenantToken = res.data.tenant_access_token;

  var all = [], pageToken;
  while (true) {
    var p = '/open-apis/bitable/v1/apps/' + encodeURIComponent(APP_TOKEN) + '/tables/' + SRC_TABLE + '/records?page_size=500' + (pageToken ? '&page_token=' + pageToken : '');
    res = await request('GET', 'open.feishu.cn', p, null, { Authorization: 'Bearer ' + tenantToken });
    all = all.concat((res.data && res.data.items) || []);
    if (!res.data || !res.data.has_more) break;
    pageToken = res.data.page_token;
  }

  console.error('Total source records: ' + all.length);

  var processedIds = [];
  var hasFinal = 0;
  for (var i = 0; i < all.length; i++) {
    var finalResult = all[i].fields['终检结果'];
    if (finalResult && finalResult !== '') {
      processedIds.push(all[i].record_id);
      hasFinal++;
    }
  }

  console.error('Records with 终检结果: ' + hasFinal);
  console.error('Processed IDs: ' + processedIds.length);

  var dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  var state = { processedIds: processedIds, lastSync: new Date().toISOString() };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  var tgtRes = await request('GET', 'open.feishu.cn', '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/tblOx1ORipiEVFw1/records?page_size=500', null, { Authorization: 'Bearer ' + tenantToken });
  var tgtCount = (tgtRes.data && tgtRes.data.items) ? tgtRes.data.items.length : 0;
  var totalScore = 0;
  if (tgtRes.data && tgtRes.data.items) {
    for (var j = 0; j < tgtRes.data.items.length; j++) {
      totalScore += Number(tgtRes.data.items[j].fields['分值']) || 0;
    }
  }

  console.error('Target records: ' + tgtCount + ' | Total score: ' + totalScore);
  console.error('State file saved to: ' + STATE_FILE);
  console.log(JSON.stringify({ processedIds: processedIds.length, targetRecords: tgtCount, totalScore: totalScore }));
}

main().catch(function(e) { console.error('FATAL:', e.message); process.exit(1); });
