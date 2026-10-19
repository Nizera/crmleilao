import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};
export const contentType = "image/png";

const MARK_PATH =
  "M6 3H16.5L21 7.5V18A3 3 0 0 1 18 21H6A3 3 0 0 1 3 18V6A3 3 0 0 1 6 3ZM12 7.4L13.23 10.7L16.76 10.85L14 13.05L14.94 16.45L12 14.5L9.06 16.45L10 13.05L7.24 10.85L10.77 10.7Z";

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
        <svg width="110" height="110" viewBox="0 0 24 24">
          <path fillRule="evenodd" fill="#FFFFFF" d={MARK_PATH} />
        </svg>
      </div>
    ),
    {
      ...size,
    },
  );
}
