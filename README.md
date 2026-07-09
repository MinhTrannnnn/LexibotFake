# LexiCheck Writing

Web chấm IELTS Writing bằng OpenAI, không đăng nhập, không lưu lịch sử, sẵn sàng deploy lên Vercel.

## Chạy local

```bash
cp .env.example .env
# sửa OPENAI_API_KEY trong .env
npm run dev
```

Mở `http://localhost:3000`.

## Deploy Vercel

1. Push project lên GitHub.
2. Import project vào Vercel.
3. Thêm Environment Variables:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` tùy chọn, mặc định trong code là `gpt-4.1-mini`
4. Deploy.

Ứng dụng chỉ gửi prompt + bài viết đi chấm tại thời điểm bấm nút, không có database và không lưu bài.
