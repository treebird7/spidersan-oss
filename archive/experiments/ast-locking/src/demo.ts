import { ASTParser } from './parser';

const codeA = `
function funcA() {
    console.log("I am A");
}

function funcB() {
    console.log("I am B");
}
`;

const codeB = `
function funcA() {
    console.log("I am A - changed");
}

function funcB() {
    console.log("I am B");
}
`;

const parser = new ASTParser();
const treeA = parser.parse(codeA);
const treeB = parser.parse(codeB);

console.log("Functions in File A:", parser.getFunctionNames(treeA));
console.log("Functions in File B:", parser.getFunctionNames(treeB));

// Ideally we would hash the function bodies here to detect change
console.log("\nSimulated Check:");
if (codeA.includes("I am A") && codeB.includes("I am A - changed")) {
    console.log("Conflict Detected: 'funcA' modified in both versions (simulated)");
}
