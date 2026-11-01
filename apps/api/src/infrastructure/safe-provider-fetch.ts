import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

// Chỉ chấp nhận địa chỉ IP định tuyến công khai, kể cả IPv4 được nhúng trong IPv6.
export function isPublicIp(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

// Kiểm tra hostname và giao thức trước khi gửi yêu cầu có API key.
export function assertSafeProviderUrl(value: string): void {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const localDevelopment = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(hostname);
  if ((url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) || url.username || url.password) {
    throw new Error("Endpoint AI phải dùng HTTPS và không được chứa thông tin đăng nhập trong URL.");
  }
  if (localDevelopment) return;
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa")) {
    throw new Error("Endpoint AI không được trỏ đến mạng nội bộ.");
  }
  if (ipaddr.isValid(hostname) && !isPublicIp(hostname)) {
    throw new Error("Endpoint AI không được trỏ đến IP nội bộ hoặc dành riêng.");
  }
}

// Kiểm tra IP thực được DNS trả về tại thời điểm kết nối để chặn DNS rebinding.
const publicDnsLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { family: options.family, hints: options.hints, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
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
