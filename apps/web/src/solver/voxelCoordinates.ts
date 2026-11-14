export const key = (i: number, j: number, k: number) => `${i},${j},${k}`;
export const parse = (s: string) => s.split(',').map(Number);
