import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { dirname } from "node:path";
import { defer, lastValueFrom, Observable } from "rxjs";
import { withTemporaryFile } from "./file-streams.js";

let activeUploads = 0;

@Injectable()
/** Spool large material uploads to private disk with process-wide admission control and deterministic cleanup. */
export class MaterialUploadInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return defer(async () => {
      if (activeUploads >= 2) throw new HttpException("Upload capacity reached. Please retry shortly.", 429);
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
