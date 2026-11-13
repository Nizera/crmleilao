import type {PDFFont,PDFPage} from "pdf-lib";

export type CustomerPdfLot={id:string;code:string;title:string;description:string|null;auction_date:string;arremate_value:number;discount_amount?:number;status:string;customer_id:string};
export const MAX_CUSTOMER_PDF_LOTS=200;
export function validateCustomerPdfLots(lots:CustomerPdfLot[]):string{
  if(!lots.length || lots.length>MAX_CUSTOMER_PDF_LOTS)throw new Error("Selecione de 1 a 200 lotes.");
  if(new Set(lots.map(l=>l.id)).size!==lots.length)throw new Error("A seleção contém lotes repetidos.");
  if(new Set(lots.map(l=>l.customer_id)).size!==1 || !lots[0].customer_id)throw new Error("Selecione somente lotes do mesmo cliente.");
  if(lots.some(l=>!["pending_payment","paid","shipped","delivered"].includes(l.status)))throw new Error("Lotes cancelados não podem entrar neste relatório.");
  if(lots.some(l=>!Number.isFinite(l.arremate_value)||l.arremate_value<0||!Number.isSafeInteger(Math.round(l.arremate_value*100))))throw new Error("Confira os valores dos lotes antes de gerar o relatório.");
  return lots[0].customer_id;
}
export function customerPdfFilename(name:string):string{
  const safe=name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,90)||"cliente";
  return `arremates-${safe}.pdf`;
}
const money=(cents:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100).replace(/\u00a0/g," ");
const date=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)?day.split("-").reverse().join("/"):"-";
const status=(value:string)=>({pending_payment:"Não pago",paid:"Pago",shipped:"Enviado",delivered:"Entregue"}[value]??value);
export async function createCustomerLotsPdf(name:string,lots:CustomerPdfLot[],issuedAt=new Date()):Promise<Uint8Array>{
  validateCustomerPdfLots(lots);
  const {PDFDocument,StandardFonts,rgb}=await import("pdf-lib");
  const pdf=await PDFDocument.create();
  const normal=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const characters=new Set(normal.getCharacterSet());
  const clean=(text:string)=>Array.from(text.replace(/[\r\n\t]+/g," ").replace(/\s+/g," ").trim()).map(char=>characters.has(char.codePointAt(0)!)?char:" ").join("");
  const wrap=(text:string,font:PDFFont,size:number,width:number)=>{
    const lines:string[]=[];let line="";
    for(const word of clean(text).split(" ")){
      if(font.widthOfTextAtSize(line?`${line} ${word}`:word,size)<=width){line=line?`${line} ${word}`:word;continue;}
      if(line){lines.push(line);line="";}
      for(const char of word){if(font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line="";}line+=char;}
    }
    if(line)lines.push(line);return lines.length?lines:[""];
  };
  const ink=rgb(.08,.08,.08),muted=rgb(.39,.39,.39),lineColor=rgb(.88,.88,.88);
  let page!:PDFPage;let y=0;
  const text=(value:string,x:number,top:number,size=9,font=normal,color=ink)=>page.drawText(clean(value),{x,y:top,size,font,color});
  const right=(value:string,x:number,top:number,size=9,font=normal)=>text(value,x-font.widthOfTextAtSize(clean(value),size),top,size,font);
  const newPage=()=>{
    page=pdf.addPage();page.setSize(595.28,841.89);
    page.drawRectangle({x:40,y:790,width:32,height:4,color:rgb(.91,.67,.08)});
    text("OS CARAS DAS LEGENDS",40,770,11,bold);
    text("Resumo dos arremates",40,745,21,bold);
    let top=719;
    for(const nameLine of wrap(name,bold,12,515)){text(nameLine,40,top,12,bold);top-=16;}
    text(`Emitido em ${issuedAt.toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"})} | ${lots.length} lote(s) selecionado(s)`,40,top-4,9,normal,muted);
    y=top-38;
    page.drawRectangle({x:40,y:y-8,width:515,height:25,color:rgb(.95,.95,.95)});
    text("Código",46,y,8,bold);text("Leilão",111,y,8,bold);text("Arremate",180,y,8,bold);right("Valor",478,y,8,bold);text("Situação",490,y,8,bold);y-=32;
  };
  newPage();
  for(const lot of lots){
    const description=lot.description?.trim();
    const content=description&&description!==lot.title?`${lot.title} - ${description}`:lot.title;
    const lines=wrap(content,normal,9,215);
    if((lot.discount_amount??0)>0)lines.push(...wrap(`Desconto aplicado: ${money(Math.round((lot.discount_amount??0)*100))}`,normal,8,215));
    let offset=0;
    while(offset<lines.length){
      if(y<110)newPage();
      const available=Math.max(1,Math.floor((y-85)/13));const chunk=lines.slice(offset,offset+available);
      text(lot.code+(offset?" (cont.)":""),46,y,7.5);if(!offset){text(date(lot.auction_date),111,y,8);right(money(Math.round(lot.arremate_value*100)),478,y,9,bold);text(status(lot.status),490,y,8);}
      chunk.forEach((value,index)=>text(value,180,y-index*13,9));y-=chunk.length*13+14;
      page.drawLine({start:{x:40,y:y+5},end:{x:555,y:y+5},thickness:.5,color:lineColor});y-=12;offset+=chunk.length;
      if(offset<lines.length)newPage();
    }
  }
  if(y<175)newPage();
  const total=lots.reduce((sum,l)=>sum+Math.round(l.arremate_value*100),0);
  const paid=lots.filter(l=>l.status!=="pending_payment").reduce((sum,l)=>sum+Math.round(l.arremate_value*100),0);
  y-=12;text("TOTAL DOS ARREMATES",40,y,11,bold);right(money(total),555,y,18,bold);
  y-=25;text(`Pago: ${money(paid)}   |   A pagar: ${money(total-paid)}`,40,y,10);
  y-=23;text("Somente os lotes selecionados. Frete não incluído.",40,y,9,normal,muted);
  const pages=pdf.getPages();pages.forEach((p,index)=>{page=p;text("Os Caras das Legends",40,36,8,normal,muted);right(`Página ${index+1} de ${pages.length}`,555,36,8);});
  pdf.setTitle(`Arremates - ${clean(name)}`);pdf.setAuthor("Os Caras das Legends");pdf.setCreationDate(issuedAt);
  return pdf.save();
}
