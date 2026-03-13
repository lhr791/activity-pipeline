/**
 * Google Apps Script - 从 Supabase 拉取活动数据到 Google Sheets
 * （对齐前端 Activity Intelligence 看板）
 * 
 * 使用方法：
 * 1. 打开 Google Sheets → Extensions → Apps Script
 * 2. 把这段代码粘贴进去，替换默认内容
 * 3. 保存，然后运行 syncActivities()
 * 4. 设置触发器：Edit → Triggers → Add Trigger → syncActivities → 每小时
 */

// ====== 配置 ======
const SUPABASE_URL = 'https://lunwwthueinnokzpwkig.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bnd3dGh1ZWlubm9renB3a2lnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTk1MDU0NSwiZXhwIjoyMDg3NTI2NTQ1fQ.q91RlZpyPfZos5u4CGvgm5TkONYUyn28M8NpUKwKhGo';

// ====== Supabase 请求封装 ======
function supabaseGet(path) {
  Logger.log('supabaseGet called with path: ' + path);
  if (!path) {
    var stack = new Error().stack;
    Logger.log('STACK TRACE: ' + stack);
    throw new Error('supabaseGet: path is undefined! Stack: ' + stack);
  }
  const url = SUPABASE_URL + '/rest/v1/' + path;
  const response = UrlFetchApp.fetch(
    url,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      },
    }
  );
  return JSON.parse(response.getContentText());
}

// ====== 日期解析 ======
function parseDate(d) {
  if (!d) return 0;
  // 去掉时区标注 "(UTC+9)" 等
  const cleaned = d.replace(/\s*\(UTC[^)]*\)/gi, '').replace(/\//g, '-').trim();
  const ts = new Date(cleaned).getTime();
  return isNaN(ts) ? 0 : ts;
}

// ====== 去重逻辑（移植自前端 Dashboard.tsx deduplicateVersions）======
function deduplicateEvents(events) {
  const byType = {};
  for (const e of events) {
    const key = (e.exchange || '') + '_' + (e.type || 'other');
    if (!byType[key]) byType[key] = [];
    byType[key].push(e);
  }

  const result = [];
  for (const key of Object.keys(byType)) {
    const group = byType[key];
    if (group.length <= 1) {
      result.push(group[0]);
      continue;
    }
    // 按日期降序，取最新
    group.sort((a, b) => {
      const dB = parseDate(b.end_date) || parseDate(b.start_date);
      const dA = parseDate(a.end_date) || parseDate(a.start_date);
      if (dB !== dA) return dB - dA;
      return (b.reward || '').length - (a.reward || '').length;
    });
    result.push(group[0]);
  }

  // 全局排序：end_date 降序
  return result.sort((a, b) => parseDate(b.end_date) - parseDate(a.end_date));
}

// ====== 判断是否进行中（和前端 isSeriesActive 一致）======
function isActive(ev) {
  const now = Date.now();
  const end = parseDate(ev.end_date);
  if (end > 0) return end >= now;
  const start = parseDate(ev.start_date);
  return start > 0 && (now - start < 30 * 86400000);
}

// ====== 解析 TG 链接 → chat_id + message_id ======
function parseTgLink(link) {
  const match = (link || '').match(/\/c\/(\d+)\/(\d+)/);
  if (!match) return null;
  return {
    chat_id: -parseInt('100' + match[1]),
    message_id: parseInt(match[2]),
  };
}

// ====== 从 raw_messages 获取 TG 原文 ======
function fetchRawMessages() {
  // 全量拉取（目前 ~548 条，不大）
  const data = supabaseGet('raw_messages?select=chat_id,message_id,text&order=id.asc&limit=2000');
  // 建索引：key = "chat_id:message_id" → text
  const map = {};
  for (const m of data) {
    map[m.chat_id + ':' + m.message_id] = m.text;
  }
  return map;
}

// ====== 根据 source_links 查找原始消息 ======
function getOriginalMessages(ev, msgMap) {
  const links = ev.source_links || [];
  const texts = [];
  for (const link of links) {
    if (texts.length >= 2) break; // 最多取 2 条
    const parsed = parseTgLink(link);
    if (!parsed) continue;
    const key = parsed.chat_id + ':' + parsed.message_id;
    if (msgMap[key]) {
      texts.push(msgMap[key]);
    }
  }
  return texts.join('\n\n---\n\n');
}

// ====== 主函数 ======
function syncActivities() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // 1. 从 Supabase 拉取最新 summary
  const summaryData = supabaseGet('summaries?select=summary,created_at&order=created_at.desc&limit=1');
  if (!summaryData.length) {
    Logger.log('No summary data found');
    return;
  }

  const summary = typeof summaryData[0].summary === 'string'
    ? JSON.parse(summaryData[0].summary)
    : summaryData[0].summary;
  const updatedAt = summaryData[0].created_at;

  // 后端已按 active_events / expired_events 分好组
  const activeEvents = summary.active_events || [];
  const expiredEvents = summary.expired_events || [];

  // 后端已去重，直接使用
  const sortedEvents = [...activeEvents, ...expiredEvents];

  // 5. 清空表格
  sheet.clear();

  // 6. 写标题行
  const headers = [
    '状态', '交易所', '活动名称', '类型',
    '活动日期', '奖励内容', '参与条件',
    '最低入金', '最高奖励', '亏损抵扣%', '返佣比例%',
    '赠金类型', '提现条件',
    '仅新用户', '需KYC',
    '来源频道', '活动链接', 'TG 原消息'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // 标题样式
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#4285f4');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // 3. 拉取 TG 原始消息
  const msgMap = fetchRawMessages();

  // 4. 填数据
  const rows = sortedEvents.map(ev => {
    const status = (ev.status === 'active') ? '进行中' : '已结束';
    // 日期：优先取 rounds 最后一轮，fallback 到事件级
    const rounds = ev.rounds || [];
    let dateRange;
    if (rounds.length > 0) {
      const last = rounds[rounds.length - 1];
      const s = last.start || ev.start_date;
      const e = last.end || ev.end_date;
      dateRange = (s || '?') + ' ~ ' + (e || '?');
    } else {
      dateRange = (ev.start_date || '?') + ' ~ ' + (ev.end_date || '?');
    }
    const tgText = getOriginalMessages(ev, msgMap);

    return [
      status,
      ev.exchange || '',
      ev.event_name || '',
      formatType(ev.type),
      dateRange,
      cleanTags(ev.reward || ''),
      ev.requirements || '',
      ev.min_deposit || '',
      ev.max_reward || '',
      ev.loss_offset >= 0 ? ev.loss_offset : '未知',
      ev.commission_rate >= 0 ? ev.commission_rate : '未知',
      formatBonusType(ev.bonus_type),
      ev.withdrawal_condition || '',
      ev.new_users_only ? '是' : '否',
      ev.kyc_required === true ? '是' : ev.kyc_required === false ? '否' : '',
      (ev.sources || []).join(', '),
      ev.link || '',
      tgText,
    ];
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // 8. 条件格式
  const statusCol = 1; // A列（状态）
  if (rows.length > 0) {
    const statusRange = sheet.getRange(2, statusCol, rows.length, 1);

    const activeRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('进行中')
      .setBackground('#e6f4ea')
      .setRanges([statusRange])
      .build();

    const expiredRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('已结束')
      .setBackground('#f1f3f4')
      .setFontColor('#999999')
      .setRanges([statusRange])
      .build();

    // 进行中的行加浅绿背景
    const activeRowRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('进行中')
      .setBackground('#e6f4ea')
      .setRanges([sheet.getRange(2, 1, rows.length, headers.length)])
      .build();

    sheet.setConditionalFormatRules([activeRule, expiredRule]);
  }

  // 9. 进行中 / 已结束 分隔行（可选：在两组之间插入一行分隔）
  // 已通过排序和条件格式区分，暂不插入分隔行

  // 10. 自动调整列宽
  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }
  // 限制过宽的列
  sheet.setColumnWidth(6, 400);  // 奖励内容
  sheet.setColumnWidth(18, 500); // TG 原消息

  // 11. 更新记录
  const infoSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('更新记录')
    || SpreadsheetApp.getActiveSpreadsheet().insertSheet('更新记录');
  infoSheet.getRange(1, 1).setValue('最后同步时间');
  infoSheet.getRange(1, 2).setValue(new Date().toLocaleString('zh-CN'));
  infoSheet.getRange(2, 1).setValue('数据更新时间');
  infoSheet.getRange(2, 2).setValue(updatedAt);
  infoSheet.getRange(3, 1).setValue('活动总数（去重后）');
  infoSheet.getRange(3, 2).setValue(sortedEvents.length);
  infoSheet.getRange(4, 1).setValue('进行中');
  infoSheet.getRange(4, 2).setValue(activeEvents.length);
  infoSheet.getRange(5, 1).setValue('已结束');
  infoSheet.getRange(5, 2).setValue(expiredEvents.length);

  Logger.log(`Synced ${sortedEvents.length} events (${activeEvents.length} active, ${expiredEvents.length} expired) at ${new Date()}`);
}

// ====== 工具函数 ======

/** 清除 {{d:X}} {{v:X}} {{b:X}} 标签，保留内容 */
function cleanTags(text) {
  return text
    .replace(/\{\{[dvb]:(.*?)\}\}/g, '$1')
    .replace(/\n/g, '\n');
}

/** 活动类型中文化 */
function formatType(type) {
  const map = {
    'deposit_bonus': '入金赠金',
    'signup_bonus': '注册奖励',
    'airdrop': '空投',
    'other': '其他',
  };
  return map[type] || type || '';
}

/** 赠金类型中文化 */
function formatBonusType(type) {
  const map = {
    'opening_margin': '开仓保证金',
    'trial_fund': '体验金',
    'voucher': '代金券',
    'cash': '现金',
    'bonus': '赠金',
  };
  return map[type] || type || '';
}

// ====== 菜单 ======
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔄 活动数据')
    .addItem('立即同步', 'syncActivities')
    .addToUi();
}
