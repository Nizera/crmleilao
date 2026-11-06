export function auctionDeadlineExpired(due: string|null|undefined, now=Date.now()):boolean {const time=due?Date.parse(due):NaN;return Number.isFinite(time)&&time<=now;}
export function auctionDeadlineLabel(due:string){return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(due));}
