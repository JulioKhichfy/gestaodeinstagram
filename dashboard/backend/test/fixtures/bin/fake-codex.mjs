// Codex falso para os testes: devolve os argumentos e um resumo do pedido recebido pelo stdin.
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (input.includes('FALHA_LOGIN')) {
    process.stderr.write('Error: Not logged in. Please sign in with ChatGPT.');
    process.exit(1);
  }
  process.stderr.write('progresso que não deve aparecer na resposta\n');
  process.stdout.write(`ARGS=${process.argv.slice(2).join(' ')}\nSISTEMA=${input.includes('# Instruções (siga sempre)\nSou o sistema')}\nPEDIDO=${input.includes('Faça a legenda')}\n`);
});
