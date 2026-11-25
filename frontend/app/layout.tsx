import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Urban Route Planner",
  description: "Chinese Postman routing for municipal waste collection",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
