import { BadRequestException } from "@nestjs/common";
import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

/** Dải NAT64 cục bộ RFC 8215; ipaddr.js xếp vào "unicast" nhưng có thể dịch sang IPv4 nội bộ. */
const LOCAL_NAT64 = ipaddr.IPv6.parse("64:ff9b:1::");
/** Cổng được phép cho endpoint công khai; cổng khác chỉ dùng khi phát triển trên máy cục bộ. */
const PUBLIC_PORTS = new Set(["", "443"]);

/** Host loopback được phép khi phát triển cục bộ (không bao giờ ở production). */
function isLocalDevelopmentHost(hostname: string): boolean {
  return process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

// Chỉ chấp nhận địa chỉ IP định tuyến công khai, kể cả IPv4 được nhúng trong IPv6; loại dải NAT64 cục bộ.
export function isPublicIp(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).match(LOCAL_NAT64, 48)) return false;
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

// Kiểm tra hostname và giao thức trước khi gửi yêu cầu có API key.
export function assertSafeProviderUrl(value: string): void {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const localDevelopment = isLocalDevelopmentHost(hostname);
  if ((url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) || url.username || url.password) {
    throw new Error("Endpoint AI phải dùng HTTPS và không được chứa thông tin đăng nhập trong URL.");
  }
  if (localDevelopment) return;
  // Chỉ cổng HTTPS mặc định: chặn dò dịch vụ nội bộ chạy trên cổng lạ của host công khai/CDN.
  if (!PUBLIC_PORTS.has(url.port)) throw new Error("Endpoint AI chỉ được dùng cổng HTTPS 443.");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa")) {
    throw new Error("Endpoint AI không được trỏ đến mạng nội bộ.");
  }
  if (ipaddr.isValid(hostname) && !isPublicIp(hostname)) {
    throw new Error("Endpoint AI không được trỏ đến IP nội bộ hoặc dành riêng.");
  }
}

/**
 * Chuẩn hóa URL do người dùng cấu hình (webhook tích hợp, bản ghi buổi học): chỉ nhận HTTPS tới host công khai,
 * không chứa thông tin đăng nhập, không trỏ mạng nội bộ/cloud metadata; lỗi trả 400 kèm thông điệp nghiệp vụ.
 */
export function assertPublicHttpsUrl(value: string, message: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BadRequestException(message);
  }
  if (url.protocol !== "https:") throw new BadRequestException(message);
  try {
    assertSafeProviderUrl(url.toString());
  } catch {
    throw new BadRequestException(message);
  }
  return url.toString();
}

// Kiểm tra IP thực được DNS trả về tại thời điểm kết nối để chặn DNS rebinding.
const publicDnsLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { family: options.family, hints: options.hints, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    // Đồng bộ với assertSafeProviderUrl: localhost khi phát triển được phân giải về loopback, mọi host khác phải công khai.
    const loopbackAllowed = isLocalDevelopmentHost(hostname.toLowerCase()) && addresses.every(({ address }) => ipaddr.process(address).range() === "loopback");
    if (!addresses.length || (!loopbackAllowed && addresses.some(({ address }) => !isPublicIp(address)))) {
      return callback(new Error("DNS của endpoint AI trả về địa chỉ mạng nội bộ hoặc dành riêng."), "", 0);
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

const publicEndpointAgent = new Agent({ connect: { lookup: publicDnsLookup } });

// Từ chối chuyển hướng để API key không bị gửi tới host khác.
export function fetchProviderEndpoint(url: string, options: RequestInit): Promise<Response> {
  assertSafeProviderUrl(url);
  return fetch(url, { ...options, redirect: "error", dispatcher: publicEndpointAgent } as RequestInit);
}
