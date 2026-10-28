import { ImageResponse } from "next/og";

export const alt = "Os Caras das Legends — Leilão diário de colecionáveis";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

const MARK_PATH =
  "M6 3H16.5L21 7.5V18A3 3 0 0 1 18 21H6A3 3 0 0 1 3 18V6A3 3 0 0 1 6 3ZM12 7.4L13.23 10.7L16.76 10.85L14 13.05L14.94 16.45L12 14.5L9.06 16.45L10 13.05L7.24 10.85L10.77 10.7Z";

const RARITIES = ["#8B5CF6", "#B45309", "#94A3B8", "#EAB308"];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#FFFFFF",
        }}
      >
        <svg width="200" height="200" viewBox="0 0 24 24">
          <path fillRule="evenodd" fill="#0A0A0A" d={MARK_PATH} />
        </svg>
        <div
          style={{
            display: "flex",
            marginTop: 40,
            fontSize: 80,
            letterSpacing: -3,
            color: "#0A0A0A",
          }}
        >
          Os Caras das Legends
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 16,
            fontSize: 34,
            color: "#737373",
          }}
        >
          Leilão diário de colecionáveis
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 36,
            gap: 18,
          }}
        >
          {RARITIES.map((color) => (
            <div
              key={color}
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: color,
              }}
            />
          ))}
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
