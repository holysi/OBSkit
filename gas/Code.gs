/**
 * OBS 直播動態彈幕系統 - Google Apps Script 後端 (高併發 CacheService 架構)
 *
 * 設計重點：
 * 1. 觀眾發送彈幕 (doPost) 僅讀寫 CacheService 記憶體快取 (~20ms)，不直接觸發 Spreadsheet I/O，支援 100 人同時在線不卡頓。
 * 2. 禁字過濾、快捷詞庫、機器人暖場清單與全局控場設定均快取於 CacheService (TTL 20 秒)，100 人同時開啟網頁 0 次 Sheet 讀取。
 * 3. 僅 OBS 端 (1 個端點) 每 1.5 秒呼叫 doGet?action=poll 拉取新彈幕，並順便將未歸檔彈幕以單次 setValues() 批次寫入 Logs 分頁。
 */

const CACHE_KEYS = {
  QUEUE: 'DANMAKU_QUEUE_V1',
  CONFIG: 'DANMAKU_CONFIG_V1'
};

const CONFIG_CACHE_TTL_SEC = 20; // 設定與詞庫快取秒數 (修改 Sheet 後最慢 20 秒內自動同步至 OBS 與觀眾端)
const QUEUE_CACHE_TTL_SEC = 21600; // 彈幕佇列快取 6 小時
const MAX_QUEUE_ITEMS = 180; // 環狀佇列保留最近 180 則彈幕 (確保小於 CacheService 單鍵 100KB 上限)

const SHEET_NAMES = {
  SETTINGS: 'Settings',
  BOT_PRESETS: 'BotPresets',
  VIEWER_PRESETS: 'ViewerPresets',
  LOGS: 'Logs'
};

/**
 * 【步驟 1】在 GAS 編輯器上方選擇 `setupSheet` 並點擊「執行」
 * 自動建立並初始化 Google Sheet 四大控場分頁與預設資料
 */
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Settings 分頁
  let settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet(SHEET_NAMES.SETTINGS);
  }
  if (settingsSheet.getLastRow() === 0) {
    const settingsData = [
      ['設定項目 (Key)', '設定值 (Value)', '說明 (Description)'],
      ['bot_enabled', true, '是否啟用機器人自動暖場彈幕 (TRUE / FALSE)'],
      ['bot_interval_min_sec', 3.5, '機器人發射最短間隔秒數 (建議 2 ~ 10)'],
      ['bot_interval_max_sec', 8.0, '機器人發射最長間隔秒數 (隨機浮動讓節奏像真人)'],
      ['bot_order_mode', 'random', '機器人發射順序：random (不重複隨機洗牌) 或 sequential (依序循環)'],
      ['bot_fake_nickname_prob', 0.65, '機器人未指定暱稱時，隨機掛上假暱稱的機率 (0.0 = 全匿名, 1.0 = 全掛暱稱)'],
      ['danmaku_speed_sec', 8.5, '彈幕從右飛到左的秒數 (數字越小飛越快，建議 6 ~ 12)'],
      ['danmaku_font_size_px', 38, 'OBS 彈幕字體大小 (px，建議 28 ~ 52)'],
      ['danmaku_area_percent', 65, '彈幕顯示區域占畫面高度百分比 (1 ~ 100，例如 50 代表只在上半部飛)'],
      ['danmaku_opacity', 0.95, 'OBS 彈幕透明度 (0.1 ~ 1.0)'],
      ['cooldown_sec', 3, '觀眾發送彈幕冷卻秒數 (防洗版)'],
      ['max_length', 45, '單則彈幕最大字數上限']
    ];
    settingsSheet.getRange(1, 1, settingsData.length, 3).setValues(settingsData);
    styleHeader_(settingsSheet, 3, [220, 140, 460]);
  }

  // 2. BotPresets 分頁 (機器人預設暖場字幕 + 隨機假暱稱池)
  let botSheet = ss.getSheetByName(SHEET_NAMES.BOT_PRESETS);
  if (!botSheet) {
    botSheet = ss.insertSheet(SHEET_NAMES.BOT_PRESETS);
  }
  if (botSheet.getLastRow() === 0) {
    const botData = [
      ['啟用 (TRUE/FALSE)', '機器人預設彈幕內容', '指定暱稱 (留空則按機率抽假暱稱或匿名)', '指定色碼 (留空則隨機安全色)', '隨機假暱稱池 (供機器人隨機混搭)'],
      [true, '主播好！！終於開播了🔥', '', '', '夜貓子阿凱'],
      [true, '簽到簽到～今天準時報到', '', '', '路過的工程師'],
      [true, '666666666666', '', '#FFE066', '愛喝奶茶的貓'],
      [true, '這段太神啦 XDDDD', '', '', '潛水員007'],
      [true, '聲音很清楚，畫質也OK！', '熱心觀眾', '#66D9E8', '台北小陳'],
      [true, '前排卡位吃雞排', '', '', '今晚不睡覺'],
      [true, '哈哈哈哈這反應太真實了', '', '#FF8787', '鍵盤觀察家'],
      [true, '刷一排愛心支持 ❤️❤️❤️', '', '#F783AC', '半糖去冰'],
      [true, '請問這個之後會有回放嗎？', '', '', 'Momo醬'],
      [true, '節奏帶起來！！！🙌', '', '#8CE99A', 'コーラ好き'],
      [true, '剛剛那個操作怎麼按出來的？', '', '', '遊戲廢人'],
      [true, '太猛了吧！！！', '', '#FFA94D', '阿瑋']
    ];
    botSheet.getRange(1, 1, botData.length, 5).setValues(botData);
    styleHeader_(botSheet, 5, [140, 320, 260, 200, 220]);
  }

  // 3. ViewerPresets 分頁 (觀眾快捷句/抽獎池 + 禁用詞清單)
  let viewerSheet = ss.getSheetByName(SHEET_NAMES.VIEWER_PRESETS);
  if (!viewerSheet) {
    viewerSheet = ss.insertSheet(SHEET_NAMES.VIEWER_PRESETS);
  }
  if (viewerSheet.getLastRow() === 0) {
    const viewerData = [
      ['觀眾快捷彈幕 / 隨機抽獎池 (顯示於觀眾網頁)', '禁用詞清單 (自動替換為 ***)'],
      ['666666666 🔥', '加賴'],
      ['簽到！主播晚上好 👋', '免費領取'],
      ['這波操作太神啦！', '代操'],
      ['哈哈哈哈哈笑死 XDDD', '外掛'],
      ['刷一排愛心 ❤️❤️❤️', '私訊我'],
      ['說得好！完全認同 💯', ''],
      ['求教學！怎麼做到的？', ''],
      ['前排圍觀吃爆米花 🍿', ''],
      ['音質畫質都很棒 👍', ''],
      ['太強了吧膝蓋給你🧎', '']
    ];
    viewerSheet.getRange(1, 1, viewerData.length, 2).setValues(viewerData);
    styleHeader_(viewerSheet, 2, [340, 240]);
  }

  // 4. Logs 分頁 (觀眾彈幕歷史紀錄)
  let logsSheet = ss.getSheetByName(SHEET_NAMES.LOGS);
  if (!logsSheet) {
    logsSheet = ss.insertSheet(SHEET_NAMES.LOGS);
  }
  if (logsSheet.getLastRow() === 0) {
    const logsHeader = [['發送時間', '訊息 ID', '觀眾暱稱', '彈幕內容', '顏色色碼']];
    logsSheet.getRange(1, 1, 1, 5).setValues(logsHeader);
    styleHeader_(logsSheet, 5, [180, 140, 160, 380, 120]);
  }

  // 清除舊快取並立即預熱
  const cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEYS.CONFIG);
  loadSystemConfig_(true);

  return '✅ Google Sheet 四大控場分頁初始化完成！請點擊右上角「部署 > 新增部署 > 網頁應用程式 (所有人皆可存取)」。';
}

/**
 * HTTP GET 端點
 * - ?action=init : 觀眾網頁或 OBS 啟動時讀取設定、快捷詞庫與目前最新 ID
 * - ?action=poll&since=<id> : OBS 每 1.5 秒輪詢新彈幕 + 批次將未歸檔彈幕寫入 Logs Sheet
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action || 'init';
    const config = loadSystemConfig_(false);
    const queue = getQueue_();
    const latestId = queue.length > 0 ? queue[queue.length - 1].id : 0;

    if (action === 'poll') {
      const sinceId = Number(params.since || 0);
      const newMessages = queue.filter(function(item) {
        return item.id > sinceId;
      });

      // 由唯一的 OBS 輪詢端順便將尚未寫入 Sheet 的彈幕批次歸檔 (避免觀眾 POST 時鎖表)
      flushUnloggedToSheet_();

      return jsonResponse_({
        ok: true,
        serverTime: Date.now(),
        latestId: latestId,
        messages: newMessages,
        settings: config.settings,
        botPresets: config.botPresets,
        fakeNicknames: config.fakeNicknames
      });
    }

    // 預設 action === 'init'
    return jsonResponse_({
      ok: true,
      serverTime: Date.now(),
      latestId: latestId,
      settings: config.settings,
      botPresets: config.botPresets,
      fakeNicknames: config.fakeNicknames,
      viewerPresets: config.viewerPresets
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

/**
 * HTTP POST 端點 (觀眾發送彈幕)
 * 接收 Content-Type: text/plain;charset=utf-8 的 JSON 字串以避免瀏覽器 CORS OPTIONS 預檢請求
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const payload = JSON.parse(rawBody);

    const config = loadSystemConfig_(false);
    const maxLen = Number(config.settings.max_length) || 45;

    let text = String(payload.text || '').trim();
    if (!text) {
      return jsonResponse_({ ok: false, error: '訊息內容不能為空' });
    }
    if (text.length > maxLen) {
      text = text.substring(0, maxLen);
    }

    let nickname = String(payload.nickname || '').trim();
    if (nickname.length > 16) {
      nickname = nickname.substring(0, 16);
    }

    // 禁用詞過濾替換為 ***
    const blockedWords = config.blockedWords || [];
    text = maskBlockedWords_(text, blockedWords);
    nickname = maskBlockedWords_(nickname, blockedWords);

    const color = sanitizeColor_(payload.color);

    // 取得輕量 ScriptLock 寫入記憶體環狀佇列 (僅需約 15~30ms)
    lock.waitLock(5000);
    const cache = CacheService.getScriptCache();
    const queue = getQueue_();

    const lastId = queue.length > 0 ? queue[queue.length - 1].id : 1000;
    const msg = {
      id: lastId + 1,
      ts: Date.now(),
      nickname: nickname,
      text: text,
      color: color,
      logged: false
    };

    queue.push(msg);
    while (queue.length > MAX_QUEUE_ITEMS) {
      queue.shift();
    }

    cache.put(CACHE_KEYS.QUEUE, JSON.stringify(queue), QUEUE_CACHE_TTL_SEC);
    lock.releaseLock();

    return jsonResponse_({
      ok: true,
      message: msg
    });
  } catch (err) {
    try {
      if (lock.hasLock()) lock.releaseLock();
    } catch (_) {}
    return jsonResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

/**
 * 讀取並快取 Google Sheet 中的設定與詞庫
 */
function loadSystemConfig_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = cache.get(CACHE_KEYS.CONFIG);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (_) {}
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 預設設定值
  const settings = {
    bot_enabled: true,
    bot_interval_min_sec: 3.5,
    bot_interval_max_sec: 8.0,
    bot_order_mode: 'random',
    bot_fake_nickname_prob: 0.65,
    danmaku_speed_sec: 8.5,
    danmaku_font_size_px: 38,
    danmaku_area_percent: 65,
    danmaku_opacity: 0.95,
    cooldown_sec: 3,
    max_length: 45
  };

  const settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (settingsSheet && settingsSheet.getLastRow() > 1) {
    const rows = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 2).getValues();
    for (let i = 0; i < rows.length; i++) {
      const k = String(rows[i][0] || '').trim();
      const v = rows[i][1];
      if (!k) continue;
      if (k === 'bot_enabled') {
        settings[k] = (v === true || String(v).toUpperCase() === 'TRUE' || v === 1);
      } else if (k === 'bot_order_mode') {
        settings[k] = String(v || 'random').trim().toLowerCase();
      } else if (v !== '' && v !== null && !isNaN(Number(v))) {
        settings[k] = Number(v);
      }
    }
  }

  const botPresets = [];
  const fakeNicknames = [];
  const botSheet = ss.getSheetByName(SHEET_NAMES.BOT_PRESETS);
  if (botSheet && botSheet.getLastRow() > 1) {
    const rows = botSheet.getRange(2, 1, botSheet.getLastRow() - 1, 5).getValues();
    for (let i = 0; i < rows.length; i++) {
      const enabled = (rows[i][0] === true || String(rows[i][0]).toUpperCase() === 'TRUE' || rows[i][0] === 1);
      const text = String(rows[i][1] || '').trim();
      const nickname = String(rows[i][2] || '').trim();
      const color = String(rows[i][3] || '').trim();
      const poolNick = String(rows[i][4] || '').trim();

      if (enabled && text) {
        botPresets.push({
          text: text,
          nickname: nickname,
          color: color ? sanitizeColor_(color) : ''
        });
      }
      if (poolNick) {
        fakeNicknames.push(poolNick);
      }
    }
  }

  const viewerPresets = [];
  const blockedWords = [];
  const viewerSheet = ss.getSheetByName(SHEET_NAMES.VIEWER_PRESETS);
  if (viewerSheet && viewerSheet.getLastRow() > 1) {
    const rows = viewerSheet.getRange(2, 1, viewerSheet.getLastRow() - 1, 2).getValues();
    for (let i = 0; i < rows.length; i++) {
      const phrase = String(rows[i][0] || '').trim();
      const badWord = String(rows[i][1] || '').trim();
      if (phrase) viewerPresets.push(phrase);
      if (badWord) blockedWords.push(badWord);
    }
  }

  const configObj = {
    settings: settings,
    botPresets: botPresets,
    fakeNicknames: fakeNicknames,
    viewerPresets: viewerPresets,
    blockedWords: blockedWords
  };

  cache.put(CACHE_KEYS.CONFIG, JSON.stringify(configObj), CONFIG_CACHE_TTL_SEC);
  return configObj;
}

/**
 * 讀取 CacheService 環狀佇列
 */
function getQueue_() {
  const cache = CacheService.getScriptCache();
  const raw = cache.get(CACHE_KEYS.QUEUE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * 將佇列中尚未寫入 Logs 分頁的觀眾彈幕一次批次寫入 Google Sheet
 */
function flushUnloggedToSheet_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(500)) {
    // 若剛好有觀眾正在寫入快取，跳過本次歸檔，留待 1.5 秒後下次輪詢再歸檔
    return;
  }
  try {
    const cache = CacheService.getScriptCache();
    const queue = getQueue_();
    const unloggedRows = [];

    for (let i = 0; i < queue.length; i++) {
      if (!queue[i].logged) {
        queue[i].logged = true;
        unloggedRows.push([
          new Date(queue[i].ts),
          queue[i].id,
          queue[i].nickname || '(匿名)',
          queue[i].text,
          queue[i].color
        ]);
      }
    }

    if (unloggedRows.length > 0) {
      cache.put(CACHE_KEYS.QUEUE, JSON.stringify(queue), QUEUE_CACHE_TTL_SEC);
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let logsSheet = ss.getSheetByName(SHEET_NAMES.LOGS);
      if (!logsSheet) {
        logsSheet = ss.insertSheet(SHEET_NAMES.LOGS);
      }
      const startRow = logsSheet.getLastRow() + 1;
      logsSheet.getRange(startRow, 1, unloggedRows.length, 5).setValues(unloggedRows);
    }
  } catch (_) {
    // 忽略歸檔錯誤以確保 OBS 輪詢穩定
  } finally {
    lock.releaseLock();
  }
}

function maskBlockedWords_(input, blockedWords) {
  if (!input || !blockedWords || blockedWords.length === 0) return input;
  let result = input;
  for (let i = 0; i < blockedWords.length; i++) {
    const word = blockedWords[i];
    if (!word) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'gi'), '***');
  }
  return result;
}

function sanitizeColor_(color) {
  const str = String(color || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(str)) {
    return str.toUpperCase();
  }
  return '#FFFFFF';
}

function styleHeader_(sheet, colCount, widths) {
  const headerRange = sheet.getRange(1, 1, 1, colCount);
  headerRange.setBackground('#1E293B');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
  for (let i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
