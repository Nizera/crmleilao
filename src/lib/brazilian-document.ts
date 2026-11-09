/** Checks numeric CPF/CNPJ check digits, without asserting ownership or registration. */
export function isValidBrazilianDocument(value:string):boolean {
  if(!/^[\d.\-/\s]+$/.test(value))return false;
  const digits=value.replace(/\D/g,"");
  if(![11,14].includes(digits.length)||/^(\d)\1+$/.test(digits))return false;
  const values=digits.split("").map(Number);
  if(digits.length===11){
    for(const size of [9,10]){
      const remainder=values.slice(0,size).reduce((sum,n,i)=>sum+n*(size+1-i),0)*10%11;
      if(values[size]!== (remainder===10?0:remainder))return false;
    }
  }else{
    for(const size of [12,13]){
      let weight=size-7;
      const sum=values.slice(0,size).reduce((sum,n)=>{const total=sum+n*weight;weight=weight===2?9:weight-1;return total;},0);
      const remainder=sum%11;
      if(values[size]!== (remainder<2?0:11-remainder))return false;
    }
  }
  return true;
}
