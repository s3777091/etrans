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

2. Sao chép `apps/backend/.env.example` thành `apps/backend/.env`, rồi nhập API key Qwen mới vào `DASHSCOPE_API_KEY`. Muốn trợ lý EAgent tìm được thông tin trên web thì nhập thêm `EXA_API_KEY` lấy ở <https://dashboard.exa.ai/api-keys>.

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

## Trợ lý EAgent

Tab thứ hai trên thanh đầu trang đổi ứng dụng sang chế độ trợ lý: tên đổi từ
**ETrans** thành **EAgent**, hai khung dịch nhường chỗ cho một khung chat.

```text
Giữ quả cầu -> PCM 16 kHz -> POST /v1/agent/transcribe
  -> phiên realtime qwen-audio-3.0-realtime-plus (chỉ lấy bản chép lời)
  -> WebSocket /v1/agent/chat -> qwen3.6-flash (stream + tool call)
  -> Exa /search khi cần thông tin mới -> câu trả lời chạy chữ trên máy
```

- Vào chế độ trợ lý, quả cầu rơi từ trên xuống góc khung chat rồi khung mở đầy
  màn hình. Ngôn ngữ mặc định là tiếng Việt thì quả cầu rơi thẳng; đặt tiếng
  Trung hoặc tiếng Anh thì quả cầu bay lên trước rồi mới rơi xuống.
- **Nhấn giữ** quả cầu để bật micro, thả tay là gửi. Câu nói được chép lại theo
  ngôn ngữ đã đặt trong cài đặt rồi gửi cho trợ lý.
- **Nhấn đúp** quả cầu để mở camera và gửi ảnh cho trợ lý. Vẫn có ô nhập chữ
  cho lúc không tiện nói.
- Câu trả lời chạy chữ theo thời gian thực. Khi bật suy luận, phần suy luận nằm
  sau nút "Xem suy luận". Khi trợ lý tìm web, truy vấn hiện ngay trong bong
  bóng chat và nguồn hiện ở cuối câu trả lời, chạm để mở.
- Cài đặt -> **Trợ lý EAgent**: ngôn ngữ mặc định, model
  (`qwen3.6-flash`, `qwen3.7-plus`, `qwen3.7-max`, `qwen3.8-max`), bật tắt suy
  luận, bật tắt tìm web và lời nhắc hệ thống riêng.

Tìm kiếm web dùng [Exa](https://dashboard.exa.ai/api-keys). Đặt `EXA_API_KEY`
trong `apps/backend/.env`; để trống thì máy chủ tự bỏ công cụ tìm kiếm và trợ
lý nói thẳng là không tra được thông tin mới.

## Đưa lên iPhone khi không có máy Mac

Build iOS bắt buộc phải chạy trên macOS. Không có Mac thì mượn Mac của GitHub
Actions: workflow `.github/workflows/ios-unsigned-ipa.yml` build ra một file
`.ipa` **không ký**, còn việc ký để lại cho máy Windows bằng Apple ID miễn phí.

### 1. Khai địa chỉ máy chủ

App đọc `EXPO_PUBLIC_API_BASE_URL` lúc đóng gói và nhúng thẳng vào bundle.
Không khai thì bản build rơi về `http://localhost:8787` — trên iPhone đó là
chính nó, nên sẽ không bao giờ gọi được máy chủ.

Vào Settings -> Secrets and variables -> Actions -> tab **Variables**, thêm
`EXPO_PUBLIC_API_BASE_URL`, ví dụ `https://vi-zh.example.com` hoặc
`http://192.168.1.20:8787`. Có thể nhập trực tiếp khi bấm Run workflow để thử
nhanh một địa chỉ khác.

Chỉ đặt địa chỉ máy chủ ở đây. `DASHSCOPE_API_KEY` phải nằm ở backend, vì mọi
biến `EXPO_PUBLIC_*` đều đọc được từ file `.ipa` mà ai cũng tải về được.

### 2. Build

Tab Actions -> **iOS unsigned IPA** -> Run workflow. Khoảng 20-40 phút. Xong
thì tải artifact `etrans-ios-unsigned-<sha>` ở cuối trang run, giải nén được
`etrans-unsigned.ipa`.

Repo đang public nên phút macOS miễn phí không giới hạn. Chuyển sang private
thì phút macOS bị tính x10 (2000 phút free ≈ 200 phút macOS ≈ 8-12 lần
build/tháng) — lúc đó nên bỏ trigger `push` và chỉ bấm tay.

Commit không cần bản `.ipa` mới thì ghi cờ bỏ qua (`[` + `skip ipa` + `]`)
trong message. Sửa `**/*.md` hoặc `apps/backend/**` thì workflow tự bỏ qua.

### 3. Ký và cài lên máy

Dùng [Sideloadly](https://sideloadly.io) hoặc AltStore trên Windows: cắm
iPhone, kéo file `.ipa` vào, đăng nhập Apple ID **miễn phí**. Chữ ký kiểu này
sống 7 ngày, hết hạn thì ký lại — không tốn đồng nào, nhưng không có Apple
Developer Program ($99/năm) thì không tránh được vòng 7 ngày.

Lần chạy đầu, iPhone chặn app lạ: Settings -> General -> VPN & Device
Management -> chọn Apple ID vừa dùng -> Trust.

### 4. Quyền và mạng trên iOS

- Micro và camera lấy chuỗi mô tả từ plugin `expo-audio` và `expo-camera`
  trong `apps/mobile/app.json`, prebuild tự ghi vào `Info.plist`.
- Máy chủ chạy trong LAN qua `http://` bị App Transport Security chặn, nên
  `app.json` khai `NSAllowsLocalNetworking` — đây là bản iOS của
  `usesCleartextTraffic` bên Android. Cờ này chỉ mở cho địa chỉ nội bộ
  (`192.168.x.x`, `10.x.x.x`, `*.local`); máy chủ ngoài Internet vẫn phải dùng
  HTTPS.
- iOS 14 trở lên hỏi quyền truy cập mạng nội bộ ở lần kết nối đầu tiên, chuỗi
  giải thích nằm ở `NSLocalNetworkUsageDescription`.

### Build tại chỗ nếu có máy Mac

```bash
npm install
npm run ios --workspace @interpreter/mobile
```

`patches/expo-audio+57.0.3.patch` có phần iOS đổi `AVAudioSession` sang
`.playAndRecord` / `.voiceChat` và bật voice processing. Luôn để `npm install`
chạy xong (postinstall gọi patch-package) rồi mới prebuild, nếu không bản build
mất khử vọng và người nói sẽ nghe lại chính giọng mình.

## Model trên endpoint đang dùng

Endpoint `token-plan.ap-southeast-1.maas.aliyuncs.com` chỉ phục vụ một danh sách
model cố định. Kiểm tra bất cứ lúc nào:

```powershell
curl -H "Authorization: Bearer $env:DASHSCOPE_API_KEY" https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models
```

Tính đến 11/08/2026 danh sách gồm `qwen3.8-max`, `qwen3.7-max`, `qwen3.7-plus`,
`qwen3.6-flash`, `qwen-audio-3.0-realtime-plus`, `qwen-audio-3.0-tts-plus`,
`glm-5.2`, `deepseek-v4-pro`, `deepseek-v4-flash-0731`, `wan2.7-image`,
`wan2.7-image-pro`.

**Hai model phiên dịch trực tiếp (`qwen3.5-livetranslate-flash-realtime` và
`qwen3-livetranslate-flash-realtime`) KHÔNG còn trong danh sách này.** Phiên
realtime bị đóng ngay với mã 1007 kèm lý do `Model not exist.`, nên chức năng
kéo quả cầu để phiên dịch không chạy được cho tới khi đổi endpoint hoặc mở
quyền dùng model đó. Ứng dụng nay báo thẳng lỗi này thay vì thử kết nối lại vô
hạn.

Trợ lý EAgent và dịch ảnh vẫn chạy vì dùng model còn trong danh sách.

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
