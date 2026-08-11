# Phiên dịch trực tiếp Trung – Việt bằng Qwen

Ứng dụng Expo phiên dịch giọng nói hai chiều giữa tiếng Trung giản thể và tiếng Việt. Qwen nhận âm thanh PCM trực tiếp, trả về bản chép lời, bản dịch và giọng đọc trong cùng một phiên realtime.

## Kiến trúc

```text
Điện thoại (PCM 16-bit, 16 kHz, mono)
  -> WebSocket máy chủ /v1/qwen/live
  -> Qwen LiveTranslate realtime
  -> âm thanh dịch PCM 24 kHz
  -> loa điện thoại
```

Model giọng nói mặc định: `qwen3.5-livetranslate-flash-realtime`. Dịch chữ trong ảnh dùng `qwen3.6-flash` với chế độ suy luận dài được tắt để ưu tiên tốc độ.

API key chỉ tồn tại ở máy chủ. Âm thanh đi qua máy chủ WebSocket vì Qwen không cung cấp token tạm thời an toàn để kết nối trực tiếp từ APK.

Luồng micro dùng chế độ nhận dạng giọng nói và bộ khử ồn phần cứng của thiết bị khi có sẵn. Âm thanh được gửi theo gói PCM 100 ms đúng với mẫu realtime của Qwen. Trên thiết bị không có bộ khử ồn phần cứng, ứng dụng tự động tiếp tục với luồng micro tiêu chuẩn.

## Chạy trên máy

Yêu cầu Node.js 20.19.4 trở lên và Android Studio hoặc Xcode.

1. Cài thư viện:

   ```powershell
   npm install
   ```

2. Sao chép `apps/backend/.env.example` thành `apps/backend/.env`, rồi nhập API key Qwen mới vào `DASHSCOPE_API_KEY`.

3. Khởi động máy chủ:

   ```powershell
   npm run dev:backend
   ```

4. Sao chép `apps/mobile/.env.example` thành `apps/mobile/.env`. Khi chạy trên điện thoại thật, đổi `localhost` thành địa chỉ HTTPS hoặc địa chỉ LAN mà điện thoại truy cập được.

   Có thể thêm thuật ngữ chuyên ngành theo từng chiều dịch để tăng độ chính xác:

   ```dotenv
   EXPO_PUBLIC_QWEN_HOTWORDS_ZH_TO_VI={"人工智能":"trí tuệ nhân tạo"}
   EXPO_PUBLIC_QWEN_HOTWORDS_VI_TO_ZH={"trí tuệ nhân tạo":"人工智能"}
   ```

5. Chạy ứng dụng Android:

   ```powershell
   npm run android --workspace @interpreter/mobile
   ```

## Thao tác

- Khung 中文 luôn ở trên, khung TIẾNG VIỆT luôn ở dưới. Vị trí này cố định, không đảo theo chiều dịch.
- Kéo quả cầu sang phải để nói tiếng Trung và nghe tiếng Việt. Khung 中文 phía trên co lại (squash) về phía quả cầu theo lực kéo.
- Kéo quả cầu sang trái để nói tiếng Việt và nghe tiếng Trung. Khung TIẾNG VIỆT phía dưới co lại.
- Thả tay để kết thúc lượt nói. Quả cầu bật về giữa, khung giãn ra (stretch) rồi về nguyên dạng, một vòng sáng thu vào quả cầu.
- Nhấn đúp quả cầu để chọn ảnh màn hình gần nhất, đọc chữ và dịch nhanh. Kết quả hiện ở khung TIẾNG VIỆT kèm nhãn phụ "DỊCH ẢNH".
- Viền quả cầu là đèn báo kết nối máy chủ: viền xanh là đã kết nối, viền đỏ là chưa kết nối, viền xanh dương là micro đang mở.
- Nhấn biểu tượng bánh răng để mở cài đặt hiệu ứng, dịch ảnh và chẩn đoán.

Android và iOS không cho ứng dụng tự ý chụp nội dung của ứng dụng khác. Luồng nhấn đúp vì vậy mở bộ chọn ảnh hệ thống để người dùng chọn ảnh màn hình cần dịch.

## Kiểm tra

```powershell
npm run typecheck
npm test
npm run build
```

## Lưu ý khi đưa lên môi trường thật

- Không đặt `DASHSCOPE_API_KEY` trong biến `EXPO_PUBLIC_*` hoặc trong APK.
- Bảo vệ máy chủ bằng đăng nhập người dùng và giới hạn lưu lượng phù hợp.
- Dùng HTTPS/WSS trên môi trường thật.
- Nếu API key từng được gửi trong tin nhắn hoặc log, hãy thu hồi và tạo key mới.
