import { Rajdhani, Source_Sans_3 } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const headingFont = Rajdhani({
  variable: "--font-heading",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

const bodyFont = Source_Sans_3({
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata = {
  title: "ZHU Controller Toolkit",
  description:
    "Quick access hub for Houston ARTCC controller tools, references, and utilities.",
};

export default function RootLayout({ children }) {

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${headingFont.variable} ${bodyFont.variable} antialiased`}>
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
