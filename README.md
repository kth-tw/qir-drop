# Qir Drop

Qir Drop 是一個全前端、無需伺服器的檔案傳輸網站，透過 QR Code 在無網路環境下分片傳送檔案。

## 功能特色

- **發送者**：上傳檔案，分割為多個分片，每個分片產生 QR Code，並以動畫循環播放。
- **接收者**：使用相機或螢幕擷取功能掃描 QR Code 動畫，接收所有分片後可下載原始檔案。
- **完全前端運作**：無需後端伺服器，適合離線環境。

## 使用方式

### 發送檔案

1. 進入「發送」頁面，選擇檔案。
2. 系統自動分割檔案並產生 QR Code 動畫。
3. 將螢幕展示給接收者掃描。

### 接收檔案

1. 進入「接收」頁面，選擇「相機」或「螢幕擷取」。
2. 連續掃描 QR Code 動畫，系統自動記錄分片進度。
3. 所有分片接收完成後，點擊下載按鈕取得原始檔案。

## 技術細節

- 檔案分片：每片約 1,200 bytes，含檔案 hash、檔名、分片序號、總分片數等 header。
- QR Code：每片資料以 base64 編碼，使用 [qrcode](https://www.npmjs.com/package/qrcode) 產生。
- 掃描：使用 [jsQR](https://www.npmjs.com/package/jsqr) 解碼 QR Code。
- 檔案重組：前端自動重組所有分片並下載。

## 開發與部署

### 安裝依賴

```bash
npm install
```

### 開發模式

```bash
npm run dev
```

### 打包靜態網站

```bash
npm run build
```

### 部署

將 `dist/` 資料夾部署至任何靜態網站伺服器即可。

## 專案結構

- `src/chunk.ts`：檔案分片與序列化
- `src/sender.ts`：發送者頁面
- `src/receiver.ts`：接收者頁面
- `src/main.ts`：主頁面與路由
- `src/style.css`：UI 樣式

---

Qir Drop 適合在無網路、無伺服器環境下安全傳送檔案。
