import { parse } from '@babel/parser';
import type * as t from '@babel/types';

export function parseFile(code: string, file: string): t.File {
  const ts = /\.tsx?$/.test(file);
  return parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    errorRecovery: true,
    plugins: ts ? ['typescript', 'jsx', 'decorators-legacy'] : ['jsx', 'flow', 'decorators-legacy'],
  });
}
