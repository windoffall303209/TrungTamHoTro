import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/providers/app-provider";

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-body",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Wind EDU | Trung tâm hỗ trợ giảng dạy",
  description: "Không gian vận hành tập trung cho dữ liệu, đề thi, diễn đàn và lớp học online.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="vi">
      <body className={beVietnamPro.variable}>
        {/*
          THESIS: Wind EDU is a contemporary registrar's desk, not a generic dashboard-card mosaic.
          OWN-WORLD: warm paper ground, blue-black ink, ledger rules, archival tabs and one vermilion action accent.
          STORY: each role scans its current work, understands status and moves to the next teaching operation without leaving the shared workspace.
          FIRST VIEWPORT: a slim role rail frames a large daily ledger and a contextual right column; actions sit directly beside the rows they change.
          FORM: Sổ giáo vụ đương đại, grounded direction 7, seed 36e85a09.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
        */}
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
