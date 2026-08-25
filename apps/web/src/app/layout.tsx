import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/providers/app-provider";

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin", "vietnamese"],
});

const manrope = Manrope({
  variable: "--font-heading",
  subsets: ["latin", "vietnamese"],
});

export const metadata: Metadata = {
  title: "Wind EDU | Trung tâm hỗ trợ giảng dạy",
  description: "Không gian vận hành tập trung cho dữ liệu, đề thi, diễn đàn và lớp học online.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className={`${inter.variable} ${manrope.variable}`}><AppProvider>{children}</AppProvider></body>
    </html>
  );
}
