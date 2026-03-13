"use client";
import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light") {
      setDark(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  return (
    <button
      onClick={toggle}
      className="fixed top-4 left-4 z-[100] p-2.5 rounded-full border transition-all duration-300"
      style={{
        background: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
        borderColor: dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)",
        color: dark ? "#e2e8f0" : "#334155",
      }}
      title={dark ? "切换白天模式" : "切换夜间模式"}
    >
      {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}
