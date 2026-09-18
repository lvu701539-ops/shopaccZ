# SHOP ACC tự động

## 1. Yêu cầu
- Node.js 20+
- npm

## 2. Chạy local
```bash
npm install
copy .env.example .env
npm start
```
Linux/macOS:
```bash
cp .env.example .env
npm install
npm start
```
Mở `http://localhost:3000`.

## 3. Tài khoản quản trị
Sửa `.env`:
- ADMIN_USER
- ADMIN_PASSWORD
- SESSION_SECRET

Sau đó khởi động lại server.

## 4. Thêm sản phẩm và ACC
Vào `/admin.html`, đăng nhập, tạo sản phẩm trước rồi thêm ACC.
Mỗi ACC có:
- username
- password
- extra (thông tin thêm nếu có)

## 5. Ngân hàng
Điền thông tin ngân hàng trong `.env`.
Bản mẫu có nút "Xác nhận CK" trong admin để test quy trình. Khi triển khai thật, thay bằng webhook/API của ngân hàng hoặc cổng thanh toán mà bạn có hợp đồng sử dụng.

## 6. Thẻ cào
Bản mẫu KHÔNG giả vờ xác thực thẻ cào. Endpoint `/api/payment/card` chỉ tiếp nhận dữ liệu.
Bạn cần tích hợp một nhà cung cấp thanh toán thẻ cào hợp pháp và để nhà cung cấp gọi:
`POST /api/payment/card/callback`
với:
```json
{"orderId":"ORD-...","status":"success"}
```
Nếu nhà cung cấp yêu cầu chữ ký, đặt `CARD_PROVIDER_API_KEY` và dùng header `x-provider-signature` theo cơ chế của họ.

## 7. Quan trọng khi đưa lên Internet
- Đổi ADMIN_PASSWORD và SESSION_SECRET.
- Bật HTTPS.
- Đặt cookie secure:true khi chạy HTTPS.
- Thêm rate limiting, CSRF protection và backup database.
- Không đưa API key thanh toán vào frontend.
- Không dùng endpoint xác nhận ngân hàng demo trong môi trường thật.
- Chỉ bán tài khoản bạn có quyền bán và tuân thủ điều khoản của game/dịch vụ.

## Cấu trúc
- `server.js`: API + database + thanh toán
- `public/`: giao diện khách và admin
- `shop.db`: tự tạo khi chạy
- `.env`: cấu hình bí mật (không commit lên Git)
