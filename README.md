# Vinalink Group AI MassWriter

Ứng dụng web AI sinh nội dung dài, hàng loạt và ảnh minh hoạ — chạy hoàn toàn trên **Vercel** với **OpenAI API** (`gpt-4o-mini` + `gpt-image-1`).

> Phiên bản này được port từ AI Studio (Gemini) sang OpenAI và đã được tái cấu trúc thành kiến trúc Vercel (frontend Vite + serverless functions). API key giữ trên server, không lộ ra trình duyệt.

---

## Kiến trúc

```
┌────────────────────────┐         ┌──────────────────────────────┐
│  Frontend (Vite + React)│  fetch │  Vercel Serverless Functions │
│  components / services  │───────▶│  /api/text   /api/image      │
│                         │        │  /api/history                │
└────────────────────────┘         └──────────────┬───────────────┘
                                                  │
                                                  ▼
                                       OpenAI API (gpt-4o-mini, gpt-image-1)
                                       Vercel Postgres (lịch sử)
```

- `api/text.ts` — toàn bộ text generation: TOC, mở bài, từng chương, kết bài, tiêu đề, viết lại, hàng loạt.
- `api/image.ts` — sinh ảnh minh hoạ + phân tích phong cách + nhận diện gương mặt nhân vật.
- `api/history.ts` — lưu lịch sử bài viết theo browser-id (Vercel Postgres). Có fallback IndexedDB nếu chưa cấu hình DB.

---

## 1. Chạy local

```bash
# Cần Node.js 18+
npm install
cp .env.example .env.local
# mở .env.local và dán OPENAI_API_KEY của bạn

# Cách A — chạy đồng thời frontend + serverless:
npx vercel dev      # khuyến nghị, vì có /api routes

# Cách B — chỉ chạy frontend:
npm run dev         # /api routes sẽ không hoạt động
```

`vercel dev` sẽ phục vụ web tại http://localhost:3000 và serverless tại `/api/*`.

---

## 2. Đẩy lên GitHub

```bash
cd "/Users/nguyenduchoa/Desktop/vinalink-group-ai-masswriter"
git init
git add .
git commit -m "Initial commit: Vinalink AI MassWriter (OpenAI + Vercel)"
git branch -M main

# Tạo repo trên github.com (Public hoặc Private), sau đó:
git remote add origin git@github.com:<USERNAME>/vinalink-group-ai-masswriter.git
git push -u origin main
```

> Lưu ý: tệp `.env.local` đã có trong `.gitignore` nên API key sẽ KHÔNG bị đẩy lên.

---

## 3. Deploy trên Vercel

### 3.1 Import dự án

1. Đăng nhập https://vercel.com → **Add New** → **Project**.
2. Chọn repo GitHub vừa push.
3. Vercel tự nhận diện framework là Vite. **Không** cần đổi build command.
4. Bấm **Deploy** lần đầu để xác nhận build chạy được.

### 3.2 Cấu hình biến môi trường

Vào **Project → Settings → Environment Variables** và thêm:

| Tên                    | Bắt buộc | Mô tả                                                    |
| ---------------------- | :------: | -------------------------------------------------------- |
| `OPENAI_API_KEY`       |    ✅    | API key của OpenAI (sk-proj-...)                          |
| `OPENAI_TEXT_MODEL`    |          | Mặc định `gpt-4o-mini`. Có thể đổi sang `gpt-4o`.         |
| `OPENAI_IMAGE_MODEL`   |          | Mặc định `gpt-image-1`.                                   |
| `OPENAI_ORG_ID`        |          | Chỉ cần nếu bạn thuộc nhiều tổ chức.                     |

Sau khi thêm xong, vào tab **Deployments**, mở deployment mới nhất và bấm **Redeploy** để biến môi trường có hiệu lực.

### 3.3 (Khuyến nghị) Thêm Postgres để lưu lịch sử

1. **Project → Storage → Create Database → Postgres**.
2. Đặt tên (ví dụ `vinalink-history`) và **Connect to Project**.
3. Vercel tự động inject các biến `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, v.v. — bạn không cần làm gì thêm.
4. Redeploy. Bảng `article_history` sẽ tự được tạo lần đầu sử dụng.

> Nếu không thêm Postgres, ứng dụng tự động fallback sang IndexedDB (lưu trong trình duyệt người dùng). Vẫn dùng được, nhưng lịch sử sẽ không đồng bộ giữa các máy.

### 3.4 Tên miền

- Vercel cấp sẵn domain `https://<project>.vercel.app`.
- Muốn gắn tên miền riêng: **Settings → Domains → Add**.

---

## 4. Sử dụng

- **Một bài**: nhập tiêu đề/dàn ý, chọn độ dài (300 / 1.000 / 3.000 / 5.000 / 10.000 / 20.000 / 40.000 ký tự…), bấm **Tạo bài**.
- **Hàng loạt**: dán danh sách tiêu đề + dàn ý (mỗi dòng một bài), tải kèm ảnh sản phẩm / nhân vật để AI gắn vào ảnh minh hoạ.
- **Lịch sử**: tự động lưu mỗi lần sinh bài. Nhấn nút "Lịch sử" để khôi phục.

---

## 5. Cấu trúc thư mục

```
.
├── api/                       Serverless functions (Vercel)
│   ├── _lib/openai.ts         Client OpenAI dùng chung (server-only)
│   ├── text.ts                Text generation
│   ├── image.ts               Image generation + vision
│   └── history.ts             CRUD lịch sử (Vercel Postgres)
├── components/                React UI
│   ├── ArticleForm.tsx
│   ├── ArticleDisplay.tsx
│   ├── HistorySidebar.tsx
│   └── Header.tsx
├── services/                  Frontend client (gọi /api/*)
│   ├── aiService.ts
│   └── historyService.ts
├── App.tsx
├── index.tsx / index.html
├── types.ts
├── vite.config.ts             Frontend build
├── vercel.json                Function memory & timeout
├── tsconfig.json
├── package.json
└── .env.example               Mẫu cấu hình env
```

---

## 6. Tuỳ biến

- **Đổi model**: sửa `OPENAI_TEXT_MODEL` / `OPENAI_IMAGE_MODEL` trong env.
- **Tỉ lệ ảnh**: gpt-image-1 hỗ trợ `1024x1024` (1:1), `1536x1024` (~16:9), `1024x1536` (~9:16). Mã đã map sẵn từ `1:1`, `16:9`, `4:3`, `3:4`, `9:16`.
- **Giới hạn lịch sử**: 30 bản ghi mỗi user (sửa `MAX_RECORDS_PER_OWNER` trong `api/history.ts`).
- **Timeout function**: 300s cho text/image, 30s cho history (xem `vercel.json`). Vercel **Hobby** plan giới hạn tối đa 10s/60s tùy plan — kiểm tra plan của bạn.

---

## 7. Khắc phục sự cố

| Triệu chứng                           | Nguyên nhân                                              | Cách xử lý                                              |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| `OPENAI_API_KEY is not set`           | Chưa thêm vào Vercel env hoặc chưa redeploy              | Thêm key, redeploy                                      |
| Sinh ảnh báo lỗi `gpt-image-1`        | Tổ chức OpenAI chưa được verify để dùng image API        | Vào https://platform.openai.com/settings/organization/general → bấm "Verify Organization" |
| Lịch sử không đồng bộ giữa các máy    | Chưa kết nối Postgres                                    | Làm theo bước 3.3                                       |
| `429 Too Many Requests`               | Hết quota OpenAI hoặc rate-limit                         | Kiểm tra usage tại platform.openai.com → Usage          |
| Build fail trên Vercel với case error | Import sai casing                                        | Sửa thành tên file đúng (Linux phân biệt hoa/thường)    |

---

## 8. Bảo mật

- API key chỉ tồn tại ở serverless functions, **không bao giờ** gửi xuống browser.
- `ownerId` cho lịch sử là một mã ngẫu nhiên ẩn danh trong localStorage — nếu cần đa người dùng thật, bổ sung Auth (NextAuth / Clerk / Supabase Auth).
- Mọi route đều có `Access-Control-Allow-Origin: *` — siết lại nếu app phải chạy nội bộ.

---

## License

Sử dụng nội bộ cho Vinalink Group. Liên hệ trước khi tái phân phối.
