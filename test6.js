import { formatQuestionText } from './src/utils/helpers.js';
import { QuestionParser } from './src/services/search/QuestionParser.js';

const text = "Algum texto.\nA) 4\nB) 1/2\nC) -2\nD) -3\nE) -1/2\n";

console.log("extractOptionsFromQuestion:", QuestionParser.extractOptionsFromQuestion(text));
