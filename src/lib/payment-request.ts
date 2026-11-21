/** Bounds client waiting only; it never cancels or retries a payment mutation. */
export function paymentReadWithTimeout<T>(request: Promise<T>, milliseconds = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("A consulta demorou. Tente novamente; seu pagamento será conferido.")), milliseconds);
    request.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
