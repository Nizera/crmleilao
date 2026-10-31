import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Os Caras das Legends — Leilão diário de colecionáveis. Lotes, Pix e envios no seu painel.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Caminho novo para diferenciar a arte da prévia antiga nos serviços de compartilhamento.
export function generateImageMetadata() {
  return [{ id: "colecionaveis-v3", alt, size, contentType }];
}

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), "public/brand/logo-sharing-v3.png"));
  return new ImageResponse(
    <div style={{width:"100%",height:"100%",display:"flex",background:"#10110d",padding:28,color:"#f7f5eb"}}>
      <div style={{display:"flex",width:"100%",height:"100%",border:"2px solid #8e752d",borderRadius:24,flexDirection:"column",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#1d1d12,#10110d)"}}>
        {/* PNG local: preserva a logo aprovada e dispensa fetch remoto no gerador. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/png;base64,${logo.toString("base64")}`} alt="" width={720} height={360} />
        <div style={{display:"flex",fontSize:43,fontWeight:700,letterSpacing:-1,color:"#f5cf43",marginTop:2}}>Leilão diário de colecionáveis</div>
        <div style={{display:"flex",fontSize:25,color:"#dfdfd3",marginTop:20}}>Seus lotes, Pix e envios em um só lugar.</div>
        <div style={{display:"flex",fontSize:20,color:"#b5b3a1",marginTop:27}}>oscarasdaslegends.com.br</div>
      </div>
    </div>,
    size,
  );
}
