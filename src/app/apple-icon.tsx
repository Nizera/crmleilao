import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A0A0A",
        }}
      >
        <svg width="110" height="110" viewBox="0 0 64 64">
          <path d="M32 7 53 16v15c0 12-8 21-21 27C19 52 11 43 11 31V16L32 7Z" fill="#16130a" stroke="#f5b800" strokeWidth="3" />
          <circle cx="32" cy="23" r="8" fill="#f8d66d" stroke="#0a0a0a" strokeWidth="2" />
          <path d="M23 33h18l-2 12H25l-2-12Zm-3-3h24l-2 4H22l-2-4Zm8 17h10v4H28z" fill="#f5b800" stroke="#f5b800" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    {
      ...size,
    },
  );
}
