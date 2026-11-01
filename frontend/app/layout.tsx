import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Urban Route Planner",
  description: "Capacity-aware garbage collection routing",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
