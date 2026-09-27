# 只給畫面測試用的自簽憑證

`test/e2e/offline.cjs` 用它在本機起一個 HTTPS 代理，假裝是 `tailscale serve`（`https://laptop.tail1234.ts.net` → 127.0.0.1）。
這把私鑰是公開的、只在測試裡用，**不要拿去做任何別的事**。

重新產生：

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3650 \
  -subj "/CN=laptop.tail1234.ts.net" -addext "subjectAltName=DNS:laptop.tail1234.ts.net"
```
