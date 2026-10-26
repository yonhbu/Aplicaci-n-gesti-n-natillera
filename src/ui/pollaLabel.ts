export function pollaLabel(name:string,month:number){
  const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return /^legacy\b/i.test(name.trim())||/^polla\s+mes\s+\d+$/i.test(name.trim())?`Polla de ${months[month-1]}`:name;
}
