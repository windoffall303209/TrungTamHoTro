import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defer, lastValueFrom, Observable } from "rxjs";

let activeSubmissionUploads = 0;
const logger = new Logger("SubmissionUploadInterceptor");
/** Số lượt tải tệp bài nộp đồng thời tối đa mỗi tiến trình (ghi đĩa tạm có giới hạn, không đệm RAM). */
const MAX_CONCURRENT_SUBMISSION_UPLOADS = Math.max(
  1,
  Number(process.env.SUBMISSION_UPLOAD_CONCURRENCY) || 32,
);

/** Trả số lượt upload bài nộp đang xử lý để giám sát và kiểm thử dọn dẹp tài nguyên. */
export function getActiveSubmissionUploadCount(): number {
  return activeSubmissionUploads;
}

@Injectable()
/** Ghi tệp bài nộp multipart ra thư mục tạm riêng trên đĩa thay vì memoryStorage và luôn dọn sạch khi xong hoặc lỗi. */
export class SubmissionUploadInterceptor implements NestInterceptor {
  /** Giới hạn concurrency, tách thư mục tạm theo từng request và bảo đảm xóa sạch tệp tạm trong khối finally. */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return defer(async () => {
      if (activeSubmissionUploads >= MAX_CONCURRENT_SUBMISSION_UPLOADS) {
        throw new HttpException(
          "Hệ thống đang xử lý quá nhiều lượt nộp tệp. Hãy thử lại sau.",
          429,
        );
      }
      activeSubmissionUploads += 1;
      let directory: string | undefined;
      try {
        directory = await mkdtemp(join(tmpdir(), "wind-submission-"));
        const Multipart = FilesInterceptor("files", 5, {
          dest: directory,
          limits: {
            fileSize: 20 * 1024 * 1024,
            files: 5,
            fields: 16,
            parts: 25,
            fieldSize: 256 * 1024,
          },
        });
        const multipart = new Multipart();
        return await lastValueFrom(
          (await multipart.intercept(context, next)) as Observable<unknown>,
        );
      } finally {
        activeSubmissionUploads = Math.max(0, activeSubmissionUploads - 1);
        if (directory) {
          await rm(directory, { recursive: true, force: true }).catch(() => {
            logger.error("Không dọn được thư mục tạm của bài nộp.");
          });
        }
      }
    });
  }
}
