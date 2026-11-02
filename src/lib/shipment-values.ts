/** Valores exclusivos da etiqueta. Nunca altera o arremate ou o pagamento. */
export function shipmentValues(subtotal:number,declaredInput:unknown=0,insuranceInput:unknown=0){
 const parse=(raw:unknown,label:string)=>{
  if(raw==null||raw==='')return 0;
  const value=typeof raw==='number'?raw:Number(String(raw).trim().replace(',','.'));
  if(!Number.isFinite(value)||value<0||value>100000||(value>0&&Math.round(value*100)===0))throw new Error(`${label} inválido. Informe um valor entre R$ 0,00 e R$ 100.000,00.`);
  return Math.round(value*100)/100;
 };
 const override=parse(declaredInput,'Valor declarado');
 const declaredValue=override||parse(subtotal,'Subtotal');
 if(declaredValue<=0)throw new Error('Os lotes estão zerados. Informe o valor declarado do prêmio para emitir a etiqueta.');
 const insuranceValue=insuranceInput==null||insuranceInput===''?declaredValue:parse(insuranceInput,'Seguro');
 if(insuranceValue>0&&Math.round(insuranceValue*100)!==Math.round(declaredValue*100))throw new Error('Com seguro, use o mesmo valor declarado do pacote. Para enviar sem seguro, deixe o seguro em zero.');
 return {declaredValue,insuranceValue};
}
