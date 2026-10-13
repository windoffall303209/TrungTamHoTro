import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/providers/app-provider";
import { I18nProvider } from "@/providers/i18n-provider";

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-body",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

/** Tạo metadata theo locale cookie để tiêu đề đúng ngôn ngữ ngay từ phản hồi HTML. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = (await cookies()).get("wind-edu-locale")?.value;
  return locale === "en-US"
    ? { title: "Wind EDU | Bilingual Teaching Center", description: "A unified workspace for learning data, exams, forums, and online classes." }
    : { title: "Wind EDU | Trung tâm hỗ trợ giảng dạy", description: "Không gian vận hành tập trung cho dữ liệu, đề thi, diễn đàn và lớp học online." };
}

// Chạy trước hydration để áp dụng theme đã lưu và tránh nháy giao diện sai màu.
const themeInitializer = `(() => {
  try {
    const stored = localStorage.getItem("wind-edu-theme");
    const theme = stored === "light" || stored === "dark"
      ? stored
      : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b1620" : "#f7f4ed");
    const locale = localStorage.getItem("wind-edu-locale") === "en-US" ? "en-US" : "vi-VN";
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  } catch { document.documentElement.dataset.theme = "light"; }
})();`;

/** Khung HTML gốc, nạp font/theme sớm và cung cấp trạng thái ứng dụng cho mọi route. */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const locale = (await cookies()).get("wind-edu-locale")?.value === "en-US" ? "en-US" : "vi-VN";
  return (
    <html data-scroll-behavior="smooth" lang={locale} suppressHydrationWarning>
      <head><meta content="#f7f4ed" name="theme-color" /><script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitializer }} /></head>
      <body className={beVietnamPro.variable}>
        {/*
          THESIS: Wind EDU is a contemporary registrar's desk, not a generic dashboard-card mosaic.
          OWN-WORLD: warm paper ground, blue-black ink, ledger rules, archival tabs and one vermilion action accent.
          STORY: each role scans its current work, understands status and moves to the next teaching operation without leaving the shared workspace.
          FIRST VIEWPORT: a slim role rail frames a large daily ledger and a contextual right column; actions sit directly beside the rows they change.
          FORM: Sổ giáo vụ đương đại, grounded direction 7, seed 36e85a09.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
        */}
        <I18nProvider><AppProvider>{children}</AppProvider></I18nProvider>
      </body>
    </html>
  );
}
