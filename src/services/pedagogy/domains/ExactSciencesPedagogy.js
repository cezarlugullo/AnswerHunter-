import { normalizePromptText } from '../core/PedagogicalPromptKernel.js';

export function inferPedagogicalDomain(text = '', extra = '') {
    const combined = normalizePromptText(`${text}\n${extra}`);
    if (!combined) return 'general';

    let score = 0;
    if (/\b(limite|continuidade|descontinuidade|dom[ií]nio|derivada|integral|polin[oô]mio|fun[cç][aã]o|ass[ií]ntota|raiz|log|ln|seno|cosseno|tangente|matriz|vetor|equa[cç][aã]o|inequa[cç][aã]o|velocidade|acelera[cç][aã]o|for[cç]a|energia|trabalho|pot[eê]ncia|corrente|tens[aã]o|resist[eê]ncia|carga|campo el[eé]trico|campo magn[eé]tico|frequ[eê]ncia|onda|press[aã]o|densidade|gravidade|cinem[aá]tica|din[aâ]mica|termodin[aâ]mica|impulso|torque|mols?|estequiometria|concentra[cç][aã]o|massa molar|reagente limitante)\b/i.test(combined)) score += 2;
    if (/[=<>±×÷∑∫√∞≤≥Δλμρσθωαβγ]|\blim\b|\bf\s*\([a-z]\)|\bg\s*\([a-z]\)|\bh\s*\([a-z]\)|\b(?:m\/s|m\/s²|m\/s2|kg|newton|joule|watt|pascal|hz|volt|amp[eè]re|ohm|mol|g\/mol)\b/i.test(combined)) score += 2;
    if (/\b[xyn]\s*\^\s*2\b|\b[xyn]\s*2\b|\b[a-z]\/[a-z0-9]/i.test(combined)) score += 1;
    return score >= 3 ? 'exact_sciences' : 'general';
}

export function extractExactSciencesSignals(text = '') {
    const normalized = normalizePromptText(text).toLowerCase();
    const signals = {
        topic: 'exatas',
        firstStep: 'classifique a grandeza, expressão ou relação antes de calcular',
        checklist: [],
        warning: 'não chute pela aparência da alternativa',
    };

    if (/\blimite\b|\blim\b/.test(normalized)) {
        signals.topic = 'limites';
        signals.firstStep = 'faça a substituição direta para ver se aparece número definido, 0/0 ou infinito';
        signals.checklist = [
            'substituição direta primeiro',
            'se der 0/0, fatorar, racionalizar ou simplificar',
            'só substitua no final da expressão simplificada'
        ];
        signals.warning = '0/0 é indeterminação, não resposta final';
        return signals;
    }

    if (/descontinu|continu/.test(normalized)) {
        signals.topic = 'continuidade e descontinuidade';
        signals.firstStep = 'descubra onde cada função deixa de existir ou muda de comportamento';
        signals.checklist = [
            'denominador zero gera ponto proibido',
            'log exige argumento positivo; raiz exige radicando permitido',
            'analise cada função separadamente antes de comparar com as alternativas'
        ];
        signals.warning = 'não misture domínio com valor do limite';
        return signals;
    }

    if (/derivad/.test(normalized)) {
        signals.topic = 'derivadas';
        signals.firstStep = 'identifique a estrutura: potência, produto, quociente ou cadeia';
        signals.checklist = [
            'escolha a regra correta',
            'derive com cuidado os sinais',
            'simplifique antes de comparar alternativas'
        ];
        signals.warning = 'o erro mais comum é esquecer a cadeia ou o sinal';
        return signals;
    }

    if (/integra/.test(normalized)) {
        signals.topic = 'integrais';
        signals.firstStep = 'reconheça o padrão: potência, substituição simples ou fração';
        signals.checklist = [
            'identifique a forma básica',
            'aplique a antiderivada adequada',
            'verifique constante e domínio quando necessário'
        ];
        signals.warning = 'não trate integral como derivada ao contrário sem checar a forma';
        return signals;
    }

    if (/matriz|determinante|sistema linear|vetor/.test(normalized)) {
        signals.topic = 'álgebra linear';
        signals.firstStep = 'identifique a operação pedida antes de manipular os números';
        signals.checklist = [
            'organize linhas, colunas ou componentes',
            'aplique a regra própria da operação',
            'confira compatibilidade dimensional'
        ];
        signals.warning = 'muitos erros vêm de operar objetos incompatíveis';
        return signals;
    }

    if (/velocidade|acelera[cç][aã]o|cinem[aá]tica|queda livre|mru|mruv/.test(normalized)) {
        signals.topic = 'física: cinemática';
        signals.firstStep = 'identifique dados, incógnita e qual equação da cinemática relaciona essas grandezas';
        signals.checklist = [
            'liste dados e incógnita',
            'escolha a equação física compatível',
            'confira sinal, direção e unidade final'
        ];
        signals.warning = 'o erro comum é usar fórmula certa com sinal ou unidade errados';
        return signals;
    }

    if (/for[cç]a|energia|trabalho|pot[eê]ncia|din[aâ]mica|newton|impulso|quantidade de movimento|torque/.test(normalized)) {
        signals.topic = 'física: mecânica';
        signals.firstStep = 'identifique o princípio físico dominante antes de substituir números';
        signals.checklist = [
            'defina sistema e grandezas relevantes',
            'escolha a lei física adequada',
            'verifique sentido, sinal e unidade'
        ];
        signals.warning = 'não misture leis físicas diferentes sem decidir qual fenômeno manda no problema';
        return signals;
    }

    if (/corrente|tens[aã]o|resist[eê]ncia|ohm|circuito|campo el[eé]trico|potencial|capacitor|carga/.test(normalized)) {
        signals.topic = 'física: eletricidade';
        signals.firstStep = 'descubra qual grandeza elétrica é dada, qual é pedida e qual relação governa o circuito';
        signals.checklist = [
            'organize dados e unidades',
            'aplique a relação correta (ohm, potência, associação ou campo)',
            'confira consistência física do resultado'
        ];
        signals.warning = 'não troque corrente, tensão e resistência nem esqueça associações';
        return signals;
    }

    if (/onda|frequ[eê]ncia|comprimento de onda|som|luz|[óo]ptica|optica/.test(normalized)) {
        signals.topic = 'física: ondas e óptica';
        signals.firstStep = 'identifique o fenômeno e a relação entre frequência, comprimento de onda, velocidade ou imagem';
        signals.checklist = [
            'separe o fenômeno físico',
            'aplique a equação ou regra geométrica adequada',
            'confira se o resultado faz sentido no contexto'
        ];
        signals.warning = 'não use fórmulas parecidas fora do contexto do fenômeno';
        return signals;
    }

    if (/mols?|estequiometria|reagente limitante|concentra[cç][aã]o|solu[cç][aã]o|massa molar/.test(normalized)) {
        signals.topic = 'química quantitativa';
        signals.firstStep = 'identifique a relação entre massa, mol, volume ou concentração antes de calcular';
        signals.checklist = [
            'anote dados e unidades',
            'converta para mol quando necessário',
            'aplique a proporção química correta'
        ];
        signals.warning = 'não pule conversões de unidade nem proporções estequiométricas';
        return signals;
    }

    signals.checklist = [
        'identifique grandezas, variáveis e restrições',
        'escolha a relação, lei ou ferramenta correta',
        'só depois compare com as alternativas'
    ];
    return signals;
}

export function buildExactSciencesFewShot(taskType = 'hint') {
    if (taskType === 'hint') {
        return `<examples>
<example>
<input>Questão de limite em que a substituição direta gera 0/0.</input>
<good_output>Antes de comparar as alternativas, o que a substituição direta revelou: valor definido ou indeterminação? Se apareceu 0/0, qual simplificação precisa acontecer antes de substituir de novo?</good_output>
</example>
<example>
<input>Questão de física com velocidade, tempo e aceleração.</input>
<good_output>Quais são as grandezas dadas, qual é a incógnita e qual equação realmente relaciona essas três quantidades? Antes de calcular, as unidades já combinam com o que a questão pede?</good_output>
</example>
</examples>`;
    }

    if (taskType === 'explain') {
        return `<examples>
<example>
<input>Limite com 0/0</input>
<good_output>Primeiro classifico o problema como indeterminação. Depois simplifico a expressão por fatoração ou racionalização. Só então substituo novamente para obter o valor do limite.</good_output>
</example>
<example>
<input>Questão de eletricidade</input>
<good_output>Primeiro identifico quais grandezas são dadas e qual é pedida. Depois escolho a relação física adequada, como a Lei de Ohm ou potência elétrica. No fim, verifico se a unidade obtida faz sentido fisicamente.</good_output>
</example>
</examples>`;
    }

    return `<examples>
<example>
<input>Questão de exatas com procedimento</input>
<good_output>{"mnemonic":"0/0? simplifica primeiro","keyElements":["indeterminação → não é resposta final","simplificação → destrava a conta"],"type":"keyword"}</good_output>
</example>
<example>
<input>Questão física com unidades</input>
<good_output>{"mnemonic":"Lei certa, unidade certa","keyElements":["grandeza → escolha a relação","unidade final → valida o resultado"],"type":"keyword"}</good_output>
</example>
</examples>`;
}

export function buildExactSciencesMnemonicElements(questionText = '', answerText = '', concept = '') {
    const signals = extractExactSciencesSignals(`${questionText}\n${answerText}\n${concept}`);
    const elements = [];

    if (signals.topic === 'limites') {
        elements.push('substituiu e deu 0/0 → simplifique antes');
        elements.push('fator comum ou conjugado → destrava o limite');
        elements.push('só no final substitua o valor pedido');
        return elements;
    }

    if (signals.topic === 'continuidade e descontinuidade') {
        elements.push('denominador zerou → ponto proibido');
        elements.push('log ou raiz → cheque domínio antes');
        elements.push('analise f, g, h separadamente');
        return elements;
    }

    if (signals.topic === 'derivadas') {
        elements.push('veja a forma antes de derivar');
        elements.push('escolha a regra: potência, produto, quociente ou cadeia');
        elements.push('simplifique e só então compare');
        return elements;
    }

    if (signals.topic === 'integrais') {
        elements.push('reconheça o padrão da integral');
        elements.push('aplique a antiderivada certa');
        elements.push('confira domínio e constante quando preciso');
        return elements;
    }

    if (signals.topic.startsWith('física:')) {
        elements.push('dados e incógnita → organize antes');
        elements.push('lei física certa → não substitua no escuro');
        elements.push('unidade e sinal → validam o resultado');
        return elements;
    }

    if (signals.topic === 'química quantitativa') {
        elements.push('dados e unidade → organize primeiro');
        elements.push('mol ou proporção → converta antes');
        elements.push('resultado final → cheque a coerência');
        return elements;
    }

    return [];
}
