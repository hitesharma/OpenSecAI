import React from "react";

interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 18, stroke = 1.75, style }: IconProps) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { display: "block", flexShrink: 0, ...style },
  };

  const paths: Record<string, React.ReactNode> = {
    shield:        <><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/></>,
    shieldCheck:   <><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9 11.5l2 2 4-4"/></>,
    package:       <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/></>,
    box:           <><rect x="4" y="6" width="16" height="13" rx="1.5"/><path d="M4 10h16"/><path d="M9 6V4h6v2"/></>,
    code:          <><path d="M9 8l-4 4 4 4"/><path d="M15 8l4 4-4 4"/></>,
    key:           <><circle cx="8" cy="8" r="3.5"/><path d="M10.5 10.5L20 20"/><path d="M16 16l2-2"/><path d="M18.5 18.5l1.5-1.5"/></>,
    layers:        <><path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z"/><path d="M4 12l8 4.5L20 12"/><path d="M4 16.5L12 21l8-4.5"/></>,
    fileList:      <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 13h5"/><path d="M10 16.5h5"/></>,
    scale:         <><path d="M12 4v16"/><path d="M7 20h10"/><path d="M5 8h14"/><path d="M5 8l-2 5h4l-2-5z"/><path d="M19 8l-2 5h4l-2-5z"/></>,
    grid:          <><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></>,
    history:       <><path d="M3 5.5v4h4"/><path d="M3.5 9.5A8.5 8.5 0 1 1 4 14.5"/><path d="M12 8v4l3 2"/></>,
    folder:        <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></>,
    folderOpen:    <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2"/><path d="M3 9h17.5a1 1 0 0 1 .97 1.25l-1.6 6A2 2 0 0 1 18 18H5a2 2 0 0 1-2-2V9z"/></>,
    play:          <><path d="M7 5l12 7-12 7V5z"/></>,
    plus:          <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    clock:         <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>,
    x:             <><path d="M6 6l12 12"/><path d="M18 6L6 18"/></>,
    search:        <><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></>,
    terminal:      <><path d="M4 6l5 6-5 6"/><path d="M12 18h8"/></>,
    chevDown:      <><path d="M6 9l6 6 6-6"/></>,
    chevRight:     <><path d="M9 6l6 6-6 6"/></>,
    arrowRight:    <><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></>,
    check:         <><path d="M5 12.5l4.5 4.5L19 7"/></>,
    checkCircle:   <><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12l2.5 2.5 4.5-5"/></>,
    xCircle:       <><circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/></>,
    alertTriangle: <><path d="M12 4l9 15.5H3L12 4z"/><path d="M12 10v4"/><path d="M12 17.5h.01"/></>,
    fileText:      <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5"/><path d="M10 15.5h5"/></>,
    eye:           <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.5"/></>,
    cpu:           <><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2"/></>,
    sparkle:       <><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z"/></>,
    activity:      <><path d="M3 12h4l2.5 7 5-14L17 12h4"/></>,
    lock:          <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
    arrowLeft:     <><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></>,
    trash:         <><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/></>,
  };

  return <svg {...p}>{paths[name] ?? paths.shield}</svg>;
}
