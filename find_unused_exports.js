const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];
  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });
  return arrayOfFiles;
}

const files = getAllFiles('./src');
const exportsList = [];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  // Match `export const name =`, `export function name(`, `export interface Name`, `export type Name =`, `export class Name`
  const regex = /export\s+(?:default\s+)?(?:const|let|var|function(?: \*)?|class|interface|type)\s+([a-zA-Z0-9_]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
      if (match[1] !== 'default' && match[1] !== 'GET' && match[1] !== 'POST' && match[1] !== 'PUT' && match[1] !== 'DELETE') {
         exportsList.push({ name: match[1], file: file });
      }
  }
});

exportsList.forEach(exp => {
    try {
        // rg is fast, but let's use grep
        // match whole word
        const countStr = execSync(`grep -r -w "${exp.name}" ./src | wc -l`, { encoding: 'utf8' }).trim();
        const count = parseInt(countStr, 10);
        if (count <= 1) {
            console.log(`Possible unused export: ${exp.name} in ${exp.file} (${count} references)`);
        }
    } catch (e) {
        // ignore errors
    }
});
