/**
 * OBS 直播動態彈幕系統 - 全局共用設定與本機模擬設定檔
 *
 * 使用方式：
 * 1. 部署完 gas/Code.gs 後，將取得的「網頁應用程式網址 (https://script.google.com/macros/s/.../exec)」
 *    貼入下方 GAS_WEB_APP_URL。
 * 2. 亦可透過網址參數覆蓋，例如：
 *    - obs.html?gasUrl=https://script.google.com/macros/s/.../exec
 *    - index.html?gasUrl=https://script.google.com/macros/s/.../exec
 * 3. 當 GAS_WEB_APP_URL 為空字串且網址未帶 ?gasUrl= 時，系統會自動啟用「本機模擬測試模式」，
 *    透過瀏覽器 BroadcastChannel + localStorage 讓 index.html 與 obs.html 免部署即可雙向連動測試！
 */
window.DANMAKU_CONFIG = {
  // 👇 請將部署好的 Google Apps Script Web App 網址貼在這裡（留空則自動啟用本機模擬模式）
  GAS_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycby-54esEhE61NCGi8Q4H6JUGVT8hGoRL_o5-Pj5VWH_T4XQvxv-5_SeN1py1eCJPQc/exec',

  // OBS 輪詢 GAS 後端的間隔毫秒數（建議 1500ms = 1.5 秒）
  OBS_POLL_INTERVAL_MS: 1500,

  // 觀眾與機器人共用的安全高對比色票（確保在直播深色/淺色畫面加上黑邊後皆清晰易讀）
  COLOR_PALETTE: [
    { name: '純淨白', hex: '#FFFFFF' },
    { name: '閃耀金', hex: '#FFE066' },
    { name: '霓虹青', hex: '#66D9E8' },
    { name: '櫻花粉', hex: '#F783AC' },
    { name: '薄荷綠', hex: '#8CE99A' },
    { name: '活力橘', hex: '#FFA94D' },
    { name: '珊瑚紅', hex: '#FF8787' }
  ],

  // 預設控場參數（連上 GAS 後會自動被 Google Sheet 的 Settings 分頁覆蓋）
  DEFAULT_SETTINGS: {
    bot_enabled: true,
    bot_interval_min_sec: 3.5,
    bot_interval_max_sec: 7.5,
    bot_order_mode: 'random', // 'random' | 'sequential'
    bot_fake_nickname_prob: 0.65,
    danmaku_speed_sec: 8.5,
    danmaku_font_size_px: 38,
    danmaku_area_percent: 65,
    danmaku_opacity: 0.95,
    cooldown_sec: 3,
    max_length: 45
  },

  // 預設機器人暖場彈幕清單（連上 GAS 後會自動被 Google Sheet 的 BotPresets 分頁覆蓋）
  DEFAULT_BOT_PRESETS: [
    { text: '主播好！！終於開播了🔥', nickname: '', color: '' },
    { text: '簽到簽到～今天準時報到', nickname: '', color: '' },
    { text: '666666666666', nickname: '', color: '#FFE066' },
    { text: '這段太神啦 XDDDD', nickname: '', color: '' },
    { text: '聲音很清楚，畫質也OK！', nickname: '熱心觀眾', color: '#66D9E8' },
    { text: '前排卡位吃雞排', nickname: '', color: '' },
    { text: '哈哈哈哈這反應太真實了', nickname: '', color: '#FF8787' },
    { text: '刷一排愛心支持 ❤️❤️❤️', nickname: '', color: '#F783AC' },
    { text: '請問這個之後會有回放嗎？', nickname: '', color: '' },
    { text: '節奏帶起來！！！🙌', nickname: '', color: '#8CE99A' },
    { text: '剛剛那個操作怎麼按出來的？', nickname: '', color: '' },
    { text: '太猛了吧！！！', nickname: '', color: '#FFA94D' }
  ],

  // 預設隨機假暱稱池（讓機器人與觀眾隨機使用，連上 GAS 後由 BotPresets 第 5 欄覆蓋）
  DEFAULT_FAKE_NICKNAMES: [
    '夜貓子阿凱',
    '路過的工程師',
    '愛喝奶茶的貓',
    '潛水員007',
    '台北小陳',
    '今晚不睡覺',
    '鍵盤觀察家',
    '半糖去冰',
    'Momo醬',
    'コーラ好き',
    '遊戲廢人',
    '阿瑋'
  ],

  // 預設觀眾快捷罐頭彈幕 / 隨機抽獎池（連上 GAS 後由 ViewerPresets 分頁覆蓋）
  DEFAULT_VIEWER_PRESETS: [
    '666666666 🔥',
    '簽到！主播晚上好 👋',
    '這波操作太神啦！',
    '哈哈哈哈哈笑死 XDDD',
    '刷一排愛心 ❤️❤️❤️',
    '說得好！完全認同 💯',
    '求教學！怎麼做到的？',
    '前排圍觀吃爆米花 🍿',
    '音質畫質都很棒 👍',
    '太強了吧膝蓋給你🧎'
  ],

  // 預設本機禁用詞清單（連上 GAS 後由 ViewerPresets 分頁覆蓋）
  DEFAULT_BLOCKED_WORDS: ['加賴', '免費領取', '代操', '外掛', '私訊我'],

  /**
   * 取得目前生效的 GAS Web App URL
   * 優先順序：網址參數 ?gasUrl= > localStorage 覆蓋值 > config.js 內的 GAS_WEB_APP_URL
   */
  resolveGasUrl: function() {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = (params.get('gasUrl') || '').trim();
      if (fromQuery) return fromQuery;

      const fromStorage = (localStorage.getItem('obs_danmaku_gas_url') || '').trim();
      if (fromStorage) return fromStorage;
    } catch (_) {}
    return (this.GAS_WEB_APP_URL || '').trim();
  },

  /**
   * 本機禁用詞遮罩工具
   */
  maskText: function(input, blockedWords) {
    if (!input) return '';
    const list = Array.isArray(blockedWords) ? blockedWords : this.DEFAULT_BLOCKED_WORDS;
    let out = String(input);
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      if (!w) continue;
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(escaped, 'gi'), '***');
    }
    return out;
  }
};
