import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/providers/app-provider";
import { I18nProvider } from "@/providers/i18n-provider";

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-body",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
});

/** Tạo metadata theo locale cookie để tiêu đề đúng ngôn ngữ ngay từ phản hồi HTML. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = (await cookies()).get("wind-edu-locale")?.value;
  return locale === "en-US"
    ? { title: "Wind EDU | Modern Online Teaching & Learning Platform", description: "A unified, high-performance workspace for courses, exams, materials, forums, and live classes." }
    : { title: "Wind EDU | Nền tảng Giảng dạy & Học tập Số", description: "Hệ thống quản lý đào tạo, đề thi AI, kho học liệu và lớp học trực tuyến hiện đại." };
}

// Chạy trước hydration để áp dụng theme đã lưu và tránh nháy giao diện sai màu.
const themeInitializer = `(() => {
  try {
    const stored = localStorage.getItem("wind-edu-theme");
    const theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#080c14" : "#f8fafc");
    const locale = localStorage.getItem("wind-edu-locale") === "en-US" ? "en-US" : "vi-VN";
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();`;

/** Khung HTML gốc, nạp font/theme sớm và cung cấp trạng thái ứng dụng cho mọi route. */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const locale = (await cookies()).get("wind-edu-locale")?.value === "en-US" ? "en-US" : "vi-VN";
  return (
    <html data-scroll-behavior="smooth" lang={locale} suppressHydrationWarning>
      <head>
        <meta content="#f8fafc" name="theme-color" />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body className={beVietnamPro.variable}>
        <I18nProvider>
          <AppProvider>{children}</AppProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
