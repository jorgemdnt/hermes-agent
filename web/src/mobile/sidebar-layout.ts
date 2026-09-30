import { useEffect, useState } from "react";
import "./sidebar-layout.css";

export function useSidebarLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("hermes:left-sidebar-open") !== "false");
  const [splitOpen, setSplitOpen] = useState(() => localStorage.getItem("hermes:right-split-open") === "true");
  useEffect(() => { localStorage.setItem("hermes:left-sidebar-open", String(sidebarOpen)); }, [sidebarOpen]);
  useEffect(() => { localStorage.setItem("hermes:right-split-open", String(splitOpen)); }, [splitOpen]);
  return { sidebarOpen, setSidebarOpen, splitOpen, setSplitOpen };
}
