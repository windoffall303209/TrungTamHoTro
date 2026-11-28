// Phải được import đầu tiên trong main.ts: libuv tạo threadpool ở lần dùng đầu tiên và đọc biến này đúng một lần.
// Mặc định 4 luồng bị scrypt, zlib, fs và DNS tranh nhau; 16 luồng cho phép băm mật khẩu song song mà không chặn I/O.
process.env.UV_THREADPOOL_SIZE ??= "16";

export {};
