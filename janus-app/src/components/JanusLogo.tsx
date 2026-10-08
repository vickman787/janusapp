import React from "react";

interface JanusLogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
  variant?: "full" | "icon" | "watermark";
}

export function JanusLogo({
  size = 40,
  showText = true,
  className = "",
  variant = "full",
}: JanusLogoProps) {
  if (variant === "watermark") {
    return (
      <div className={`pointer-events-none select-none flex items-center justify-center ${className}`}>
        <svg
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full opacity-[0.06] blur-[0.5px]"
        >
          <defs>
            <linearGradient id="bgJanusLight" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="50%" stopColor="#C4B5FD" />
              <stop offset="100%" stopColor="#836EF9" />
            </linearGradient>
            <linearGradient id="bgJanusDark" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#836EF9" />
              <stop offset="50%" stopColor="#6848D7" />
              <stop offset="100%" stopColor="#3B0764" />
            </linearGradient>
            <linearGradient id="bgHairRibbon" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#836EF9" />
              <stop offset="100%" stopColor="#A0055D" />
            </linearGradient>
          </defs>

          {/* Left Head & Face Silhouette */}
          <path
            d="M175 90 C125 90 90 135 90 190 C90 220 98 245 108 265 C115 278 122 284 130 295 C136 303 138 316 136 325 C132 342 144 350 156 342 C168 333 172 320 178 308 C185 294 188 280 188 260 L188 120 C188 102 182 90 175 90 Z"
            fill="url(#bgJanusLight)"
          />

          {/* Left Facial Profile Outline */}
          <path
            d="M142 125 C115 138 98 165 98 196 C98 206 102 214 96 220 C88 228 85 238 92 244 C100 250 106 250 106 258 C106 266 94 274 100 284 C106 294 122 298 135 298"
            stroke="url(#bgJanusLight)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Right Head & Face Silhouette */}
          <path
            d="M225 90 C275 90 310 135 310 190 C310 220 302 245 292 265 C285 278 278 284 270 295 C264 303 262 316 264 325 C268 342 256 350 244 342 C232 333 228 320 222 308 C215 294 212 280 212 260 L212 120 C212 102 218 90 225 90 Z"
            fill="url(#bgJanusDark)"
          />

          {/* Right Facial Profile Outline */}
          <path
            d="M258 125 C285 138 302 165 302 196 C302 206 298 214 304 220 C312 228 315 238 308 244 C300 250 294 250 294 258 C294 266 306 274 300 284 C294 294 278 298 265 298"
            stroke="url(#bgHairRibbon)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Intertwined Central Hair Ribbon Braids */}
          <path
            d="M170 105 C200 70 245 100 220 150 C200 190 150 180 180 240 C200 280 230 260 210 320"
            stroke="url(#bgHairRibbon)"
            strokeWidth="16"
            strokeLinecap="round"
          />
          <path
            d="M230 105 C200 70 155 100 180 150 C200 190 250 180 220 240 C200 280 170 260 190 320"
            stroke="url(#bgJanusLight)"
            strokeWidth="14"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* ── Dual-Face Emblem ── */}
      <div
        className="relative shrink-0 flex items-center justify-center rounded-lg bg-[#161224] border border-white/15 p-1 overflow-hidden"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full"
        >
          <defs>
            <linearGradient id="jlWhite" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="70%" stopColor="#E0D7FE" />
              <stop offset="100%" stopColor="#836EF9" />
            </linearGradient>
            <linearGradient id="jlPurple" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#836EF9" />
              <stop offset="60%" stopColor="#5B21B6" />
              <stop offset="100%" stopColor="#2E1065" />
            </linearGradient>
            <linearGradient id="jlRibbon" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#C084FC" />
              <stop offset="50%" stopColor="#836EF9" />
              <stop offset="100%" stopColor="#A0055D" />
            </linearGradient>
          </defs>

          {/* Left Face - Light Lavender Profile */}
          <path
            d="M44 24 C34 24 26 32 24 42 C22 47 24 49 20 53 C17 56 18 60 21 62 C24 64 25 64 25 67 C25 71 20 73 22 78 C25 83 33 85 44 85"
            stroke="url(#jlWhite)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />

          {/* Left Hair Ribbon Curls */}
          <path
            d="M44 24 C48 30 52 38 48 46 C44 54 38 52 42 62 C46 72 52 74 46 84"
            stroke="url(#jlRibbon)"
            strokeWidth="4"
            strokeLinecap="round"
          />

          {/* Right Face - Dark Violet Profile */}
          <path
            d="M56 24 C66 24 74 32 76 42 C78 47 76 49 80 53 C83 56 82 60 79 62 C76 64 75 64 75 67 C75 71 80 73 78 78 C75 83 67 85 56 85"
            stroke="url(#jlPurple)"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />

          {/* Right Hair Ribbon Curls */}
          <path
            d="M56 24 C52 30 48 38 52 46 C56 54 62 52 58 62 C54 72 48 74 54 84"
            stroke="url(#jlRibbon)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Intertwining Loop Accent at top */}
          <path
            d="M46 22 C48 18 52 18 54 22"
            stroke="#C084FC"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* ── Brand Typography ── */}
      {showText && (
        <div className="flex flex-col">
          <span className="text-lg font-bold tracking-[0.16em] text-white font-serif leading-none">
            JANUS
          </span>
          <span className="text-[8px] font-semibold tracking-[0.2em] text-[#836EF9] uppercase mt-0.5">
            CONSUMER PAYMENTS
          </span>
        </div>
      )}
    </div>
  );
}
