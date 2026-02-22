const fs = require('fs');

let code = fs.readFileSync('src/services/ApiService.js', 'utf8');

// The file structure is:
// export const ApiService = {
//   ...
// };
// We want to remove duplicate object property methods.
// We'll track the curly braces manually.

const lines = code.split('\n');

const seenMethods = new Set();
let i = 0;
let insideApiService = false;
let currentDepth = 0;
let methodStart = -1;
let currentMethodName = null;

const newLines = [];

// Skip to export const ApiService = {
for (; i < lines.length; i++) {
    const line = lines[i];
    newLines.push(line);
    if (line.includes('export const ApiService = {')) {
        insideApiService = true;
        currentDepth = 1;
        i++;
        break;
    }
}

let skipUntilDepth = -1;

for (; i < lines.length; i++) {
    const line = lines[i];
    let trimmed = line.trim();

    // adjust depth
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;

    // We are at the root level of ApiService if currentDepth is 1 before evaluating this line.
    if (insideApiService && currentDepth === 1 && skipUntilDepth === -1) {
        // Did we hit a root level method signature?
        const methodMatch = line.match(/^    (?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
        if (methodMatch) {
            const mName = methodMatch[1];
            if (['searchWithSerper', '_extractOptionsLocally', 'extractOptionsFromText', 'extractOptionsFromSource'].includes(mName)) {
                if (seenMethods.has(mName)) {
                    // Duplicate! Start skipping.
                    skipUntilDepth = 1; // Wait until depth drops below or to 1 and we close this

                    // We might need to skip preceding JSDoc comments if they existed
                    // For now, let's just pop from newLines until we don't hit /** or *
                    while (newLines.length > 0) {
                        const lastLine = newLines[newLines.length - 1].trim();
                        if (lastLine.startsWith('/**') || lastLine.startsWith('*') || lastLine === '' || lastLine.startsWith('//')) {
                            newLines.pop();
                        } else {
                            break;
                        }
                    }
                } else {
                    seenMethods.add(mName);
                }
            }
        }
    }

    currentDepth += openBraces;
    currentDepth -= closeBraces;

    if (skipUntilDepth !== -1) {
        // We are skipping this line because it's part of a duplicate method
        if (currentDepth <= skipUntilDepth && closeBraces > openBraces) {
            // we closed the duplicate method
            skipUntilDepth = -1;
            // if there's a comma at the end of the closing line, it might be `  },` -> omit it too
        }
    } else {
        newLines.push(line);
    }

    if (currentDepth === 0 && insideApiService) {
        insideApiService = false;
    }
}

// Write the reconstructed file
fs.writeFileSync('src/services/ApiService.js', newLines.join('\n'));
console.log('Deduplication script finished. Kept first occurrence of:', Array.from(seenMethods));

