"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { rethrowIfRedirect,type ActionResult } from "@/lib/result";
import { allow } from "@/lib/ratelimit";
import { CATALOG_PATH,MAX_PRODUCT_PHOTOS,MAX_PRODUCT_PHOTO_BYTES,isProductImageContent,isProductImagePath,parseProductCsv,storeProductSchema } from "@/lib/store-admin";

function invalidateProducts(id?: string) {
  revalidatePath(CATALOG_PATH); if(id) revalidatePath(`${CATALOG_PATH}/${id}`);
  revalidatePath("/admin/fidelidade"); revalidatePath("/painel/loja");
}
function failure(error:unknown):ActionResult<never> {
  rethrowIfRedirect(error); console.error("[store-products]",error instanceof Error?error.message:"Falha no catálogo");
  return {ok:false,error:"Não foi possível salvar agora. Confira se as migrations 0024 e 0025 foram aplicadas e tente novamente."};
}
export async function saveStoreProductAction(form:FormData):Promise<ActionResult<{id:string}>> {
  const uploaded:string[]=[]; let committed=false; let db:Awaited<ReturnType<typeof createClient>>|null=null;
  try {
    const {profile}=await requireAdmin();
    if(profile.role==="viewer") return {ok:false,error:"Seu perfil é somente leitura."};
    if(!await allow("store-catalog-write",profile.id)) return {ok:false,error:"Aguarde um pouco antes de salvar novamente."};
    const id=String(form.get("id") ?? ""); const productId=id || crypto.randomUUID();
    if(!z.uuid().safeParse(productId).success) return {ok:false,error:"Produto inválido."};
    const intent=String(form.get("intent") ?? "draft");
    if(!["publish","draft","archive"].includes(intent)) return {ok:false,error:"Publicação inválida."};
    const keys=["name","description","sku","category","points_cost","cash_price","mixed_cash_price","mixed_points_cost","internal_cost","stock","low_stock_threshold"];
    const parsed=storeProductSchema.safeParse({...Object.fromEntries(keys.map((key)=>[key,form.get(key)])),delivery_kind:form.get("delivery_kind") ?? "physical",active:intent==="publish",archived:intent==="archive"});
    if(!parsed.success) return {ok:false,error:parsed.error.issues[0]?.message ?? "Revise o cadastro."};
    let retained:unknown;
    try {retained=JSON.parse(String(form.get("retained_images") ?? "[]"));} catch{return {ok:false,error:"Galeria inválida."};}
    if(!Array.isArray(retained) || retained.length>MAX_PRODUCT_PHOTOS || retained.some((path)=>typeof path!=="string" || !isProductImagePath(productId,path)) || new Set(retained).size!==retained.length) return {ok:false,error:"Galeria inválida para este produto."};
    const retainedPaths=retained as string[];
    const files=form.getAll("images").filter((file):file is File=>file instanceof File && file.size>0);
    if(files.length+retainedPaths.length>MAX_PRODUCT_PHOTOS || files.some((file)=>file.size>MAX_PRODUCT_PHOTO_BYTES) || files.reduce((sum,file)=>sum+file.size,0)>3600000) return {ok:false,error:"Use até 6 fotos otimizadas, com até 600 KB cada."};
    for(const file of files) {
      if(!isProductImageContent(new Uint8Array(await file.slice(0,32).arrayBuffer()),file.type)) return {ok:false,error:"Uma imagem não é válida. Envie fotos JPG, PNG ou WebP."};
    }
    db=await createClient();
    let oldPaths:string[]=[];
    const expectedVersion=String(form.get("reward_updated_at") ?? "");
    if(id) {
      const {data:old,error}=await db.from("loyalty_rewards").select("id,image_paths,updated_at").eq("id",id).maybeSingle();
      if(error) throw error;
      if(!old) return {ok:false,error:"Produto não encontrado."};
      if(!expectedVersion || !Number.isFinite(Date.parse(expectedVersion)) || Date.parse(expectedVersion)!==Date.parse(old.updated_at)) return {ok:false,error:"O produto mudou enquanto você editava. Atualize a página e revise o estoque antes de salvar."};
      oldPaths=old.image_paths ?? [];
      if(retainedPaths.some((path)=>!oldPaths.includes(path))) return {ok:false,error:"Uma foto da galeria não pertence à versão atual do produto."};
    } else if(retainedPaths.length) return {ok:false,error:"Um novo produto deve receber novas fotos."};
    for(const file of files) {
      const extension=file.type==="image/jpeg"?"jpg":file.type==="image/png"?"png":"webp";
      const path=`loyalty-rewards/${productId}/${crypto.randomUUID()}.${extension}`;
      const {error}=await db.storage.from("lot-images").upload(path,file,{contentType:file.type,upsert:false});
      if(error) throw error; uploaded.push(path);
    }
    // Ordem enviada pelo editor preserva capa e posição de fotos novas/existentes.
    const orderRaw=String(form.get("photo_order") ?? "");
    let paths=[...retainedPaths,...uploaded];
    if(orderRaw) {
      let order:unknown; try{order=JSON.parse(orderRaw);}catch{throw new Error("Ordem de fotos inválida.");}
      const tokens=[...retainedPaths.map((_,i)=>`old:${i}`),...uploaded.map((_,i)=>`new:${i}`)];
      if(!Array.isArray(order) || order.length!==tokens.length || new Set(order).size!==tokens.length || order.some((token)=>!tokens.includes(token))) throw new Error("Ordem de fotos inválida.");
      paths=order.map((token:string)=>token.startsWith("old:")?retainedPaths[Number(token.slice(4))]:uploaded[Number(token.slice(4))]);
    }
    const values={...parsed.data,sku:parsed.data.sku || (id ? undefined : null),image_paths:paths,image_path:paths[0] ?? null};
    // SKU vazio na edição mantém o atual; no cadastro o banco gera um código.
    const result=id ? await db.from("loyalty_rewards").update(values).eq("id",id).eq("updated_at",expectedVersion).select("id")
      : await db.from("loyalty_rewards").insert({...values,id:productId,created_by:profile.id}).select("id");
    if(result.error || !result.data?.length) {
      if(uploaded.length) await db.storage.from("lot-images").remove(uploaded);
      if(result.error?.code==="23505") return {ok:false,error:"Já existe um produto com este SKU. Use outro código."};
      if(!result.error) return {ok:false,error:"O produto mudou durante o envio. Atualize a página para não sobrescrever estoque ou preços."};
      if(result.error.message.includes("último produto")) return {ok:false,error:result.error.message};
      throw result.error;
    }
    committed=true;
    const removed=oldPaths.filter((path)=>!paths.includes(path));
    if(removed.length) {try {const {error}=await db.storage.from("lot-images").remove(removed); if(error) console.warn("[store-products] limpeza de imagens pendente");}catch{console.warn("[store-products] limpeza de imagens pendente");}}
    invalidateProducts(productId); return {ok:true,data:{id:productId}};
  } catch(error) {if(db && uploaded.length && !committed) await db.storage.from("lot-images").remove(uploaded); return failure(error);}
}

export async function bulkStoreProductsAction(input:unknown):Promise<ActionResult<{count:number}>> {
  try {
    const {profile}=await requireAdmin();
    if(profile.role==="viewer") return {ok:false,error:"Seu perfil é somente leitura."};
    const parsed=z.object({action:z.enum(["publish","draft","archive"]),products:z.array(z.object({id:z.uuid(),updated_at:z.string().refine((value)=>Number.isFinite(Date.parse(value)))})).min(1).max(100)}).safeParse(input);
    if(!parsed.success) return {ok:false,error:"Seleção inválida. Atualize o catálogo."};
    if(!await allow("store-catalog-write",profile.id)) return {ok:false,error:"Aguarde um pouco antes de continuar."};
    const db=await createClient();
    const {data,error}=await db.rpc("bulk_store_products",{p_products:parsed.data.products,p_action:parsed.data.action});
    if(error) {
      if(/mudou|último produto|publicar/.test(error.message)) return {ok:false,error:error.message};
      throw error;
    }
    invalidateProducts(); return {ok:true,data:{count:Number(data)}};
  } catch(error){return failure(error);}
}

export async function importStoreProductsAction(csv:string,requestKey:string):Promise<ActionResult<{count:number}>> {
  try {
    const {profile}=await requireAdmin();
    if(profile.role==="viewer") return {ok:false,error:"Seu perfil é somente leitura."};
    if(!z.uuid().safeParse(requestKey).success) return {ok:false,error:"Selecione o arquivo novamente."};
    if(typeof csv!=="string" || Buffer.byteLength(csv,"utf8")>256000) return {ok:false,error:"O CSV deve ter até 250 KB."};
    const parsed=parseProductCsv(csv);
    if(parsed.errors.length) return {ok:false,error:parsed.errors[0]};
    if(!await allow("store-catalog-write",profile.id)) return {ok:false,error:"Aguarde um pouco antes de importar novamente."};
    const db=await createClient();
    const {data,error}=await db.rpc("import_store_products",{p_rows:parsed.rows,p_request_key:requestKey});
    if(error?.code==="23505") return {ok:false,error:"Um SKU do arquivo já existe no catálogo. Nenhum produto foi importado."};
    if(error) throw error;
    invalidateProducts(); return {ok:true,data:{count:Number(data)}};
  } catch(error){return failure(error);}
}
