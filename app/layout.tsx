import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wealth OS — Financial Command Center",
  description: "Your all-in-one personal finance dashboard for tracking wealth, investments, budgets, and taxes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-[#07080c] text-gray-100">{children}</body>
    </html>
  );
}
