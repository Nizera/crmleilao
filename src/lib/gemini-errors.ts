// Nunca devolver o erro bruto do provedor: ele pode conter conteúdo da requisição.
export function geminiFailure(status:number,payload:unknown){
 const p=payload as {error?:{message?:unknown;status?:unknown;details?:{reason?:unknown}[]}}|null;
 const message=typeof p?.error?.message==='string'?p.error.message.toLowerCase():'';
 const reasons=Array.isArray(p?.error?.details)?p.error.details.map(d=>typeof d?.reason==='string'?d.reason:''):[];
 const tag=`AI-${status}`;
 if(reasons.includes('API_KEY_INVALID')||/api key.*(invalid|expired)|api_key_invalid/.test(message))return `${tag}: a chave do Gemini é inválida ou expirou. Confira GEMINI_API_KEY na Vercel e faça um novo deploy.`;
 if(status===401)return `${tag}: o Google não aceitou a autenticação. Confira a chave da Gemini API no Google AI Studio.`;
 if(status===403)return `${tag}: o Google bloqueou o acesso. Confira a API habilitada, as restrições da chave e a disponibilidade na sua conta/região.`;
 if(status===404||/not found|not supported.*generatecontent/.test(message))return `${tag}: o modelo não está disponível para esta chave. Confira GEMINI_MODEL e os modelos liberados no Google AI Studio.`;
 if(status===429){if(/limit:?\s*0\b|quota.*\b0\b/.test(message))return `${tag}: este projeto está sem cota para o modelo escolhido. Confira os limites no Google AI Studio antes de tentar novamente.`;return `${tag}: limite de uso do Gemini atingido. Aguarde e confira as cotas do seu projeto.`;}
 if(status===400)return `${tag}: o Google rejeitou o formato da análise. Confira se o modelo suporta imagens e saída JSON estruturada.`;
 if(status>=500)return `${tag}: o Google continua indisponível após as tentativas automáticas. Aguarde alguns minutos e tente novamente. O preenchimento manual continua disponível.`;
 return `${tag}: a análise foi recusada pelo provedor. Você pode continuar preenchendo manualmente.`;
}
