import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type {
  ClassFeedCommentView,
  ClassFeedLikeToggleResult,
  ClassFeedPostView,
  ClassFeedPreferenceResult,
} from "@wind-of-fall/contracts";
import type { Request, Response } from "express";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { CurrentSession } from "../../../auth/current-session.decorator.js";
import { RequireAuthentication } from "../../../auth/require-permissions.decorator.js";
import {
  isInlineSafeMime,
  USER_FILE_CSP,
} from "../../../infrastructure/file-signature.js";
import { readFileHead } from "../../../infrastructure/file-streams.js";
import {
  fileContentDisposition,
  normalizeMultipartFileName,
} from "../../../infrastructure/file-transfer.js";
import {
  rethrowWithRangeHeaders,
  sendRangedStreamableFile,
} from "../../../infrastructure/http-range-stream.js";
import { SubmissionUploadInterceptor } from "../../../infrastructure/submission-upload.interceptor.js";
import {
  CreateFeedCommentDto,
  CreateFeedPostDto,
  ListFeedQueryDto,
  UpdateFeedPostDto,
  UpdateFeedPreferenceDto,
} from "./class-feed.dto.js";
import {
  ClassFeedService,
  type UploadedFeedFile,
} from "./class-feed.service.js";

@ApiTags("Class Feed")
@Controller("classes")
@RequireAuthentication()
/** API Bảng tin lớp học: đăng bài kèm ảnh/tệp, bình luận 2 tầng, lượt thích, sửa/xóa và lịch sử chỉnh sửa. */
export class ClassFeedController {
  constructor(private readonly classFeed: ClassFeedService) {}

  /** Tải danh sách bài viết bảng tin trong lớp mà người dùng có quyền tham gia. */
  @Get(":classId/feed")
  listPosts(
    @Param("classId") classId: string,
    @Query() query: ListFeedQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ClassFeedPostView[]> {
    return this.classFeed.listPosts(classId, session, {
      includeHidden: query.includeHidden,
      limit: query.limit,
    });
  }

  /** Tạo bài viết mới (hỗ trợ cả JSON và multipart đính kèm tối đa 5 ảnh/tệp ghi đĩa tạm). */
  @Post(":classId/feed/posts")
  @UseInterceptors(SubmissionUploadInterceptor)
  async createPost(
    @Param("classId") classId: string,
    @Body() input: CreateFeedPostDto,
    @UploadedFiles()
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer?: Buffer;
      path?: string;
    }> = [],
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ClassFeedPostView> {
    const normalizedFiles = await this.normalizeUploads(files);
    return this.classFeed.createPost(
      classId,
      input.content,
      normalizedFiles,
      session,
    );
  }

  /** Cập nhật nội dung bài viết và tự động lưu lịch sử chỉnh sửa trong cơ sở dữ liệu. */
  @Patch(":classId/feed/posts/:postId")
  updatePost(
    @Param("classId") classId: string,
    @Param("postId") postId: string,
    @Body() input: UpdateFeedPostDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ClassFeedPostView> {
    return this.classFeed.updatePost(classId, postId, input.content, session);
  }

  /** Xóa bài viết khỏi bảng tin lớp và dọn tệp đính kèm tương ứng trên storage. */
  @Delete(":classId/feed/posts/:postId")
  deletePost(
    @Param("classId") classId: string,
    @Param("postId") postId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{ deleted: true; postId: string }> {
    return this.classFeed.deletePost(classId, postId, session);
  }

  /** Bật/tắt lượt thích cho một bài viết trên bảng tin lớp. */
  @Post(":classId/feed/posts/:postId/like")
  togglePostLike(
    @Param("classId") classId: string,
    @Param("postId") postId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ClassFeedLikeToggleResult> {
    return this.classFeed.togglePostLike(classId, postId, session);
  }

  /** Lưu trạng thái ẩn hoặc theo dõi bài viết riêng cho tài khoản hiện tại. */
  @Patch(":classId/feed/posts/:postId/preferences")
  updatePreference(
    @Param("classId") classId: string,
    @Param("postId") postId: string,
    @Body() input: UpdateFeedPreferenceDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ClassFeedPreferenceResult> {
    return this.classFeed.updatePostPreference(classId, postId, input, session);
  }

  /** Tạo bình luận cấp 1 hoặc phản hồi con cấp 2 cho một bài viết trên bảng tin lớp. */
  @Post(":classId/feed/posts/:postId/comments")
  createComment(
    @Param("classId") classId: string,
    @Param("postId") postId: string,
    @Body() input: CreateFeedCommentDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ClassFeedCommentView> {
    return this.classFeed.createComment(classId, postId, input, session);
  }

  /** Xóa bình luận (tác giả, giảng viên lớp hoặc quản lý/quản trị). */
  @Delete(":classId/feed/posts/:postId/comments/:commentId")
  deleteComment(
    @Param("classId") classId: string,
    @Param("postId") postId: string,
    @Param("commentId") commentId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{ deleted: true; commentId: string }> {
    return this.classFeed.deleteComment(classId, postId, commentId, session);
  }

  /** Bật/tắt lượt thích cho một bình luận cấp 1 hoặc phản hồi cấp 2. */
  @Post(":classId/feed/posts/:postId/comments/:commentId/like")
  toggleCommentLike(
    @Param("classId") classId: string,
    @Param("postId") postId: string,
    @Param("commentId") commentId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ClassFeedLikeToggleResult> {
    return this.classFeed.toggleCommentLike(classId, postId, commentId, session);
  }

  /** Tải xuống hoặc xem trước tệp đính kèm bảng tin theo stream có hỗ trợ HTTP Range (206/416) và CSP sandbox. */
  @Get(":classId/feed/posts/:postId/attachments/:attachmentId")
  @Header("Content-Security-Policy", USER_FILE_CSP)
  async attachment(
    @Param("classId") classId: string,
    @Param("postId") postId: string,
    @Param("attachmentId") attachmentId: string,
    @Query("action") action: string,
    @Headers("range") rangeHeader: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<StreamableFile> {
    try {
      const file = await this.classFeed.readAttachmentStream(
        classId,
        postId,
        attachmentId,
        session,
        rangeHeader,
      );
      const inline = action === "preview" && isInlineSafeMime(file.mimeType);
      return sendRangedStreamableFile(req, res, {
        stream: file.stream,
        totalSize: file.totalSize,
        range: file.range,
        fileName: file.fileName,
        mimeType: file.mimeType,
        disposition: fileContentDisposition(
          inline ? "inline" : "attachment",
          file.fileName,
        ),
      });
    } catch (error) {
      rethrowWithRangeHeaders(res, error);
    }
  }

  /** Chuẩn hóa tên tệp multipart và chỉ nạp 8 KB đầu khi tệp đã ghi đĩa tạm để tránh đệm toàn tệp vào RAM. */
  private async normalizeUploads(
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer?: Buffer;
      path?: string;
    }>,
  ): Promise<UploadedFeedFile[]> {
    const normalized: UploadedFeedFile[] = [];
    for (const file of files) {
      if (file.path) {
        normalized.push({
          originalName: normalizeMultipartFileName(file.originalname),
          mimeType: file.mimetype,
          size: file.size,
          path: file.path,
          buffer: await readFileHead(file.path),
        });
      } else if (file.buffer) {
        normalized.push({
          originalName: normalizeMultipartFileName(file.originalname),
          mimeType: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        });
      } else {
        throw new BadRequestException("Không đọc được dữ liệu tệp tải lên.");
      }
    }
    return normalized;
  }
}
