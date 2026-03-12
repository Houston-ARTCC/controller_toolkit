import { Rajdhani, Source_Sans_3 } from "next/font/google";
import ThemeSwitcher from "@/components/theme-switcher";
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
  const themeInitScript = `
    (() => {
      const storedMode = localStorage.getItem("theme-mode") || "system";
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const resolved = storedMode === "system" ? (prefersDark ? "dark" : "light") : storedMode;
      document.documentElement.setAttribute("data-theme-mode", storedMode);
      document.documentElement.setAttribute("data-theme", resolved);
    })();
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${headingFont.variable} ${bodyFont.variable} antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeSwitcher />
        {children}
      </body>
    </html>
  );
}
