"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const dark = document.documentElement.dataset.theme === "dark";
    setIsDark(dark);
  }, []);

  function toggleTheme() {
    const nextIsDark = !isDark;
    document.documentElement.dataset.theme = nextIsDark ? "dark" : "light";
    window.localStorage.setItem("janus-theme", nextIsDark ? "dark" : "light");
    setIsDark(nextIsDark);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-lg border border-white/10 bg-[#161224]/80 p-2 text-white/55 transition hover:border-[#836EF9]/50 hover:text-white"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
