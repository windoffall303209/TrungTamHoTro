import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import type { Environment } from "../config/environment.js";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

export interface EmailDeliveryResult {
  provider: "resend";
  providerMessageId: string;
  acceptedAt: string;
}

/** Chuẩn hóa địa chỉ người gửi sang email thuần hoặc dạng `Tên <email>` mà Resend nhận. */
export function normalizeResendSender(value: string): string {
  const sender = value.trim();
  if (!sender) return "";
  if (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender)) return sender;
  if (/^.+\s<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$/.test(sender)) return sender;
  const friendlySender = sender.match(/^(.+?)\s+([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/);
  if (friendlySender) return `${friendlySender[1]!.trim()} <${friendlySender[2]}>`;
  throw new ServiceUnavailableException("RESEND_FROM không đúng định dạng email hoặc 'Tên hiển thị <email>'.");
}

@Injectable()
/** Boundary duy nhất gửi transactional email qua Resend. */
export class EmailDeliveryService {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly client?: Resend;

  /** Tạo Resend client chỉ khi có API key; sender vẫn được kiểm tra ngay lúc bootstrap. */
  constructor(config: ConfigService<Environment, true>) {
    this.apiKey = config.get("RESEND_API_KEY", { infer: true });
    this.from = normalizeResendSender(config.get("RESEND_FROM", { infer: true }));
    this.client = this.apiKey ? new Resend(this.apiKey) : undefined;
  }

  /** Cho luồng nghiệp vụ biết email delivery có sẵn trước khi tạo yêu cầu gửi. */
  isConfigured(): boolean {
    return Boolean(this.client && this.from);
  }

  /**
   * Gửi plain-text email với idempotency key để retry không tạo thư trùng.
   * Lỗi provider được đổi thành ServiceUnavailableException, không trả chi tiết API key.
   */
  async send(input: SendEmailInput): Promise<EmailDeliveryResult> {
    if (!this.client || !this.from) {
      throw new ServiceUnavailableException("Resend chưa được cấu hình. Cần RESEND_API_KEY và RESEND_FROM.");
    }

    const { data, error } = await this.client.emails.send(
      {
        from: this.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      },
      { idempotencyKey: input.idempotencyKey.slice(0, 256) },
    );

    if (error || !data?.id) {
      throw new ServiceUnavailableException(`Resend từ chối yêu cầu gửi email${error?.name ? ` (${error.name})` : ""}.`);
    }

    return { provider: "resend", providerMessageId: data.id, acceptedAt: new Date().toISOString() };
  }
}
