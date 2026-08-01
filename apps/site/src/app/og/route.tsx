import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 };

const HEADLINE = "See your app’s data and network. Live.";
const SUBTEXT =
  "Inspect storage and capture HTTP + GraphQL traffic in one modular Studio. Zero app code. Fully local.";
const TAGLINE = "OPEN SOURCE · DEV-ONLY BY DESIGN";

// Cores literais do tema claro (packages/tokens/tokens.css).
const BG = "#faf9f5";
const TEXT = "#1f1e1d";
const MUTED = "#6b6862";
const ACCENT = "#d97757";
const BORDER = "#e5e2d9";

/**
 * Carrega uma fonte do Google já subsetada ao texto usado (fetch minúsculo). O
 * User-Agent antigo faz o Google servir woff/TTF — não o woff2, que o Satori
 * não lê. Só no render; a Vercel cacheia a imagem gerada. Para robustez máxima
 * vale vendorizar os TTFs no repo e ler do disco.
 */
async function loadGoogleFont(
  family: string,
  weight: number,
  text: string,
): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family,
  )}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (
    await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/40.0.2214.85 Safari/537.36",
      },
    })
  ).text();
  const src = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype|woff)'\)/);
  if (!src) throw new Error(`Font not found: ${family} ${weight}`);
  return (await fetch(src[1])).arrayBuffer();
}

// Fundo: creme + grade sutil de "+" (var(--grid) = texto a 5%) + cruzes de canto.
const gridSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630'>
  <rect width='1200' height='630' fill='${BG}'/>
  <defs><pattern id='p' width='30' height='30' patternUnits='userSpaceOnUse'>
    <path d='M15 12 V18 M12 15 H18' stroke='rgba(31,30,29,0.05)' stroke-width='1'/>
  </pattern></defs>
  <rect width='1200' height='630' fill='url(#p)'/>
  <g stroke='rgba(31,30,29,0.13)' stroke-width='1.5'>
    <path d='M46 34 v18 M37 43 h18'/>
    <path d='M1154 34 v18 M1145 43 h18'/>
    <path d='M46 596 v-18 M37 587 h18'/>
    <path d='M1154 596 v-18 M1145 587 h18'/>
  </g>
</svg>`;
const gridUri = `data:image/svg+xml,${encodeURIComponent(gridSvg)}`;

export async function GET() {
  const sansText = HEADLINE + SUBTEXT;
  const [sans700, sans500, mono600, logo, shot] = await Promise.all([
    loadGoogleFont("Instrument Sans", 700, sansText),
    loadGoogleFont("Instrument Sans", 500, sansText),
    loadGoogleFont("JetBrains Mono", 600, TAGLINE),
    readFile(join(process.cwd(), "public/brand/nativescope-logo.png")),
    readFile(
      join(process.cwd(), "public/screenshots/network-inspector-light.png"),
    ),
  ]);
  const logoUri = `data:image/png;base64,${logo.toString("base64")}`;
  const shotUri = `data:image/png;base64,${shot.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "1200px",
          height: "630px",
          backgroundColor: BG,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={gridUri}
          width={1200}
          height={630}
          style={{ position: "absolute", top: 0, left: 0 }}
          alt=""
        />

        {/* Screenshot de network sangrando na borda direita. */}
        <div
          style={{
            position: "absolute",
            top: "71px",
            left: "612px",
            display: "flex",
            width: "780px",
            height: "488px",
            borderRadius: "16px",
            border: `1px solid ${BORDER}`,
            overflow: "hidden",
            boxShadow: "0 26px 70px rgba(31,30,29,0.16)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shotUri}
            width={780}
            height={488}
            style={{ objectFit: "cover", objectPosition: "left top" }}
            alt=""
          />
        </div>

        {/* Painel esquerdo: logo + headline/sub centralizados como um grupo (o
            logo colado no conteúdo, não jogado no topo). Tagline fixa no rodapé. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: "612px",
            height: "630px",
            padding: "0 40px 0 64px",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUri}
            width={226}
            height={46}
            style={{ marginBottom: "30px" }}
            alt="NativeScope"
          />

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                width: "44px",
                height: "4px",
                borderRadius: "2px",
                backgroundColor: ACCENT,
                marginBottom: "22px",
              }}
            />
            <div
              style={{
                display: "flex",
                fontFamily: "Instrument Sans",
                fontWeight: 700,
                fontSize: "54px",
                lineHeight: 1.04,
                letterSpacing: "-0.02em",
                color: TEXT,
                maxWidth: "470px",
              }}
            >
              {HEADLINE}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: "20px",
                fontFamily: "Instrument Sans",
                fontWeight: 500,
                fontSize: "20px",
                lineHeight: 1.4,
                color: MUTED,
                maxWidth: "440px",
              }}
            >
              {SUBTEXT}
            </div>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: "64px",
            bottom: "52px",
            display: "flex",
            fontFamily: "JetBrains Mono",
            fontWeight: 600,
            fontSize: "13px",
            letterSpacing: "0.14em",
            color: MUTED,
          }}
        >
          {TAGLINE}
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts: [
        { name: "Instrument Sans", data: sans700, weight: 700, style: "normal" },
        { name: "Instrument Sans", data: sans500, weight: 500, style: "normal" },
        { name: "JetBrains Mono", data: mono600, weight: 600, style: "normal" },
      ],
    },
  );
}
