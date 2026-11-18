import {loadLandingSnapshot} from '@/lib/landing-live-server';
export async function GET(){
 try{return Response.json(await loadLandingSnapshot(),{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({error:'Catálogo temporariamente indisponível'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
