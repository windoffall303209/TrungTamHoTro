import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { dirname } from "node:path";
import { defer, lastValueFrom, Observable } from "rxjs";
import { withTemporaryFile } from "./file-streams.js";

let activeUploads = 0;
/** Số lượt tải học liệu lên đồng thời mỗi tiến trình (ghi đĩa tạm, không đệm RAM); mặc định 8 thay vì 2. */
const MAX_CONCURRENT_UPLOADS = Math.max(1, Number(process.env.UPLOAD_CONCURRENCY) || 8);

@Injectable()
/** Ghi học liệu lớn xuống tệp riêng, giới hạn lượt tải đồng thời trong tiến trình và luôn dọn dẹp. */
export class MaterialUploadInterceptor implements NestInterceptor {
  /** Giới hạn tải lên đồng thời, ghi multipart vào tệp tạm và giải phóng tài nguyên sau xử lý. */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return defer(async () => {
      if (activeUploads >= MAX_CONCURRENT_UPLOADS) throw new HttpException("Upload capacity reached. Please retry shortly.", 429);
      activeUploads += 1;
      try {
        return await withTemporaryFile(async (path) => {
          const Multipart = FileInterceptor("file", {
            dest: dirname(path),
            limits: { fileSize: 500_000_000, files: 1, fields: 4, parts: 5, fieldSize: 16_384 },
          });
          const multipart = new Multipart();
          return lastValueFrom(await multipart.intercept(context, next) as Observable<unknown>);
        });
      } finally { activeUploads -= 1; }
    });
  }
}
