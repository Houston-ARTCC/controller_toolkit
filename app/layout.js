import { Rajdhani, Source_Sans_3 } from "next/font/google";
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
  const themeInitScript = `(()=>{try{const m=localStorage.getItem("theme-mode")||"system";const d=window.matchMedia("(prefers-color-scheme: dark)").matches;const r=m==="system"?(d?"dark":"light"):m;document.documentElement.setAttribute("data-theme-mode",m);document.documentElement.setAttribute("data-theme",r);}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${headingFont.variable} ${bodyFont.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
