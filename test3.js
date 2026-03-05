import { formatQuestionText } from './src/utils/helpers.js';

const text = `
Algum texto.
A) 4
B) 1/2
C) -2
D) -3
E) -1/2
`;
console.log(formatQuestionText(text, null));
