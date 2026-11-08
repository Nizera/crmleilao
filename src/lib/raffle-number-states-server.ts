import "server-only";
import {createClient} from "@/lib/supabase/server";
import {type RaffleNumberStates} from "@/lib/raffle-number-states";

export async function readRaffleNumberStates(campaign:string,total:number):Promise<RaffleNumberStates|null>{
 const {data,error}=await(await createClient()).rpc("get_public_raffle_number_states",{p_campaign:campaign});
 if(error||!data)return null;
 return data.total===total && Array.isArray(data.occupied) ? data as RaffleNumberStates : null;
}
