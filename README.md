# OBS 直播動態彈幕與機器人暖場系統 (GAS 高併發版)

專為 OBS Studio 設計的輕量級即時互動彈幕工具，結合 **Google Sheet + Google Apps Script (GAS)** 雲端控場與 `CacheService` 記憶體佇列，單一免費 Google 帳號即可承載 **100 人同時在線發送彈幕**，且內建與真人彈幕完全一致的**機器人自動暖場字幕排程**。

---

## 📁 專案結構

- [`gas/Code.gs`](file:///j:/projects/OBS_danmo/gas/Code.gs)：Google Apps Script 後端程式碼（含 `setupSheet()` 一鍵建立四大控場分頁、`CacheService` 高速記憶體佇列、禁字過濾、OBS 輪詢批次歸檔）。
- [`config.js`](file:///j:/projects/OBS_danmo/config.js)：前端共用設定檔（綁定 GAS Web App 網址、預設色票與本機離線模擬預設詞庫）。
- [`obs.html`](file:///j:/projects/OBS_danmo/obs.html)：供 OBS「瀏覽器來源 (Browser Source)」載入的全透明背景飛行彈幕層（含多軌道防重疊演算法與機器人隨機 Jitter 暖場排程器）。
- [`index.html`](file:///j:/projects/OBS_danmo/index.html)：供直播觀眾掃 QR Code 或點連結進入的彈幕發射台（支援選填暱稱、隨機暱稱、顏色選擇、快捷罐頭句子、🎲 隨機抽一句與防洗版冷卻倒數）。

---

## 🚀 30 秒本機免部署快速體驗

在還沒部署 Google Apps Script 之前，你可以直接雙擊打開專案內的檔案測試完整流程：

1. 用瀏覽器打開 [`obs.html`](file:///j:/projects/OBS_danmo/obs.html)（會自動啟動機器人暖場彈幕，每隔 3.5~7.5 秒發射一句擬真彈幕）。
2. 用同一個瀏覽器開新分頁打開 [`index.html`](file:///j:/projects/OBS_danmo/index.html)。
3. 在 `index.html` 點選快捷句子或按 **「🎲 隨機抽一句」** 並點擊發射，彈幕會透過 `BroadcastChannel` 即時飛過 `obs.html` 畫面！

---

## ☁️ 正式部署步驟（Google Sheet + Google Apps Script）

### 步驟 1：建立 Google Sheet 與執行一鍵初始化
1. 前往 [Google Sheets](https://sheets.new) 新增一份空白試算表。
2. 點選上方選單 **「擴充功能 (Extensions)」>「Apps Script」**。
3. 將 [`gas/Code.gs`](file:///j:/projects/OBS_danmo/gas/Code.gs) 的內容完整貼上並取代原本的 `Code.gs`，按 `Ctrl + S` 儲存。
4. 在上方工具列函式下拉選單選擇 **`setupSheet`**，點擊 **「執行 (Run)」** 並完成 Google 權限授權。
5. 回到試算表，你會看到系統已自動建立好 4 個分頁與預設資料：
   - **`Settings`**：即時調整機器人開關、發射秒數區間、假暱稱機率、彈幕速度、字體大小、畫面占比與觀眾冷卻秒數（修改後 20 秒內自動同步至 OBS）。
   - **`BotPresets`**：管理機器人暖場台詞與隨機假暱稱池。
   - **`ViewerPresets`**：管理觀眾網頁上的快捷罐頭句子與禁用詞清單（自動替換為 `***`）。
   - **`Logs`**：自動批次留存所有觀眾發送過的彈幕紀錄。

### 步驟 2：部署為 Web App (網頁應用程式)
1. 在 Apps Script 右上角點擊 **「部署 (Deploy)」>「新增部署作業 (New deployment)」**。
2. 左側齒輪選取類型 **「網頁應用程式 (Web app)」**：
   - **執行身分 (Execute as)**：`我 (Me)`
   - **誰可以存取 (Who has access)**：`所有人 (Anyone)`
3. 點擊 **「部署」**，複製產生的 **網頁應用程式網址 (`https://script.google.com/macros/s/.../exec`)**。

### 步驟 3：綁定網址並放上 OBS 與靜態空間
1. 打開 [`config.js`](file:///j:/projects/OBS_danmo/config.js)，將複製的網址貼入 `GAS_WEB_APP_URL`（或直接在網址後方加上 `?gasUrl=你的GAS網址`）。
2. **OBS 設定**：
   - 在 OBS「來源」新增 **「瀏覽器 (Browser)」**。
   - 勾選「本機檔案」選擇 `obs.html`（或填入代管後的網址），寬度設為 `1920`、高度設為 `1080`，即可疊加在遊戲或攝影機畫面上方。
3. **觀眾輸入網頁 (`index.html` + `config.js`)**：
   - 上傳至 GitHub Pages、Cloudflare Pages 或 Vercel 等免費靜態空間，產生網址或 QR Code 讓 100 位觀眾同時掃碼發送彈幕！
