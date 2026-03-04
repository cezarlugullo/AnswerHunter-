const cleanQuery = "Você está trabalhando no desenvolvimento de um sistema para caixas de supermercado utilizando a linguagem C. O programa precisa registrar produtos automaticamente ao serem escaneados, capturando os eventos gerados pela leitura do código de barras e processando as informações correspondentes. Considere as seguintes afirmativas sobre a captura de eventos neste contexto: I. Eventos podem ser capturados utilizando bibliotecas específicas para interação com hardware, que fornecem funções de callback para responder imediatamente a esses eventos. II. O uso de threads pode ser necessário para lidar com a entrada de dados do scanner de códigos de barras, garantindo que o programa não congele durante a espera por novos eventos. III. Bibliotecas gráficas como GLUT são ideais para capturar eventos de dispositivos de entrada, pois facilitam a integração com eventos de teclado e mouse. IV. O tratamento de eventos em sistemas de tempo real deve ser feito de forma assíncrona, garantindo que os eventos críticos sejam processados imediatamente, mesmo durante outras operações. Quais afirmativas estão corretas? A) Apenas I e III estão corretas. B) Apenas I e IV estão corretas. C) Apenas II e IV estão corretas.";

const optionMarkers = [...cleanQuery.matchAll(/(^|[\s:;])[A-E]\s*[\)\.\-:]\s/gi)];
console.log(optionMarkers.length);
if (optionMarkers.length >= 2) {
    const firstMarkerIndex = optionMarkers[0].index ?? -1;
    console.log(firstMarkerIndex, "string:", cleanQuery.substring(0, firstMarkerIndex));
}
