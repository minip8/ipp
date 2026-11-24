/**
 * Starter code generated from a problem signature. The type mapping here is the same one the
 * judge's generated driver uses (see the table in problem.ts) - change both together.
 */
import type { Language } from './common';
import type { Method, Param, ProblemSignature, Ty } from './problem';

const isObj = (t: Ty): t is { array: Ty } | { list: Ty } => typeof t === 'object';
const inner = (t: { array: Ty } | { list: Ty }): Ty => ('array' in t ? t.array : t.list);

// ---------- C++ ----------
export function cppType(t: Ty): string {
  if (isObj(t)) return `vector<${cppType(inner(t))}>`;
  return {
    int: 'int',
    long: 'long long',
    double: 'double',
    bool: 'bool',
    string: 'string',
    char: 'char',
    void: 'void',
  }[t];
}
const cppParam = (p: Param) => `${cppType(p.type)}${isObj(p.type) ? '&' : ''} ${p.name}`;

function cpp(sig: ProblemSignature): string {
  const method = (m: Method) =>
    `    ${cppType(m.returns)} ${m.name}(${m.params.map(cppParam).join(', ')}) {\n        ${m.returns === 'void' ? '' : 'return {};'}\n    }`;
  const ctor =
    sig.kind === 'design'
      ? `    ${sig.className}(${sig.ctorParams.map(cppParam).join(', ')}) {\n        \n    }\n\n`
      : '';
  return `#include <bits/stdc++.h>
using namespace std;

class ${sig.className} {
public:
${ctor}${sig.methods.map(method).join('\n\n')}
};

int main() {
    // "Run" executes this file exactly as written - call your code here to try it out.
    // "Run tests" and "Submit" ignore main() and call ${sig.className} directly.
    return 0;
}
`;
}

// ---------- Java ----------
export function javaType(t: Ty, boxed = false): string {
  if (isObj(t)) {
    return 'array' in t ? `${javaType(t.array)}[]` : `List<${javaType(t.list, true)}>`;
  }
  const prim = {
    int: 'int',
    long: 'long',
    double: 'double',
    bool: 'boolean',
    string: 'String',
    char: 'char',
    void: 'void',
  }[t];
  const box = {
    int: 'Integer',
    long: 'Long',
    double: 'Double',
    bool: 'Boolean',
    string: 'String',
    char: 'Character',
    void: 'Void',
  }[t];
  return boxed ? box : prim;
}
function javaDefaultReturn(t: Ty): string {
  if (t === 'void') return '';
  if (t === 'int' || t === 'long' || t === 'double') return 'return 0;';
  if (t === 'bool') return 'return false;';
  if (t === 'char') return "return ' ';";
  return 'return null;';
}
const javaParam = (p: Param) => `${javaType(p.type)} ${p.name}`;

function java(sig: ProblemSignature): string {
  const method = (m: Method) =>
    `    public ${javaType(m.returns)} ${m.name}(${m.params.map(javaParam).join(', ')}) {\n        ${javaDefaultReturn(m.returns)}\n    }`;
  const ctor =
    sig.kind === 'design'
      ? `    public ${sig.className}(${sig.ctorParams.map(javaParam).join(', ')}) {\n        \n    }\n\n`
      : '';
  return `import java.util.*;

class ${sig.className} {
${ctor}${sig.methods.map(method).join('\n\n')}
}

public class Main {
    public static void main(String[] args) {
        // "Run" executes this file exactly as written - call your code here to try it out.
        // "Run tests" and "Submit" ignore main() and call ${sig.className} directly.
    }
}
`;
}

// ---------- Python ----------
export function pythonType(t: Ty): string {
  if (isObj(t)) return `list[${pythonType(inner(t))}]`;
  return {
    int: 'int',
    long: 'int',
    double: 'float',
    bool: 'bool',
    string: 'str',
    char: 'str',
    void: 'None',
  }[t];
}
const pyParams = (ps: Param[]) =>
  ['self', ...ps.map((p) => `${p.name}: ${pythonType(p.type)}`)].join(', ');

function python(sig: ProblemSignature): string {
  const method = (m: Method) =>
    `    def ${m.name}(${pyParams(m.params)}) -> ${pythonType(m.returns)}:\n        pass`;
  const ctor =
    sig.kind === 'design'
      ? `    def __init__(${pyParams(sig.ctorParams)}) -> None:\n        pass\n\n`
      : '';
  return `class ${sig.className}:
${ctor}${sig.methods.map(method).join('\n\n')}


if __name__ == "__main__":
    # "Run" executes this file exactly as written - call your code here to try it out.
    # "Run tests" and "Submit" ignore this block and call ${sig.className} directly.
    pass
`;
}

export function generateScaffold(signature: ProblemSignature, language: Language): string {
  return { cpp, java, python }[language](signature);
}

export function generateScaffolds(signature: ProblemSignature): Record<Language, string> {
  return { cpp: cpp(signature), java: java(signature), python: python(signature) };
}
