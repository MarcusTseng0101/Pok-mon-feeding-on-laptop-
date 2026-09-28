# 52poke 抓取狀態

時間：2026-09-28T15:29Z（UTC）

## 結果：連不到，沒有抓任何資料

雲端容器的網路政策擋掉 `wiki.52poke.com`，兩個請求都在 proxy 的 CONNECT 階段被拒，還沒碰到 52poke 伺服器。

| 請求 | HTTP 碼 | 錯誤 |
|---|---|---|
| `https://wiki.52poke.com/zh-hant/%E5%93%88%E5%8A%9B%E6%A0%97`（哈力栗頁面） | `000` | `curl: (56) CONNECT tunnel failed, response 403` |
| `https://wiki.52poke.com/api.php?action=parse&page=%E5%93%88%E5%8A%9B%E6%A0%97&prop=wikitext&format=json`（MediaWiki API） | `000` | `curl: (56) CONNECT tunnel failed, response 403` |

## agent proxy 狀態：`recentRelayFailures` 最後 3 筆

只有 2 筆（全部列出）：

```json
[
 {
  "ts": "2026-09-28T15:29:46.332Z",
  "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "wiki.52poke.com:443"
 },
 {
  "ts": "2026-09-28T15:29:46.612Z",
  "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "wiki.52poke.com:443"
 }
]
```

## 統計

- 成功：0 隻
- 缺（頁面裡找不到「外貌」「習性」）：無法判斷（沒抓到頁面）
- 失敗：650～721 全部 72 隻（連線被擋，沒有送出請求）

## 要怎麼解

到這個雲端環境的設定（session 標題列的環境選單 → Edit）→ Network access，
把 `wiki.52poke.com` 加進允許的網域，或改成更寬的存取等級，再重跑一次這個任務。
依照任務指示，沒有改用別的網站。
