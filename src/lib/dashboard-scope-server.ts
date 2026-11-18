import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Etiquetas pela data prevista do envio, independente da data de cadastro dos itens. */
export async function fetchScheduledShipments(db: ReturnType<typeof createAdminClient>, from: string, through: string) {
  const rows: {id:string;status:string}[] = [];
  for (let offset=0;;offset+=500) {
    const {data,error}=await db.from("shipments").select("id,status").gte("batch_date",from).lte("batch_date",through).order("id").range(offset,offset+499);
    if(error)return {data:[],error};
    rows.push(...(data??[]));
    if((data?.length??0)<500)break;
  }
  return {data:rows,error:null};
}

/** Consultas paginadas e em blocos para não estourar a URL do PostgREST. */
export async function fetchScopeRows<T>(
  db: ReturnType<typeof createAdminClient>, table: string, column: string,
  ids: string[], select: string, order: string[] = ["id"],
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  const unique = [...new Set(ids)];
  // Two disjoint ID groups at a time; paginate each group without truncation.
  for(let index=0;index<unique.length;index+=200){
    const groups=[unique.slice(index,index+100),unique.slice(index+100,index+200)].filter(ids=>ids.length);
    const results=await Promise.all(groups.map(async ids=>{
      const groupRows:T[]=[];
      for(let offset=0;;offset+=500){
        let query=db.from(table).select(select).in(column,ids);
        for(const key of order)query=query.order(key,{ascending:true});
        const {data,error}=await query.range(offset,offset+499);
        if(error)return {data:[] as T[],error};
        const page=(data??[]) as unknown as T[];groupRows.push(...page);
        if(page.length<500)break;
      }
      return {data:groupRows,error:null};
    }));
    const failed=results.find(result=>result.error);
    if(failed)return {data:[],error:failed.error};
    for(const result of results)rows.push(...result.data);
  }
  return { data: rows, error: null };
}
